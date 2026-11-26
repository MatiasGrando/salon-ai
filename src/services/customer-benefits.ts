import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { acquireBusinessAgendaLock } from './agenda-locks.js'
import { benefitSummary, BookingProgramError, dateKey, localParts, DEFAULT_BOOKING_TIMEZONE } from './booking-program-domain.js'
import { allocateMembership, membershipServices, membershipBalances, membershipEnd, priceMembership, validateMembershipItems, type MembershipServiceInput } from './membership-domain.js'
import { createCashTransactionRepository } from '../repositories/prisma-cash-repository.js'
import { ensureAppointmentAccountForPayment } from './cash-service.js'

export type BenefitPlanInput = { name: string; kind: string; serviceIds: string[]; serviceRules?: MembershipServiceInput[]; totalUses: number | null; discountPercent: number; price: number; validityDays: number; cancellationHours: number; consumeLateCancellation: boolean; consumeNoShow: boolean; isActive?: boolean }
function fail(code: string, message: string): never { throw new BookingProgramError(code, message) }
function int(value: number, min: number, max: number) { return Number.isSafeInteger(value) && value >= min && value <= max }
async function lockBenefitBusiness(tx: Prisma.TransactionClient, businessId: string, agendaBusinessLocked = false) {
  if (!agendaBusinessLocked) await acquireBusinessAgendaLock(tx, businessId)
  // Match the cash ledger's Business -> session/account lock order.
  const [business] = await tx.$queryRaw<Array<{ timezone: string | null }>>(
    Prisma.sql`SELECT timezone FROM "Business" WHERE id=${businessId} FOR UPDATE`
  )
  return business?.timezone || DEFAULT_BOOKING_TIMEZONE
}

