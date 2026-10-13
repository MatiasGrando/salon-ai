import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, continueCompletedBooking, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { rememberDialogueQuestion } from '../src/conversational-bot/dialogue-context.js'
import { respondWithAiInterpreter, type AiInterpretationInput } from '../src/conversational-bot/ai-interpreter.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { summarizeInterpretationRepairFeedback, summarizeInterpretationAttemptsDiagnostic, summarizeValidationDiagnostic } from '../src/conversational-bot/ai-diagnostics.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { socialContinuationFacts } from '../src/conversational-bot/reply-contract.js'
import { projectBusinessHoursContext, projectBusinessTimeContext } from '../src/conversational-bot/business-time-context.js'

// Local doubles: no environment, network, database, execution or transport.
const context = { businessId: 'recovery', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-13T00:07:00Z') }
const services = [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 15000, requiresConsultation: false }]
let agenda = 0
const port: DialoguePort = { catalog: async () => services, availability: async () => { agenda++; return { professionals: [], slots: [] } } }
const empty = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
const social = { ...empty, turnPlan: { version: 1, operations: [] }, communicativeActs: { version: 1,
  acts: [{ kind: 'social', field: 'general', evidence: 'hola', confidence: 1, mention: null, operationIndexes: [] }] } }
const terms: RuntimeBookingTerms = { version: 1, businessId: context.businessId, timezone: context.timezone, date: '2026-10-13', customerName: 'Ana',
  preference: { kind: 'any' }, totalPriceMinor: 15000, segments: [{ serviceId: 'cut', serviceName: 'Corte Hombre', professionalId: 'staff', professionalName: 'Elisa',
    startAt: '2026-10-13T19:00:00.000Z', endAt: '2026-10-13T19:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30, priceMinor: 15000, priceMode: 'FIXED', configurationHash: null }] }
const fingerprint = runtimeBookingFingerprint(terms), nonce = '11111111-1111-4111-8111-111111111111'
const presented = { version: 1 as const, nonce, fingerprint, conditionsPresented: true as const, terms, scope: { businessId: context.businessId, sessionId: 'session', deploymentId: 'deployment', generation: 1, revision: '1', configurationId: 'config', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 } }
function confirmed(): DialogueState {
  return { ...initialDialogueState(context.businessId), introduced: true, customerName: 'Ana', serviceId: 'cut', date: terms.date, professional: terms.preference,
    slot: { date: terms.date, time: '16:00', startAt: terms.segments[0]!.startAt, professionalId: 'staff', professionalName: 'Elisa', band: 'AFTERNOON', occupiedMinutes: 30 },
    pending: 'proposal', bookingReservation: { presented,
    receipt: { kind: 'COMMITTED', coordinationGroupId: 'group', proposalNonce: nonce, fingerprint, appointments: [{ segmentIndex: 0, appointmentId: 'appointment', visitId: 'visit' }] } } }
}
const failures: string[] = []
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); console.log('PASS postconfirmation ' + name) } catch (error) { failures.push(name); console.error('RED postconfirmation ' + name + ': ' + String(error)) }
}
await check('strict reply contract still rejects declarative continuation', () => {
  assert.throws(() => socialContinuationFacts('La propuesta sigue pendiente.'), /invalid social continuation/)
})
for (const plan of [false, true]) await check('social ' + (plan ? 'plan' : 'legacy') + ' recovers declarative remembered question', async () => {
  const state = { ...initialDialogueState(context.businessId), pending: 'date' as const, serviceId: 'cut' }
  rememberDialogueQuestion(state, 'Mantengo los datos del pedido.')
  const before = structuredClone(state), calls = agenda
  assert.deepEqual(parseDialogueState(state, context.businessId, context.timezone), state)
  const result = await respondWithAiInterpreter(context, state, 'hola', port, async () => plan ? social : empty)
  assert.equal(result.reply, '¿Para qué día querés el turno?')
  assert.deepEqual(result.state, before); assert.deepEqual(state, before); assert.equal(agenda, calls)
})
await check('runtime proposal greeting asks confirmation without executing it', async () => {
  const state = confirmed(); state.bookingReservation = { presented }
  rememberDialogueQuestion(state, 'La propuesta sigue pendiente; todavía no está reservado.')
  const before = structuredClone(state), calls = agenda
  const result = await respondWithAiInterpreter(context, state, 'hola', port, async () => social)
  assert.match(result.reply, /¿.*confirm.*\?/i); assert.deepEqual(result.state, before)
  assert.equal(result.bookingCommand, undefined); assert.equal(agenda, calls)
})
await check('current valid question remains available to model and social output', async () => {
  const state = { ...initialDialogueState(context.businessId), pending: 'date' as const, serviceId: 'cut' }
  rememberDialogueQuestion(state, '¿Para qué día querés reservar?')
  const result = await respondWithAiInterpreter(context, state, 'hola', port, async input => {
    assert.equal(input.firstReplyFacts?.at(-1)?.text, state.questionContext?.question)
    assert.equal(input.firstReplyFacts?.at(-1)?.id, 'next')
    return social
  })
  assert.equal(result.reply, state.questionContext?.question)
})
const bookingMessage = 'hola que tal quería un turno para el jueves a las 15'
const validPlan = { version: 1, operations: [{ kind: 'date', expression: 'el jueves', value: '2026-10-15', evidence: 'el jueves', confidence: 1 },
  { kind: 'time', value: '15:00', evidence: 'a las 15', confidence: 1 }] }
