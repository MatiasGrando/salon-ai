import { attachAiUsage } from '../src/conversational-bot/ai-usage.js'
import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import * as diagnosticHelpers from '../src/conversational-bot/ai-diagnostics.js'

// Local doubles only: no environment, network, real database or bookings.
const context = { businessId: 'recovery', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-09T20:00:00Z') }
const services = [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, requiresConsultation: false, price: 15000 },
  { id: 'lights', name: 'Iluminación', aliases: ['mechas'], durationMinutes: 60, requiresConsultation: false, price: 40000 }]
const empty = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
const invalid = { ...empty, intent: 'booking', serviceId: 'PRIVATE_FOREIGN_ID', serviceEvidence: 'mechas' }
const message = 'hola que tal soy Matías\nqueria hacerme mechas'
type Attempt = { reason: string | null; validation: { outcome: string; reason: string | null }; providerMs: number; validationMs: number }
const attempts = (result: Awaited<ReturnType<typeof respondWithAiInterpreter>>) =>
  (result.interpretation as unknown as { interpretationAttempts?: Attempt[] }).interpretationAttempts
const feedback = (input: AiInterpretationInput) => (input as unknown as { repairFeedback?: unknown }).repairFeedback
let agenda = 0, preparation = 0, writing = 0
const port: DialoguePort = { catalog: async () => services,
  availability: async () => { agenda++; return { professionals: [], slots: [] } },
  prepareRuntimeBooking: async () => { preparation++; return null } }
const failures: string[] = []; let passed = 0
async function check(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log('PASS interpretation recovery ' + name) }
  catch (error) { failures.push(name); console.error('RED interpretation recovery ' + name + ': ' + String(error)) }
}
async function terminal(state: DialogueState, provider: AiInterpretationProvider, timeoutMs = 50) {
  const before = structuredClone(state), counts = { agenda, preparation, writing }
  const result = await respondWithAiInterpreter(context, state, message, port, provider,
    { timeoutMs, responseProvider: async () => { writing++; return null } })
  assert.deepEqual(state, before, 'caller snapshot remains immutable')
  assert.deepEqual(result.state, before, 'all failed interpretation paths retain the complete last valid state')
  assert.deepEqual({ agenda, preparation, writing }, counts, 'no agenda, financial preparation or drafting after failure')
  assert.equal(result.proposal, null)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined); assert.equal(result.managementCommand, undefined)
  assert.doesNotMatch(result.reply, /Matías|mechas|Qué servicio|qué servicio|confirmad|reservado|Soy Cami/)
  assert.match(result.reply, /procesar|interpretar|problema/i, 'honest failure notice rather than interpreting again')
  return result
}
await check('accepted first interpretation stays one call', async () => {
  let count = 0
  const result = await respondWithAiInterpreter(context, initialDialogueState('recovery'), 'hola', port,
    async input => { count++; assert.equal(feedback(input), undefined); return empty })
  assert.equal(count, 1); assert.equal(result.interpretation.aiCalls, 1)
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(attempts(result)?.length, 1)
})
await check('invalid then valid uses same original input and closed feedback', async () => {
  const inputs: AiInterpretationInput[] = []
  const result = await respondWithAiInterpreter(context, initialDialogueState('recovery'), message, port, async input => {
    inputs.push(structuredClone(input))
    return inputs.length === 1 ? invalid : { ...empty, intent: 'booking', serviceId: 'lights', serviceEvidence: 'mechas', serviceConfidence: 'certain' }
  })
  assert.equal(inputs.length, 2); assert.equal(result.interpretation.aiCalls, 2)
  const { repairFeedback, ...repaired } = inputs[1] as AiInterpretationInput & { repairFeedback?: unknown }
  assert.deepEqual(repaired, inputs[0], 'repair does not use partially applied or rejected state')
  assert.deepEqual(repairFeedback, { reason: 'service_not_in_catalog' })
  assert.equal(result.state.serviceId, 'lights'); assert.equal(result.interpretation.mode, 'ai')
  assert.deepEqual(attempts(result)?.map(item => item.reason), ['invalid_output', null])
  assert.deepEqual(attempts(result)?.map(item => item.validation.outcome), ['rejected', 'accepted'])
  assert.doesNotMatch(JSON.stringify(attempts(result)), /PRIVATE_|Matías|mechas|serviceId|raw|evidence/)
})
await check('invalid twice cannot invent identity at episode start', async () => {
  let count = 0
  const result = await terminal(initialDialogueState('recovery'), async () => { count++; return invalid })
  assert.equal(count, 2); assert.equal(result.interpretation.aiCalls, 2); assert.equal(attempts(result)?.length, 2)
})
await check('existing basket and identity survive rejected repair', async () => {
  const state: DialogueState = { ...initialDialogueState('recovery'), introduced: true, customerName: 'Ana', serviceId: 'cut',
    basket: { version: 1, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: 'Corte Hombre' }] },
    date: '2026-10-13', professional: { kind: 'specific', id: 'staff' }, requestedTime: null, pending: 'time',
    timePreference: { kind: 'around', time: '16:00' } }
  await terminal(state, async () => invalid)
})
const terms: RuntimeBookingTerms = { version: 1, businessId: 'recovery', timezone: context.timezone,
  date: '2026-10-13', customerName: 'Ana', preference: { kind: 'specific', id: 'staff' }, totalPriceMinor: 15000,
  segments: [{ serviceId: 'cut', serviceName: 'Corte Hombre', professionalId: 'staff', professionalName: 'Elisa',
    startAt: '2026-10-13T19:00:00.000Z', endAt: '2026-10-13T19:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30,
    priceMinor: 15000, priceMode: 'FIXED', configurationHash: null }] }