export class CustomerBenefitsService {
  constructor(private readonly db: PrismaClient) {}
  async quote(businessId: string, customerId: string, date: string, serviceIds: string[]) {
    dateKey(date)
    if (!Array.isArray(serviceIds) || !serviceIds.length || serviceIds.length > 100 || serviceIds.some(id => typeof id !== 'string' || !id) || new Set(serviceIds).size !== serviceIds.length) fail('INVALID_SERVICES', 'Selecciona servicios validos.')
    const services = await this.db.service.findMany({ where: { businessId, id: { in: serviceIds }, isActive: true }, select: { id: true, price: true } })
    if (services.length !== serviceIds.length) fail('INVALID_SERVICES', 'Selecciona servicios del comercio.')
    const grants = await this.db.customerBenefit.findMany({ where: { businessId, customerId, startsOn: { lte: date }, endsOn: { gte: date }, cashEntry: { reversedBy: null } }, include: { uses: { where: { state: { in: ['RESERVED', 'CONSUMED'] } } } }, orderBy: [{ endsOn: 'asc' }, { id: 'asc' }] })
    for (const grant of grants) {
      const allocations = allocateMembership(grant, services.map(s => ({ serviceId: s.id, price: s.price })))
      if (allocations.length) return { benefitId: grant.id, name: grant.name, endsOn: grant.endsOn, coveredAmount: allocations.reduce((sum, a) => sum + a.originalPrice, 0), serviceIds: allocations.map(a => a.serviceId) }
    }
    return null
  }
  async savePlan(businessId: string, input: BenefitPlanInput, id?: string) {
    const perService = input?.serviceRules !== undefined
    if (perService) {
      validateMembershipItems(input.serviceRules)
      input = { ...input, serviceIds: input.serviceRules.map(r => r.serviceId), totalUses: input.serviceRules.reduce((sum, r) => sum + r.uses, 0), discountPercent: 100 }
    }
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || !['PACK', 'MEMBERSHIP'].includes(input.kind) ||
      !Array.isArray(input.serviceIds) || !input.serviceIds.length || input.serviceIds.length > 100 || new Set(input.serviceIds).size !== input.serviceIds.length ||
      !int(input.price, 1, 2147483647) || !int(input.validityDays, 1, 3650) || !int(input.cancellationHours, 0, 720) || !int(input.discountPercent, 0, 100) ||
      (input.totalUses !== null && !int(input.totalUses, 1, 10000)) || (input.kind === 'PACK' && input.totalUses === null) ||
      (input.totalUses === null && input.discountPercent === 0) || typeof input.consumeLateCancellation !== 'boolean' || typeof input.consumeNoShow !== 'boolean') fail('INVALID_BENEFIT_PLAN', 'Revisa los servicios, usos, precio y vigencia del beneficio.')
    return this.db.$transaction(async tx => {
      await lockBenefitBusiness(tx, businessId)
      const services = await tx.service.findMany({ where: { businessId, id: { in: input.serviceIds }, isActive: true }, select: { id: true, name: true, price: true, priceMode: true } })
      if (services.length !== input.serviceIds.length) fail('INVALID_SERVICES', 'Hay servicios que no pertenecen al comercio o estan inactivos.')
      const priced = perService ? priceMembership(input.serviceRules!, services) : null
      const data = { name: input.name.trim(), kind: input.kind, serviceIds: input.serviceIds, serviceRules: priced?.rules ?? [], totalUses: input.totalUses, discountPercent: input.totalUses !== null ? 100 : input.discountPercent,
        price: input.price, validityDays: input.validityDays, cancellationHours: input.cancellationHours, consumeLateCancellation: input.consumeLateCancellation, consumeNoShow: input.consumeNoShow, isActive: input.isActive ?? true }
      if (id && !await tx.benefitPlan.findFirst({ where: { businessId, id } })) fail('PLAN_NOT_FOUND', 'No encontre ese plan.')
      return id ? tx.benefitPlan.update({ where: { businessId_id: { businessId, id } }, data }) : tx.benefitPlan.create({ data: { businessId, ...data } })
    })
  }
  async list(businessId: string, customerId: string) {
    const business = await this.db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } })
    const today = localParts(new Date(), business.timezone || DEFAULT_BOOKING_TIMEZONE).date
    const grants = await this.db.customerBenefit.findMany({ where: { businessId, customerId }, include: { uses: { include: { appointment: { select: { startAt: true, status: true, serviceId: true } } } }, cashEntry: { select: { reversedBy: { select: { id: true } } } } }, orderBy: { endsOn: 'desc' } })
    return grants.map(g => {
      const revoked = Boolean(g.cashEntry.reversedBy)
      const serviceBalances = membershipBalances(g.serviceRules, g.uses, g.startsOn, g.endsOn, today, revoked)
      const summary = serviceBalances.length ? { used: serviceBalances.reduce((n, r) => n + r.used, 0), reserved: serviceBalances.reduce((n, r) => n + r.reserved, 0), available: serviceBalances.reduce((n, r) => n + r.available, 0), expired: today > g.endsOn, expiredUses: serviceBalances.reduce((n, r) => n + r.expiredUses, 0) } : benefitSummary(g, g.uses.map(u => u.state), today)
      return { ...g, ...summary, available: revoked || today < g.startsOn ? 0 : summary.available, serviceBalances, revoked }
    })
  }
  async purchase(input: { businessId: string; customerId: string; planId: string; startsOn: string; cashSessionId: string; paymentMethodId: string; requestKey: string; expectedPrice?: number }) {
    dateKey(input.startsOn)
    if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey)) fail('INVALID_REQUEST_KEY', 'Falta la referencia de la compra.')
    const hash = createHash('sha256').update(JSON.stringify([input.customerId, input.planId, input.startsOn, input.cashSessionId, input.paymentMethodId, input.expectedPrice])).digest('hex')
    return this.db.$transaction(async tx => {
      await lockBenefitBusiness(tx, input.businessId)
      const previous = await tx.customerBenefit.findUnique({ where: { businessId_requestKey: { businessId: input.businessId, requestKey: input.requestKey } } })
      if (previous) {
        if (previous.requestHash !== hash) fail('REQUEST_CONFLICT', 'La referencia ya se uso para otra compra.')
        return previous
      }
      const plan = await tx.benefitPlan.findFirst({ where: { businessId: input.businessId, id: input.planId, isActive: true } })
      if (!plan || !await tx.customer.findFirst({ where: { businessId: input.businessId, id: input.customerId } })) fail('BENEFIT_NOT_FOUND', 'No encontre el cliente o el plan.')
      if (input.expectedPrice !== undefined && input.expectedPrice !== plan.price) fail('PLAN_PRICE_CHANGED', 'El precio del plan cambio. Actualiza sus condiciones antes de registrar el cobro.')
      if ((await tx.service.findMany({ where: { businessId: input.businessId, id: { in: plan.serviceIds }, isActive: true }, select: { id: true } })).length !== plan.serviceIds.length) fail('INVALID_SERVICES', 'El plan contiene servicios inactivos. Revisa sus condiciones antes de venderlo.')
      const endsOn = membershipEnd(input.startsOn, plan.validityDays)
      if (plan.kind === 'MEMBERSHIP' && await tx.customerBenefit.findFirst({ where: { businessId: input.businessId, customerId: input.customerId, planId: plan.id, startsOn: { lte: endsOn }, endsOn: { gte: input.startsOn }, cashEntry: { reversedBy: null } } })) fail('MEMBERSHIP_OVERLAP', 'Ese periodo de membresia ya esta pagado. Inicia el siguiente despues del vencimiento.')
      const sessions = await tx.$queryRaw<Array<{ id: string; registerDayId: string }>>(Prisma.sql`SELECT s.id, s."registerDayId" FROM "CashSession" s JOIN "CashRegisterDay" d ON d.id=s."registerDayId" WHERE s.id=${input.cashSessionId} AND s."businessId"=${input.businessId} AND s."closedAt" IS NULL AND d."closedAt" IS NULL FOR UPDATE OF d, s`)
      const session = sessions[0]
      if (!session) fail('CASH_CLOSED', 'Abri Caja antes de registrar la compra.')
      const method = await tx.businessPaymentMethod.findFirst({ where: { id: input.paymentMethodId, businessId: input.businessId, isActive: true } })
      if (!method) fail('INVALID_PAYMENT_METHOD', 'Selecciona un medio de pago vigente.')
      const category = await tx.cashExpenseCategory.upsert({ where: { businessId_normalizedName: { businessId: input.businessId, normalizedName: 'membresias y packs' } }, create: { businessId: input.businessId, name: 'Membresias y packs', normalizedName: 'membresias y packs' }, update: {} })
      if (!category.isActive) fail('MEMBERSHIP_CATEGORY_INACTIVE', 'Activa la categoria Membresias y packs en Caja antes de registrar la compra.')
      const cashEntry = await tx.cashEntry.create({ data: { businessId: input.businessId, registerDayId: session.registerDayId, cashSessionId: session.id, type: 'INCOME', direction: 'INFLOW', origin: 'CASH_REGISTER', paymentMethod: method.kind, businessPaymentMethodId: method.id, expenseCategoryId: category.id, amount: plan.price, description: `${plan.kind === 'PACK' ? 'Pack' : 'Membresia'}: ${plan.name} (${input.startsOn} / ${endsOn})` } })
      return tx.customerBenefit.create({ data: { businessId: input.businessId, customerId: input.customerId, planId: plan.id, name: plan.name, kind: plan.kind, serviceIds: plan.serviceIds, serviceRules: plan.serviceRules as Prisma.InputJsonValue, totalUses: plan.totalUses, discountPercent: plan.discountPercent, price: plan.price, startsOn: input.startsOn, endsOn, cancellationHours: plan.cancellationHours, consumeLateCancellation: plan.consumeLateCancellation, consumeNoShow: plan.consumeNoShow, cashEntryId: cashEntry.id, requestKey: input.requestKey, requestHash: hash } })
    })
  }
}

