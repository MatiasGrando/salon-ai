import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import assert from 'node:assert/strict'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA } from '../src/conversational-bot/turn-plan.js'
import { admitCommunicativePlan, parseCommunicativeActs, professionalReferenceScope } from '../src/conversational-bot/communicative-act.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { parseDialogueQuestion } from '../src/conversational-bot/dialogue-context.js'
import { presentVerifiedDates, type AvailabilityPresentationInput } from '../src/conversational-bot/availability-presentation.js'
import { choiceDraftFingerprint } from '../src/conversational-bot/choices.js'
import { temporalPlanDate } from '../src/conversational-bot/business-time-context.js'

// Offline proposals test admission/state/freshness, not live model comprehension.
// No credentials, real agenda, network, persistence or reservation adapter.
const context = { businessId: 'date-priority-qa', timezone: 'UTC', dbNow: new Date('2026-10-05T10:00:00Z') }
const service = { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 100, requiresConsultation: false }
const professional = { id: 'p', name: 'Profesional QA', priority: 0 }
const slots = ['2026-10-06', '2026-10-07', '2026-10-09'].map(date => ({
  date, time: '17:00', startAt: date + 'T17:00:00.000Z', professionalId: 'p',
  professionalName: professional.name, band: 'AFTERNOON' as const, occupiedMinutes: 30
}))
let horizonCalls = 0, fixedCalls = 0, providerCalls = 0
let lastTemporal: unknown
let availableSlots = structuredClone(slots)
const port: DialoguePort = {
  catalog: async () => [service],
  verifiedDateChoices: async (selected, _professional, _estimates, temporal) => {
    lastTemporal = structuredClone(temporal)
    horizonCalls++
    assert.deepEqual(selected.map(item => item.id), ['cut'])
    return { ok: true, services: [service], durationMinutes: 30, totalPrice: 100,
      professionals: [professional], slots: structuredClone(availableSlots) }
  },
  availability: async (_selected, date) => {
    fixedCalls++
    return { professionals: [professional], slots: structuredClone(availableSlots.filter(slot => slot.date === date)) }
  }
}
const ev = (evidence: string, confidence = .99) => ({ evidence, confidence })
const candidate = (operations: object[], text: string, kind = 'request', field = 'date', confidence = .99) => ({
  intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
  serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false,
  informationTarget: null, firstReply: null, intakeReply: null, turnPlan: { version: 1, operations },
  communicativeActs: { version: 1, acts: [{ kind, field, ...ev(text, confidence), mention: null,
    operationIndexes: operations.map((_item, index) => index) }] }
})
const requested = [
  { expression: 'viernes', value: '2026-10-09' },
  { expression: 'martes', value: '2026-10-06' },
  { expression: 'miércoles', value: '2026-10-07' }
]
const message = 'prefiero viernes, luego martes y por último miércoles'
const operation = (values = requested, text = message) => ({ kind: 'date_preferences', candidates: structuredClone(values), ...ev(text) })
const preferences = (state: DialogueState) => (state as DialogueState & { datePreferences?: { expression: string; value: string }[] }).datePreferences
const offered = (result: Awaited<ReturnType<typeof respond>>) => result.choicePresentation?.choices.flatMap(item => item.operation.kind === 'date' ? [item.operation.date] : []) ?? []
async function selected() {
  availableSlots = structuredClone(slots)
  const result = await respond(context, initialDialogueState(context.businessId), 'Corte hombre', port,
    { serviceId: 'cut', candidateIds: [], correction: false })
  assert.equal(result.state.serviceId, 'cut', 'setup uses the actual public selection path')
  assert.equal(result.state.date, null)
  assert.equal(result.state.pending, 'date')
  parseDialogueState(result.state, context.businessId, context.timezone)
  horizonCalls = 0; fixedCalls = 0
  return result.state
}
async function say(state: DialogueState, text: string, output: unknown, dialoguePort = port) {
  const before = structuredClone(state)
  const provider: AiInterpretationProvider = async () => { providerCalls++; return structuredClone(output) }
  const result = await respondWithAiInterpreter(context, state, text, dialoguePort, provider)
  assert.deepEqual(state, before, 'supplied previous snapshot is immutable')
  return result
}
async function prioritised(state: DialogueState, values = requested, text = message) {
  const result = await say(state, text, candidate([operation(values, text)], text))
  assert.equal(result.interpretation.mode, 'ai', 'supported current priorities cannot fall back')
  return result
}
let passed = 0
const failures: string[] = []
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failures.push(name); console.error('RED ' + name + ': ' + (error instanceof Error ? error.message.split('\n')[0] : String(error))) }
}
await check('strict schema/parser expose ordered 2-3-candidate operation', () => {
  for (const values of [requested.slice(0, 2), requested]) {
    const parsed = parseTurnPlan({ version: 1, operations: [operation(values)] }, message)
    assert.deepEqual((parsed.operations[0] as unknown as { candidates: unknown[] }).candidates, values)
  }
  const operationsSchema = TURN_PLAN_JSON_SCHEMA.properties.operations as { items: { anyOf: { properties: { kind: { enum: string[] } }; additionalProperties: boolean }[] } }
  const schema = operationsSchema.items.anyOf.find(item => item.properties.kind.enum.includes('date_preferences'))
  assert.ok(schema)
  assert.equal(schema.additionalProperties, false)
})
await check('malformed/duplicate/date-conflicting priorities rejected as a whole', () => {
  assert.equal(parseTurnPlan({ version: 1, operations: [operation()] }, message).operations.length, 1)
  for (const candidates of [[], requested.slice(0, 1), [...requested, requested[0]!],
    [requested[0]!, requested[0]!], [{ expression: 'viernes', value: '2026-02-30' }, requested[1]!],
    [{ ...requested[0]!, foreign: 'x' }, requested[1]!]]) {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ ...operation(), candidates }] }, message))
  }
  assert.throws(() => parseTurnPlan({ version: 1, operations: [operation(), operation()] }, message))
  assert.throws(() => parseTurnPlan({ version: 1, operations: [operation(),
    { kind: 'date', expression: 'martes', value: '2026-10-06', ...ev('martes') }] }, message))
  assert.throws(() => parseTurnPlan({ version: 1, operations: [operation([{ expression: 'domingo', value: '2026-10-11' }, requested[1]!])] }, message))
})
await check('one fresh horizon orders requested options without choosing date/slot', async () => {
  const result = await prioritised(await selected())
  assert.deepEqual(preferences(result.state), requested)
  assert.deepEqual(offered(result), requested.map(item => item.value))
  assert.equal(result.state.date, null); assert.equal(result.state.slot, null); assert.equal(result.proposal, null)
  assert.equal(horizonCalls, 1); assert.equal(fixedCalls, 0)
  assert.ok(result.turnOutcome?.appliedFields.includes('date'))
  assert.ok(result.turnOutcome?.changedFields.includes('date'))
})
await check('invalid/past candidate cannot partially install valid peers or query agenda', async () => {
  for (const values of [[{ expression: 'viernes', value: '2026-10-08' }, requested[1]!],
    [{ expression: '2026-10-04', value: '2026-10-04' }, requested[1]!]]) {
    const state = await selected(), text = values.map(item => item.expression).join(' o ')
    const result = await say(state, text, candidate([operation(values, text)], text))
    assert.equal(result.interpretation.mode, 'ai', 'structurally valid but impossible dates are clarified by the engine')
    assert.equal(result.state.date, null); assert.equal(preferences(result.state), undefined)
    assert.equal(result.state.serviceId, state.serviceId); assert.equal(result.state.slot, null)
    assert.equal(horizonCalls, 0); assert.equal(fixedCalls, 0)
  }
})
await check('weak/history/inquiry/wrong-field acts do not install priorities', async () => {
  const state = await selected(), parsed = parseTurnPlan({ version: 1, operations: [operation()] }, message)
  for (const [kind, field, confidence] of [['request', 'date', .4], ['reference', 'date', .99], ['inquiry', 'date', .99], ['request', 'service', .99]] as const) {
    const metadata = parseCommunicativeActs(candidate([operation()], message, kind, field, confidence).communicativeActs, message, 1)
    const admitted = admitCommunicativePlan(metadata, parsed, parsed, message, state, [service])
    assert.equal(admitted.plan.operations.length, 0); assert.ok(admitted.blockedFields.includes('date'))
    assert.equal(preferences(state), undefined)
  }
})
await check('absent first priority remains unverified, not exhausted/closed', async () => {
  const state = await selected()
  availableSlots = slots.filter(slot => slot.date === '2026-10-06')
  const result = await prioritised(state)
  assert.deepEqual(offered(result), ['2026-10-06']); assert.deepEqual(preferences(result.state), requested)
  assert.match(result.reply, /verificar|verificad/i)
  assert.doesNotMatch(result.reply, /sin cupo|cerrado|no hay turnos|no encontré fechas disponibles/i)
  assert.equal(result.state.date, null); assert.equal(horizonCalls, 1); assert.equal(fixedCalls, 0)
})
await check('empty horizon/missing port keep priorities without false absence claims', async () => {
  for (const hasPort of [true, false]) {
    const state = await selected()
    availableSlots = []
    const localPort = hasPort ? port : { catalog: port.catalog, availability: port.availability }
    const result = await say(state, message, candidate([operation()], message), localPort)
    assert.equal(result.interpretation.mode, 'ai'); assert.deepEqual(preferences(result.state), requested)
    assert.equal(result.state.date, null); assert.equal(result.state.slot, null)
    assert.match(result.reply, /verificar|verificad/i)
    assert.doesNotMatch(result.reply, /sin cupo|cerrado|no hay turnos|no encontré fechas disponibles/i)
    assert.equal(horizonCalls, hasPort ? 1 : 0)
  }
})
await check('presentation validates ALL slots before filtering/ranking', () => {
  const scope = { businessId: context.businessId, serviceIds: ['cut'], date: null, professionalId: null }
  const input = { scope, read: { fresh: true, scope, slots }, now: context.dbNow, timezone: context.timezone,
    orderedDates: requested.map(item => item.value) } as AvailabilityPresentationInput & { orderedDates: string[] }
  assert.deepEqual(presentVerifiedDates(input).choices.flatMap(item => item.kind === 'date' ? [item.date] : []), requested.map(item => item.value))
  assert.equal(presentVerifiedDates(input).example, '2026-10-09 a las 17:00')
  assert.throws(() => presentVerifiedDates({ ...input, read: { ...input.read, fresh: false } }))
  assert.throws(() => presentVerifiedDates({ ...input, read: { ...input.read, scope: { ...scope, businessId: 'foreign' } } }))
  assert.throws(() => presentVerifiedDates({ ...input, read: { ...input.read, slots: [...slots, { ...slots[0]!, date: '2026-11-01', time: 'broken' }] } }))
})
await check('priority changes invalidate question/reference/fingerprint scopes', async () => {
  const state = (await prioritised(await selected())).state
  assert.equal(state.questionContext?.role, 'date')
  assert.deepEqual(parseDialogueQuestion(state.questionContext, state), state.questionContext)
  const reordered = { ...state, datePreferences: [requested[1]!, requested[0]!, requested[2]!] }
  assert.equal(parseDialogueQuestion(state.questionContext, reordered), null)
  assert.notEqual(professionalReferenceScope(reordered), professionalReferenceScope(state))
  assert.notEqual(choiceDraftFingerprint(reordered), choiceDraftFingerprint(state))
  assert.throws(() => parseDialogueState({ ...state, date: '2026-10-06' }, context.businessId, context.timezone))
})
await check('explicit fresh button clears priorities; old button is rejected', async () => {
  const result = await prioritised(await selected())
  const option = result.choicePresentation?.choices.find(item => item.operation.kind === 'date')
  assert.ok(option)
  horizonCalls = 0
  const chosen = await respondConversationChoice(context, result.state, option.operation, port)
  assert.equal(chosen.state.date, '2026-10-09'); assert.equal(preferences(chosen.state), undefined)
  assert.equal(chosen.state.slot, null); assert.equal(horizonCalls, 1)
  const second = await prioritised(result.state, requested.slice(1), 'prefiero martes y miércoles')
  assert.ok(!offered(second).includes('2026-10-09'))
  await assert.rejects(() => respondConversationChoice(context, second.state, option.operation, port))
})
await check('explicit current typed date clears stored priorities', async () => {
  const state = (await prioritised(await selected())).state, text = 'mejor el martes'
  const result = await say(state, text, candidate([{ kind: 'date', expression: 'martes', value: '2026-10-06', ...ev('martes') }], text, 'change'))
  assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.state.date, '2026-10-06')
  assert.equal(preferences(result.state), undefined); assert.equal(result.state.slot, null)
})
await check('multiple dates cannot expose previous date commercial proof before model', async () => {
  const state = await selected()
  const concrete = await respondConversationChoice(context, state, { kind: 'date', date: '2026-10-06' }, port)
  assert.equal(concrete.state.date, '2026-10-06', 'old date actually produced by public choice path')
  let reads = 0, readsAtProvider = -1
  const localPort: DialoguePort = { ...port, businessTimeContext: (date, times) => {
    reads++
    return { businessId: context.businessId, timezone: context.timezone, date, candidateTimes: [...times],
      candidates: times.map(time => ({ time, status: time === '17:00' ? 'open' as const : 'closed' as const })) }
  } }
  const provider: AiInterpretationProvider = async input => {
    readsAtProvider = reads
    assert.equal(input.businessTimeContext, undefined)
    return candidate([], 'prefiero viernes o miércoles tipo 5')
  }
  await respondWithAiInterpreter(context, concrete.state, 'prefiero viernes o miércoles tipo 5', localPort, provider)
  assert.equal(readsAtProvider, 0)
  assert.equal(temporalPlanDate({ operations: [operation()] }, '2026-10-06', '2026-10-05'), null)
})
await check('common exact time coexists with ordered dates without choosing a date/slot', async () => {
  const state = await selected(), text = 'Prefiero miércoles; si no, martes, a las 17.'
  const values = [requested[2]!, requested[1]!]
  const output = candidate([operation(values, 'Prefiero miércoles; si no, martes'),
    { kind: 'time', value: '17:00', ...ev('a las 17') }], text)
  output.communicativeActs.acts = [
    { kind: 'request', field: 'date', ...ev('Prefiero miércoles; si no, martes'), mention: null, operationIndexes: [0] },
    { kind: 'request', field: 'time', ...ev('a las 17'), mention: null, operationIndexes: [1] }
  ]
  const result = await say(state, text, output)
  assert.equal(result.interpretation.mode, 'ai')
  assert.deepEqual(preferences(result.state), values)
  assert.equal(result.state.requestedTime, '17:00')
  assert.deepEqual(lastTemporal, { requestedTime: '17:00' })
  assert.equal(result.state.date, null); assert.equal(result.state.slot, null)
  assert.deepEqual(offered(result), values.map(item => item.value))
  assert.equal(horizonCalls, 1); assert.equal(fixedCalls, 0)
})
await check('stored current priorities reach same-call provider context and strict schema', async () => {
  const state = (await prioritised(await selected())).state
  let requests = 0, body: Record<string, any> | undefined
  const provider = createOpenAiInterpretationProvider({ apiKey: 'synthetic-test-only', fetchImpl: async (_url, init) => {
    requests++; body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate([], 'gracias')) }] }
    ] }), { status: 200 })
  } })
  await provider({ message: 'gracias', state, services: [service], businessDate: '2026-10-05', timezone: 'UTC' }, new AbortController().signal)
  assert.equal(requests, 1)
  const input = JSON.parse(body!.input)
  assert.deepEqual(input.datePreferences, requested)
  assert.equal(input.date, null); assert.equal(input.expectedAnswer.role, 'date')
  const schema = body!.text.format.schema.properties.turnPlan
  assert.ok(JSON.stringify(schema).includes('date_preferences'))
  assert.equal(body!.store, false)
})
await check('a side inquiry preserves priorities without another horizon read', async () => {
  const state = (await prioritised(await selected())).state, text = '¿Cuál es la dirección?'
  horizonCalls = 0; fixedCalls = 0
  const facts = { businessId: context.businessId, name: 'Prueba', address: 'Calle QA 123', area: null, mapsUrl: null,
    website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: null }
  const output = candidate([{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'], subject: 'general' }, ...ev(text) }], text, 'inquiry', 'general')
  const result = await say(state, text, output, { ...port, information: async () => facts })
  assert.equal(result.interpretation.mode, 'ai')
  assert.deepEqual(preferences(result.state), requested)
  assert.equal(result.state.date, null); assert.equal(result.state.serviceId, state.serviceId)
  assert.match(result.reply, /Calle QA 123/)
  assert.equal(horizonCalls, 0); assert.equal(fixedCalls, 0)
})
await check('JSON roundtrip keeps canonical question scope and malformed persisted priorities fail', async () => {
  const state = (await prioritised(await selected())).state
  const jsonb = JSON.parse(JSON.stringify(state))
  jsonb.datePreferences = jsonb.datePreferences.map((item: { expression: string; value: string }) => ({ value: item.value, expression: item.expression }))
  const parsed = parseDialogueState(jsonb, context.businessId, context.timezone)
  assert.deepEqual(parsed.questionContext, state.questionContext)
  for (const datePreferences of [[requested[0]!], [requested[0]!, requested[0]!],
    [requested[0]!, { expression: 'martes', value: null }]]) {
    assert.throws(() => parseDialogueState({ ...state, datePreferences }, context.businessId, context.timezone))
  }
})
await check('invalid priorities preserve an old selected date and independent actual name', async () => {
  const base = await selected()
  const selectedDate = await respondConversationChoice(context, base, { kind: 'date', date: '2026-10-06' }, port)
  horizonCalls = 0; fixedCalls = 0
  const text = 'Soy Matías; prefiero viernes o martes'
  const values = [{ expression: 'viernes', value: '2026-10-08' }, requested[1]!]
  const output = candidate([operation(values, 'prefiero viernes o martes'),
    { kind: 'name', value: 'Matías', ...ev('Matías') }], text)
  output.communicativeActs.acts = [
    { kind: 'change', field: 'date', ...ev('prefiero viernes o martes'), mention: null, operationIndexes: [0] },
    { kind: 'request', field: 'name', ...ev('Soy Matías'), mention: null, operationIndexes: [1] }
  ]
  const result = await say(selectedDate.state, text, output)
  assert.equal(result.interpretation.mode, 'ai')
  assert.equal(result.state.date, '2026-10-06')
  assert.equal(preferences(result.state), undefined)
  assert.equal(result.state.customerName, 'Matías')
  assert.equal(result.state.serviceId, selectedDate.state.serviceId)
  assert.equal(horizonCalls, 0); assert.equal(fixedCalls, 0)
  assert.match(result.reply, /fecha|día/)
})
await check('singular date cannot truncate multiple dates in its current communicative evidence', async () => {
  const state = await selected(), text = 'Prefiero miércoles; si no, martes'
  const output = candidate([{ kind: 'date', expression: 'miércoles', value: '2026-10-07', ...ev('miércoles') }], text)
  const parsed = parseTurnPlan(output.turnPlan, text)
  const acts = parseCommunicativeActs(output.communicativeActs, text, parsed.operations.length)
  const admission = admitCommunicativePlan(acts, parsed, parsed, text, state, [service], '2026-10-05')
  assert.deepEqual(admission.blockedFields, ['date'])
  assert.deepEqual(admission.plan.operations, [])
  const result = await say(state, text, output)
  assert.equal(result.interpretation.mode, 'ai')
  assert.ok(!result.turnOutcome?.appliedFields.includes('date'))
  assert.equal(result.state.date, null, 'do not silently select only one alternative')
  assert.equal(preferences(result.state), undefined, 'do not reconstruct missing priorities from text')
  assert.equal(result.state.serviceId, state.serviceId)
  assert.equal(result.state.slot, null)
  assert.equal(horizonCalls, 0); assert.equal(fixedCalls, 0)
  assert.match(result.reply, /fecha|día|aclar/)
})
await check('historical date and independently scoped actual date correction remain distinct', async () => {
  const state = await selected(), text = 'Antes vine el martes; ahora quiero el miércoles'
  const output = candidate([{ kind: 'date', expression: 'miércoles', value: '2026-10-07', ...ev('miércoles') }], text, 'change')
  output.communicativeActs.acts = [
    { kind: 'reference', field: 'date', ...ev('Antes vine el martes'), mention: null, operationIndexes: [] },
    { kind: 'change', field: 'date', ...ev('ahora quiero el miércoles'), mention: null, operationIndexes: [0] }
  ]
  const result = await say(state, text, output)
  assert.equal(result.interpretation.mode, 'ai')
  assert.equal(result.state.date, '2026-10-07')
  assert.equal(preferences(result.state), undefined)
})
await check('date truncation blocks only date and preserves independent current identity', async () => {
  const state = await selected(), text = 'Soy Matías; prefiero miércoles; si no, martes'
  const output = candidate([
    { kind: 'date', expression: 'miércoles', value: '2026-10-07', ...ev('miércoles') },
    { kind: 'name', value: 'Matías', ...ev('Matías') }
  ], text)
  output.communicativeActs.acts = [
    { kind: 'request', field: 'date', ...ev('prefiero miércoles; si no, martes'), mention: null, operationIndexes: [0] },
    { kind: 'request', field: 'name', ...ev('Soy Matías'), mention: null, operationIndexes: [1] }
  ]
  const result = await say(state, text, output)
  assert.equal(result.interpretation.mode, 'ai')
  assert.equal(result.state.date, null); assert.equal(preferences(result.state), undefined)
  assert.equal(result.state.customerName, 'Matías')
  assert.equal(result.state.serviceId, state.serviceId)
  assert.equal(horizonCalls, 0); assert.equal(fixedCalls, 0)
})
console.log('date priority controlled checks: ' + passed + ' PASS / ' + failures.length + ' FAIL; provider proposals=' + providerCalls)
if (failures.length) process.exitCode = 1
