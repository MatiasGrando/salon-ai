import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { Prisma } from '../generated/prisma/client.js'
import { localDateKey, localDateTimeToInstants, weekdayInTimezone } from '../bot-options/application/availability-queries.js'
import { acquireAgendaHierarchy, lockAppointmentRows } from './agenda-locks.js'
import { revalidateBookingWrite } from './booking-operations.js'
import { getWeexAuthFromRequest } from './weex-account-service.js'
import { resolveGuestBookingAccesses } from './guest-booking-access.js'

export async function persistWebBookingOwner(tx: Prisma.TransactionClient, input: {
  businessId: string; appointmentId: string; accountId: string
}) {
  const attributed = await tx.appointment.updateMany({
    where: { id: input.appointmentId, businessId: input.businessId, origin: 'WEB', createdByWeexAccountId: null },
    data: { createdByWeexAccountId: input.accountId }
  })
  if (attributed.count !== 1) throw new Error('WEB_BOOKING_OWNER_NOT_ATTRIBUTED')
}

export function webSelfServiceSummary(appointment: {
  origin?: string; status: string; startAt: Date; visitId?: string | null;
  bookingDeposit?: { source: string; status: string; snapshotSealedAt?: Date | null; visitId?: string | null } | null
}, authorized: boolean, now = new Date()) {
  const deposit = appointment.bookingDeposit
  const supported = authorized && appointment.origin === 'WEB' && appointment.status === 'CONFIRMED' &&
    appointment.startAt.getTime() > now.getTime() && !appointment.visitId &&
    (!deposit || deposit.source === 'WEB' && deposit.status === 'APPROVED' && !deposit.snapshotSealedAt && !deposit.visitId)
  return { mode: supported ? 'direct' as const : 'contact' as const, canReschedule: supported, canCancel: supported,
    reason: supported ? null : !authorized
      ? 'Para modificar esta reserva anterior, comunicate con el local.'
      : appointment.status === 'CANCELLED' ? 'La reserva está cancelada.'
      : 'Esta reserva requiere la gestión del local. La seña y los pagos se conservan.' }
}

export class WebAppointmentSelfServiceError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); this.name = 'WebAppointmentSelfServiceError' }
}
const fail = (status: number, message: string): never => { throw new WebAppointmentSelfServiceError(status, message) }
const unavailable = (): never => fail(404, 'No encontramos un acceso vigente para gestionar esta reserva.')
const stale = (): never => fail(409, 'La reserva o los horarios cambiaron. Actualizá los datos y elegí nuevamente.')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const groupInclude = { service: true, professional: true,
  serviceItems: { orderBy: { sortOrder: 'asc' as const } },
  bookingDeposit: { select: { id: true, source: true, status: true, amount: true, snapshotSealedAt: true, visitId: true } }
} satisfies Prisma.AppointmentInclude
type Member = Prisma.AppointmentGetPayload<{ include: typeof groupInclude }>
type Scope = { request: FastifyRequest; businessId: string; appointmentId: string }
type Actor = { kind: 'ACCOUNT' | 'GUEST'; id: string }
type Policy = { timezone: string; cancellationLeadMinutes: number; rescheduleLeadMinutes: number; bookingHorizonDays: number; bookingLeadTimeHours: number }
type Loaded = { members: Member[]; actor: Actor; policy: Policy; now: Date; revision: string }