const presented = { version: 1 as const, nonce: '8f720180-c78d-4de6-86f9-419d61b79325', fingerprint: runtimeBookingFingerprint(terms), conditionsPresented: true as const,
  scope: { businessId: 'recovery', sessionId: 'session', deploymentId: 'deployment', generation: 2, revision: '4',
    configurationId: 'configuration', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 }, terms }
const proposalState: DialogueState = { ...initialDialogueState('recovery'), introduced: true, serviceId: 'cut', customerName: 'Ana',
  date: terms.date, professional: terms.preference, pending: 'proposal',
  slot: { date: terms.date, time: '16:00', startAt: terms.segments[0]!.startAt, professionalId: 'staff', professionalName: 'Elisa', band: 'AFTERNOON', occupiedMinutes: 30 },
  bookingReservation: { presented } }
assert.deepEqual(parseDialogueState(proposalState, context.businessId, context.timezone), proposalState, 'financial fixture is a valid parsed snapshot')
await check('financial terms nonce and proposal survive failure', async () => { await terminal(proposalState, async () => invalid) })
await check('provider error does not retry or parse independently', async () => {
  let count = 0
  const result = await terminal(initialDialogueState('recovery'), async () => { count++; throw new Error('PRIVATE_PROVIDER_FAILURE') })
  assert.equal(count, 1); assert.equal(result.interpretation.aiCalls, 1); assert.equal(result.interpretation.reason, 'provider_error')
  assert.equal(attempts(result)?.length, 1)
})
await check('timeout does not retry and aborts original call', async () => {
  let count = 0, signal: AbortSignal | undefined
  const result = await terminal(initialDialogueState('recovery'), async (_input, current) => { count++; signal = current; return new Promise(() => {}) }, 5)
  assert.equal(count, 1); assert.equal(signal?.aborted, true); assert.equal(result.interpretation.reason, 'timeout')
})
for (const second of ['provider_error', 'timeout'] as const) await check('repair ' + second + ' stops at two attempts', async () => {
  let count = 0
  const result = await terminal(proposalState, async () => {
    count++; if (count === 1) return invalid
    if (second === 'provider_error') throw new Error('PRIVATE_REPAIR_ERROR')
    return new Promise(() => {})
  }, 5)
  assert.equal(count, 2); assert.equal(result.interpretation.aiCalls, 2)
  assert.deepEqual(attempts(result)?.map(item => item.reason), ['invalid_output', second])
})
await check('unsupported repaired consent still fails same validator', async () => {
  let count = 0
  await terminal(proposalState, async () => { count++; return count === 1 ? invalid : { ...empty, intent: 'booking',
    turnPlan: { version: 1, operations: [{ kind: 'confirm_proposal', evidence: 'PRIVATE_NOT_IN_MESSAGE', confidence: 1 }] } } })
  assert.equal(count, 2)
})
for (const failed of [false, true]) await check('usage totals include rejected first attempt and ' + (failed ? 'failed repair' : 'successful repair'), async () => {
  let count = 0
  const result = await respondWithAiInterpreter(context, initialDialogueState('recovery'), message, port, async () => {
    count++
    if (count === 2 && failed) throw new Error('PRIVATE_REPAIR_FAILURE')
    return attachAiUsage(count === 1 ? structuredClone(invalid) : structuredClone(empty),
      { usage: { input_tokens: count === 1 ? 10 : 20, output_tokens: count === 1 ? 2 : 4,
        input_tokens_details: { cached_tokens: count === 1 ? 5 : 10 }, output_tokens_details: { reasoning_tokens: 0 } } })
  })
  assert.equal(count, 2)
  assert.deepEqual(result.interpretation.usage?.interpretation,
    { inputTokens: failed ? 10 : 30, outputTokens: failed ? 2 : 6, cachedInputTokens: failed ? 5 : 15, reasoningTokens: 0 })
})
await check('closed attempt diagnostic strips extras rejects accessors and caps count', async () => {
  const summarize = (diagnosticHelpers as unknown as { summarizeInterpretationAttemptsDiagnostic?: (value: unknown) => unknown }).summarizeInterpretationAttemptsDiagnostic
  assert.equal(typeof summarize, 'function')
  const item = { reason: 'invalid_output', validation: { outcome: 'rejected', reason: 'service_not_in_catalog',
    service: 'rejected', professional: 'absent', candidates: 'absent', correction: 'absent' }, providerMs: 1, validationMs: 1 }
  const clean = summarize!([{ ...item, raw: 'PRIVATE_RAW', message: 'PRIVATE_MESSAGE', catalogId: 'PRIVATE_ID' }])
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE_|raw|message|catalogId/)
  assert.ok(Array.isArray(clean) && clean.length === 1)
  assert.equal(summarize!([item, item, item]), undefined)
  assert.equal(summarize!([{ ...item, reason: 'PRIVATE_REASON' }]), undefined)
  let accessed = false
  assert.equal(summarize!([Object.defineProperty({ ...item }, 'validation', { get() { accessed = true; throw new Error('PRIVATE_GETTER') } })]), undefined)
  assert.equal(accessed, false)
})
await check('official provider sends only closed repair feedback with existing schema', async () => {
  let body: Record<string, unknown> | undefined
  const provider = createOpenAiInterpretationProvider({ apiKey: 'fake-local-key', fetchImpl: async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(empty) }] }] }), { status: 200 })
  } })
  const input = { message, state: initialDialogueState('recovery'), services,
    repairFeedback: { reason: 'turn_plan' as const, cause: 'evidence' as const, raw: 'PRIVATE_RAW' } }
  await provider(input, new AbortController().signal)
  const request = JSON.parse(String(body?.input)) as { repairFeedback?: unknown }
  assert.deepEqual(request.repairFeedback, { reason: 'turn_plan', cause: 'evidence' })
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_RAW/)
  assert.equal((body?.text as { format: { strict: boolean } }).format.strict, true)
})
console.log('Interpretation recovery: ' + passed + ' passed; ' + failures.length + ' failed')
assert.equal(failures.length, 0, failures.join('; '))