await check('completed booking then new date/time then greeting keeps new request and receipt', async () => {
  const prior = confirmed(), before = structuredClone(prior)
  const booked = await respondWithAiInterpreter(context, prior, bookingMessage, port, async () => ({ ...empty, intent: 'booking', turnPlan: validPlan }))
  assert.equal(booked.interpretation.reason, null); assert.equal(booked.state.date, '2026-10-15'); assert.equal(booked.state.requestedTime, '15:00')
  assert.equal(booked.state.serviceId, null); assert.deepEqual(booked.state.completedBooking, prior.bookingReservation); assert.deepEqual(prior, before)
  const next = await respondWithAiInterpreter(context, booked.state, 'hola', port, async () => social)
  assert.match(next.reply, /servicio.*\?/i); assert.equal(next.state.date, '2026-10-15'); assert.equal(next.state.requestedTime, '15:00')
  assert.equal(next.bookingCommand, undefined)
})
await check('original Thursday at three request uses public hours and survives next greeting', async () => {
  const message = 'hola que tal como estan queria un turno para el jueves a las 3'
  const snapshot = { businessId: context.businessId, timezone: context.timezone, stamp: 'local-test',
    from: new Date('2026-10-15T03:00:00Z'), to: new Date('2026-10-16T03:00:00Z'),
    weeklyHours: [{ dayOfWeek: 4, startTime: '09:00', endTime: '20:00' }], globalBlocks: [] }
  const localPort = { ...port, businessHoursContext: (date: string) => projectBusinessHoursContext(snapshot, date),
    businessTimeContext: (date: string, times: readonly string[]) => projectBusinessTimeContext(snapshot, date, times) }
  const previous = confirmed(), before = structuredClone(previous), reads = agenda
  const result = await respondWithAiInterpreter(context, previous, message, localPort, async input => {
    assert.deepEqual(input.businessHoursContext, { businessId: context.businessId, timezone: context.timezone, date: '2026-10-15', known: true,
      openIntervals: [{ from: '09:00', to: '20:00' }] })
    return { ...empty, intent: 'booking', turnPlan: { version: 1, operations: [validPlan.operations[0],
      { kind: 'time', value: '15:00', evidence: 'a las 3', confidence: .99 }] }, communicativeActs: { version: 1, acts: [
      { kind: 'inquiry', field: 'date', evidence: 'el jueves', confidence: .99, mention: null, operationIndexes: [0] },
      { kind: 'inquiry', field: 'time', evidence: 'a las 3', confidence: .99, mention: null, operationIndexes: [1] }
    ] } }
  })
  assert.equal(result.interpretation.reason, null); assert.equal(result.interpretation.aiCalls, 1)
  assert.equal(result.state.date, '2026-10-15'); assert.equal(result.state.requestedTime, '15:00')
  assert.equal(result.state.pending, 'service'); assert.equal(result.state.serviceId, null); assert.equal(result.bookingCommand, undefined)
  assert.deepEqual(previous, before); assert.deepEqual(result.state.completedBooking, previous.bookingReservation)
  const greeting = await respondWithAiInterpreter(context, result.state, 'hola', localPort, async () => social)
  assert.equal(greeting.state.date, '2026-10-15'); assert.equal(greeting.state.requestedTime, '15:00')
  assert.deepEqual(greeting.state.completedBooking, previous.bookingReservation); assert.equal(agenda, reads)
  assert.match(greeting.reply, /servicio.*\?/i)
})
await check('two wrong evidence plans preserve snapshot and next greeting is answered', async () => {
  const state = confirmed(), before = structuredClone(state), inputs: AiInterpretationInput[] = []
  const result = await respondWithAiInterpreter(context, state, bookingMessage, port, async input => {
    inputs.push(input); return { ...empty, intent: 'booking', turnPlan: { version: 1, operations: [{ kind: 'time', value: '15:00', evidence: 'PRIVATE_NOT_IN_MESSAGE', confidence: 1 }] } }
  })
  assert.equal(inputs.length, 2); assert.deepEqual(result.state, continueCompletedBooking(before)); assert.deepEqual(state, before)
  assert.deepEqual(inputs[1]?.repairFeedback, { reason: 'turn_plan', cause: 'evidence', detail: 'operation_evidence_not_in_message' })
  const validation = result.interpretation.validation!
  assert.equal((validation.turnPlan as { detail?: string })?.detail, 'operation_evidence_not_in_message')
  assert.doesNotMatch(JSON.stringify(validation), /PRIVATE_NOT_IN_MESSAGE/)
  assert.equal((summarizeValidationDiagnostic(validation)?.turnPlan as { detail?: string })?.detail, 'operation_evidence_not_in_message')
  const attempts = summarizeInterpretationAttemptsDiagnostic(result.interpretation.interpretationAttempts)
  assert.equal(attempts?.length, 2)
  assert.ok(attempts?.every(attempt => attempt.validation.turnPlan?.detail === 'operation_evidence_not_in_message'))
  const next = await respondWithAiInterpreter(context, result.state, 'hola', port, async () => social)
  assert.match(next.reply, /ayudar.*\?/i); assert.deepEqual(next.state.completedBooking, state.bookingReservation)
})
await check('temporal missing-date detail survives wrapper and uses only existing repair attempt', async () => {
  let calls = 0
  const result = await respondWithAiInterpreter(context, confirmed(), bookingMessage, port, async input => {
    calls++
    if (calls === 1) return { ...empty, intent: 'booking', turnPlan: { version: 1, operations: validPlan.operations.slice(1) } }
    assert.deepEqual(input.repairFeedback, { reason: 'turn_plan', cause: 'evidence', detail: 'current_date_missing_or_conflicting' })
    return { ...empty, intent: 'booking', turnPlan: validPlan }
  })
  assert.equal(calls, 2); assert.equal(result.interpretation.reason, null); assert.equal(result.state.date, '2026-10-15')
})
await check('closed detail rejects arbitrary text and official provider supplies actionable guide', async () => {
  assert.equal(summarizeInterpretationRepairFeedback({ reason: 'turn_plan', cause: 'evidence', detail: 'PRIVATE' }), undefined)
  assert.equal(summarizeInterpretationRepairFeedback({ reason: 'turn_plan', cause: 'shape', detail: 'current_date_missing_or_conflicting' }), undefined)
  let accessed = false
  assert.equal(summarizeInterpretationRepairFeedback(Object.defineProperty({ reason: 'turn_plan', cause: 'evidence' }, 'detail', {
    get() { accessed = true; throw new Error('PRIVATE') } })), undefined)
  assert.equal(accessed, false)
  const rejected = { outcome: 'rejected', reason: 'turn_plan', service: 'absent', professional: 'absent', candidates: 'absent', correction: 'absent',
    turnPlan: { outcome: 'rejected', reason: 'turn_plan', validationAcceptedKinds: [], cause: 'evidence', detail: 'PRIVATE' } }
  assert.equal(summarizeValidationDiagnostic(rejected), undefined)
  let body: Record<string, unknown> | undefined
  const provider = createOpenAiInterpretationProvider({ apiKey: 'fake', fetchImpl: async (_url, init) => {
    body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(empty) }] }] }), { status: 200 })
  } })
  await provider({ message: bookingMessage, state: initialDialogueState(context.businessId), services,
    repairFeedback: { reason: 'turn_plan', cause: 'evidence', detail: 'current_date_missing_or_conflicting' } } as AiInterpretationInput, new AbortController().signal)
  assert.match(String(body?.instructions), /current_date_missing_or_conflicting/)
  assert.equal(JSON.parse(String(body?.input)).repairFeedback.detail, 'current_date_missing_or_conflicting')
})
assert.equal(failures.length, 0, failures.join('; '))