async function load(tx: Prisma.TransactionClient, scope: Scope): Promise<Loaded> {
  if (typeof scope.appointmentId !== 'string' || scope.appointmentId.length > 128) unavailable()
  const anchor = await tx.appointment.findFirst({
    where: { id: scope.appointmentId, businessId: scope.businessId, origin: 'WEB' }, include: groupInclude
  })
  if (!anchor || anchor.origin !== 'WEB' || anchor.businessId !== scope.businessId) unavailable()
  const members = anchor.coordinationGroupId ? await tx.appointment.findMany({
    where: { coordinationGroupId: anchor.coordinationGroupId }, include: groupInclude,
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 6
  }) : [anchor]
  if (!members.length || members.length > 5 || members.some(a => a.businessId !== scope.businessId || a.origin !== 'WEB' || a.customerId !== anchor.customerId)) unavailable()
  members.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id))
  const auth = await getWeexAuthFromRequest(scope.request, tx)
  let actor: Actor | null = auth && members.every(a => a.createdByWeexAccountId === auth.account.id)
    ? { kind: 'ACCOUNT', id: auth.account.id } : null
  if (!actor) {
    const scopes = await resolveGuestBookingAccesses(scope.request, scope.businessId, tx)
    const grant = scopes.find(s => s.access.appointmentIds.length === members.length &&
      members.every(a => s.access.appointmentIds.includes(a.id)))
    if (grant) actor = { kind: 'GUEST', id: grant.access.id }
  }
  if (!actor) unavailable()
  const [business, configured, clock] = await Promise.all([
    tx.business.findUnique({ where: { id: scope.businessId }, select: { timezone: true } }),
    tx.businessBotOptionsSettings.findUnique({ where: { businessId: scope.businessId } }),
    tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`/* web-self-service-now */ SELECT clock_timestamp() AS now`)
  ])
  if (!business || !clock[0]?.now) unavailable()
  const policy: Policy = {
    timezone: configured?.timezone || business.timezone || 'America/Argentina/Buenos_Aires',
    cancellationLeadMinutes: configured?.cancellationLeadMinutes ?? 60,
    rescheduleLeadMinutes: configured?.rescheduleLeadMinutes ?? 60,
    bookingHorizonDays: configured?.bookingHorizonDays ?? 30,
    bookingLeadTimeHours: configured?.bookingLeadTimeHours ?? 0
  }
  try { new Intl.DateTimeFormat('en', { timeZone: policy.timezone }).format(clock[0].now) } catch { fail(422, 'El local debe revisar su configuración horaria.') }
  if (![policy.cancellationLeadMinutes, policy.rescheduleLeadMinutes, policy.bookingLeadTimeHours].every(v => Number.isFinite(v) && v >= 0) ||
    !Number.isInteger(policy.bookingHorizonDays) || policy.bookingHorizonDays < 1 || policy.bookingHorizonDays > 366) {
    fail(422, 'El local debe revisar sus reglas para gestionar turnos.')
  }
  return { members, actor, policy, now: clock[0].now, revision: revisionFor(members) }
}

function revisionFor(members: Member[]) {
  return digest(members.map(a => ({ id: a.id, version: a.version, startAt: a.startAt.toISOString(),
    professionalId: a.professionalId, status: a.status, duration: a.totalDurationMinutes,
    serviceIds: services(a), quote: a.quotedPrice, owner: a.createdByWeexAccountId,
    deposit: a.bookingDeposit, visitId: a.visitId })))
}

