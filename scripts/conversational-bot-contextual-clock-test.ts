import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { projectBusinessHoursContext, projectBusinessTimeContext, scopedBusinessHoursContext } from '../src/conversational-bot/business-time-context.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'

const context = { businessId: 'clock-qa', timezone: 'UTC', dbNow: new Date('2026-10-12T12:00:00Z') }
const snapshot = { ...context, stamp: 'fixture', from: new Date('2026-10-12T00:00:00Z'), to: new Date('2026-10-15T00:00:00Z'), weeklyHours: [{ dayOfWeek: 1, startTime: '09:00', endTime: '20:00' }], globalBlocks: [] }
const state = { ...initialDialogueState(context.businessId), serviceId: 'cut', customerName: 'Ana', date: '2026-10-12', professional: { kind: 'specific' as const, id: 'p' }, pending: 'time' as const }
const services = [{ id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false }]
let agendaReads = 0
const port: DialoguePort = {
  catalog: async () => services,
  businessTimeContext: (date, times) => projectBusinessTimeContext(snapshot, date, times),
  businessHoursContext: date => projectBusinessHoursContext(snapshot, date),
  availability: async (_service, date) => { agendaReads++; return { professionals: [{ id: 'p', name: 'Ana', priority: 0 }], slots: [{ date, time: '15:00', startAt: date + 'T15:00:00Z', professionalId: 'p', professionalName: 'Ana', occupiedMinutes: 0, band: 'AFTERNOON' as const }] } }
}
const proposal = (message: string, operation: object) => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [operation] }, communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'time', evidence: message, confidence: .99, mention: null, operationIndexes: [0] }] } })
const time = (evidence: string, value = '15:00') => ({ kind: 'time', evidence, value, confidence: .99 })
const todayProposal = (message: string) => ({ ...proposal(message, time('a las 3')), turnPlan: { version: 1, operations: [{ kind: 'date', expression: 'hoy', value: '2026-10-12', evidence: 'hoy', confidence: .99 }, time('a las 3')] }, communicativeActs: { version: 1, acts: [
  { kind: 'inquiry', field: 'date', evidence: 'hoy', confidence: .99, mention: null, operationIndexes: [0] },
  { kind: 'inquiry', field: 'time', evidence: 'a las 3', confidence: .99, mention: null, operationIndexes: [1] }
] } })
// Exact technical proposal captured from the authorized synthetic B10 evaluation.
// It omitted the user's explicit day despite receiving the correct public calendar.
const omittedDayProposal = (message: string) => ({ ...proposal(message, { kind: 'time_clarification', evidence: 'a las 3', confidence: .98, candidateTimes: ['03:00', '15:00'] }),
  communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'time', evidence: message, confidence: .99, mention: 'a las 3', operationIndexes: [0] }] },
  firstReply: { catalogAnswer: null, salutation: null, opening: null, factIds: null, closing: null, variantChoices: null } })
