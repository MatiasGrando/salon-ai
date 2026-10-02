import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialogueBasketAvailability, type DialoguePort, type DialogueResponse, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import * as diagnostics from '../src/conversational-bot/ai-diagnostics.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { pendingQuestion, type BusinessFacts } from '../src/conversational-bot/information.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import type { TurnOperation } from '../src/conversational-bot/turn-plan.js'

const context = { businessId: 'private-tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T15:00:00Z') }
const cut: DialogueService = { id: 'private-cut', name: 'Corte', durationMinutes: 30, price: 100, requiresConsultation: false }
const policy: ServiceBookingPolicy = { id: 'private-smooth', name: 'Alisado', attentionMode: 'GUIDED_ESTIMATE', price: 200, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué largo tenés?', estimateOptions: [{ id: 'short', label: 'Hasta los hombros', priceMin: 200, priceMax: 300, note: null }], estimateExplanation: null,
  estimateDisclaimer: 'Estimado sujeto a evaluación.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
const smooth: DialogueService = { id: policy.id, name: policy.name, durationMinutes: 90, professionalDurationMinutes: 90, customerDurationMinutes: 150, price: 200, priceMode: 'STARTING_AT', requiresConsultation: false, bookingPolicy: policy }
const catalog = [cut, smooth]
const professionals = [{ id: 'private-rama', name: 'Ramiro', priority: 0 }]
const slot = { date: '2026-10-03', time: '17:00', startAt: '2026-10-03T20:00:00.000Z', professionalId: 'private-rama', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
const facts: BusinessFacts = { businessId: context.businessId, name: 'Local', address: null, area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: '9 a 20' }
const selected: DialogueState = { ...initialDialogueState(context.businessId), pending: 'proposal', basket: { version: 1, nextMemberId: 3, members: [
  { memberId: 'm1', mode: 'single', serviceIds: [cut.id], evidence: 'corte' }, { memberId: 'm2', mode: 'single', serviceIds: [smooth.id], evidence: 'alisado' }
] }, serviceEstimates: { [smooth.id]: { configurationKey: serviceConfigurationKey(policy), optionId: 'short' } }, date: slot.date, requestedTime: slot.time, slot,
  customerName: 'Private Customer', professional: { kind: 'any' }, dialogueContext: { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: context.businessId, serviceId: null, serviceIds: [cut.id, smooth.id], durationMinutes: 120, date: slot.date, professionalId: null } } }
let queries = 0
const success = (): DialogueBasketAvailability => ({ ok: true, services: catalog, durationMinutes: 120, customerDurationMinutes: 180, totalPrice: null, professionals, slots: [slot] })
const port = (result: DialogueBasketAvailability = success()): DialoguePort => ({ catalog: async () => catalog, information: async () => facts,
  availability: async () => { queries++; return { professionals, slots: [slot] } }, availabilityBasket: async () => { queries++; return result } })
const say = (state: DialogueState, p: DialoguePort, operations: TurnOperation[] = [{ kind: 'name', value: 'Private Customer', evidence: 'Private Customer', confidence: 1 }], message = 'Private Customer') =>
  respond(context, state, message, p, { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations } })
type Trace = { outcome: string; phase: string; reason: string | null; scope?: string }
const trace = (value: DialogueResponse) => (value as DialogueResponse & { availability?: Trace }).availability
const expected = (reason: string, phase = 'query', outcome = 'blocked', scope: string | null = 'all_compatible'): Trace => ({ outcome, phase, reason, ...(scope ? { scope } : {}) })

const first = await say(selected, port({ ok: false, reason: 'COMBINATION_BLOCKED' }))
assert.deepEqual(trace(first), expected('COMBINATION_BLOCKED'), 'exact cause must survive motor return')
assert.equal(first.state.requestedTime, slot.time, 'a failed verification does not discard an independent preference')
assert.doesNotMatch(pendingQuestion(first.state), /Qué servicio necesitás/, 'resolved basket is not an unknown service')
assert.match(pendingQuestion(first.state), /cambiar|quitar|equipo/)