function services(member: Member) { return member.serviceItems.length ? member.serviceItems.map(s => s.serviceId) : [member.serviceId] }
function serialize(member: Member) {
  return { id: member.id, startAt: member.startAt.toISOString(), status: member.status,
    service: { id: member.serviceId, name: member.service.name, duration: member.totalDurationMinutes,
      price: member.quotedPrice ?? (member.serviceItems.length && member.serviceItems.every(s => s.price !== null)
        ? member.serviceItems.reduce((sum, s) => sum + s.price!, 0) : null) },
    professional: { id: member.professionalId, name: member.professional.name } }
}
function permissions(loaded: Loaded) {
  const supported = loaded.members.every(a => webSelfServiceSummary(a, true, loaded.now).mode === 'direct')
  const lead = loaded.members[0]!.startAt.getTime() - loaded.now.getTime()
  const canCancel = supported && lead >= loaded.policy.cancellationLeadMinutes * 60_000
  const canReschedule = supported && lead >= loaded.policy.rescheduleLeadMinutes * 60_000
  return { mode: canCancel || canReschedule ? 'direct' as const : 'contact' as const, canCancel, canReschedule,
    reason: !supported ? 'Esta reserva requiere la gestión del local. La seña y los pagos se conservan.'
      : !canCancel || !canReschedule ? 'Por la anticipación requerida, consultá al local para esta gestión.' : null,
    revision: loaded.revision }
}
async function professionalChoices(tx: Prisma.TransactionClient, scope: Scope, loaded: Loaded) {
  const [professionals, links] = await Promise.all([
    tx.professional.findMany({ where: { businessId: scope.businessId, isActive: true }, select: { id: true, name: true } }),
    tx.professionalService.findMany({ where: { professional: { businessId: scope.businessId, isActive: true },
      serviceId: { in: [...new Set(loaded.members.flatMap(services))] } }, select: { professionalId: true, serviceId: true } })
  ])
  return loaded.members.map(member => ({ appointmentId: member.id,
    professionals: professionals.filter(p => services(member).every(serviceId => links.some(l => l.professionalId === p.id && l.serviceId === serviceId))) }))
}
async function management(tx: Prisma.TransactionClient, scope: Scope, loaded: Loaded, view?: 'actions') {
  const permission = permissions(loaded)
  return { appointments: loaded.members.map(serialize), selfService: { ...permission,
    professionalChoices: view !== 'actions' && permission.canReschedule ? await professionalChoices(tx, scope, loaded) : [], timezone: loaded.policy.timezone } }
}
export async function webAppointmentManagement(tx: Prisma.TransactionClient, input: Scope & { view?: 'actions' }) {
  return management(tx, input, await load(tx, input), input.view)
}