// Called only with a CRM-authorized customer, a verified web account or a trusted bot identity.
// An unverified phone typed into a guest form never selects a benefit.
export async function reserveBenefit(
  tx: Prisma.TransactionClient,
  input: { businessId: string; customerId: string; appointmentId: string; benefitId?: string; optional?: boolean },
  justCreated?: Prisma.AppointmentGetPayload<{ include: { serviceItems: true } }>,
  agendaBusinessLocked = false
) {
  const zone = await lockBenefitBusiness(tx, input.businessId, agendaBusinessLocked)
  // Only the creating caller can pass a fresh result from this transaction,
  // before a deposit or coverage has been attached to it.
  const appointment = justCreated?.serviceItems.length
    ? { ...justCreated, service: null, benefitUse: null, bookingDeposit: null }
    : await tx.appointment.findFirst({ where: { id: input.appointmentId, businessId: input.businessId, customerId: input.customerId }, include: { service: true, serviceItems: true, benefitUse: true, bookingDeposit: true } })
  if (!appointment || appointment.id !== input.appointmentId || appointment.businessId !== input.businessId || appointment.customerId !== input.customerId) {
    fail('APPOINTMENT_NOT_FOUND', 'No encontre ese turno para el cliente.')
  }
  if (appointment.benefitUse) {
    if (input.benefitId && appointment.benefitUse.benefitId !== input.benefitId) fail('BENEFIT_ALREADY_APPLIED', 'El turno ya tiene otro beneficio.')
    return appointment.benefitUse
  }
  if (!['PENDING', 'CONFIRMED'].includes(appointment.status) || appointment.manualDepositPaid || appointment.bookingDeposit) {
    if (input.optional) return null
    fail('BENEFIT_PAYMENT_CONFLICT', 'Aplica el beneficio antes de cobrar una sena o realizar el servicio.')
  }
  const date = localParts(appointment.startAt, zone).date
  const ids = appointment.serviceItems.length ? appointment.serviceItems.map(s => s.serviceId) : [appointment.serviceId]
  const items = appointment.serviceItems.length ? appointment.serviceItems : [{ serviceId: appointment.serviceId, price: appointment.quotedPrice ?? appointment.service?.price ?? null }]
  const grants = await tx.customerBenefit.findMany({ where: { businessId: input.businessId, customerId: input.customerId, ...(input.benefitId ? { id: input.benefitId } : {}), startsOn: { lte: date }, endsOn: { gte: date }, cashEntry: { reversedBy: null } }, include: { uses: { where: { state: { in: ['RESERVED', 'CONSUMED'] } } } }, orderBy: [{ endsOn: 'asc' }, { id: 'asc' }] })
  const grant = grants.find(g => membershipServices(g.serviceRules).length ? allocateMembership(g, items).length > 0 : ids.every(id => g.serviceIds.includes(id)) && (g.totalUses === null || ids.length === 1 && g.uses.length < g.totalUses))
  if (!grant) {
    if (input.optional) return null
    fail('BENEFIT_COVERAGE_REQUIRED', 'Hace falta un beneficio con usos y vigencia para la fecha de atencion. Renova o reserva a precio normal.')
  }
  const repository = createCashTransactionRepository(tx)
  const account = await ensureAppointmentAccountForPayment(repository, input.businessId, appointment.id)
  const links = await tx.appointmentAccountLink.findMany({ where: { businessId: input.businessId, accountId: account.id }, include: { appointment: { select: { customerId: true, coordinationGroupId: true } } } })
  const entries = await tx.cashEntry.count({ where: { businessId: input.businessId, accountId: account.id } })
  const productSale = await tx.productSale.findFirst({ where: { businessId: input.businessId, appointmentId: appointment.id } })
  const previousUses = await tx.benefitUse.findMany({ where: { businessId: input.businessId, appointment: { accountLink: { is: { accountId: account.id } } } }, select: { coveredAmount: true } })
  const previousCoverage = previousUses.reduce((sum, use) => sum + use.coveredAmount, 0)
  const validLinks = links.length === 1 || Boolean(appointment.coordinationGroupId && links.every(link => link.appointment.customerId === input.customerId && link.appointment.coordinationGroupId === appointment.coordinationGroupId))
  if (!validLinks || entries || productSale || account.agreedAmount === null || account.discountAmount !== previousCoverage) fail('BENEFIT_PAYMENT_CONFLICT', 'El turno ya tiene cobros, productos o descuentos. Revisa su cuenta antes de aplicar el beneficio.')
  const itemTotal = items.every(i => i.price !== null) ? items.reduce((sum, i) => sum + i.price!, 0) : null
  const originalPrice = links.length > 1 ? appointment.quotedPrice ?? itemTotal : account.agreedAmount
  if (originalPrice === null) fail('BENEFIT_PAYMENT_CONFLICT', 'Confirma el precio de los servicios antes de aplicar la membresia.')
  const allocations = allocateMembership(grant, items)
  const coveredAmount = allocations.length ? allocations.reduce((n, a) => n + a.originalPrice, 0) : Math.round(originalPrice * grant.discountPercent / 100)
  if (coveredAmount > originalPrice || coveredAmount + previousCoverage > account.agreedAmount) fail('BENEFIT_PAYMENT_CONFLICT', 'El precio acordado no coincide con los servicios del turno.')
  await tx.appointmentAccount.update({ where: { businessId_id: { businessId: input.businessId, id: account.id } }, data: { discountAmount: coveredAmount + previousCoverage } })
  return tx.benefitUse.create({ data: { id: randomUUID(), businessId: input.businessId, benefitId: grant.id, appointmentId: appointment.id, originalPrice, coveredAmount, allocations, commissionBase: allocations.length ? allocations.reduce((n, a) => n + a.unitPrice, 0) : null } })
}
