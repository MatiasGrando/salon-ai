import assert from 'node:assert/strict'
import { admitCommunicativePlan, parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { initialDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { coordinationKey, type DialogueAvailabilitySlot } from '../src/conversational-bot/coordinated-booking.js'

const context = { businessId: 'coordinated-text', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T12:00:00Z') }
const services: DialogueService[] = [
  { id: 'light', name: 'Iluminacion', durationMinutes: 120, price: 40000, requiresConsultation: false },
  { id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 15000, requiresConsultation: false }
]
function slot(time: string, secondProfessional = 'gas'): DialogueAvailabilitySlot {
  const startAt = new Date('2026-10-13T' + time + ':00-03:00').toISOString()
  const cutAt = new Date(Date.parse(startAt) + 120 * 60_000).toISOString()
  const endAt = new Date(Date.parse(cutAt) + 30 * 60_000).toISOString()
  const segments = [
    { serviceId: 'light', serviceName: 'Iluminacion', professionalId: 'tam', professionalName: 'Tamara', startAt, endAt: cutAt, durationMinutes: 120, customerDurationMinutes: 120 },
    { serviceId: 'cut', serviceName: 'Corte Hombre', professionalId: secondProfessional, professionalName: secondProfessional === 'gas' ? 'Gaspar' : 'Otro', startAt: cutAt, endAt, durationMinutes: 30, customerDurationMinutes: 30 }
  ]
  return { date: '2026-10-13', time, startAt, professionalId: 'tam', professionalName: 'Tamara', occupiedMinutes: 150, band: 'AFTERNOON',
    coordination: { key: coordinationKey(context.businessId, segments), segments } }
}
let currentSlots = [slot('16:00'), slot('15:30'), slot('16:30')]
let reads = 0
const port: DialoguePort = {
  catalog: async () => services,
  availability: async () => { throw new Error('single-service agenda must not be used') },
  availabilityBasket: async selected => { reads++; return { ok: true, services: selected, durationMinutes: 150, totalPrice: 55000,
    professionals: [{ id: 'tam', name: 'Tamara', priority: 0 }], slots: currentSlots } }
}
const state = (): DialogueState => ({ ...initialDialogueState(context.businessId), date: '2026-10-13', pending: 'time', professional: { kind: 'any' }, introduced: true,
  basket: { version: 1, nextMemberId: 3, members: [
    { memberId: 'm1', mode: 'single', serviceIds: ['light'], evidence: 'Iluminacion' },
    { memberId: 'm2', mode: 'single', serviceIds: ['cut'], evidence: 'Corte Hombre' }
  ] } })
const offer = (customerName: string | null = null) => respond(context, { ...state(), customerName }, 'cualquier horario', port, { serviceId: null, candidateIds: [], correction: false,
  intent: 'booking', turnPlan: { version: 1, operations: [{ kind: 'time_preference', preference: { kind: 'any' }, evidence: 'cualquier horario', confidence: .99 }] } })
const candidate = (message: string, kind = 'answer', confidence = .99, value = '16:00') => ({
  intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain',
  serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null,
  turnPlan: { version: 1, operations: [{ kind: 'time', value, evidence: message, confidence }] },
  communicativeActs: { version: 1, acts: [{ kind, field: 'time', evidence: message, mention: null, confidence, operationIndexes: [0] }] }
})
const say = (previous: DialogueState, message: string, kind = 'answer', confidence = .99) => respondWithAiInterpreter(context, previous, message, port,
  async () => candidate(message, kind, confidence))
let passed = 0, failed = 0
async function test(name: string, run: () => Promise<void>) {
  currentSlots = [slot('16:00'), slot('15:30'), slot('16:30')]
  try { await run(); passed++; console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
await test('ephemeral exact-time answer authority is absent for inquiry request historical and weak acts', async () => {
  const offered = await offer()
  const message = 'a las 16 esta bien'
  const admit = (kind: string, confidence: number) => {
    const proposal = candidate(message, kind, confidence)
    const plan = parseTurnPlan(proposal.turnPlan, message)
    const metadata = parseCommunicativeActs(proposal.communicativeActs, message, plan.operations.length, plan)
    return admitCommunicativePlan(metadata, plan, plan, message, offered.state, services)
  }
  assert.equal((admit('answer', .99) as { currentTimeAnswer?: true }).currentTimeAnswer, true)
  for (const [kind, confidence] of [['inquiry', .99], ['request', .99], ['reference', .99], ['answer', .6]] as const)
    assert.equal((admit(kind, confidence) as { currentTimeAnswer?: true }).currentTimeAnswer, undefined)
})
await test('AI-owned exact acceptance selects fresh complete group and asks the name', async () => {
  const offered = await offer()
  assert.equal(offered.state.pending, 'time')
  assert.equal(offered.choicePresentation?.choices.filter(choice => choice.operation.kind === 'slot').length, 3)
  const before = reads
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.equal(accepted.interpretation.mode, 'ai')
  assert.equal(accepted.state.slot?.coordination?.key, currentSlots[0]!.coordination!.key, 'accepted current coordinated offer must not be re-offered')
  assert.deepEqual(accepted.state.slot?.coordination?.segments, currentSlots[0]!.coordination!.segments)
  assert.ok(reads > before, 'the entire assignment must be freshly verified')
  assert.equal(accepted.state.pending, 'name')
  assert.match(accepted.reply, /nombre/)
  assert.equal(accepted.proposal, null)
  assert.equal(accepted.bookingCommand, undefined)
})
await test('text acceptance progresses like the stored choice without confirming a reservation', async () => {
  const offered = await offer()
  const operation = offered.choicePresentation!.choices.find(choice => choice.operation.kind === 'slot' && choice.operation.time === '16:00')!.operation
  const clicked = await respondConversationChoice(context, offered.state, operation, port)
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.deepEqual(accepted.state.slot, clicked.state.slot)
  assert.equal(accepted.state.pending, clicked.state.pending)
  assert.equal(accepted.bookingCommand, undefined)
})
await test('known customer reaches a full proposal but not a booking command', async () => {
  const offered = await offer('Cliente de prueba')
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.equal(accepted.state.pending, 'proposal')
  assert.deepEqual(accepted.proposal?.segments, currentSlots[0]!.coordination!.segments)
  assert.equal(accepted.proposal?.customerName, 'Cliente de prueba')
  assert.equal(accepted.bookingCommand, undefined)
})
await test('availability question is not acceptance even when only one group exists', async () => {
  const offered = await offer(); currentSlots = [slot('16:00')]
  const queried = await say(offered.state, 'a las 16 tenes lugar?', 'inquiry')
  assert.equal(queried.state.slot, null)
  assert.equal(queried.state.requestedTimeMode, 'inquiry')
  assert.equal(queried.state.pending, 'time')
  assert.equal(queried.bookingCommand, undefined)
})
await test('a new time request without answer ownership does not select the old offer', async () => {
  const offered = await offer()
  const requested = await say(offered.state, 'quiero a las 16', 'request')
  assert.equal(requested.state.slot, null)
  assert.equal(requested.state.pending, 'time')
  assert.equal(requested.bookingCommand, undefined)
})
await test('approximate answer remains a search preference rather than an exact choice', async () => {
  const offered = await offer()
  const message = 'mas o menos a las 16'
  const requested = await respondWithAiInterpreter(context, offered.state, message, port, async () => ({
    ...candidate(message), turnPlan: { version: 1, operations: [{ kind: 'time_preference', preference: { kind: 'around', time: '16:00' }, evidence: message, confidence: .99 }] }
  }))
  assert.equal(requested.state.slot, null)
  assert.equal(requested.state.pending, 'time')
  assert.equal(requested.bookingCommand, undefined)
})
await test('two fresh full assignments at the same start remain ambiguous', async () => {
  currentSlots = [slot('16:00'), slot('16:00', 'other')]
  const offered = await offer()
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.equal(accepted.state.slot, null)
  assert.equal(accepted.state.pending, 'time')
  assert.equal(accepted.bookingCommand, undefined)
})
await test('changed later professional invalidates a prior whole-group acceptance', async () => {
  const offered = await offer(); currentSlots = [slot('16:00', 'other')]
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.equal(accepted.state.slot, null)
  assert.equal(accepted.state.pending, 'time')
  assert.equal(accepted.bookingCommand, undefined)
})
await test('time not previously offered does not silently select a newly found coordinated option', async () => {
  currentSlots = [slot('15:30')]; const offered = await offer(); currentSlots = [slot('16:00')]
  const accepted = await say(offered.state, 'a las 16 esta bien')
  assert.equal(accepted.state.slot, null)
  assert.equal(accepted.state.pending, 'time')
})
await test('foreign owner and changed offer date cannot authorize the previous assignment', async () => {
  const offered = await offer()
  await assert.rejects(() => say({ ...offered.state, businessId: 'foreign' }, 'a las 16 esta bien'), /scope/)
  const nextDate = { ...offered.state, date: '2026-10-14', dialogueContext: undefined, questionContext: undefined }
  const accepted = await say(nextDate, 'a las 16 esta bien')
  assert.equal(accepted.state.slot, null)
  assert.equal(accepted.bookingCommand, undefined)
})
await test('low confidence and historical time do not select the assignment', async () => {
  const offered = await offer()
  for (const [kind, confidence] of [['answer', .6], ['reference', .99]] as const) {
    const accepted = await say(offered.state, 'a las 16 esta bien', kind, confidence)
    assert.equal(accepted.state.slot, null)
    assert.equal(accepted.bookingCommand, undefined)
  }
})
console.log(`coordinated text selection: ${passed} PASS / ${failed} FAIL`)
if (failed) process.exitCode = 1