type Segment = { appointmentId: string; startAt: string; professionalId: string; professionalName: string; serviceName: string; durationMinutes: number }
type Option = { id: string; date: string; time: string; segments: Segment[] }
function proposedSegments(loaded: Loaded, startAt: Date, professionalIds: string[], names: Map<string, string>) {
  const firstAt = loaded.members[0]!.startAt.getTime()
  return loaded.members.map((member, index) => ({ appointmentId: member.id,
    startAt: new Date(startAt.getTime() + member.startAt.getTime() - firstAt).toISOString(),
    professionalId: professionalIds[index]!, professionalName: names.get(professionalIds[index]!)!,
    serviceName: member.service.name, durationMinutes: member.totalDurationMinutes }))
}
function contained(hours: Array<{ startTime: string; endTime: string }>, startAt: Date, endAt: Date, timezone: string) {
  if (localDateKey(startAt, timezone) !== localDateKey(endAt, timezone)) return false
  const time = (value: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(value)
  return hours.some(h => h.startTime <= time(startAt) && h.endTime >= time(endAt))
}
async function options(tx: Prisma.TransactionClient, scope: Scope, loaded: Loaded, date: string, submittedIds?: string[]) {
  if (!permissions(loaded).canReschedule) fail(422, 'Para reprogramar esta reserva, comunicate con el local. La seña y los pagos se conservan.')
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !localDateTimeToInstants(date, 720, loaded.policy.timezone).length) fail(400, 'Elegí una fecha válida.')
  const today = localDateKey(loaded.now, loaded.policy.timezone)
  const horizon = localDateKey(loaded.now, loaded.policy.timezone, loaded.policy.bookingHorizonDays)
  if (date < today || date >= horizon) return []
  const choices = await professionalChoices(tx, scope, loaded)
  const ids = submittedIds ?? loaded.members.map(a => a.professionalId)
  if (!Array.isArray(ids) || ids.length !== loaded.members.length || ids.some((id, i) => typeof id !== 'string' || !choices[i]!.professionals.some(p => p.id === id))) {
    fail(400, 'Elegí un profesional habilitado para cada servicio.')
  }
  const dayStart = localDateTimeToInstants(date, 0, loaded.policy.timezone)[0]!
  const nextDate = new Date(date + 'T12:00:00Z'); nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const dayEnd = localDateTimeToInstants(nextDate.toISOString().slice(0, 10), 0, loaded.policy.timezone)[0]!
  if (!dayStart || !dayEnd) return []
  const weekday = weekdayInTimezone(dayStart, loaded.policy.timezone)
  const [hours, professionalHours, blocks, busy] = await Promise.all([
    tx.businessHours.findMany({ where: { businessId: scope.businessId, dayOfWeek: weekday } }),
    tx.professionalHours.findMany({ where: { professionalId: { in: ids }, dayOfWeek: weekday } }),
    tx.scheduleBlock.findMany({ where: { businessId: scope.businessId, startAt: { lt: dayEnd }, endAt: { gt: dayStart },
      OR: [{ professionalId: { in: ids } }, { professionalId: null }] } }),
    tx.$queryRaw<Array<{ professionalId: string; startAt: Date; endAt: Date }>>(Prisma.sql`
      /* web-self-service-busy */ SELECT a."professionalId",a."startAt",a."startAt"+make_interval(mins=>a."totalDurationMinutes") AS "endAt"
      FROM "Appointment" a LEFT JOIN "BookingDeposit" d ON d."appointmentId"=a.id
      WHERE a."businessId"=${scope.businessId} AND a."professionalId" IN (${Prisma.join(ids)})
        AND a.id NOT IN (${Prisma.join(loaded.members.map(a => a.id))})
        AND a."startAt"<${dayEnd} AND a."startAt"+make_interval(mins=>a."totalDurationMinutes")>${dayStart}
        AND (a.status='CONFIRMED'::"AppointmentStatus" OR (a.status='PENDING'::"AppointmentStatus"
          AND NOT COALESCE(d.status='PENDING_PROOF'::"BookingDepositStatus" AND d."expiresAt"<=${loaded.now},false)
          AND NOT EXISTS (SELECT 1 FROM "BookingVisit" held WHERE held.id=a."visitId" AND held."businessId"=a."businessId" AND held.status='HELD'::"BookingVisitStatus" AND held."holdExpiresAt"<=${loaded.now})))`)
  ])
  const names = new Map(choices.flatMap(c => c.professionals).map(p => [p.id, p.name]))
  const result: Option[] = []
  for (let minute = 0; minute < 1440; minute += 30) for (const startAt of localDateTimeToInstants(date, minute, loaded.policy.timezone)) {
    if (startAt.getTime() < loaded.now.getTime() + loaded.policy.bookingLeadTimeHours * 3600000) continue
    const segments = proposedSegments(loaded, startAt, ids, names)
    if (!segments.every(segment => {
      const start = new Date(segment.startAt), end = new Date(start.getTime() + segment.durationMinutes * 60000)
      return Number.isSafeInteger(segment.durationMinutes) && segment.durationMinutes > 0 && segment.durationMinutes <= 1440 &&
        contained(hours, start, end, loaded.policy.timezone) &&
        contained(professionalHours.filter(h => h.professionalId === segment.professionalId), start, end, loaded.policy.timezone) &&
        !blocks.some(b => (!b.professionalId || b.professionalId === segment.professionalId) && b.startAt < end && b.endAt > start) &&
        !busy.some(b => b.professionalId === segment.professionalId && b.startAt < end && b.endAt > start)
    })) continue
    if (segments.some((segment, index) => segments.slice(index + 1).some(other =>
      segment.professionalId === other.professionalId && new Date(segment.startAt).getTime() + segment.durationMinutes * 60000 > new Date(other.startAt).getTime()))) continue
    const time = `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`
    result.push({ id: digest({ businessId: scope.businessId, revision: loaded.revision, date, segments }), date, time, segments })
  }
  return result
}
export async function webAppointmentRescheduleOptions(tx: Prisma.TransactionClient, input: Scope & { date: string; professionalIds?: string[] }) {
  const loaded = await load(tx, input)
  return { selfService: permissions(loaded), options: await options(tx, input, loaded, input.date, input.professionalIds) }
}