for (const reason of ['SERVICE_UNAVAILABLE', 'INVALID_CONFIGURATION', 'DOMAIN_REVIEW', 'PHOTO_REQUIRED', 'VALIDATION_REQUIRED', 'ESTIMATE_NOT_BOOKABLE', 'INVALID_DURATION', 'COMBINATION_BLOCKED', 'COMBINATION_REVIEW', 'NO_COMMON_PROFESSIONAL', 'UNSUPPORTED_OCCUPANCY'] as const) {
  const before = queries
  const failed = await say(selected, port({ ok: false, reason }))
  assert.deepEqual(trace(failed), expected(reason, 'query', reason === 'UNSUPPORTED_OCCUPANCY' ? 'unsupported' : 'blocked'))
  assert.equal(queries, before + 1); assert.equal(failed.proposal, null); assert.equal(failed.state.slot, null)
  assert.equal(failed.state.dialogueContext?.presentedOffer, null); assert.equal(failed.state.requestedTime, slot.time)
  assert.deepEqual(failed.state.basket, selected.basket); assert.deepEqual(failed.state.serviceEstimates, selected.serviceEstimates)
  assert.equal(failed.state.date, selected.date); assert.equal(failed.state.customerName, selected.customerName); assert.deepEqual(failed.state.professional, selected.professional)
  assert.deepEqual(parseDialogueState(failed.state, context.businessId), failed.state)
  assert.doesNotMatch(JSON.stringify(trace(failed)), /private|Corte|Ramiro|Customer|SELECT/)
  assert.match(failed.reply, /equipo|cambiar|quitar|consulta|foto|validación|presupuesto/)
  const count = queries
  const info = await say(failed.state, port(), [{ kind: 'information', target: { kind: 'business', actions: ['HOURS'] }, evidence: 'horarios', confidence: 1 }], 'horarios')
  const empty = await say(failed.state, port(), [], 'hola')
  const social = await respond(context, failed.state, 'hola', port(), { serviceId: null, candidateIds: [], correction: false, intent: 'other' })
  const lexical = await respond(context, failed.state, 'dirección', port())
  const lexicalSocial = await respond(context, failed.state, 'hola', port())
  for (const continuation of [info, empty, social, lexical, lexicalSocial]) {
    assert.equal(trace(continuation), undefined, 'read-only continuation cannot claim old availability is current')
    assert.doesNotMatch(continuation.reply, /Qué servicio necesitás|Qué horario de los disponibles/)
    assert.match(continuation.reply, /cambiar|quitar|equipo/); assert.equal(continuation.proposal, null)
    assert.equal(continuation.state.slot, null); assert.equal(continuation.state.requestedTime, slot.time)
  }
  assert.equal(queries, count, 'information and social turns must not query agenda')
}

const unavailable = port(); delete unavailable.availabilityBasket
const beforeAbsent = queries
const absent = await say(selected, unavailable)
assert.equal(queries, beforeAbsent, 'missing port does not fall back to partial availability')
assert.deepEqual(trace(absent), expected('PORT_UNAVAILABLE', 'preflight', 'unsupported', null))
assert.equal(absent.state.pending, 'time'); assert.match(pendingQuestion(absent.state), /consultemos/); assert.equal(absent.state.requestedTime, slot.time)
const proof = await say(selected, port({ ok: true, services: catalog, durationMinutes: 120, totalPrice: null, professionals, slots: [slot] }))
assert.deepEqual(trace(proof), expected('CUSTOMER_DURATION_PROOF_MISSING', 'contract', 'unsupported'))
assert.equal(proof.state.pending, 'time'); assert.doesNotMatch(proof.reply, /Qué servicio necesitás|horario de los disponibles/)
const spurious = await say(selected, port({ ok: false, reason: 'GUIDANCE_REQUIRED', services: catalog }))
assert.deepEqual(trace(spurious), expected('GUIDANCE_RESULT_NOT_PENDING', 'fresh_guidance', 'unsupported'))
assert.equal(spurious.state.pending, 'time')
const changedPolicy = { ...policy, estimateQuestion: '¿Qué opción actual?', estimateOptions: [{ id: 'new', label: 'Nuevo largo', priceMin: 200, priceMax: 300, note: null }] }
const fresh = await say(selected, port({ ok: false, reason: 'GUIDANCE_REQUIRED', services: [cut, { ...smooth, bookingPolicy: changedPolicy }] }))
assert.deepEqual(trace(fresh), expected('GUIDANCE_REQUIRED', 'fresh_guidance', 'guidance_required'))
assert.equal(fresh.state.pending, 'estimate'); assert.match(fresh.reply, /Nuevo largo/)
const freshBlocked = await say(selected, port({ ok: false, reason: 'GUIDANCE_REQUIRED', services: [cut, { ...smooth, bookingPolicy: { ...policy, requiresPhoto: true } }] }))
assert.deepEqual(trace(freshBlocked), expected('PHOTO_REQUIRED', 'fresh_guidance'))
const freshInvalid = await say(selected, port({ ok: false, reason: 'GUIDANCE_REQUIRED', services: [cut, { ...smooth, durationMinutes: 0 }] }))
assert.deepEqual(trace(freshInvalid), expected('INVALID_DURATION', 'fresh_guidance'))

