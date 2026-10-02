import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialogueContext, type DialoguePort } from '../src/conversational-bot/engine.js'
import { finalizeSandboxBooking } from '../src/conversational-bot/sandbox-booking.js'
const context: DialogueContext = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z'), sandboxBooking: true }
const service = { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 27000, priceMode: 'FIXED' as const, requiresConsultation: false }
let agendaCalls = 0
const slot = { startAt: '2026-10-03T20:00:00.000Z', date: '2026-10-03', time: '17:00', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
const port: DialoguePort = { catalog: async () => [service], availability: async () => { agendaCalls++; return { professionals: [{ id: 'cin', name: 'Cin', priority: 0 }], slots: [slot] } } }
const ready = { ...initialDialogueState('qa'), serviceId: 'cut', date: slot.date, professional: { kind: 'specific' as const, id: 'cin' }, slot, customerName: 'Matías' }
const shown = await respond(context, ready, 'quiero reservar', port)
assert.match(shown.reply, /¿Confirmás este turno de prueba\?/)
assert.match(shown.reply, /sábado 03\/10/)
assert.match(shown.reply, /30 min/)
assert.match(shown.reply, /27[.,]000/)
assert.equal(shown.bookingCommand, undefined, 'showing a proposal never executes')
assert.equal(shown.state.questionContext?.role, 'confirmation')
const callsBefore = agendaCalls
const confirm = await respond(context, shown.state, 'sí', port)
assert.equal(confirm.bookingCommand?.kind, 'CONFIRM_SANDBOX_BOOKING')
assert.equal(agendaCalls, callsBefore, 'confirmation adapter, not dialogue, revalidates atomically')
assert.doesNotMatch(confirm.reply, /turno de prueba reservado/i)
const committed = finalizeSandboxBooking(confirm, { kind: 'COMMITTED', appointmentId: 'simqa_appointment_test', proposalNonce: confirm.bookingCommand!.presented.nonce, fingerprint: confirm.bookingCommand!.presented.fingerprint })
assert.match(committed.reply, /Turno de prueba reservado/)
assert.match(committed.reply, /simqa_appointment_test/)
parseDialogueState(committed.state, 'qa', context.timezone)
const replay = await respond(context, committed.state, 'quiero reservar', port)
assert.equal(replay.bookingCommand, undefined)
assert.equal(agendaCalls, callsBefore)
assert.match(replay.reply, /simqa_appointment_test/)
const altered = await respond(context, committed.state, 'mejor mañana', port, { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [{ kind: 'date', expression: 'mañana', confidence: 1, evidence: 'mañana' }] } })
assert.equal(altered.state.date, committed.state.date)
assert.match(altered.reply, /modificar/i)
const production = await respond({ ...context, sandboxBooking: false }, ready, 'quiero reservar', port)
assert.equal(production.state.sandboxReservation, undefined)
assert.equal((await respond({ ...context, sandboxBooking: false }, production.state, 'sí', port)).bookingCommand, undefined)
console.log('conversational sandbox booking contract: OK')
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
const semantic = (evidence: string, confidence = 1) => ({ serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1 as const, operations: [{ kind: 'confirm_proposal' as const, confidence, evidence }] } })
const semanticTurn = await respond(context, shown.state, 'confirmá ese turno por favor', port, semantic('confirmá ese turno por favor'))
assert.ok(semanticTurn.bookingCommand)
for (const phrase of ['no confirmes', 'sí pero mejor mañana', '¿podés confirmar?']) {
  const rejected = await respond(context, shown.state, phrase, port, semantic(phrase))
  assert.equal(rejected.bookingCommand, undefined, 'obvious contrary, conditional or interrogative consent does not execute')
}
const uncertain = await respond(context, shown.state, 'confirmá', port, semantic('confirmá', 0.7))
assert.equal(uncertain.bookingCommand, undefined)
const correction = await respond(context, shown.state, 'sí mejor el domingo', port, { ...semantic('sí'), turnPlan: { version: 1, operations: [
  { kind: 'confirm_proposal', evidence: 'sí', confidence: 1 }, { kind: 'date', expression: 'el domingo', evidence: 'el domingo', confidence: 1 }
] } })
assert.equal(correction.bookingCommand, undefined)
assert.equal(correction.state.sandboxReservation, undefined)
assert.equal(correction.state.customerName, 'Matías')
const noPresented = await respond(context, ready, 'sí', port, semantic('sí'))
assert.equal(noPresented.bookingCommand, undefined)
const info = await respond(context, shown.state, '¿Dónde están?', { ...port, information: async () => ({ businessId: 'qa', name: 'QA', address: 'Monroe 5252', area: 'Villa Urquiza', mapsUrl: null, hours: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null }) }, { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, evidence: 'Dónde están', confidence: 1 }] } })
assert.equal(info.bookingCommand, undefined)
assert.equal(info.state.sandboxReservation?.presented.nonce, shown.state.sandboxReservation!.presented.nonce)
assert.match(info.reply, /Confirmás/)
const failed = finalizeSandboxBooking(confirm, { kind: 'SLOT_CONFLICT' })
assert.equal(failed.state.slot, null)
assert.equal(failed.state.sandboxReservation, undefined)
assert.equal(failed.state.customerName, 'Matías')
parseDialogueState(failed.state, 'qa', context.timezone)
const requote = finalizeSandboxBooking(confirm, { kind: 'REQUOTE' })
assert.equal(requote.state.sandboxReservation, undefined)
assert.match(requote.reply, /nueva propuesta/)
assert.throws(() => finalizeSandboxBooking(confirm, { kind: 'COMMITTED', appointmentId: 'simqa_appointment_test', proposalNonce: 'foreign', fingerprint: confirm.bookingCommand!.presented.fingerprint }))
const foreign = structuredClone(shown.state)
foreign.sandboxReservation!.presented.terms.businessId = 'foreign'
assert.throws(() => parseDialogueState(foreign, 'qa'))
const stale = structuredClone(shown.state)
stale.customerName = 'Otra persona'
assert.throws(() => parseDialogueState(stale, 'qa'))
assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'confirm_proposal', confidence: 1, evidence: 'sí', proposalId: 'invented' }] }, 'sí'))
let responseCalls = 0
const aiConfirmed = await respondWithAiInterpreter(context, shown.state, 'confirmá ese turno por favor', port,
  async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: semantic('confirmá ese turno por favor').turnPlan }),
  { responseProvider: async () => { responseCalls++; return { opening: '¡Reservado!', factIds: [], closing: null } } })
