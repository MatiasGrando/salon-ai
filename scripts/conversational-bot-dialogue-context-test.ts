import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { rememberDialogueQuestion, resolveDialogueRoute } from '../src/conversational-bot/dialogue-context.js'

const context = { businessId: 'qa-context', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z') }
const services = [{ id: 'cut', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 100 }]
const professionals = [{ id: 'cin', name: 'Cin', priority: 0 }, { id: 'matias-prof', name: 'Matías', priority: 1 }]
let agendaCalls = 0
const port: DialoguePort = {
  catalog: async () => services,
  availability: async (_service, date, id) => {
    agendaCalls++
    return { professionals, slots: professionals.filter(p => !id || id === p.id).map(p => ({ date, time: '17:00', startAt: date + 'T20:00:00Z', professionalId: p.id, professionalName: p.name, band: 'AFTERNOON' as const, occupiedMinutes: 0 })) }
  }
}
const legacy = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false }
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const decision = (...operations: object[]) => ({ intent: 'booking' as const, serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1 as const, operations: operations as any } })
const initial = initialDialogueState(context.businessId)
const offered = await respond(context, initial, 'Corte hombre mañana, soy Matías', port, decision(
  { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') },
  { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') }
))
assert.equal(offered.state.pending, 'professional')
const wrongName = await respondWithAiInterpreter(context, offered.state, 'Cin', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Cin', ...ev('Cin') }] } }))
assert.equal(wrongName.state.customerName, 'Matías', 'expected professional must never overwrite existing customer identity')
assert.deepEqual(wrongName.state.professional, { kind: 'specific', id: 'cin' }, 'known expected answer is resolved only through fresh compatible professionals')
assert.equal((offered.state as any).questionContext.field, 'professional')
assert.equal((offered.state as any).questionContext.role, 'professional')
assert.deepEqual((offered.state as any).questionContext.options.map((option: any) => option.id), ['professional:any', 'cin', 'matias-prof'])
assert.equal((offered.state as any).questionContext.complete, true)
assert.deepEqual(parseDialogueState(offered.state, context.businessId), offered.state)
assert.equal(Object.keys(offered.state).some(key => /actor|machineSnapshot/.test(key)), false)

let request: Record<string, any> | undefined
const provider = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...legacy, turnPlan: { version: 1, operations: [] } }) }] }] }), { status: 200 })
} })
await provider({ message: 'Cin', state: offered.state, services }, new AbortController().signal)
assert.equal(JSON.parse(request!.input).expectedAnswer.role, 'professional')
assert.deepEqual(JSON.parse(request!.input).expectedAnswer.options, (offered.state as any).questionContext.options)
assert.equal(request!.store, false)

const sameLabel = await respondWithAiInterpreter(context, offered.state, 'Matías', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Matías', ...ev('Matías') }] } }))
assert.equal(sameLabel.state.customerName, 'Matías')
assert.deepEqual(sameLabel.state.professional, { kind: 'specific', id: 'matias-prof' }, 'answer role is determined by asked question even if customer shares the name')
const explicitIdentity = await respondWithAiInterpreter(context, offered.state, 'soy Cin', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Cin', ...ev('Cin') }] } }))
assert.equal(explicitIdentity.state.customerName, 'Cin', 'explicit identity corrections work outside name pending')
assert.equal(explicitIdentity.state.professional, null)

const unknownRole = await respondWithAiInterpreter(context, offered.state, 'Persona mañana 17:00', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [
  { kind: 'name', value: 'Persona', ...ev('Persona') }, { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'time', value: '17:00', ...ev('17:00') }
] } }))
assert.equal(unknownRole.state.customerName, 'Matías')
assert.equal(unknownRole.state.requestedTime, '17:00', 'role clarification does not discard independent operations')
assert.equal(unknownRole.interpretation.reason, null, 'role ambiguity is not malformed AI output')
assert.match(unknownRole.reply, /profesional|nombre/i)

