import { readPreviewChoiceState } from './preview-choice.js'
import { loadActiveServiceContent } from './prisma-service-content.js'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'
import { revalidateBookingWrite } from '../services/booking-operations.js'
import { createAppointmentRecord } from '../services/prisma-booking.js'
import { createSimulatorBookingIdentity } from '../services/simulator-booking-scope.js'
import { PrismaAvailabilityRepository } from '../bot-options/infrastructure/prisma-availability.js'
import { loadPrismaBasketAvailability } from './prisma-basket-availability.js'
import { SANDBOX_RECEIPT_ADDRESS_MAX_LENGTH, buildSandboxBookingTerms, parseSandboxReservation, sandboxProposalFingerprint, type SandboxBookingResult, type SandboxBookingTerms } from './sandbox-booking.js'
import { parseDialogueState, type DialogueResponse } from './engine.js'

type ScopeClient = Pick<Prisma.TransactionClient, 'business' | 'user'> & Partial<Pick<Prisma.TransactionClient, '$queryRaw'>>
type ScopeBusiness = { id: string; isDemo: boolean; demoType: string | null; publicAddress: string | null; publicAddressArea: string | null }
/** Reuse the scope read for a fresh location; never open another transaction or lookup. */
async function loadSimulatorBookingScope(client: ScopeClient, businessId: string, userId: string, lock: boolean): Promise<ScopeBusiness | null> {
  const user = lock && client.$queryRaw ? (await client.$queryRaw<Array<{ id: string; role: string; isActive: boolean }>>(Prisma.sql`SELECT "id", "role", "isActive" FROM "User" WHERE "id" = ${userId} FOR SHARE`))[0]
    : await client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } })
  if (!user || user.role !== 'SUPER_ADMIN' || !user.isActive) return null
  const business = lock && client.$queryRaw ? (await client.$queryRaw<Array<ScopeBusiness>>(Prisma.sql`SELECT "id", "isDemo", "demoType", "publicAddress", "publicAddressArea" FROM "Business" WHERE "id" = ${businessId} FOR SHARE`))[0]
    : await client.business.findFirst({ where: { id: businessId, isDemo: true, demoType: 'QA_SANDBOX' }, select: { id: true, isDemo: true, demoType: true, publicAddress: true, publicAddressArea: true } })
  return business?.id === businessId && business.isDemo === true && business.demoType === 'QA_SANDBOX' ? business : null
}
/** Authenticated server user ID, never a request-body role or a namespace-as-permission. */
export async function verifySimulatorBookingScope(client: ScopeClient, businessId: string, userId: string, lock = false): Promise<boolean> {
  return Boolean(await loadSimulatorBookingScope(client, businessId, userId, lock))
}
function physicalAddress(business: ScopeBusiness): string | undefined {
  const clean = (value: unknown) => typeof value === 'string' && value.length <= SANDBOX_RECEIPT_ADDRESS_MAX_LENGTH && !/[\u0000-\u001f]/.test(value) ? value.trim() : ''
  const address = clean(business.publicAddress), area = clean(business.publicAddressArea)
  if (!address) return undefined // A neighborhood alone is not a physical address.
  const label = !area || address.toLocaleLowerCase('es-AR').includes(area.toLocaleLowerCase('es-AR')) ? address : address + ', ' + area
  return label.length <= SANDBOX_RECEIPT_ADDRESS_MAX_LENGTH ? label : undefined
}
const blocked = (reason: Extract<SandboxBookingResult, { kind: 'BLOCKED' }>['reason']): SandboxBookingResult => ({ kind: 'BLOCKED', reason })
const marker = (conversationId: string, proposalNonce: string, fingerprint: string, terms: SandboxBookingTerms) => JSON.stringify({ kind: 'simulator-reservation-v1', conversationId, proposalNonce, fingerprint, terms })
/** Must run within the caller's CAS transaction; no network, side effects or nested transactions. */
export async function executePrismaSandboxBooking(tx: Prisma.TransactionClient, input: { businessId: string; userId: string; conversationId: string; expectedPhone: string; response: DialogueResponse }): Promise<SandboxBookingResult> {
  const { response } = input
  if (!response.bookingCommand || Object.hasOwn(response.state, 'editRequest')) return blocked('SCOPE_REJECTED')
  let reservation
  try { reservation = parseSandboxReservation(response.state.sandboxReservation, response.state) }
  catch { return blocked('SCOPE_REJECTED') }
  const presented = reservation.presented, terms = presented.terms
  if (terms.businessId !== input.businessId || !isDeepStrictEqual(response.bookingCommand.presented, presented)) return blocked('SCOPE_REJECTED')
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [terms.professionalId] })
  const business = await loadSimulatorBookingScope(tx, input.businessId, input.userId, true)
  if (!business) return blocked('SCOPE_REJECTED')
  const conversation = await tx.conversation.findUnique({ where: { id: input.conversationId }, select: { businessId: true, phone: true, supportBotKey: true, supportBotState: true } })
  if (conversation?.businessId !== input.businessId || conversation.phone !== input.expectedPhone || !input.expectedPhone.startsWith(`demo:preview:${input.userId}:`)) return blocked('SCOPE_REJECTED')
  let stored
  try { stored = parseDialogueState(readPreviewChoiceState(conversation.supportBotState).draft, input.businessId, terms.timezone) }
  catch { return blocked('SCOPE_REJECTED') }
  if (conversation.supportBotKey !== 'conversational-preview' || !isDeepStrictEqual(stored.sandboxReservation?.presented, presented)) return blocked('SCOPE_REJECTED')
  const identity = createSimulatorBookingIdentity({ businessId: input.businessId, conversationId: input.conversationId, proposalRevision: presented.nonce, proposalFingerprint: presented.fingerprint })
  const businessAddress = stored.sandboxReservation?.receipt ? stored.sandboxReservation.receipt.businessAddress : physicalAddress(business)
  const receipt = { ...(businessAddress ? { businessAddress } : {}), kind: 'COMMITTED' as const, appointmentId: identity.appointmentId, proposalNonce: presented.nonce, fingerprint: presented.fingerprint }
  const notes = marker(input.conversationId, presented.nonce, presented.fingerprint, terms)
  const serviceItems = terms.services.map((service, sortOrder) => ({ serviceId: service.id, sortOrder, durationMinutes: service.durationMinutes,
    price: service.estimate || service.priceMode !== 'FIXED' ? null : service.price }))
  const existing = await tx.appointment.findUnique({ where: { id: identity.appointmentId }, include: { customer: true, serviceItems: { orderBy: { sortOrder: 'asc' } } } })
  // Before checking availability: this appointment necessarily overlaps its own slot.
  if (existing) {
    const items = existing.serviceItems.map(({ serviceId, sortOrder, durationMinutes, price }) => ({ serviceId, sortOrder, durationMinutes, price }))
    if (existing.businessId !== input.businessId || existing.customerId !== identity.customerId || existing.professionalId !== terms.professionalId || existing.serviceId !== terms.services[0]!.id ||
      existing.status !== 'CONFIRMED' || existing.startAt.toISOString() !== terms.startAt || existing.totalDurationMinutes !== terms.durationMinutes || existing.quotedPrice !== terms.totalPrice || existing.notes !== notes ||
      existing.customer.businessId !== input.businessId || existing.customer.phone !== identity.customerPhone || existing.customer.normalizedPhone !== null || existing.customer.email !== null || !isDeepStrictEqual(items, serviceItems)) return blocked('SCOPE_REJECTED')
    return receipt
  }
  if (reservation.receipt) return blocked('SCOPE_REJECTED')
  if (presented.conditionsPresented !== true) return { kind: 'REQUOTE' }
  const availability = new PrismaAvailabilityRepository(tx)
  const settings = await availability.loadSettings(input.businessId)
  const clocks = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`)
  const dbNow = clocks[0]?.now
  if (!(dbNow instanceof Date) || !Number.isFinite(dbNow.getTime())) throw new Error('sandbox database clock unavailable')
  if (settings.timezone !== terms.timezone) return { kind: 'REQUOTE' }
  const requested = terms.services.map(service => ({ id: service.id, name: service.name, durationMinutes: service.durationMinutes, requiresConsultation: false, price: service.price, priceMode: service.priceMode }))
  const serviceContent = await loadActiveServiceContent(tx, input.businessId, true)
  const fresh = await loadPrismaBasketAvailability(tx, { businessId: input.businessId, timezone: settings.timezone, dbNow }, settings, requested, terms.date, terms.professionalId, response.state.serviceEstimates, serviceContent)
  if (!fresh.ok) return fresh.reason === 'GUIDANCE_REQUIRED' ? { kind: 'REQUOTE' } : blocked(fresh.reason === 'SERVICE_UNAVAILABLE' ? 'SERVICE_UNAVAILABLE' : 'POLICY_BLOCKED')
  const slot = fresh.slots.find(slot => slot.startAt === terms.startAt && slot.professionalId === terms.professionalId && slot.date === terms.date && slot.time === terms.time)
  if (!slot) return { kind: 'SLOT_CONFLICT' }
  const freshState = { ...response.state, slot }
  let currentTerms
  try { currentTerms = buildSandboxBookingTerms({ businessId: input.businessId, timezone: settings.timezone, dbNow }, freshState, fresh.services,
    { kind: 'BOOKING_PROPOSAL', businessId: input.businessId, serviceId: fresh.services[0]!.id, professionalId: slot.professionalId, startAt: slot.startAt, customerName: terms.customerName, serviceIds: fresh.services.map(service => service.id), durationMinutes: fresh.durationMinutes, customerDurationMinutes: fresh.customerDurationMinutes ?? fresh.durationMinutes, totalPrice: fresh.totalPrice }) }
  catch { return { kind: 'REQUOTE' } }
  if (sandboxProposalFingerprint(currentTerms) !== presented.fingerprint) return { kind: 'REQUOTE' }
  const validation = await revalidateBookingWrite(tx, { businessId: input.businessId, professionalId: terms.professionalId, serviceIds: terms.services.map(service => service.id), startAt: new Date(terms.startAt), timezone: settings.timezone, dbNow })
  if (validation.conflicts.length) return { kind: 'SLOT_CONFLICT' }
  if (validation.orderedServices.some(service => service.depositMode !== 'NONE')) return blocked('DEPOSIT_REQUIRED')
  if (validation.professionalDuration !== terms.durationMinutes || validation.customerDuration !== terms.customerDurationMinutes) return { kind: 'REQUOTE' }
  const customer = await tx.customer.findUnique({ where: { id: identity.customerId } })
  if (customer && (customer.businessId !== input.businessId || customer.phone !== identity.customerPhone || customer.normalizedPhone !== null || customer.email !== null)) return blocked('SCOPE_REJECTED')
  if (customer) await tx.customer.update({ where: { id: identity.customerId }, data: { name: terms.customerName } })
  else await tx.customer.create({ data: { id: identity.customerId, businessId: input.businessId, phone: identity.customerPhone, normalizedPhone: null, email: null, name: terms.customerName } })
  await createAppointmentRecord(tx, { data: { id: identity.appointmentId, businessId: input.businessId, customerId: identity.customerId, professionalId: terms.professionalId,
    serviceId: terms.services[0]!.id, startAt: new Date(terms.startAt), totalDurationMinutes: terms.durationMinutes, quotedPrice: terms.totalPrice, status: 'CONFIRMED', origin: 'MANUAL', notes,
    serviceItems: { create: serviceItems } } })
  return receipt
}
