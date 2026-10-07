import { createHash, randomUUID } from 'node:crypto'
import { serviceConfigurationKey, type ServiceEstimate } from '../bot-options/domain/service-booking.js'
import { validateCoordinatedSlot, coordinationLabel, type SlotCoordination } from './coordinated-booking.js'
import { basketServiceIds } from './service-basket.js'
import { resolveGuidance, attendanceContent } from './service-guidance.js'
import type { BookingProposal, DialogueContext, DialogueResponse, DialogueService, DialogueState } from './engine.js'

export const SANDBOX_CONFIRMATION_QUESTION = '¿Confirmás este turno de prueba?'
export type SandboxBookingService = {
  id: string; name: string; durationMinutes: number; customerDurationMinutes: number
  price: number | null; priceMode: 'FIXED' | 'STARTING_AT'; configurationHash: string
  estimate: ServiceEstimate | null; conditionsHash?: string
}
export type SandboxBookingTerms = {
  businessId: string; timezone: string; date: string; startAt: string; time: string
  customerName: string; professionalId: string; professionalName: string
  preference: { kind: 'any' } | { kind: 'specific'; id: string }
  durationMinutes: number; customerDurationMinutes: number; totalPrice: number | null
  services: SandboxBookingService[]
  coordination?: SlotCoordination
}
export type PresentedSandboxProposal = { schemaVersion: 1; nonce: string; fingerprint: string; terms: SandboxBookingTerms; conditionsPresented?: true }
export const SANDBOX_RECEIPT_ADDRESS_MAX_LENGTH = 1000
/** Optional commit-time location snapshot; legacy receipts deliberately have none. */
export type SandboxBookingReceipt = { appointmentId: string; proposalNonce: string; fingerprint: string; businessAddress?: string; appointmentIds?: string[]; coordinationGroupId?: string }
export type SandboxReservation = { schemaVersion: 1; presented: PresentedSandboxProposal; receipt?: SandboxBookingReceipt }
export type SandboxBookingCommand = { kind: 'CONFIRM_SANDBOX_BOOKING'; presented: PresentedSandboxProposal }
export type SandboxBookingBlockReason = 'DEPOSIT_REQUIRED' | 'POLICY_BLOCKED' | 'SERVICE_UNAVAILABLE' | 'SCOPE_REJECTED' | 'TEMPORARILY_UNAVAILABLE'
export type SandboxBookingResult =
  | ({ kind: 'COMMITTED' } & SandboxBookingReceipt)
  | { kind: 'SLOT_CONFLICT' }
  | { kind: 'REQUOTE' }
  | { kind: 'BLOCKED'; reason: SandboxBookingBlockReason }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  return value
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const text = (value: unknown, length: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= length && !/[\u0000-\u001f]/.test(value)
const validReceiptAddress = (value: unknown): value is string => text(value, SANDBOX_RECEIPT_ADDRESS_MAX_LENGTH) && value.trim() === value && value.trim().length > 0
const minutes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1440
const money = (value: unknown): value is number | null => value === null || Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected

/** Stable terms hash excludes question wording, diagnostics and the randomly generated presentation version. */
export function sandboxProposalFingerprint(terms: SandboxBookingTerms): string { validateTerms(terms); return digest(terms) }
export function buildSandboxBookingTerms(context: DialogueContext, state: DialogueState, services: readonly DialogueService[], proposal: BookingProposal): SandboxBookingTerms {
  if (!state.slot || !state.customerName || !state.date || !state.professional || proposal.businessId !== context.businessId) throw new Error('incomplete sandbox proposal')
  const ids = basketServiceIds(state)
  const selected = ids.map(id => services.find(service => service.id === id))
  if (proposal.startAt !== state.slot.startAt || proposal.professionalId !== state.slot.professionalId || proposal.customerName !== state.customerName || proposal.serviceId !== ids[0] || proposal.serviceIds && JSON.stringify(proposal.serviceIds) !== JSON.stringify(ids)) throw new Error('sandbox proposal does not match draft')
  if (!ids.length || selected.some(service => !service)) throw new Error('incomplete sandbox services')
  const guidance = resolveGuidance(selected as DialogueService[], state.serviceEstimates)
  if (guidance.pending || guidance.blocked || guidance.changed) throw new Error('unverified sandbox guidance')
  const rows = (selected as DialogueService[]).map(service => ({
    id: service.id, name: service.name, durationMinutes: service.professionalDurationMinutes ?? service.durationMinutes!,
    customerDurationMinutes: service.customerDurationMinutes ?? service.durationMinutes!, price: service.price, priceMode: service.priceMode ?? 'FIXED',
    configurationHash: digest(service.bookingPolicy ? serviceConfigurationKey(service.bookingPolicy) : [service.name, service.durationMinutes, service.price, service.priceMode ?? 'FIXED', service.requiresConsultation]),
    estimate: guidance.estimates[service.id] ?? null,
    ...(attendanceContent(service, context.businessId) ? { conditionsHash: digest(attendanceContent(service, context.businessId)) } : {})
  }))
  const terms: SandboxBookingTerms = { businessId: context.businessId, timezone: context.timezone, date: state.date, startAt: state.slot.startAt, time: state.slot.time,
    customerName: state.customerName, professionalId: state.slot.professionalId, professionalName: state.slot.professionalName, preference: structuredClone(state.professional),
    durationMinutes: rows.reduce((sum, service) => sum + service.durationMinutes, 0), customerDurationMinutes: rows.reduce((sum, service) => sum + service.customerDurationMinutes, 0),
    ...(state.slot.coordination ? { coordination: structuredClone(state.slot.coordination) } : {}),
    totalPrice: rows.every(service => !service.estimate && service.priceMode === 'FIXED' && service.price !== null) ? rows.reduce((sum, service) => sum + service.price!, 0) : null, services: rows }
  if (JSON.stringify(proposal.segments) !== JSON.stringify(state.slot.coordination?.segments)) throw new Error('sandbox assignment does not match proposal')
  validateTerms(terms)
  if (terms.customerDurationMinutes > terms.durationMinutes && proposal.customerDurationMinutes !== terms.customerDurationMinutes) throw new Error('sandbox customer duration proof missing')
  if (proposal.durationMinutes !== undefined && proposal.durationMinutes !== terms.durationMinutes || proposal.totalPrice !== undefined && proposal.totalPrice !== terms.totalPrice) throw new Error('sandbox proposal aggregate changed')
  return terms
}
function validateTerms(terms: SandboxBookingTerms) {
  if (!terms || typeof terms !== 'object' || !keys(terms, (Object.hasOwn(terms, 'coordination') ? 'businessId,coordination,' : 'businessId,') + 'customerDurationMinutes,customerName,date,durationMinutes,preference,professionalId,professionalName,services,startAt,time,timezone,totalPrice') ||
      !text(terms.businessId, 128) || !text(terms.timezone, 100) || !text(terms.customerName, 100) || !text(terms.professionalId, 128) || !text(terms.professionalName, 200) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(terms.date) || !/^\d{2}:\d{2}$/.test(terms.time) || !Number.isFinite(Date.parse(terms.startAt)) || new Date(terms.startAt).toISOString() !== terms.startAt ||
      !minutes(terms.durationMinutes) || !minutes(terms.customerDurationMinutes) || !money(terms.totalPrice) || !terms.preference ||
      (terms.preference.kind === 'any' ? !keys(terms.preference, 'kind') : terms.preference.kind !== 'specific' || !keys(terms.preference, 'id,kind') || terms.preference.id !== terms.professionalId) ||
      !Array.isArray(terms.services) || terms.services.length < 1 || terms.services.length > 10 || new Set(terms.services.map(service => service.id)).size !== terms.services.length) throw new Error('invalid sandbox terms')
  const instant = new Date(terms.startAt)
  const wall = new Intl.DateTimeFormat('en-CA', { timeZone: terms.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const part = (type: string) => wall.find(item => item.type === type)?.value
  if ([part('year'),part('month'),part('day')].join('-') !== terms.date || [part('hour'),part('minute')].join(':') !== terms.time) throw new Error('invalid sandbox wall time')
  for (const service of terms.services) {
    if (!service || !keys(service, Object.hasOwn(service, 'conditionsHash') ? 'conditionsHash,configurationHash,customerDurationMinutes,durationMinutes,estimate,id,name,price,priceMode' : 'configurationHash,customerDurationMinutes,durationMinutes,estimate,id,name,price,priceMode') || !text(service.id, 128) || !text(service.name, 200) || !minutes(service.durationMinutes) || !minutes(service.customerDurationMinutes) || !money(service.price) ||
        !['FIXED','STARTING_AT'].includes(service.priceMode) || !/^[a-f0-9]{64}$/.test(service.configurationHash) || service.conditionsHash !== undefined && !/^[a-f0-9]{64}$/.test(service.conditionsHash)) throw new Error('invalid sandbox service')
    const estimate = service.estimate
    if (estimate !== null && (!estimate || !keys(estimate, 'optionId,optionLabel,priceMax,priceMin') || estimate.optionId !== null && !text(estimate.optionId, 128) || estimate.optionLabel !== null && !text(estimate.optionLabel, 200) || !money(estimate.priceMin) || estimate.priceMin === null || !money(estimate.priceMax) || estimate.priceMax !== null && estimate.priceMax < estimate.priceMin)) throw new Error('invalid sandbox estimate')
  }
  if (terms.durationMinutes !== terms.services.reduce((sum, service) => sum + service.durationMinutes, 0) || terms.customerDurationMinutes !== terms.services.reduce((sum, service) => sum + service.customerDurationMinutes, 0)) throw new Error('invalid sandbox aggregate')
  if (Object.hasOwn(terms, 'coordination')) {
    if (!terms.coordination || !Array.isArray(terms.coordination.segments)) throw new Error('invalid sandbox assignment')
    const last = terms.coordination.segments.at(-1)
    validateCoordinatedSlot({ date: terms.date, time: terms.time, startAt: terms.startAt, professionalId: terms.professionalId, professionalName: terms.professionalName, occupiedMinutes: (Date.parse(last?.endAt ?? '') - Date.parse(terms.startAt)) / 60000, coordination: terms.coordination }, { businessId: terms.businessId, timezone: terms.timezone, serviceIds: terms.services.map(service => service.id), services: terms.services.map(service => ({ id: service.id, name: service.name, durationMinutes: service.durationMinutes, customerDurationMinutes: service.customerDurationMinutes })) })
    if (terms.preference.kind !== 'any') throw new Error('invalid sandbox coordinated preference')
  }
  const fixed = terms.services.every(service => !service.estimate && service.priceMode === 'FIXED' && service.price !== null) ? terms.services.reduce((sum, service) => sum + service.price!, 0) : null
  if (fixed !== terms.totalPrice) throw new Error('invalid sandbox price aggregate')
}
export function sandboxProposalMatchesState(presented: PresentedSandboxProposal, state: DialogueState): boolean {
  const t = presented.terms
  return state.pending === 'proposal' && t.businessId === state.businessId && t.date === state.date && t.startAt === state.slot?.startAt && t.time === state.slot?.time &&
    t.professionalId === state.slot.professionalId && t.professionalName === state.slot.professionalName && t.customerName === state.customerName &&
    JSON.stringify(t.coordination) === JSON.stringify(state.slot.coordination) &&
    JSON.stringify(t.preference) === JSON.stringify(state.professional) && JSON.stringify(t.services.map(service => service.id)) === JSON.stringify(basketServiceIds(state)) &&
    t.services.every(service => service.estimate === null ? !state.serviceEstimates?.[service.id] : state.serviceEstimates?.[service.id]?.optionId === service.estimate.optionId && digest(state.serviceEstimates[service.id]!.configurationKey) === service.configurationHash)
}
export function parseSandboxReservation(value: unknown, state: DialogueState): SandboxReservation {
  const reservation = value as SandboxReservation
  if (!reservation || typeof reservation !== 'object' || !keys(reservation, reservation.receipt ? 'presented,receipt,schemaVersion' : 'presented,schemaVersion') || reservation.schemaVersion !== 1 || JSON.stringify(value).length > 10000) throw new Error('invalid sandbox reservation')
  const p = reservation.presented
  if (!p || !keys(p, Object.hasOwn(p, 'conditionsPresented') ? 'conditionsPresented,fingerprint,nonce,schemaVersion,terms' : 'fingerprint,nonce,schemaVersion,terms') || p.conditionsPresented !== undefined && p.conditionsPresented !== true || p.schemaVersion !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.nonce) || !/^[a-f0-9]{64}$/.test(p.fingerprint)) throw new Error('invalid sandbox proposal')
  validateTerms(p.terms)
  if (sandboxProposalFingerprint(p.terms) !== p.fingerprint || !sandboxProposalMatchesState(p, state)) throw new Error('stale sandbox proposal')
  if (reservation.receipt) validateReceipt(reservation.receipt, p)
  return structuredClone(reservation)
}
function validateReceipt(receipt: SandboxBookingReceipt, presented: PresentedSandboxProposal): void {
  const expected = ['appointmentId', 'fingerprint', 'proposalNonce']
  if (Object.hasOwn(receipt, 'businessAddress')) expected.push('businessAddress')
  const coordinated = presented.terms.coordination
  if (coordinated) expected.push('appointmentIds', 'coordinationGroupId')
  if (!keys(receipt, expected.sort().join(',')) ||
      Object.hasOwn(receipt, 'businessAddress') && !validReceiptAddress(receipt.businessAddress) ||
      !text(receipt.appointmentId, 128) || !receipt.appointmentId.startsWith('simqa_appointment_') ||
      receipt.proposalNonce !== presented.nonce || receipt.fingerprint !== presented.fingerprint) throw new Error('invalid sandbox receipt')
  if (coordinated && (!Array.isArray(receipt.appointmentIds) || receipt.appointmentIds.length !== coordinated.segments.length ||
      new Set(receipt.appointmentIds).size !== receipt.appointmentIds.length || receipt.appointmentIds[0] !== receipt.appointmentId ||
      receipt.appointmentIds.some(id => !text(id, 128) || !id.startsWith('simqa_appointment_')) ||
      !text(receipt.coordinationGroupId, 128) || !receipt.coordinationGroupId.startsWith('simqa_group_'))) throw new Error('invalid sandbox receipt members')
}
export function presentSandboxProposal(context: DialogueContext, state: DialogueState, services: readonly DialogueService[], proposal: BookingProposal, previous?: SandboxReservation): string {
  if (Object.hasOwn(state, 'editRequest')) throw new Error('pending edit request cannot present consent')
  const terms = buildSandboxBookingTerms(context, state, services, proposal)
  const fingerprint = sandboxProposalFingerprint(terms)
  const presented: PresentedSandboxProposal = previous?.presented.conditionsPresented === true && previous.presented.fingerprint === fingerprint ? structuredClone(previous.presented) : { schemaVersion: 1, nonce: randomUUID(), fingerprint, terms, conditionsPresented: true }
  state.sandboxReservation = { schemaVersion: 1, presented }
  if (JSON.stringify(state).length > 16384) { delete state.sandboxReservation; throw new Error('sandbox proposal exceeds state limit') }
  const conditions = services.filter(service => basketServiceIds(state).includes(service.id)).map(service => attendanceContent(service, context.businessId)).filter(Boolean).join('\n\n')
  return (conditions ? 'Antes de confirmar, tené en cuenta:\n' + conditions + '\n\n' : '') + 'Propuesta de turno de prueba:\n' + renderSandboxTerms(terms) + '\nTodavía no está reservado.\n' + SANDBOX_CONFIRMATION_QUESTION
}
const amount = (price: number) => '$ ' + price.toLocaleString('es-AR')
export function renderSandboxTerms(terms: SandboxBookingTerms): string {
  const day = new Intl.DateTimeFormat('es-AR', { timeZone: terms.timezone, weekday: 'long' }).format(new Date(terms.startAt))
  const date = terms.date.slice(8) + '/' + terms.date.slice(5, 7) + '/' + terms.date.slice(0, 4)
  const lines = terms.services.map(service => {
    const estimate = service.estimate
    const price = estimate ? estimate.priceMax === null ? 'Desde ' + amount(estimate.priceMin) + ' (estimado)' : amount(estimate.priceMin) + ' a ' + amount(estimate.priceMax) + ' (estimado)'
      : service.price === null ? 'precio a consultar' : (service.priceMode === 'STARTING_AT' ? 'Desde ' : '') + amount(service.price)
    return service.name + (estimate?.optionLabel ? ' — ' + estimate.optionLabel : '') + ': ' + price
  })
  if (terms.coordination) lines.push('Servicios y profesionales: ' + coordinationLabel({ professionalName: terms.professionalName, coordination: terms.coordination }, terms.timezone))
  return [...lines, 'Cliente: ' + terms.customerName, 'Fecha: ' + day + ' ' + date + ' a las ' + terms.time, 'Profesional' + (terms.coordination ? 'es: ' + terms.coordination.segments.map(segment => segment.professionalName).join(' → ') : ': ' + terms.professionalName),
    'Duración: ' + terms.durationMinutes + ' min' + (terms.customerDurationMinutes !== terms.durationMinutes ? '; permanencia: ' + terms.customerDurationMinutes + ' min' : ''),
    'Total: ' + (terms.totalPrice === null ? 'a consultar; los precios estimados no son un precio final' : amount(terms.totalPrice))].join('\n')
}
export function sandboxReceiptReply(reservation: SandboxReservation): string {
  if (!reservation.receipt) throw new Error('sandbox receipt missing')
  return 'La reserva fue confirmada.\n' + (reservation.receipt.businessAddress ? 'Te esperamos en ' + reservation.receipt.businessAddress + '.\n' : '') + renderSandboxTerms(reservation.presented.terms) + '\nCódigo' + (reservation.receipt.appointmentIds ? 's: ' + reservation.receipt.appointmentIds.join(' · ') : ': ' + reservation.receipt.appointmentId)
}
/** Buffered result only: the transactional caller must commit the effect, receipt and chat before returning it. */
export function finalizeSandboxBooking(response: DialogueResponse, result: SandboxBookingResult): DialogueResponse {
  const command = response.bookingCommand
  if (!command || !response.state.sandboxReservation || command.presented.fingerprint !== response.state.sandboxReservation.presented.fingerprint || command.presented.nonce !== response.state.sandboxReservation.presented.nonce) throw new Error('sandbox command missing')
  const state = structuredClone(response.state)
  if (result.kind === 'COMMITTED') {
    if (Object.hasOwn(result, 'businessAddress') && !validReceiptAddress(result.businessAddress)) throw new Error('invalid sandbox receipt address')
    if (result.proposalNonce !== command.presented.nonce || result.fingerprint !== command.presented.fingerprint || !text(result.appointmentId, 128) || !result.appointmentId.startsWith('simqa_appointment_')) throw new Error('sandbox committed result mismatch')
    state.sandboxReservation!.receipt = { appointmentId: result.appointmentId, proposalNonce: result.proposalNonce, fingerprint: result.fingerprint, ...(result.businessAddress ? { businessAddress: result.businessAddress } : {}), ...(result.appointmentIds ? { appointmentIds: [...result.appointmentIds] } : {}), ...(result.coordinationGroupId ? { coordinationGroupId: result.coordinationGroupId } : {}) }
    validateReceipt(state.sandboxReservation!.receipt, command.presented)
    delete state.questionContext
    if (state.dialogueContext) state.dialogueContext.lastQuestion = null
    return { state, proposal: null, reply: sandboxReceiptReply(state.sandboxReservation!) }
  }
  delete state.sandboxReservation
  delete state.questionContext
  delete state.dialogueContext
  state.slot = null
  state.requestedTime = null
  state.pending = 'time'
  const reply = result.kind === 'SLOT_CONFLICT' ? 'Ese horario ya no está disponible. Mantengo el pedido; ¿querés consultar otros horarios?'
    : result.kind === 'REQUOTE' ? 'Cambiaron los datos de la propuesta. No reservé: necesitamos consultar una nueva propuesta y confirmarla.'
    : result.reason === 'DEPOSIT_REQUIRED' ? 'Este servicio requiere seña. La gestión de seña todavía no está disponible en este simulador; no reservé el turno.'
    : 'No pude confirmar este turno de prueba. Mantengo el pedido; necesitás revisar los datos o consultarlo con el equipo.'
  return { state, proposal: null, reply }
}