const namedCorrection = await respondWithAiInterpreter(context, offered.state, 'a nombre de Laura mañana', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [
  { kind: 'name', value: 'Laura', ...ev('Laura') }, { kind: 'date', expression: 'mañana', ...ev('mañana') }
] } }))
assert.equal(namedCorrection.state.customerName, 'Laura', 'third-person identity is explicit without requiring a self-introducer')
const initialMixed = await respondWithAiInterpreter(context, initial, 'Matías Corte hombre mañana con Cin', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [
  { kind: 'name', value: 'Matías', ...ev('Matías') }, { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') },
  { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Cin', ...ev('Cin') }
] } }))
assert.equal(initialMixed.state.customerName, 'Matías', 'semantically independent initial identity remains free-order')
assert.deepEqual(initialMixed.state.professional, { kind: 'specific', id: 'cin' })
const onlyProfessionalEvidence = await respondWithAiInterpreter(context, initial, 'mañana con Cin', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [
  { kind: 'name', value: 'Cin', ...ev('Cin') }, { kind: 'date', expression: 'mañana', ...ev('mañana') }
] } }))
assert.equal(onlyProfessionalEvidence.state.customerName, null, 'initial professional evidence without a separate customer identity must not be admitted as a name')
assert.equal(onlyProfessionalEvidence.state.date, '2026-10-03')
const initialNameOnly = await respondWithAiInterpreter(context, initial, 'Matías', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Matías', ...ev('Matías') }] } }))
assert.equal(initialNameOnly.state.customerName, 'Matías', 'a certain short initial semantic identity need not wait for a rigid dialogue step')
const conflictingInitial = await respondWithAiInterpreter(context, initial, 'Matías Corte hombre mañana con Cin', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [
  { kind: 'name', value: 'Cin', ...ev('Cin') }, { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') },
  { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Cin', ...ev('Cin') }
] } }))
assert.equal(conflictingInitial.state.customerName, null, 'one professional evidence span cannot simultaneously invent initial customer identity')
assert.deepEqual(conflictingInitial.state.professional, { kind: 'specific', id: 'cin' })
const beforeSocial = agendaCalls
await respondWithAiInterpreter(context, offered.state, 'hola', port, async () => ({ ...legacy, intent: 'other', turnPlan: { version: 1, operations: [] } }))
assert.equal(agendaCalls, beforeSocial, 'stored option context never preloads availability for social turns')
const namePending: DialogueState = { ...initial, serviceId: 'cut', date: '2026-10-03', professional: { kind: 'specific', id: 'cin' }, slot: { date: '2026-10-03', time: '17:00', startAt: '2026-10-03T20:00:00Z', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON', occupiedMinutes: 0 }, pending: 'name' }
const fallbackPhrase = await respond(context, namePending, 'matias queria un corte', port)
assert.notEqual(fallbackPhrase.state.customerName, 'matias queria un corte', 'fallback identity cannot swallow a booking phrase')
const fallbackMixed = await respond(context, initial, 'hola soy matias queria un corte', port)
assert.notEqual(fallbackMixed.state.customerName, 'matias queria un corte')
const explicitWithDate = await respond(context, initial, 'soy Matías mañana', port)
assert.equal(explicitWithDate.state.customerName, 'Matías', 'date words cannot leak into an explicit fallback name')
const compound = await respond(context, initial, 'soy María José quiero Corte hombre mañana', port)
assert.equal(compound.state.customerName, 'María José', 'known grammatical boundary preserves the complete compound name')
const uncertainCompound = await respond(context, initial, 'soy maria jose queria un corte', port)
assert.equal(uncertainCompound.state.customerName, null, 'uncertain mixed identity must not silently truncate a compound name')
const uncertainName = await respondWithAiInterpreter(context, namePending, 'Matías', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Matías', evidence: 'Matías', confidence: 0.6 }] } }))
assert.equal(uncertainName.state.customerName, null, 'medium-confidence identity remains unconfirmed per the project field-confidence contract')
assert.equal(uncertainName.interpretation.reason, null)
const highName = await respondWithAiInterpreter(context, initial, 'Matías', port, async () => ({ ...legacy, turnPlan: { version: 1, operations: [{ kind: 'name', value: 'Matías', evidence: 'Matías', confidence: 0.85 }] } }))
assert.equal(highName.state.customerName, 'Matías')
const bareName = await respond(context, namePending, 'Matías', port)
assert.equal(bareName.state.customerName, 'Matías')
const stale = { ...offered.state, date: '2026-10-04' }
assert.equal(parseDialogueState(stale, context.businessId).questionContext, undefined, 'stale question evidence is discarded without losing valid draft fields')
const foreign = { ...offered.state, questionContext: { ...(offered.state as any).questionContext, businessId: 'foreign' } }
assert.throws(() => parseDialogueState(foreign, context.businessId), /question|context/)
const old = { ...offered.state }; delete (old as any).questionContext
assert.equal(parseDialogueState(old, context.businessId).customerName, 'Matías', 'older v1 snapshots remain readable')
for (const tamper of [{ role: 'customer' }, { complete: false }, { options: [{ id: 'cin', label: 'Cin', authority: true }] }, { targetServiceId: 'foreign-service' }, { extra: true }]) {
  assert.throws(() => parseDialogueState({ ...offered.state, questionContext: { ...offered.state.questionContext, ...tamper } }, context.businessId), /question|context/)
}
const budget = structuredClone(offered.state)
rememberDialogueQuestion(budget, '¿Con qué profesional?', Array.from({ length: 50 }, (_, index) => ({ id: 'professional-' + index, label: 'x'.repeat(200) })))
assert.equal(budget.questionContext?.complete, false)
assert.deepEqual(budget.questionContext?.options, [], 'oversized question options are discarded, never silently represented as a complete subset')
assert.ok(JSON.stringify(budget).length <= 16384)
assert.doesNotThrow(() => parseDialogueState(budget, context.businessId))
const overCount = structuredClone(offered.state)
rememberDialogueQuestion(overCount, '¿Con qué profesional?', Array.from({ length: 51 }, (_, index) => ({ id: 'p' + index, label: 'P' + index })))
assert.equal(overCount.questionContext?.complete, false)
const malformedLabels = structuredClone(offered.state)
rememberDialogueQuestion(malformedLabels, '¿Con qué profesional?', [{ id: 'p', label: 'bad\nlabel' }])
assert.equal(malformedLabels.questionContext?.complete, false)
assert.deepEqual(malformedLabels.questionContext?.options, [])
for (const question of ['x'.repeat(241), 'bad\nquestion', '']) {
  const invalidQuestion = structuredClone(offered.state)
  rememberDialogueQuestion(invalidQuestion, question)
  assert.equal(invalidQuestion.questionContext, undefined, 'invalid question metadata is omitted rather than poisoning the next snapshot')
  assert.doesNotThrow(() => parseDialogueState(invalidQuestion, context.businessId))
}
assert.equal(resolveDialogueRoute(initial).pending, 'service')
assert.equal(resolveDialogueRoute({ ...initial, serviceId: 'cut' }).pending, 'date')
assert.equal(resolveDialogueRoute({ ...initial, serviceId: 'cut', date: '2026-10-03' }).pending, 'professional')
assert.equal(resolveDialogueRoute(namePending).pending, 'name')
assert.equal(resolveDialogueRoute({ ...namePending, customerName: 'Matías' }).pending, 'proposal')
assert.equal(resolveDialogueRoute({ ...namePending, customerName: 'Matías' }, [], 'date').pending, 'date', 'safety/correction transitions can reopen any required field')
console.log('PASS typed dialogue context: professional/customer roles, compact provider context, independent corrections and legacy snapshots')
