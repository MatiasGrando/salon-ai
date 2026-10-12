import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { parseTurnPlan, TURN_PLAN_JSON_SCHEMA } from '../src/conversational-bot/turn-plan.js'

// Controlled semantic proposals only: these tests do not contact a model or real agenda.
const context = { businessId: 'professional-option-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-12T15:00:00Z') }
const services = [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 15000, requiresConsultation: false }]
const gaspar = { id: 'gaspar', name: 'Gaspar', priority: 0 }
const ana = { id: 'ana', name: 'Ana', priority: 1 }
let freshProfessionals = [gaspar, ana]
let agendaCalls: (string | undefined)[] = []
const port: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date, id) => {
    agendaCalls.push(id)
    return { professionals: freshProfessionals, slots: freshProfessionals.filter(person => !id || id === person.id).flatMap(person => ['15:00', '17:00'].map(time => ({
      date, time, startAt: date + 'T' + (Number(time.slice(0, 2)) + 3) + ':00:00.000Z', professionalId: person.id, professionalName: person.name, band: 'AFTERNOON' as const, occupiedMinutes: 0
    }))) }
  }
}
const initial: DialogueState = { ...initialDialogueState(context.businessId), serviceId: 'cut', date: '2026-10-12', requestedTime: '15:00', requestedTimeMode: 'inquiry', customerName: 'Matías', pending: 'professional' }
const offered = (await respond(context, initial, 'quiero reservar', port, { intent: 'booking', serviceId: null, candidateIds: [], correction: false })).state
assert.deepEqual(offered.questionContext?.options.map(option => option.id), ['professional:any', 'gaspar', 'ana'])
const evidence = (value: string) => ({ evidence: value, confidence: 1 })
const option = (message: string, optionId = 'gaspar', optionIndex = 2, confidence = 1) => ({ kind: 'professional', mode: 'option', optionId, optionIndex, evidence: message, confidence })
const candidate = (message: string, operations: object[], actOverrides: Record<string, unknown> = {}) => ({
  intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceCandidateIds: [], serviceConfidence: 'certain', serviceCorrection: false,
  turnPlan: { version: 1, operations },
  communicativeActs: { version: 1, acts: [{ kind: 'answer', field: 'professional', ...evidence(message), mention: null, operationIndexes: [0], ...actOverrides }] }
})
const say = (state: DialogueState, message: string, operation: object, actOverrides: Record<string, unknown> = {}) =>
  respondWithAiInterpreter(context, state, message, port, async () => candidate(message, [operation], actOverrides))