export function assertWebAppointmentMutationOrigin(request: FastifyRequest) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
    fail(403, 'Esta acción debe realizarse desde la página de tu reserva.')
  }
  try {
    const supplied = new URL(origin)
    let expected = new URL(request.protocol + '://' + request.host)
    if (process.env.NODE_ENV === 'production' && request.protocol === 'http') {
      const baseDomain = (process.env.PUBLIC_BASE_DOMAIN ?? 'weex.com.ar').trim().toLowerCase()
      const publicDomain = baseDomain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(baseDomain)
      const publicExpected = new URL('https://' + request.host)
      const authority = request.host.toLowerCase()
      const canonicalAuthority = authority === publicExpected.host || !publicExpected.port && authority === publicExpected.hostname + ':443'
      const prefix = publicExpected.hostname.endsWith('.' + baseDomain) ? publicExpected.hostname.slice(0, -baseDomain.length - 1) : ''
      // Public HTTPS is canonical even when ingress terminates TLS. Forwarded
      // headers are usable only through Fastify's explicitly trusted peer policy.
      if (publicDomain && canonicalAuthority && (publicExpected.hostname === baseDomain || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix))) expected = publicExpected
    }
    if (!['https:', 'http:'].includes(supplied.protocol) || supplied.username || supplied.password || supplied.origin !== expected.origin || origin !== supplied.origin) throw new Error('origin')
  } catch { fail(403, 'Esta acción debe realizarse desde la página de tu reserva.') }
}
export async function mutateWebAppointment(tx: Prisma.TransactionClient, input: Scope & { action: 'RESCHEDULE' | 'CANCEL'; body: unknown }) {
  assertWebAppointmentMutationOrigin(input.request)
  const body = input.body as Record<string, unknown>
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    typeof body.operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId) ||
    typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision) ||
    !['RESCHEDULE', 'CANCEL'].includes(input.action)) fail(400, 'Revisá los datos de la gestión.')
  const allowed = input.action === 'CANCEL' ? ['revision', 'operationId', 'confirmed'] : ['revision', 'operationId', 'date', 'professionalIds', 'optionId']
  if (Object.keys(body).some(key => !allowed.includes(key)) || input.action === 'CANCEL' && body.confirmed !== true) fail(400, 'Confirmá explícitamente la acción desde el resumen.')
  // Business → all old/new professional locks → appointment rows. Re-read authority after waiting.
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [] })
  let loaded = await load(tx, input)
  const submitted = Array.isArray(body.professionalIds) && body.professionalIds.every(id => typeof id === 'string' && id.length <= 128)
    ? body.professionalIds as string[] : []
  await acquireAgendaHierarchy(tx, { businessId: input.businessId,
    professionalIds: [...loaded.members.map(a => a.professionalId), ...submitted] })
  await lockAppointmentRows(tx, { businessId: input.businessId, appointmentIds: loaded.members.map(a => a.id) })
  loaded = await load(tx, input)
  const requestHash = digest({ businessId: input.businessId, appointmentId: input.appointmentId, actor: loaded.actor,
    action: input.action, revision: body.revision, ...(input.action === 'CANCEL' ? { confirmed: body.confirmed }
      : { date: body.date, professionalIds: body.professionalIds, optionId: body.optionId }) })
  const prior = await tx.webAppointmentAction.findUnique({ where: { operationId: body.operationId as string } })
  if (prior) {
    if (prior.businessId !== input.businessId || prior.actorType !== loaded.actor.kind || prior.actorId !== loaded.actor.id || prior.requestHash !== requestHash) stale()
    return { ...await management(tx, input, loaded), idempotent: true }
  }
  if (loaded.revision !== body.revision) stale()
  const permission = permissions(loaded)
  if (input.action === 'CANCEL' ? !permission.canCancel : !permission.canReschedule) fail(422, permission.reason || 'Solicitá esta gestión al local. La seña y los pagos se conservan.')
  // The reminder worker claims these same rows with UPDATE. A claim either wins
  // first (we abort), or waits until our cancellation commits (its claim fails).
  const reminders = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    /* web-self-service-reminders */ SELECT id,status FROM "ReminderDelivery"
    WHERE "businessId"=${input.businessId} AND "appointmentId" IN (${Prisma.join(loaded.members.map(a => a.id))})
      AND status IN ('PENDING','FAILED','PROCESSING') ORDER BY id FOR UPDATE`)
  if (reminders.some(r => r.status === 'PROCESSING')) fail(409, 'Hay una comunicación del turno en curso. Esperá un momento y volvé a intentar; no modificamos la reserva.')
  let option: Option | undefined
  if (input.action === 'RESCHEDULE') {
    if (typeof body.date !== 'string' || typeof body.optionId !== 'string' || submitted.length !== loaded.members.length) fail(400, 'Elegí fecha, profesionales y un horario vigente.')
    option = (await options(tx, input, loaded, body.date, submitted)).find(o => o.id === body.optionId)
    if (!option) stale()
    for (const [index, member] of loaded.members.entries()) {
      const segment = option.segments[index]!
      const validation = await revalidateBookingWrite(tx, { businessId: input.businessId, professionalId: segment.professionalId,
        professionalIdsToLock: [...loaded.members.map(a => a.professionalId), ...submitted], serviceIds: services(member),
        startAt: new Date(segment.startAt), excludeAppointmentIds: loaded.members.map(a => a.id),
        contractedDurationMinutes: { professional: member.totalDurationMinutes, customer: member.totalDurationMinutes },
        timezone: loaded.policy.timezone, dbNow: loaded.now })
      if (validation.conflicts.length) stale()
    }
  }
  const before = loaded.members.map(serialize)
  const changedMembers: Member[] = []
  for (const [index, member] of loaded.members.entries()) {
    const segment = option?.segments[index]
    const updated = await tx.appointment.update({ where: { id: member.id }, data: segment
      ? { startAt: new Date(segment.startAt), professionalId: segment.professionalId, version: { increment: 1 } }
      : { status: 'CANCELLED', version: { increment: 1 } } })
    if (updated.professionalId !== (segment?.professionalId ?? member.professionalId) ||
      updated.startAt.getTime() !== (segment ? new Date(segment.startAt).getTime() : member.startAt.getTime()) ||
      updated.status !== (segment ? member.status : 'CANCELLED') || updated.serviceId !== member.serviceId ||
      updated.businessId !== member.businessId || updated.customerId !== member.customerId ||
      updated.quotedPrice !== member.quotedPrice || updated.totalDurationMinutes !== member.totalDurationMinutes ||
      updated.coordinationGroupId !== member.coordinationGroupId || updated.createdByWeexAccountId !== member.createdByWeexAccountId ||
      updated.origin !== member.origin || updated.visitId !== member.visitId) stale()
    // UPDATE returns real database scalars (including trigger-produced version).
    // Relations/snapshots came from the fresh authorized read under the same locks;
    // only a validated professional can replace that relation in this operation.
    changedMembers.push({ ...member, ...updated, professional: segment
      ? { ...member.professional, id: updated.professionalId, name: segment.professionalName }
      : member.professional })
  }
  await tx.reminderDelivery.updateMany({
    where: { businessId: input.businessId, appointmentId: { in: loaded.members.map(a => a.id) }, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'CANCELLED', manualNote: 'La reserva cambió desde la web; se requiere preparar el recordatorio vigente.' }
  })
  changedMembers.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id))
  const changed: Loaded = { ...loaded, members: changedMembers, revision: revisionFor(changedMembers) }
  await tx.webAppointmentAction.create({ data: {
    operationId: body.operationId as string, businessId: input.businessId, appointmentIds: loaded.members.map(a => a.id),
    actorType: loaded.actor.kind, actorId: loaded.actor.id, action: input.action, requestHash,
    before, after: changed.members.map(serialize)
  } })
  return { ...await management(tx, input, changed), idempotent: false }
}
