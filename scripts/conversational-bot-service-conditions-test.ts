import { rememberDialogueQuestion } from '../src/conversational-bot/dialogue-context.js'
import { respondConversationChoice } from '../src/conversational-bot/engine.js'
import { executePrismaSandboxBooking } from '../src/conversational-bot/prisma-sandbox-booking.js'
import assert from 'node:assert/strict'
import { initialDialogueState, type DialogueState, type DialogueService } from '../src/conversational-bot/engine.js'
import { presentSandboxProposal, sandboxProposalFingerprint, parseSandboxReservation } from '../src/conversational-bot/sandbox-booking.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
const context = { businessId: 'tenant', timezone: 'UTC', dbNow: new Date('2026-10-03T12:00:00Z'), sandboxBooking: true }
const policy: ServiceBookingPolicy = { id: 'service', name: 'Servicio', attentionMode: 'GUIDED_ESTIMATE', price: 100, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué variante preferís?', estimateOptions: [{ id: 'short', label: 'Corto', priceMin: 100, priceMax: 200, note: 'Evaluación previa obligatoria.' }], estimateExplanation: 'El presupuesto depende del largo.',
  estimateDisclaimer: 'Precio estimado.\nAsistir con el cabello limpio.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
const service: DialogueService = { id: policy.id, name: policy.name, price: policy.price, priceMode: policy.priceMode, durationMinutes: 30, requiresConsultation: false, bookingPolicy: policy }
const makeState = (): DialogueState => ({ ...initialDialogueState('tenant'), serviceId: policy.id, date: '2026-10-04', professional: { kind: 'specific', id: 'professional' }, customerName: 'Cliente', requestedTime: '13:00', pending: 'proposal',
  slot: { date: '2026-10-04', time: '13:00', startAt: '2026-10-04T13:00:00.000Z', professionalId: 'professional', professionalName: 'Profesional', band: 'AFTERNOON', occupiedMinutes: 30 },
  serviceEstimates: { service: { configurationKey: serviceConfigurationKey(policy), optionId: 'short' } } })
const proposal = { kind: 'BOOKING_PROPOSAL' as const, businessId: 'tenant', serviceId: policy.id, startAt: '2026-10-04T13:00:00.000Z', professionalId: 'professional', customerName: 'Cliente' }
const state = makeState()
const text = presentSandboxProposal(context, state, [service], proposal)
assert.ok(text.includes(policy.estimateDisclaimer!), 'all legacy conditions must be delivered before consent, not only hashed')
assert.ok(text.indexOf(policy.estimateDisclaimer!) < text.indexOf('¿Confirmás'), 'conditions precede the consent question')
assert.ok(text.includes('Evaluación previa obligatoria.'))
assert.equal((state.sandboxReservation!.presented as unknown as { conditionsPresented?: boolean }).conditionsPresented, true)
const old = structuredClone(state.sandboxReservation!)
delete (old.presented as unknown as { conditionsPresented?: boolean }).conditionsPresented
for (const row of old.presented.terms.services) delete (row as unknown as { conditionsHash?: string }).conditionsHash
old.presented.fingerprint = sandboxProposalFingerprint(old.presented.terms)
parseSandboxReservation(old, state)
const currentNonce = old.presented.nonce
presentSandboxProposal(context, state, [service], proposal, old)
assert.notEqual(state.sandboxReservation!.presented.nonce, currentNonce, 'legacy proposal without delivery proof requires fresh presentation/consent')
const pendingEdit = makeState()
Object.assign(pendingEdit, { editRequest: { fields: ['service' as const] } })
assert.throws(() => presentSandboxProposal(context, pendingEdit, [service], proposal), /edit request/, 'a pending edit cannot issue a new consent proposal')
let effects = 0
const forbiddenTx: any = { $executeRaw: async () => { effects++; throw new Error('pending edit must stop before locking/effects') }, $queryRaw: async () => { effects++; throw new Error('pending edit must stop before reading') } }
const command = { kind: 'CONFIRM_SANDBOX_BOOKING' as const, presented: state.sandboxReservation!.presented }
const editState = { ...state, editRequest: { fields: ['service' as const] } }
const result = await executePrismaSandboxBooking(forbiddenTx, { businessId: 'tenant', userId: 'actor', conversationId: 'conversation', expectedPhone: 'demo:preview:actor:session', response: { state: editState, reply: '', proposal: null, bookingCommand: command } })
assert.deepEqual(result, { kind: 'BLOCKED', reason: 'SCOPE_REJECTED' })
assert.equal(effects, 0, 'adapter cannot bypass pending edit guard before engine')
console.log('PASS proposal conditions before consent, source evidence, legacy upgrade and pending-edit barrier')
const legacyState = { ...state, sandboxReservation: old }
rememberDialogueQuestion(legacyState, '¿Confirmás este turno?')
await assert.rejects(() => respondConversationChoice(context, legacyState, { kind: 'confirm', nonce: old.presented.nonce }, { catalog: async () => [service], availability: async () => { throw new Error('no agenda for rejected consent') } }), /no longer available/, 'legacy delivery has no conditions proof and cannot issue a booking command')
console.log('PASS typed consent rejects legacy presentation without conditions proof')