const unchanged = (response: Awaited<ReturnType<typeof say>>, before = offered) => {
  assert.equal(response.state.professional, null)
  assert.equal(response.state.customerName, before.customerName)
  assert.equal(response.state.serviceId, before.serviceId)
  assert.equal(response.state.date, before.date)
  assert.equal(response.state.requestedTime, before.requestedTime)
  assert.equal(response.state.slot, null)
  assert.equal(response.proposal, null)
}
const cases: [string, () => void | Promise<void>][] = [
  ['schema admits an evidence-anchored professional option reference', () => {
    assert.deepEqual(parseTurnPlan({ version: 1, operations: [option('2')] }, '2', ['cut']).operations[0], option('2'))
    const schemas = (TURN_PLAN_JSON_SCHEMA.properties.operations as any).items.anyOf
    const optionSchema = schemas.find((item: any) => item.properties.kind.enum[0] === 'professional' && item.properties.mode.enum[0] === 'option')
    assert.ok(optionSchema, 'the structured-output JSON schema must advertise the option mode')
    assert.deepEqual(optionSchema.required, ['kind', 'evidence', 'confidence', 'mode', 'optionId', 'optionIndex'])
    assert.equal(optionSchema.additionalProperties, false)
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ ...option('2'), optionIndex: 2.5 }] }, '2', ['cut']))
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ ...option('2'), mention: 'Gaspar' }] }, '2', ['cut']))
  }],
  ['numeric answer acquires the shown professional without inventing a literal name', async () => {
    agendaCalls = []
    const response = await say(offered, '2', option('2'))
    assert.equal(response.interpretation.reason, null)
    assert.deepEqual(response.state.professional, { kind: 'specific', id: 'gaspar' })
    assert.equal(response.state.customerName, 'Matías')
    assert.equal(response.state.date, offered.date)
    assert.equal(response.state.requestedTime, '15:00')
    assert.ok(agendaCalls.includes('gaspar'), 'specific choice must reach fresh availability')
    assert.equal(response.proposal, null, 'professional choice does not confirm a reservation')
  }],
  ['ordinal meaning is proposed by the IA using the same option contract', async () => {
    const response = await say(offered, 'el segundo', option('el segundo'))
    assert.equal(response.interpretation.reason, null)
    assert.deepEqual(response.state.professional, { kind: 'specific', id: 'gaspar' })
    assert.equal(response.state.customerName, 'Matías')
    assert.equal(response.state.requestedTime, '15:00')
  }],
  ['any professional uses the existing first choice without acquiring an identity', async () => {
    const response = await say(offered, 'el primero', option('el primero', 'professional:any', 1))
    assert.equal(response.interpretation.reason, null)
    assert.deepEqual(response.state.professional, { kind: 'any' })
    assert.equal(response.state.customerName, 'Matías')
    assert.equal(response.state.date, offered.date)
    assert.equal(response.state.requestedTime, '15:00')
    assert.equal(response.proposal, null)
  }],
  ['index and ID must identify the same shown choice', async () => unchanged(await say(offered, '2', option('2', 'ana', 2)))],
  ['a foreign or arbitrary ID cannot use a shown ordinal', async () => unchanged(await say(offered, '2', option('2', 'foreign', 2)))],
  ['out of range reference does not acquire a professional', async () => unchanged(await say(offered, 'el quinto', option('el quinto', 'gaspar', 5)))],
  ['newly reordered question does not accept an old ID/index pairing', async () => {
    const reordered = structuredClone(offered)
    reordered.questionContext!.options = [reordered.questionContext!.options[0]!, reordered.questionContext!.options[2]!, reordered.questionContext!.options[1]!]
    unchanged(await say(reordered, '2', option('2')), reordered)
  }],
  ['an incomplete question cannot authorize a reference', async () => {
    const incomplete = structuredClone(offered)
    incomplete.questionContext!.complete = false
    incomplete.questionContext!.options = []
    unchanged(await say(incomplete, '2', option('2')), incomplete)
    const staleScope = structuredClone(offered)
    staleScope.date = '2026-10-13'
    unchanged(await say(staleScope, '2', option('2')), staleScope)
  }],
  ['missing question context does not recover an ordinal from the fresh roster', async () => {
    const absent = structuredClone(offered)
    delete absent.questionContext
    unchanged(await say(absent, '2', option('2')), absent)
  }],
  ['a different answer role cannot acquire a professional from its option', async () => {
    const wrongRole = { ...initialDialogueState(context.businessId), customerName: 'Matías' }
    const response = await say(wrongRole, '2', option('2'))
    assert.equal(response.state.professional, null)
    assert.equal(response.state.customerName, 'Matías')
    assert.equal(response.state.serviceId, null)
  }],
  ['low confidence does not authorize selection', async () => unchanged(await say(offered, '2', option('2', 'gaspar', 2, .5)))],
  ['an inquiry about a menu option is not a professional selection', async () => unchanged(await say(offered, 'qué hace el segundo?', option('qué hace el segundo?'), { kind: 'inquiry' }))],
  ['fabricated evidence cannot authorize the otherwise correct option', async () => unchanged(await say(offered, '2', option('el segundo')))],
  ['a professional no longer eligible must not be selected', async () => {
    freshProfessionals = [ana]
    try { unchanged(await say(offered, '2', option('2'))) } finally { freshProfessionals = [gaspar, ana] }
  }],
  ['a simultaneous new date invalidates selection from the old question', async () => {
    const message = 'el segundo, mañana'
    const response = await respondWithAiInterpreter(context, offered, message, port, async () => ({
      ...candidate(message, [option('el segundo'), { kind: 'date', expression: 'mañana', value: '2026-10-13', ...evidence('mañana') }]),
      communicativeActs: { version: 1, acts: [
        { kind: 'answer', field: 'professional', ...evidence('el segundo'), mention: null, operationIndexes: [0] },
        { kind: 'change', field: 'date', ...evidence('mañana'), mention: null, operationIndexes: [1] }
      ] }
    }))
    assert.equal(response.state.professional, null)
    assert.equal(response.state.customerName, 'Matías')
    assert.equal(response.proposal, null)
  }]
]
let failed = 0
for (const [name, check] of cases) {
  try { await check(); console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error))) }
}
console.log(`Professional option reference: ${cases.length - failed}/${cases.length} PASS`)
if (failed) process.exitCode = 1