assert.ok(aiConfirmed.bookingCommand)
assert.equal(responseCalls, 0, 'effect lifecycle always uses canonical text')
const aiFailure = await respondWithAiInterpreter(context, shown.state, 'sí', port, async () => { throw new Error('offline provider unavailable') })
assert.equal(aiFailure.interpretation.mode, 'fallback')
assert.ok(aiFailure.bookingCommand, 'closed affirmative remains usable when provider fails')
let request: any
const provider = createOpenAiInterpretationProvider({ apiKey: 'offline', fetchImpl: async (_url, init) => {
  request = JSON.parse(init!.body as string)
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: semantic('sí').turnPlan }) }] }] }), { status: 200 })
} })
await provider({ message: 'sí', state: shown.state, services: [service] }, new AbortController().signal)
assert.equal(JSON.parse(request.input).expectedAnswer.role, 'confirmation')
assert.ok(request.text.format.schema.properties.turnPlan.anyOf[0].properties.operations.items.anyOf.some((schema: any) => schema.properties.kind.enum[0] === 'confirm_proposal'))
console.log('sandbox consent, replay, failure, provider schema: OK')
import { buildSandboxBookingTerms, presentSandboxProposal, sandboxProposalFingerprint } from '../src/conversational-bot/sandbox-booking.js'
const oldTerms = shown.state.sandboxReservation!.presented.terms
const reordered = Object.fromEntries(Object.entries(oldTerms).reverse()) as typeof oldTerms
assert.equal(sandboxProposalFingerprint(reordered), sandboxProposalFingerprint(oldTerms), 'field insertion order is not a new quote')
assert.throws(() => sandboxProposalFingerprint({ ...oldTerms, totalPrice: Number.POSITIVE_INFINITY }))
const estimatePolicy = { id: 'cream', name: 'Baño de crema', attentionMode: 'GUIDED_ESTIMATE' as const, price: 25000, priceMode: 'STARTING_AT' as const, estimateAllowsBooking: true,
  estimateQuestion: '¿Qué marca querés?', estimateOptions: [{ id: 'karsell', label: 'Karsell', priceMin: 25000, priceMax: 30000, note: null }], estimateExplanation: null, estimateDisclaimer: 'Precio final a confirmar', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
import { serviceConfigurationKey } from '../src/bot-options/domain/service-booking.js'
const cream = { id: 'cream', name: 'Baño de crema', durationMinutes: 30, professionalDurationMinutes: 30, customerDurationMinutes: 45, price: 25000, priceMode: 'STARTING_AT' as const, requiresConsultation: false, bookingPolicy: estimatePolicy }
const multiple = { ...ready, pending: 'proposal' as const, serviceId: null, basket: { version: 1 as const, nextMemberId: 3, members: [
  { memberId: 'm1', mode: 'single' as const, serviceIds: ['cut'], evidence: 'corte' }, { memberId: 'm2', mode: 'single' as const, serviceIds: ['cream'], evidence: 'baño de crema' }
] }, serviceEstimates: { cream: { configurationKey: serviceConfigurationKey(estimatePolicy), optionId: 'karsell' } } }
const multiProposal = { kind: 'BOOKING_PROPOSAL' as const, businessId: 'qa', serviceId: 'cut', serviceIds: ['cut','cream'], customerDurationMinutes: 75, startAt: slot.startAt, professionalId: 'cin', customerName: 'Matías' }
const terms = buildSandboxBookingTerms(context, multiple, [service,cream], multiProposal)
assert.equal(terms.totalPrice, null)
assert.equal(terms.durationMinutes, 60)
assert.equal(terms.customerDurationMinutes, 75)
const multiText = presentSandboxProposal(context, multiple, [service,cream], multiProposal)
assert.match(multiText, /Karsell/)
assert.match(multiText, /25[.,]000 a \$ 30[.,]000/)
assert.match(multiText, /permanencia: 75 min/)
parseDialogueState(multiple, 'qa', context.timezone)
const newer = buildSandboxBookingTerms(context, shown.state, [{ ...service, price: 28000 }], shown.proposal!)
assert.notEqual(sandboxProposalFingerprint(newer), shown.state.sandboxReservation!.presented.fingerprint)
const changed = structuredClone(shown.state)
presentSandboxProposal(context, changed, [{ ...service, price: 28000 }], shown.proposal!, shown.state.sandboxReservation)
assert.notEqual(changed.sandboxReservation!.presented.nonce, shown.state.sandboxReservation!.presented.nonce)
const unchanged = structuredClone(shown.state)
presentSandboxProposal(context, unchanged, [service], shown.proposal!, shown.state.sandboxReservation)
assert.equal(unchanged.sandboxReservation!.presented.nonce, shown.state.sandboxReservation!.presented.nonce)
console.log('sandbox canonical terms, estimate ranges, nonce rotation: OK')

assert.throws(() => buildSandboxBookingTerms(context, ready, [service], { ...shown.proposal!, professionalId: 'foreign' }))
assert.throws(() => buildSandboxBookingTerms(context, multiple, [service,cream], { ...multiProposal, customerDurationMinutes: 60 }))
for (const phrase of ['¿sí?', 'sí?', 'sí, pero mejor mañana', 'sí y cuál es la dirección']) {
  assert.equal((await respond(context, shown.state, phrase, port)).bookingCommand, undefined)
}