const failures: string[] = []
async function check(name: string, run: () => Promise<void> | void) { try { await run(); console.log('PASS contextual clock ' + name) } catch (error) { failures.push(name); console.error('RED contextual clock ' + name + ': ' + String(error)) } }
function unbooked(result: Awaited<ReturnType<typeof respondWithAiInterpreter>>) { assert.equal(result.state.slot, null); assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.state.serviceId, 'cut'); assert.equal(result.state.customerName, 'Ana') }
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network forbidden') }
try {
  await check('B10 exact omitted-day replay repairs both date and clock through the IA', async () => {
    const message = 'hoy a las 3 tenés lugar?'; let calls = 0
    const result = await respondWithAiInterpreter(context, { ...state, date: null, professional: null, pending: 'date' }, message, port, async input => {
      calls++
      if (input.repairFeedback) { assert.equal(input.repairFeedback.cause, 'evidence'); return todayProposal(message) }
      return omittedDayProposal(message)
    })
    assert.equal(calls, 2, 'omitting the explicit date cannot be reported as accepted')
    assert.equal(result.interpretation.interpretationAttempts?.[0]?.validation.outcome, 'rejected')
    assert.equal(result.state.date, '2026-10-12'); assert.equal(result.state.requestedTime, '15:00'); assert.equal(result.state.pending, 'professional'); unbooked(result)
  })
  await check('two omitted-day interpretations preserve the original request and day state', async () => {
    const message = 'hoy a las 3 tenés lugar?'; let calls = 0; const beforeReads = agendaReads
    const original = { ...state, date: null, professional: null, pending: 'date' as const }
    const result = await respondWithAiInterpreter(context, original, message, port, async () => { calls++; return omittedDayProposal(message) })
    assert.equal(calls, 2); assert.equal(result.interpretation.mode, 'fallback'); assert.equal(result.state.date, null); assert.equal(result.state.requestedTime, null); assert.equal(result.state.pending, 'date'); assert.equal(agendaReads, beforeReads); unbooked(result)
  })
  await check('Tuesday and its clock are repaired before asking the missing service', async () => {
    const message = 'el martes a las 3 tenés lugar?'; let calls = 0
    const tuesdaySnapshot = { ...snapshot, weeklyHours: [...snapshot.weeklyHours, { dayOfWeek: 2, startTime: '09:00', endTime: '20:00' }] }
    const tuesdayPort = { ...port, businessHoursContext: (date: string) => projectBusinessHoursContext(tuesdaySnapshot, date), businessTimeContext: (date: string, times: readonly string[]) => projectBusinessTimeContext(tuesdaySnapshot, date, times) }
    const result = await respondWithAiInterpreter(context, { ...state, serviceId: null, date: null, professional: null, pending: 'service' }, message, tuesdayPort, async input => {
      calls++; assert.equal(input.businessHoursContext?.date, '2026-10-13')
      if (!input.repairFeedback) return omittedDayProposal(message)
      return { ...todayProposal(message), turnPlan: { version: 1, operations: [{ kind: 'date', expression: 'martes', value: '2026-10-13', evidence: 'martes', confidence: .99 }, time('a las 3')] }, communicativeActs: { version: 1, acts: [
        { kind: 'inquiry', field: 'date', evidence: 'martes', confidence: .99, mention: null, operationIndexes: [0] },
        { kind: 'inquiry', field: 'time', evidence: 'a las 3', confidence: .99, mention: null, operationIndexes: [1] }
      ] } }
    })
    assert.equal(calls, 2); assert.equal(result.state.date, '2026-10-13'); assert.equal(result.state.requestedTime, '15:00'); assert.equal(result.state.pending, 'service'); assert.equal(result.state.serviceId, null); assert.match(result.reply, /servicio/); assert.equal(result.state.slot, null); assert.equal(result.bookingCommand, undefined)
  })
  for (const [expression, day] of [['hoy', '2026-10-12'], ['martes', '2026-10-13']] as const) await check('an omitted ' + expression + ' date with a 24-hour clock is repaired rather than inferred', async () => {
    const message = expression + ' a las 15 tenés lugar?'; let calls = 0
    const result = await respondWithAiInterpreter(context, { ...state, date: null, professional: null, pending: 'date' }, message, port, async input => {
      calls++
      if (!input.repairFeedback) return proposal(message, time('a las 15'))
      return { ...proposal(message, time('a las 15')), turnPlan: { version: 1, operations: [{ kind: 'date', expression, value: day, evidence: expression, confidence: .99 }, time('a las 15')] }, communicativeActs: { version: 1, acts: [
        { kind: 'inquiry', field: 'date', evidence: expression, confidence: .99, mention: null, operationIndexes: [0] },
        { kind: 'inquiry', field: 'time', evidence: 'a las 15', confidence: .99, mention: null, operationIndexes: [1] }
      ] } }
    })
    assert.equal(calls, 2); assert.equal(result.state.date, day); assert.equal(result.state.requestedTime, '15:00'); assert.equal(result.state.pending, 'professional'); unbooked(result)
  })
  await check('a morning period without a date does not force a tomorrow operation', async () => {
    const message = 'por la mañana'; let calls = 0
    const result = await respondWithAiInterpreter(context, { ...state, date: null, pending: 'date' }, message, port, async () => {
      calls++; return proposal(message, { kind: 'time_preference', preference: { kind: 'band', band: 'MORNING' }, evidence: message, confidence: .99 })
    })
    assert.equal(calls, 1); assert.equal(result.state.date, null); assert.deepEqual(result.state.timePreference, { kind: 'band', band: 'MORNING' }); unbooked(result)
  })
  await check('an explicit morning clock is not a tomorrow date', async () => {
    const message = 'a las 3 de la mañana tenés lugar?'; let calls = 0
    const result = await respondWithAiInterpreter(context, state, message, port, async () => { calls++; return proposal(message, time('a las 3 de la mañana', '03:00')) })
    assert.equal(calls, 1); assert.equal(result.state.date, state.date); assert.equal(result.state.requestedTime, '03:00'); unbooked(result)
  })
  await check('unmarked clock exposes public hours and reads availability at 15', async () => {
    const message = 'hoy a las 3 tenés lugar?'
    const before = agendaReads
    const provider: AiInterpretationProvider = async input => { assert.deepEqual(input.businessHoursContext, { businessId: context.businessId, timezone: 'UTC', date: state.date, known: true, openIntervals: [{ from: '09:00', to: '20:00' }] }); return proposal(message, time('a las 3')) }
    const result = await respondWithAiInterpreter(context, state, message, port, provider)
    assert.equal(result.interpretation.mode, 'ai'); assert.equal(result.state.requestedTime, '15:00'); assert.equal(result.state.requestedTimeMode, 'inquiry'); assert.equal(agendaReads, before + 1)
    assert.doesNotMatch(result.reply, /qué horario o franja preferís/i); unbooked(result)
  })
  for (const [label, read] of [
    ['both open', (date: string, times: readonly string[]) => ({ businessId: context.businessId, timezone: 'UTC', date, candidateTimes: [...times], candidates: times.map(time => ({ time, status: 'open' as const })) })],
    ['unknown', (_date: string, _times: readonly string[]) => undefined],
    ['foreign date', (_date: string, times: readonly string[]) => ({ businessId: context.businessId, timezone: 'UTC', date: '2026-10-13', candidateTimes: [...times], candidates: times.map(time => ({ time, status: time === '15:00' ? 'open' as const : 'closed' as const })) })],
    ['foreign zone', (date: string, times: readonly string[]) => ({ businessId: context.businessId, timezone: 'Foreign/Zone', date, candidateTimes: [...times], candidates: times.map(time => ({ time, status: time === '15:00' ? 'open' as const : 'closed' as const })) })]
  ] as const) await check(label + ' requests the actual AM/PM ambiguity', async () => {
    const message = 'hoy a las 3 tenés lugar?'; const before = agendaReads
    let calls = 0
    const result = await respondWithAiInterpreter(context, state, message, { ...port, businessTimeContext: read, businessHoursContext: undefined }, async input => {
      calls++
      return proposal(message, input.repairFeedback ? { kind: 'time_clarification', candidateTimes: ['03:00', '15:00'], evidence: 'a las 3', confidence: .99 } : time('a las 3'))
    })
    assert.equal(calls, 2, 'the IA repairs its own unproven period; the engine does not rewrite it')
    assert.deepEqual(result.state.timeClarification, { candidateTimes: ['03:00', '15:00'] }); assert.match(result.reply, /3 de la mañana o de la tarde/); assert.equal(result.state.date, state.date); assert.equal(agendaReads, before); unbooked(result)
  })
  await check('explicit 03 AM is never rewritten to an open 15', async () => {
    const message = 'hoy a las 03 AM tenés lugar?'
    const result = await respondWithAiInterpreter(context, state, message, port, async () => proposal(message, time('a las 03 AM', '03:00')))
    assert.equal(result.state.requestedTime, '03:00'); assert.equal(result.state.timeClarification, undefined); unbooked(result)
  })
  await check('wrong numeric anchor never becomes another hour', async () => {
    const message = 'hoy a las 3 tenés lugar?'
    const result = await respondWithAiInterpreter(context, state, message, port, async () => proposal(message, time('a las 3', '16:00')))
    assert.notEqual(result.state.requestedTime, '16:00'); assert.equal(result.state.date, state.date); unbooked(result)
  })
  await check('a proposed closed AM hour is rejected, never silently changed to PM', async () => {
    const message = 'hoy a las 3 tenés lugar?'; let calls = 0
    const result = await respondWithAiInterpreter(context, state, message, port, async () => { calls++; return proposal(message, time('a las 3', '03:00')) })
    assert.equal(calls, 2); assert.equal(result.state.requestedTime, null); assert.equal(result.state.timePreference, undefined); assert.equal(result.interpretation.mode, 'fallback'); unbooked(result)
  })
  await check('the current date proposal uses today rather than the previous selected day', async () => {
    const message = 'hoy a las 3 tenés lugar?'
    const result = await respondWithAiInterpreter(context, { ...state, date: '2026-10-13' }, message, port, async input => {
      assert.equal(input.businessHoursContext?.date, '2026-10-12')
      return todayProposal(message)
    })
    assert.equal(result.state.date, '2026-10-12'); assert.equal(result.state.requestedTime, '15:00'); unbooked(result)
  })
  await check('the actual date question retains 15 while asking only for the missing professional', async () => {
    const message = 'hoy a las 3 tenés lugar?'
    const result = await respondWithAiInterpreter(context, { ...state, date: null, professional: null, pending: 'date' }, message, port, async input => {
      assert.equal(input.businessHoursContext?.date, '2026-10-12'); return todayProposal(message)
    })
    assert.equal(result.state.date, '2026-10-12'); assert.equal(result.state.requestedTime, '15:00'); assert.equal(result.state.pending, 'professional'); assert.match(result.reply, /profesional/); assert.doesNotMatch(result.reply, /qué horario o franja preferís/i); unbooked(result)
  })
  await check('provider receives bounded public fields without callback extras', async () => {
    const message = 'hoy a las 3 tenés lugar?'; let payload: Record<string, unknown> | undefined
    const provider = createOpenAiInterpretationProvider({ apiKey: 'offline-only', fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); payload = JSON.parse(request.input)
      assert.match(request.instructions, /businessHoursContext/)
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal(message, time('a las 3'))) }] }] }), { status: 200 })
    } })
    const result = await respondWithAiInterpreter(context, state, message, { ...port, businessHoursContext: date => ({ ...projectBusinessHoursContext(snapshot, date)!, privateNote: 'DO NOT EXPOSE' }) }, provider)
    assert.deepEqual(Object.keys(payload!.businessHoursContext as object).sort(), ['businessId', 'date', 'known', 'openIntervals', 'timezone'])
    assert.doesNotMatch(JSON.stringify(payload!.businessHoursContext), /DO NOT EXPOSE|privateNote|professional|slot/)
    assert.equal(result.state.requestedTime, '15:00'); unbooked(result)
  })
  await check('a professional numeric answer does not manufacture temporal context or time', async () => {
    let calendar: unknown
    const result = await respondWithAiInterpreter(context, { ...state, pending: 'professional', professional: null }, '2', port, async input => { calendar = input.businessHoursContext; return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [] }, communicativeActs: null } })
    assert.ok(calendar, 'hours are context, never gated by a numeric answer'); assert.equal(result.state.requestedTime, null); unbooked(result)
  })
  await check('public calendar rejects malformed data, exceptions and scope changes', () => {
    assert.ok(projectBusinessHoursContext, 'public calendar projector exists')
    assert.equal(projectBusinessHoursContext({ ...snapshot, weeklyHours: null }, state.date), undefined)
    assert.equal(projectBusinessHoursContext(snapshot, '2026-10-17')?.known, false)
    assert.equal(projectBusinessHoursContext({ ...snapshot, globalBlocks: [{ startAt: '2026-10-12T14:00:00Z', endAt: '2026-10-12T16:00:00Z' }] }, state.date)?.known, false)
    const proof = projectBusinessHoursContext(snapshot, state.date)!
    for (const changed of [{ ...proof, businessId: 'foreign' }, { ...proof, timezone: 'Other/Zone' }, { ...proof, date: '2026-10-13' }]) assert.equal(scopedBusinessHoursContext(changed, { businessId: context.businessId, timezone: context.timezone, date: state.date }), undefined)
  })
} finally { globalThis.fetch = originalFetch }
assert.deepEqual(state.requestedTime, null, 'caller state remains unchanged')
if (failures.length) throw new Error('contextual clock failures: ' + failures.join(', '))
console.log('PASS contextual clock: bounded public context, inquiry safety and specific ambiguity; no network')
