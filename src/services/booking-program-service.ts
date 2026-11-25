import { Prisma, type PrismaClient, type RecurringBooking } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy, acquireBusinessAgendaLock } from './agenda-locks.js'
import { revalidateBookingWrite } from './booking-operations.js'
import { reserveBenefit } from './customer-benefits.js'
import { hasServiceBenefit } from './membership-domain.js'
import { addDateDays, BookingProgramError, containsDatedInterval, dateKey, DEFAULT_BOOKING_TIMEZONE, localParts, recurrenceDates, validTime, validateDatedHours, weekStart, zonedInstant, type DatedHour } from './booking-program-domain.js'

function fail(code: string, message: string): never { throw new BookingProgramError(code, message) }
export type RecurringInput = { customerId: string; professionalId: string; serviceId: string; startsOn: string; endsOn: string | null; time: string; frequency: string; useBenefits: boolean }
export class BookingProgramService {
  constructor(private readonly db: PrismaClient) {}
  async getWeek(businessId: string, professionalId: string, week: string) {
    if (weekStart(week) !== week) fail('INVALID_WEEK', 'Selecciona el lunes de la semana.')
    const professional = await this.db.professional.findFirst({ where: { businessId, id: professionalId }, include: { workingHours: true } })
    if (!professional) fail('PROFESSIONAL_NOT_FOUND', 'No encontre ese profesional.')
    const saved = await this.db.availabilityWeek.findUnique({ where: { professionalId_weekStart: { professionalId, weekStart: week } } })
    const defaultHours = Array.from({ length: 7 }, (_, i) => addDateDays(week, i)).flatMap(date => professional.workingHours.filter(h => h.dayOfWeek === new Date(date).getUTCDay()).map(h => ({ date, startTime: h.startTime, endTime: h.endTime })))
    return { mode: professional.availabilityMode, weekStart: week, revision: saved?.revision ?? 0, draftHours: saved?.draftHours ?? defaultHours, publishedHours: saved?.publishedHours ?? null, publishedAt: saved?.publishedAt ?? null }
  }
  async setMode(businessId: string, professionalId: string, mode: string) {
    if (!['HABITUAL', 'MANUAL'].includes(mode)) fail('INVALID_MODE', 'Modalidad invalida.')
    return this.db.$transaction(async tx => {
      await acquireAgendaHierarchy(tx, { businessId, professionalIds: [professionalId] })
      return tx.professional.update({ where: { businessId_id: { businessId, id: professionalId } }, data: { availabilityMode: mode } })
    })
  }
  async saveWeek(input: { businessId: string; professionalId: string; weekStart: string; hours: unknown; revision: number; action: 'DRAFT' | 'PREVIEW' | 'PUBLISH'; acknowledgeConflicts?: boolean }) {
    const hours = validateDatedHours(input.weekStart, input.hours)
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('INVALID_REVISION', 'Recarga la semana antes de guardar.')
    return this.db.$transaction(async tx => {
      await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [input.professionalId] })
      const saved = await tx.availabilityWeek.findUnique({ where: { professionalId_weekStart: { professionalId: input.professionalId, weekStart: input.weekStart } } })
      if ((saved?.revision ?? 0) !== input.revision) fail('STALE_WEEK', 'La semana cambio en otra ventana. Recargala antes de guardar.')
      const summary = await this.preview(tx, input.businessId, input.professionalId, input.weekStart, hours)
      if (input.action === 'PREVIEW') return { ...summary, revision: input.revision }
      if (input.action === 'PUBLISH' && summary.appointmentConflicts.length) fail('EXISTING_APPOINTMENT_CONFLICT', 'Hay reservas fuera de las nuevas franjas. Reprogramalas o amplia los horarios antes de publicar.')
      if (input.action === 'PUBLISH' && summary.recurringConflicts.length && !input.acknowledgeConflicts) throw new BookingProgramError('RECURRING_CONFLICTS', 'Revisa los conflictos de repeticion y confirma su publicacion.')
      const data = { draftHours: hours, revision: input.revision + 1, ...(input.action === 'PUBLISH' ? { publishedHours: hours, publishedAt: new Date() } : {}) }
      const week = await tx.availabilityWeek.upsert({ where: { professionalId_weekStart: { professionalId: input.professionalId, weekStart: input.weekStart } }, create: { businessId: input.businessId, professionalId: input.professionalId, weekStart: input.weekStart, ...data }, update: data })
      const generated = input.action === 'PUBLISH' ? await this.materialize(tx, input.businessId, input.professionalId, input.weekStart, addDateDays(input.weekStart, 6)) : []
      return { ...summary, revision: week.revision, publishedAt: week.publishedAt, generated }
    }, { timeout: 30000 })
  }
  private async preview(tx: Prisma.TransactionClient, businessId: string, professionalId: string, week: string, hours: DatedHour[]) {
    const zone = await timezone(tx, businessId)
    const from = zonedInstant(week, '00:00', zone), to = zonedInstant(addDateDays(week, 7), '00:00', zone)
    const appointments = await tx.appointment.findMany({ where: { businessId, professionalId, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: from, lt: to } }, include: { customer: { select: { name: true } } } })
    const appointmentConflicts = appointments.filter(a => !containsDatedInterval(hours, a.startAt, new Date(a.startAt.getTime() + a.totalDurationMinutes * 60000), zone)).map(a => ({ appointmentId: a.id, customer: a.customer.name, startAt: a.startAt, reason: 'Fuera de las nuevas franjas' }))
    const rules = await tx.recurringBooking.findMany({ where: { businessId, professionalId, status: 'ACTIVE' }, include: { customer: { select: { name: true } }, service: true, occurrences: { where: { date: { gte: week, lt: addDateDays(week, 7) } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const planned: Array<{ start: number; end: number }> = appointments.map(a => ({ start: a.startAt.getTime(), end: a.startAt.getTime() + a.totalDurationMinutes * 60000 }))
    const recurringConflicts: Array<{ ruleId: string; date: string; customer: string; reason: string }> = []
    let recurringCount = 0
    for (const rule of rules) for (const date of recurrenceDates(rule, week, addDateDays(week, 6))) {
      const prior = rule.occurrences.find(o => o.date === date)
      if (prior?.status === 'SKIPPED') continue
      recurringCount++
      if (prior?.appointmentId) continue
      const start = zonedInstant(date, rule.time, zone), end = new Date(start.getTime() + rule.service.duration * 60000)
      let reason = !containsDatedInterval(hours, start, end, zone) ? 'Fuera de las franjas de la semana' : planned.some(p => p.start < end.getTime() && p.end > start.getTime()) ? 'Superposicion con otra reserva' : ''
      if (!reason) {
        const validation = await revalidateBookingWrite(tx, { businessId, professionalId, serviceIds: [rule.serviceId], startAt: start, timezone: zone })
        const conflicts = validation.conflicts.filter(c => c !== 'OUTSIDE_PROFESSIONAL_HOURS')
        if (conflicts.length) reason = conflicts.join(', ')
      }
      if (!reason && rule.useBenefits && !await hasBenefitCoverage(tx, businessId, rule.customerId, rule.serviceId, date)) reason = 'Renovacion o usos de beneficio pendientes'
      if (reason) recurringConflicts.push({ ruleId: rule.id, date, customer: rule.customer.name, reason })
      else planned.push({ start: start.getTime(), end: end.getTime() })
    }
    return { daysEnabled: new Set(hours.map(h => h.date)).size, recurringCount, appointmentConflicts, recurringConflicts }
  }
  async createRule(businessId: string, input: RecurringInput) {
    validateRule(input)
    return this.db.$transaction(async tx => {
      await acquireAgendaHierarchy(tx, { businessId, professionalIds: [input.professionalId] })
      if (!await tx.customer.findFirst({ where: { businessId, id: input.customerId } }) || !await tx.service.findFirst({ where: { businessId, id: input.serviceId, isActive: true } }) || !await tx.professionalService.findFirst({ where: { professionalId: input.professionalId, serviceId: input.serviceId } })) fail('INVALID_RULE_RESOURCES', 'Revisa el cliente, el servicio y el profesional.')
      const rule = await tx.recurringBooking.create({ data: { businessId, customerId: input.customerId, professionalId: input.professionalId, serviceId: input.serviceId, startsOn: input.startsOn, endsOn: input.endsOn || null, time: input.time, frequency: input.frequency, useBenefits: input.useBenefits } })
      const today = localParts(new Date(), await timezone(tx, businessId)).date
      await this.materialize(tx, businessId, input.professionalId, today, addDateDays(today, 60))
      return rule
    }, { timeout: 30000 })
  }
  async changeRule(businessId: string, id: string, input: { status: string; revision: number }) {
    if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(input.status)) fail('INVALID_STATUS', 'Estado de repeticion invalido.')
    return this.db.$transaction(async tx => {
      await acquireBusinessAgendaLock(tx, businessId)
      const rule = await tx.recurringBooking.findFirst({ where: { businessId, id } })
      if (!rule || rule.revision !== input.revision || rule.status === 'ENDED') fail('STALE_RULE', 'La repeticion cambio o ya termino. Recarga el listado.')
      // Pausing stops generation. Existing confirmed appointments remain visible and unchanged.
      return tx.recurringBooking.update({ where: { businessId_id: { businessId, id } }, data: { status: input.status, revision: { increment: 1 } } })
    })
  }
  async skip(businessId: string, ruleId: string, date: string) {
    dateKey(date)
    return this.db.$transaction(async tx => {
      await acquireBusinessAgendaLock(tx, businessId)
      const rule = await tx.recurringBooking.findFirst({ where: { businessId, id: ruleId } })
      if (!rule || !recurrenceDates(rule, date, date).length) fail('OCCURRENCE_NOT_FOUND', 'Esa fecha no corresponde a la repeticion.')
      const occurrence = await tx.recurringOccurrence.findUnique({ where: { ruleId_date: { ruleId, date } } })
      if (occurrence?.appointmentId) fail('CANCEL_APPOINTMENT_FIRST', 'Cancela el turno desde Agenda para aplicar su politica de cancelacion.')
      return tx.recurringOccurrence.upsert({ where: { ruleId_date: { ruleId, date } }, create: { businessId, ruleId, date, status: 'SKIPPED' }, update: { status: 'SKIPPED', conflict: null } })
    })
  }
  async refresh(businessId?: string) {
    const rules = await this.db.recurringBooking.findMany({ where: { status: 'ACTIVE', ...(businessId ? { businessId } : {}) }, select: { businessId: true, professionalId: true }, distinct: ['businessId', 'professionalId'], take: 500 })
    for (const rule of rules) await this.db.$transaction(async tx => {
      await acquireAgendaHierarchy(tx, { businessId: rule.businessId, professionalIds: [rule.professionalId] })
      const today = localParts(new Date(), await timezone(tx, rule.businessId)).date
      await this.materialize(tx, rule.businessId, rule.professionalId, today, addDateDays(today, 60))
    }, { timeout: 30000 })
  }
  private async materialize(tx: Prisma.TransactionClient, businessId: string, professionalId: string, from: string, to: string) {
    const zone = await timezone(tx, businessId)
    const professional = await tx.professional.findFirstOrThrow({ where: { businessId, id: professionalId } })
    const rules = await tx.recurringBooking.findMany({ where: { businessId, professionalId, status: 'ACTIVE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const results: Array<{ ruleId: string; date: string; status: string; conflict: string | null }> = []
    for (const rule of rules) for (const date of recurrenceDates(rule, from, to)) {
      if (professional.availabilityMode === 'MANUAL' && !await tx.availabilityWeek.findFirst({ where: { businessId, professionalId, weekStart: weekStart(date), publishedAt: { not: null } } })) continue
      const existing = await tx.recurringOccurrence.findUnique({ where: { ruleId_date: { ruleId: rule.id, date } } })
      if (existing?.appointmentId || existing?.status === 'SKIPPED') continue
      const startAt = zonedInstant(date, rule.time, zone)
      if (startAt <= new Date()) continue
      const validation = await revalidateBookingWrite(tx, { businessId, professionalId, serviceIds: [rule.serviceId], startAt, timezone: zone })
      let conflict = validation.conflicts.join(', ') || null
      if (!validation.orderedServices[0]?.isActive) conflict = 'Servicio inactivo'
      if (!conflict && rule.useBenefits && !await hasBenefitCoverage(tx, businessId, rule.customerId, rule.serviceId, date)) conflict = 'Renovacion o usos de beneficio pendientes'
      let appointmentId: string | null = null
      if (!conflict) {
        const service = validation.orderedServices[0]!
        const appointment = await tx.appointment.create({ data: { businessId, customerId: rule.customerId, professionalId, serviceId: rule.serviceId, startAt, origin: 'MANUAL', status: 'CONFIRMED', totalDurationMinutes: validation.professionalDuration, quotedPrice: service.price, serviceItems: { create: { serviceId: service.id, durationMinutes: service.duration, sortOrder: 0, price: service.price } } } })
        appointmentId = appointment.id
        if (rule.useBenefits) await reserveBenefit(tx, { businessId, customerId: rule.customerId, appointmentId })
      }
      const data = { status: conflict ? 'CONFLICT' : 'BOOKED', conflict, appointmentId }
      await tx.recurringOccurrence.upsert({ where: { ruleId_date: { ruleId: rule.id, date } }, create: { businessId, ruleId: rule.id, date, ...data }, update: data })
      results.push({ ruleId: rule.id, date, status: data.status, conflict })
    }
    return results
  }
}
async function timezone(tx: Prisma.TransactionClient, businessId: string) { return (await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } })).timezone || DEFAULT_BOOKING_TIMEZONE }
async function hasBenefitCoverage(tx: Prisma.TransactionClient, businessId: string, customerId: string, serviceId: string, date: string) {
  const grants = await tx.customerBenefit.findMany({ where: { businessId, customerId, serviceIds: { has: serviceId }, startsOn: { lte: date }, endsOn: { gte: date }, cashEntry: { reversedBy: null } }, include: { uses: { where: { state: { in: ['RESERVED', 'CONSUMED'] } } } } })
  return grants.some(g => hasServiceBenefit(g, serviceId))
}
function validateRule(input: RecurringInput) {
  dateKey(input.startsOn)
  if (input.endsOn) dateKey(input.endsOn)
  if (!input.customerId || !input.professionalId || !input.serviceId || !validTime(input.time) || !['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(input.frequency) || input.endsOn && input.endsOn < input.startsOn || typeof input.useBenefits !== 'boolean') fail('INVALID_RULE', 'Revisa los datos de la repeticion.')
}