const pendingGuide = await say({ ...selected, slot: null, pending: 'time', serviceEstimates: {} }, port())
assert.deepEqual(trace(pendingGuide), expected('GUIDANCE_REQUIRED', 'preflight', 'guidance_required', null))
const preflight = await say(selected, { ...port(), catalog: async () => [cut, { ...smooth, bookingPolicy: { ...policy, requiresPhoto: true } }] })
assert.deepEqual(trace(preflight), expected('PHOTO_REQUIRED', 'preflight', 'blocked', null))
const invalid = await say(selected, { ...port(), catalog: async () => [cut, { ...smooth, durationMinutes: 0 }] })
assert.deepEqual(trace(invalid), expected('INVALID_DURATION', 'preflight', 'blocked', null))
const missing = await say(selected, { ...port(), catalog: async () => [cut] })
assert.deepEqual(trace(missing), expected('SERVICE_UNAVAILABLE', 'preflight', 'blocked', null))
assert.equal(missing.state.requestedTime, slot.time)

const verified = await say(selected, port())
assert.deepEqual(trace(verified), { outcome: 'verified', phase: 'slots', reason: null, scope: 'all_compatible' }); assert.ok(verified.proposal)
const noSlots = await say(selected, port({ ok: true, services: catalog, durationMinutes: 120, customerDurationMinutes: 180, totalPrice: null, professionals, slots: [] }))
assert.deepEqual(trace(noSlots), { outcome: 'no_slots', phase: 'slots', reason: null, scope: 'all_compatible' }); assert.equal(noSlots.state.pending, 'date'); assert.equal(noSlots.state.date, null)
const legacyState: DialogueState = { ...initialDialogueState(context.businessId), serviceId: cut.id, date: slot.date, professional: { kind: 'specific', id: professionals[0]!.id } }
const legacy = await say(legacyState, port())
assert.deepEqual(trace(legacy), { outcome: 'verified', phase: 'slots', reason: null, scope: 'preferred' })
const preferredPort: DialoguePort = { ...port(), availabilityBasket: async (services, _date, professionalId) => { queries++; return professionalId ? { ok: false, reason: 'NO_COMMON_PROFESSIONAL' } : { ok: true, services, durationMinutes: 120, customerDurationMinutes: 180, totalPrice: null, professionals, slots: [slot] } } }
const preferred = await respond(context, { ...selected, slot: null, professional: null, professionalNameHint: 'ramiro', pending: 'professional', dialogueContext: undefined } as unknown as DialogueState, 'Ramiro', preferredPort)
assert.deepEqual(trace(preferred), expected('NO_COMMON_PROFESSIONAL', 'query', 'blocked', 'preferred'))
assert.equal(preferred.state.pending, 'professional'); assert.match(preferred.reply, /otra preferencia/); assert.equal(preferred.proposal, null)
const retryBefore = queries
const retry = await say(first.state, port(), [{ kind: 'basket', mutation: 'remove', scope: 'members', targetMemberIds: ['m2'], members: [], evidence: 'quitar alisado', confidence: 1 }], 'quitar alisado')
assert.equal(queries, retryBefore + 1); assert.equal(retry.state.serviceId, cut.id); assert.equal(retry.state.requestedTime, null); assert.equal(retry.proposal, null)

