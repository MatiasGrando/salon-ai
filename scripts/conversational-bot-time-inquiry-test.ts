import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueResponse, type DialogueState } from '../src/conversational-bot/engine.js'
import { admitCommunicativePlan, parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'

// Offline proposals exercise semantic admission and the real engine; they do not
// certify a live model. Assertions and recorded requests stay outside providers.
const context = { businessId: 'time-inquiry-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-09T15:00:00Z') }
const services = [{ id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 100, requiresConsultation: false }]
const professionals = [{ id: 'ramiro', name: 'Ramiro', priority: 0 }]
const base = (): DialogueState => ({ ...initialDialogueState(context.businessId), serviceId: 'cut', date: '2026-10-13', professional: { kind: 'specific', id: 'ramiro' }, customerName: 'Ana', pending: 'time' })
const evidence = (text: string, confidence = .99) => ({ evidence: text, confidence })
const time = (text = 'a las 16', value = '16:00') => ({ kind: 'time', value, ...evidence(text) })
const act = (kind: string, field: string, text: string, indexes: number[], confidence = .99) => ({ kind, field, ...evidence(text, confidence), operationIndexes: indexes, mention: null })
const output = (operations: object[], acts: object[]) => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations }, communicativeActs: { version: 1, acts } })
const inquiry = (text: string) => output([time(/a las 16/i.exec(text)?.[0])], [act('inquiry', 'time', text, [0])])
const mode = (state: DialogueState) => (state as DialogueState & { requestedTimeMode?: string }).requestedTimeMode

type AgendaRead = { date: string; professionalId: string | undefined; temporal: unknown }
function agenda(times: string[] = ['16:00', '17:00']) {
  const reads: AgendaRead[] = []
  const port: DialoguePort = {
    catalog: async () => services,
    availability: async (_service, date, professionalId, temporal) => {
      reads.push({ date, professionalId, temporal: structuredClone(temporal) })
      return { professionals, slots: times.map(clock => ({ date, time: clock, startAt: date + 'T' + String(Number(clock.slice(0, 2)) + 3).padStart(2, '0') + clock.slice(2) + ':00Z', professionalId: 'ramiro', professionalName: 'Ramiro', occupiedMinutes: 0, band: 'AFTERNOON' as const })) }
    }
  }
  return { reads, port }
}
async function say(state: DialogueState, message: string, proposal: unknown, port: DialoguePort) {
  const before = structuredClone(state)
  let providerCalls = 0
  const provider: AiInterpretationProvider = async () => { providerCalls++; return structuredClone(proposal) }
  const result = await respondWithAiInterpreter(context, state, message, port, provider)
  assert.deepEqual(state, before, 'interpretation must not mutate its input')
  assert.equal(providerCalls, 1, 'the controlled interpretation is one call')
  assert.equal(result.interpretation.interpretationProviderError, null)
  return result
}
function unselected(result: DialogueResponse) {
  assert.equal(result.state.slot, null, 'asking availability cannot select a slot')
  assert.equal(result.proposal, null, 'asking availability cannot create a booking proposal')
  assert.equal(result.bookingCommand, undefined, 'asking availability cannot authorize booking')
  assert.doesNotMatch(result.reply, /turno (?:confirmado|reservado)|(?:ya|te) reserv[eé]|propuesta:/i)
}
function preserved(result: DialogueResponse) {
  assert.equal(result.state.serviceId, 'cut')
  assert.deepEqual(result.state.professional, { kind: 'specific', id: 'ramiro' })
  assert.equal(result.state.date, '2026-10-13')
}
const failures: string[] = []
async function check(label: string, run: () => void | Promise<void>) {
  try { await run(); console.log('PASS time inquiry ' + label) }
  catch (error) { failures.push(label); console.error('RED time inquiry ' + label + ': ' + String(error)) }
}
const originalFetch = globalThis.fetch
 globalThis.fetch = async () => { throw new Error('Network forbidden in time inquiry regression') }