const mutationBefore = queries
const anotherTime = await say(first.state, port({ ok: false, reason: 'COMBINATION_BLOCKED' }), [{ kind: 'time', value: '15:00', evidence: '15:00', confidence: 1 }], '15:00')
assert.equal(queries, mutationBefore + 1); assert.equal(anotherTime.proposal, null); assert.equal(anotherTime.state.slot, null)
assert.equal(anotherTime.state.requestedTime, '15:00'); assert.deepEqual(trace(anotherTime), expected('COMBINATION_BLOCKED'))
const stillNoCommon = await say(first.state, port({ ok: false, reason: 'NO_COMMON_PROFESSIONAL' }), [{ kind: 'professional', mode: 'any', evidence: 'cualquiera', confidence: 1 }], 'cualquiera')
assert.equal(queries, mutationBefore + 2); assert.equal(stillNoCommon.proposal, null); assert.equal(stillNoCommon.state.pending, 'service')
assert.deepEqual(trace(stillNoCommon), expected('NO_COMMON_PROFESSIONAL')); assert.match(stillNoCommon.reply, /compatible con todos/)
const anotherDate = await say(first.state, port({ ok: false, reason: 'COMBINATION_REVIEW' }), [{ kind: 'date', expression: '2026-10-04', value: '2026-10-04', evidence: '2026-10-04', confidence: 1 }], '2026-10-04')
assert.equal(queries, mutationBefore + 3); assert.equal(anotherDate.state.date, '2026-10-04'); assert.equal(anotherDate.state.requestedTime, null)
assert.equal(anotherDate.proposal, null); assert.deepEqual(anotherDate.state.basket, selected.basket)
const summarizeAvailability = (diagnostics as unknown as { summarizeAvailability(value: unknown): Trace | undefined }).summarizeAvailability
assert.equal(typeof summarizeAvailability, 'function')
assert.deepEqual(summarizeAvailability(trace(first)), trace(first))
for (const unsafe of [{ ...trace(first), reason: 'Private Customer' }, { ...trace(first), phase: 'private' }, { ...trace(first), outcome: 'private' }, { ...trace(first), scope: 'private' }, { outcome: 'blocked', phase: 'query', reason: null }, { ...trace(first), name: 'Private Customer' }, Object.create(trace(first)!)]) assert.equal(summarizeAvailability(unsafe), undefined)
const accessor = Object.defineProperty({}, 'outcome', { enumerable: true, get: () => { throw new Error('must not invoke accessor') } })
assert.equal(summarizeAvailability(accessor), undefined)
const ai = await respondWithAiInterpreter(context, selected, 'Private Customer', port({ ok: false, reason: 'COMBINATION_REVIEW' }), async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Private Customer', evidence: 'Private Customer', confidence: 1 }] } }))
assert.deepEqual((ai.interpretation as unknown as { availability?: Trace }).availability, expected('COMBINATION_REVIEW'))
assert.doesNotMatch(JSON.stringify((ai.interpretation as unknown as { availability?: Trace }).availability), /Private Customer|private/)
const preview = await runConversationalPreview({ load: async () => selected, save: async () => {}, createPort: async () => ({ context, port: port({ ok: false, reason: 'NO_COMMON_PROFESSIONAL' }) }) }, context.businessId, 'fake-phone', '17:00')
assert.deepEqual((preview.interpretation as unknown as { availability?: Trace }).availability, expected('NO_COMMON_PROFESSIONAL'))
assert.equal(preview.interpretation.mode, 'deterministic'); assert.equal(preview.proposalReady, false)
console.log('availability diagnostics and faithful blocked continuation: offline PASS')