try {
  await check('three current questions preserve Tuesday and actually read the agenda', async () => {
    const { port, reads } = agenda()
    let state: DialogueState = { ...base(), date: '2026-10-12' }
    const messages = ['El martes a las 16 tendrás?', 'A las 16 podría ser?', 'A las 16 podría ser?']
    for (const [index, message] of messages.entries()) {
      const proposed = index === 0 ? output([
        { kind: 'date', expression: 'martes', ...evidence('martes') }, time()
      ], [act('inquiry', 'date', message, [0]), act('inquiry', 'time', message, [1])]) : inquiry(message)
      const beforeReads = reads.length
      const result = await say(state, message, proposed, port)
      assert.equal(result.interpretation.mode, 'ai')
      assert.equal(result.state.requestedTime, '16:00')
      assert.equal(mode(result.state), 'inquiry')
      assert.equal(reads.length, beforeReads + 1)
      assert.deepEqual(reads.at(-1), { date: '2026-10-13', professionalId: 'ramiro', temporal: { requestedTime: '16:00' } })
      assert.equal(result.state.timeMeaningClarification, undefined)
      assert.ok(result.choicePresentation?.choices.some(choice => choice.operation.kind === 'slot' && choice.operation.time === '16:00'))
      assert.doesNotMatch(result.reply, /qué horario o franja preferís/i)
      preserved(result); unselected(result)
      assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(result.state)), context.businessId, context.timezone), result.state)
      state = result.state
    }
  })
  await check('a current exact inquiry resolves stored meaning clarification', async () => {
    const { port, reads } = agenda()
    const result = await say({ ...base(), timeMeaningClarification: true }, 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    assert.equal(result.state.timeMeaningClarification, undefined)
    assert.equal(result.state.requestedTime, '16:00')
    assert.equal(reads.length, 1)
    preserved(result); unselected(result)
  })
  await check('direct engine honors the same admitted inquiry without selecting', async () => {
    const { port, reads } = agenda()
    const message = 'A las 16 podría ser?'
    const proposed = inquiry(message)
    const plan = parseTurnPlan(proposed.turnPlan, message)
    const metadata = parseCommunicativeActs(proposed.communicativeActs, message, plan.operations.length, plan)
    const communicative = admitCommunicativePlan(metadata, plan, plan, message, base(), services, '2026-10-09')
    const result = await respond(context, base(), message, port, { intent: 'booking', serviceId: null, candidateIds: [], correction: false, turnPlan: communicative.plan, communicative })
    assert.equal(result.state.requestedTime, '16:00')
    assert.equal(reads.length, 1)
    preserved(result); unselected(result)
  })
  await check('a date inquiry cannot convert an independently chosen time into an inquiry', async () => {
    const { port } = agenda(['16:00'])
    const message = 'El martes? Elijo a las 16'
    const result = await say(base(), message, output([
      { kind: 'date', expression: 'martes', ...evidence('martes') }, time()
    ], [act('inquiry', 'date', 'El martes?', [0]), act('answer', 'time', 'Elijo a las 16', [1])]), port)
    assert.equal(mode(result.state), undefined)
    assert.equal(result.state.slot?.time, '16:00')
    assert.equal(result.bookingCommand, undefined)
  })
  await check('a weak temporal operation cannot erase an existing selection through inquiry mode', async () => {
    const { port, reads } = agenda()
    const chosen = await say(base(), 'Elijo a las 16', output([time()], [act('answer', 'time', 'Elijo a las 16', [0])]), port)
    const beforeReads = reads.length
    const message = 'A las 17 podría ser?'
    const result = await say(chosen.state, message, output([{ ...time('A las 17', '17:00'), confidence: .4 }], [act('inquiry', 'time', message, [0])]), port)
    assert.equal(mode(result.state), undefined)
    assert.equal(result.state.requestedTime, '16:00')
    assert.equal(result.state.slot?.time, '16:00')
    assert.equal(reads.length, beforeReads)
    assert.ok(!result.turnOutcome?.appliedFields.includes('time'))
  })
  await check('name and professional answers cannot turn a queried time into selection', async () => {
    const { port } = agenda(['16:00'])
    const queried = await say(base(), 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    const named = await say(queried.state, 'Soy Lucía', output([{ kind: 'name', value: 'Lucía', ...evidence('Lucía') }], [act('change', 'name', 'Soy Lucía', [0])]), port)
    assert.equal(named.state.customerName, 'Lucía')
    assert.equal(mode(named.state), 'inquiry')
    unselected(named)
    const professional = await say(named.state, 'Con Ramiro', output([{ kind: 'professional', mode: 'specific', mention: 'Ramiro', ...evidence('Ramiro') }], [act('request', 'professional', 'Con Ramiro', [0])]), port)
    assert.equal(mode(professional.state), 'inquiry')
    preserved(professional); unselected(professional)
  })
  await check('a busy exact target offers real alternatives without inventing availability', async () => {
    const { port, reads } = agenda(['17:00'])
    const result = await say(base(), 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    assert.equal(result.state.requestedTime, '16:00')
    assert.equal(reads.length, 1)
    assert.ok(result.choicePresentation?.choices.some(choice => choice.operation.kind === 'slot' && choice.operation.time === '17:00'))
    assert.ok(!result.choicePresentation?.choices.some(choice => choice.operation.kind === 'slot' && choice.operation.time === '16:00'))
    preserved(result); unselected(result)
  })
  await check('no slots is a verified unavailable answer, not another meaning question', async () => {
    const { port, reads } = agenda([])
    const result = await say(base(), 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    assert.equal(reads.length, 1)
    assert.equal(result.availability?.outcome, 'no_slots')
    assert.doesNotMatch(result.reply, /qué horario o franja preferís/i)
    preserved(result); unselected(result)
  })
  await check('a current exact question can replace a genuine AM/PM clarification', async () => {
    const { port, reads } = agenda()
    const result = await say({ ...base(), timeClarification: { candidateTimes: ['04:00', '16:00'] } }, 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.timeClarification, undefined)
    assert.equal(result.state.requestedTime, '16:00')
    assert.equal(reads.length, 1)
    unselected(result)
  })
  await check('genuine twelve-hour ambiguity still asks the period without using free slots', async () => {
    const { port, reads } = agenda(['16:00'])
    const message = '¿Tipo 4 podría ser?'
    const result = await say(base(), message, output([{ kind: 'time_clarification', candidateTimes: ['04:00', '16:00'], ...evidence('Tipo 4') }], [act('request', 'time', message, [0])]), port)
    assert.deepEqual(result.state.timeClarification, { candidateTimes: ['04:00', '16:00'] })
    assert.equal(result.state.requestedTime, null)
    assert.equal(reads.length, 0)
    assert.match(result.reply, /mañana.*tarde/)
    unselected(result)
  })
  await check('contradictory approximation is rejected and never acknowledged as applied', async () => {
    const { port, reads } = agenda()
    const message = 'A las 16 podría ser?'
    const result = await say(base(), message, output([{ kind: 'time_preference', preference: { kind: 'around', time: '16:00' }, ...evidence('A las 16') }], [act('request', 'time', message, [0])]), port)
    assert.equal(result.interpretation.temporalGrounding?.outcome, 'field_rejected')
    assert.equal(result.state.requestedTime, null)
    assert.ok(!result.turnOutcome?.appliedFields.includes('time'))
    assert.equal(reads.length, 0)
    assert.doesNotMatch(result.reply, /(?:anot[eé]|cambi[eé]|registr[eé]).*16:00/i)
    unselected(result)
  })
  for (const [label, message, owner] of [
    ['historical', 'Antes venía a las 16', act('reference', 'time', 'Antes venía a las 16', [0])],
    ['negative', 'No a las 16', act('uncertain', 'time', 'No a las 16', [0])],
    ['weak', 'A las 16 podría ser?', act('inquiry', 'time', 'A las 16 podría ser?', [0], .4)],
    ['wrong field', 'A las 16 podría ser?', act('inquiry', 'service', 'A las 16 podría ser?', [0])]
  ] as const) {
    await check(label + ' ownership cannot acquire a queried time', async () => {
      const { port, reads } = agenda()
      const result = await say(base(), message, output([time(/a las 16/i.exec(message)?.[0])], [owner]), port)
      assert.equal(result.state.requestedTime, null)
      assert.equal(mode(result.state), undefined)
      assert.equal(reads.length, 0)
      assert.ok(!result.turnOutcome?.appliedFields.includes('time'))
      preserved(result); unselected(result)
    })
  }
  await check('the server mode is strict, dependent on an exact request, and legacy compatible', () => {
    assert.deepEqual(parseDialogueState(base(), context.businessId, context.timezone), base())
    for (const invalid of [
      { ...base(), requestedTime: '16:00', requestedTimeMode: 'booking' },
      { ...base(), requestedTimeMode: 'inquiry' },
      { ...base(), requestedTime: '16:00', requestedTimeMode: 'inquiry', slot: { date: '2026-10-13', time: '16:00', startAt: '2026-10-13T19:00:00Z', professionalId: 'ramiro', professionalName: 'Ramiro', occupiedMinutes: 0, band: 'AFTERNOON' } }
    ]) assert.throws(() => parseDialogueState(invalid, context.businessId, context.timezone))
  })
  await check('native slot choice clears query mode before validating the selected snapshot', async () => {
    const { port } = agenda(['16:00'])
    const queried = await say(base(), 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    const choice = queried.choicePresentation?.choices.find(choice => choice.operation.kind === 'slot')
    assert.ok(choice)
    const selected = await respondConversationChoice(context, queried.state, choice.operation, port)
    assert.equal(mode(selected.state), undefined)
    assert.equal(selected.state.slot?.time, '16:00')
    assert.equal(selected.bookingCommand, undefined)
    assert.doesNotMatch(selected.reply, /turno (?:confirmado|reservado)|(?:ya|te) reserv[eé]/i)
  })
  await check('explicit choice after the offered inquiry clears mode without confirming booking', async () => {
    const { port } = agenda(['16:00'])
    const queried = await say(base(), 'A las 16 podría ser?', inquiry('A las 16 podría ser?'), port)
    const selected = await say(queried.state, 'Elijo a las 16', output([time()], [act('answer', 'time', 'Elijo a las 16', [0])]), port)
    assert.equal(mode(selected.state), undefined)
    assert.equal(selected.state.slot?.time, '16:00')
    assert.equal(selected.bookingCommand, undefined)
    assert.doesNotMatch(selected.reply, /turno (?:confirmado|reservado)|(?:ya|te) reserv[eé]/i)
  })
} finally { globalThis.fetch = originalFetch }
if (failures.length) throw new Error('Time inquiry regression failures: ' + failures.join(', '))
console.log('time inquiry: offline PASS')
