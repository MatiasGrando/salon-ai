import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T12:00:00Z') }
const services = [
  { id: 'cut-private-id', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 100 },
  { id: 'barba-private-id', name: 'Corte y barba', durationMinutes: 45, requiresConsultation: false, price: 200 }
]
const businessFacts: BusinessFacts = { businessId: 'tenant', name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Viernes: 09:00 a 18:00' }
const legacy = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null }
const operation = (kind: string, evidence: string, fields: object = {}) => ({ kind, evidence, confidence: 1, ...fields })
const plan = (...operations: object[]) => ({ version: 1, operations })
const completion = (candidate: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }] })
let request: Record<string, any> | undefined
let httpCalls = 0
const http = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  httpCalls++; request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify(completion({ ...legacy, turnPlan: plan() })), { status: 200 })
} })
await http({ message: 'hola', state: initialDialogueState('tenant'), services, businessDate: '2026-10-01', timezone: context.timezone }, new AbortController().signal)
assert.ok(request!.text.format.schema.required.includes('turnPlan'), 'actual Responses request must expose the modular turn plan')
assert.equal(request!.text.format.strict, true)
const strictObjects = (schema: any) => {
  if (schema.type === 'object' || Array.isArray(schema.type) && schema.type.includes('object')) {
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
  }
  if (schema.properties) Object.values(schema.properties).forEach(strictObjects)
  if (schema.items) strictObjects(schema.items)
  if (schema.anyOf) schema.anyOf.forEach(strictObjects)
}
strictObjects(request!.text.format.schema)
assert.equal(request!.text.format.schema.type, 'object')
assert.ok(request!.text.format.schema.properties.turnPlan.anyOf.some((part: any) => part.type === 'null'))
const planSchema = request!.text.format.schema.properties.turnPlan.anyOf.find((part: any) => part.type === 'object')
assert.ok(planSchema.properties.operations.items.anyOf.find((part: any) => part.properties.kind.enum.includes('service')).properties.mode.enum.includes('unresolved'))
assert.match(request!.instructions, /(?:combin|simult)/i)
assert.match(request!.instructions, /(?:nombre|name)[^.]*pendiente/i)
assert.match(request!.instructions, /alternativas[^.]*múltiples|múltiples[^.]*alternativas/i)
assert.equal(request!.store, false)
assert.equal(request!.reasoning.effort, 'none')
assert.ok(request!.max_output_tokens >= 1800, 'bounded multi-operation plans need more than the legacy 600-token output limit')
assert.equal(JSON.parse(request!.input).customerName, null)
assert.equal(JSON.parse(request!.input).requestedTime, null)
const fullCatalog = Array.from({ length: 200 }, (_unused, index) => ({ ...services[0]!, id: 'catalog-' + index, name: 'Servicio ' + index }))
await http({ message: 'hola', state: initialDialogueState('tenant'), services: fullCatalog }, new AbortController().signal)
assert.equal(JSON.parse(request!.input).services.length, 200, 'the actual provider input must not silently truncate a catalog accepted by its 200-service bound')
const callsBeforeOversize = httpCalls
await assert.rejects(() => http({ message: 'hola', state: initialDialogueState('tenant'), services: [...fullCatalog, { ...services[0]!, id: 'catalog-201' }] }, new AbortController().signal), /too large/)
assert.equal(httpCalls, callsBeforeOversize, '201 catalog entries are rejected before fetch')

async function say(message: string, turnPlan: unknown, previous: DialogueState = initialDialogueState('tenant'), intent = 'other', options: { legacyOnly?: boolean; draft?: boolean; reverseCopy?: boolean; legacyFields?: object } = {}) {
  let calls = 0, availabilityCalls = 0, informationCalls = 0
  let firstInput: AiInterpretationInput | undefined
  let finalFacts: readonly { id: string; text: string }[] = []
  const port: DialoguePort = {
    catalog: async () => services,
    information: async () => { informationCalls++; return businessFacts },
    availability: async () => { availabilityCalls++; return { professionals: [{ id: 'ramiro-private-id', name: 'Ramiro', priority: 0 }], slots: [{ date: '2026-10-02', time: '17:00', startAt: '2026-10-02T20:00:00Z', professionalId: 'ramiro-private-id', professionalName: 'Ramiro', band: 'AFTERNOON', occupiedMinutes: 30 }] } }
  }
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++; firstInput = input
    return { ...legacy, ...options.legacyFields, intent, ...(options.legacyOnly ? {} : { turnPlan }), ...(options.draft ? { firstReply: { opening: 'Hola.', factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [], closing: null } } : {}) }
  }, { respond: async (input: { facts: readonly { id: string; text: string }[] }) => {
    calls++; finalFacts = input.facts
    return { opening: null, factIds: options.reverseCopy ? [...input.facts].reverse().map(fact => fact.id) : input.facts.map(fact => fact.id), closing: null }
  } }) as AiInterpretationProvider
  const response = await respondWithAiInterpreter(context, previous, message, port, provider)
  return { response, calls, availabilityCalls, informationCalls, firstInput: firstInput!, finalFacts }
}
const mixed = await say('Corte hombre la jornada siguiente con Ramiro a las cinco de la tarde, dónde están?', plan(
  operation('service', 'Corte hombre', { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('date', 'la jornada siguiente', { expression: 'la jornada siguiente', value: '2026-10-02' }),
  operation('professional', 'Ramiro', { mode: 'specific', mention: 'Ramiro' }),
  operation('time', 'cinco de la tarde', { value: '17:00' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'information', { draft: true })
assert.equal(mixed.response.interpretation.mode, 'ai')
assert.equal(mixed.response.state.serviceId, 'cut-private-id')
assert.equal(mixed.response.state.date, '2026-10-02')
assert.equal(mixed.response.state.requestedTime, '17:00', 'normalized semantic time is not restricted to numeric input patterns')
assert.equal(mixed.response.state.professional?.kind, 'specific')
assert.equal(mixed.response.state.pending, 'name')
assert.match(mixed.response.reply, /Calle 123/)
assert.match(mixed.response.reply, /nombre/i)
assert.equal(mixed.response.interpretation.replyRoute, 'second_call', 'stale first-call copy must not replace post-update facts')
assert.ok(mixed.availabilityCalls > 0)
assert.equal(mixed.informationCalls, 1)
assert.equal(mixed.finalFacts.at(-1)?.id, 'next')

const early = await say('Soy Matías, la jornada siguiente. dónde están?', plan(
  operation('name', 'Matías', { value: 'Matías' }),
  operation('date', 'la jornada siguiente', { expression: 'la jornada siguiente', value: '2026-10-02' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'other', { draft: true })
assert.equal(early.response.state.customerName, 'Matías', 'name is an entity operation independent of intent and pending')
assert.equal(early.response.state.date, '2026-10-02')
assert.equal(early.response.state.pending, 'service')
assert.match(early.response.reply, /Calle 123/)
assert.match(early.response.reply, /servicio/i)
assert.equal(early.response.interpretation.replyRoute, 'second_call')
assert.equal(early.availabilityCalls, 0)
const diagnostic = early.response.interpretation
assert.deepEqual(diagnostic.proposal?.turnPlan?.kinds, ['name', 'date', 'information'])
assert.equal(diagnostic.proposal?.turnPlan?.operationCount, 3)
assert.equal(diagnostic.validation?.turnPlan?.outcome, 'accepted')
assert.deepEqual(diagnostic.validation?.turnPlan?.validationAcceptedKinds, ['name', 'date', 'information'])
assert.doesNotMatch(JSON.stringify(diagnostic), /Matías|jornada|tenant|Calle|cut-private|barba-private|2026-10-02/)

const ambiguous = await say('un corte mañana, soy Matías, dónde están?', plan(
  operation('service', 'corte', { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('date', 'mañana', { expression: 'mañana', value: '2026-10-02' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
))
assert.equal(ambiguous.response.state.serviceId, null, 'generic evidence cannot hide other catalog matches')
assert.equal(ambiguous.response.state.customerName, 'Matías')
assert.equal(ambiguous.response.state.date, '2026-10-02')
assert.match(ambiguous.response.reply, /Corte hombre/)
assert.match(ambiguous.response.reply, /Corte y barba/)
assert.match(ambiguous.response.reply, /Calle 123/)

const unresolved = await say('mejor masaje mañana con Ramiro a las cinco de la tarde, soy Matías, dónde están?', plan(
  operation('service', 'masaje', { mode: 'unresolved', serviceIds: [], correction: true }),
  operation('date', 'mañana', { expression: 'mañana', value: null }),
  operation('professional', 'Ramiro', { mode: 'specific', mention: 'Ramiro' }),
  operation('time', 'cinco de la tarde', { value: '17:00' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), mixed.response.state, 'information')
assert.equal(unresolved.response.interpretation.mode, 'ai', 'unresolved service is a supported clarification, not a rejected mixed plan')
assert.equal(unresolved.response.state.serviceId, null)
assert.equal(unresolved.response.state.slot, null)
assert.equal(unresolved.response.state.date, '2026-10-02')
assert.equal(unresolved.response.state.requestedTime, '17:00')
assert.equal(unresolved.response.state.customerName, 'Matías')
assert.equal(unresolved.response.state.professionalNameHint, 'ramiro')
assert.match(unresolved.response.reply, /información confirmada.*masaje/i)
assert.match(unresolved.response.reply, /Calle 123/)
assert.doesNotMatch(unresolved.response.reply, /no (?:lo )?ofrecemos/i)
assert.equal(unresolved.response.proposal, null)

const shown: DialogueState = { ...initialDialogueState('tenant'), serviceId: 'cut-private-id', date: '2026-10-02', professional: { kind: 'specific', id: 'ramiro-private-id' }, pending: 'time', dialogueContext: { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: 'tenant', serviceId: 'cut-private-id', date: '2026-10-02', professionalId: 'ramiro-private-id' } } }
const reads = await say('dónde están, esos horarios, cancelar y reprogramar', plan(
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } }),
  operation('information', 'esos horarios', { target: { kind: 'presented_offer', actions: [] } }),
  operation('unsupported_action', 'cancelar', { action: 'CANCEL' }),
  operation('unsupported_action', 'reprogramar', { action: 'RESCHEDULE' })
), shown, 'other')
assert.match(reads.response.reply, /Calle 123/)
assert.match(reads.response.reply, /viernes 02\/10/)
assert.match(reads.response.reply, /todavía no está disponible/)
assert.equal(reads.response.state.date, shown.date)
assert.equal(reads.availabilityCalls, 0)
assert.equal(reads.response.proposal, null)
assert.equal(reads.response.interpretation.proposal?.turnPlan?.operationCount, 4)
const multiple = await say('Corte hombre y Corte y barba, mañana, soy Matías, dónde están?', plan(
  operation('service', 'Corte hombre y Corte y barba', { mode: 'multiple', serviceIds: ['cut-private-id', 'barba-private-id'], correction: false }),
  operation('date', 'mañana', { expression: 'mañana', value: null }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'information')
assert.equal(multiple.response.state.serviceId, null, 'multiple services cannot collapse into one implicit booking')
assert.equal(multiple.response.state.customerName, 'Matías')
assert.equal(multiple.response.state.date, '2026-10-02')
assert.match(multiple.response.reply, /No pude verificar.*conjunta/i)
assert.match(multiple.response.reply, /Calle 123/)
assert.equal(multiple.response.proposal, null)
const clockConflict = await say('mañana, soy Matías, dónde están?', plan(
  operation('date', 'mañana', { expression: 'mañana', value: '2026-10-03' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
))
assert.equal(clockConflict.response.interpretation.validation?.turnPlan?.outcome, 'accepted', 'contract acceptance is not a claim that motor accepted date semantics')
assert.equal(clockConflict.response.state.date, null, 'motor clock rejects a canonical date contradicting mañana')
assert.equal(clockConflict.response.state.customerName, 'Matías')
assert.match(clockConflict.response.reply, /Calle 123/)

for (const badPlan of [
  { version: 2, operations: [] },
  plan(operation('name', 'unmentioned-private-value', { value: 'unmentioned-private-value' })),
  plan(operation('service', 'corte', { mode: 'single', serviceIds: ['foreign-private-id'], correction: false })),
  plan(operation('name', 'Matías', { value: 'Matías' }), operation('name', 'Matías', { value: 'Matías' }))
]) {
  const bad = await say('corte Matías', badPlan)
  assert.equal(bad.response.interpretation.reason, 'invalid_output', 'present invalid plan must not be silently ignored')
  assert.equal(bad.response.interpretation.validation?.turnPlan?.outcome, 'rejected')
  assert.deepEqual(bad.response.interpretation.validation?.turnPlan?.validationAcceptedKinds, [])
  assert.doesNotMatch(JSON.stringify(bad.response.interpretation), /unmentioned-private|foreign-private|Matías/)
}
for (const contradictory of [plan(), plan(operation('name', 'Matías', { value: 'Matías' }))]) {
  const conflict = await say('Corte hombre Matías', contradictory, undefined, 'booking', { legacyFields: { serviceId: 'cut-private-id', serviceEvidence: 'Corte hombre' } })
  assert.equal(conflict.response.interpretation.reason, 'invalid_output', 'legacy root data must not silently disappear behind a structured plan')
  assert.equal(conflict.response.interpretation.validation?.turnPlan?.outcome, 'rejected')
}
const social = await say('hola', plan(), undefined, 'other', { draft: true })
assert.equal(social.response.interpretation.replyRoute, 'first_call')
assert.equal(social.calls, 1)
const old = await say('hola', null, undefined, 'other', { legacyOnly: true, draft: true })
assert.equal(old.response.interpretation.replyRoute, 'first_call')
assert.equal(old.response.interpretation.validation?.turnPlan, undefined)
const isolatedInfo = await say('dónde están?', plan(operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })), undefined, 'information', { draft: true })
assert.equal(isolatedInfo.response.interpretation.replyRoute, 'first_call')
assert.equal(isolatedInfo.calls, 1)
assert.equal(isolatedInfo.response.state.serviceId, null)
const unsafeCopy = await say('Soy Matías, dónde están?', plan(operation('name', 'Matías', { value: 'Matías' }), operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })), { ...initialDialogueState('tenant'), serviceId: 'cut-private-id', pending: 'date' }, 'other', { reverseCopy: true })
assert.equal(unsafeCopy.response.interpretation.copyReason, null)
assert.equal(unsafeCopy.response.interpretation.copyMode, 'prepared'); assert.equal(unsafeCopy.calls, 1)
assert.match(unsafeCopy.response.reply, /Calle 123/)
assert.match(unsafeCopy.response.reply, /día/i)
// The actual HTTP parsing seam must accept a bounded plan above the previous legacy 4096-character limit.
const longEvidence = ('Corte hombre Matías mañana Ramiro cinco de la tarde dónde están esos horarios cancelar reprogramar humano ' + 'detalle '.repeat(30)).slice(0, 296).trim()
const longCandidate = { ...legacy, firstReply: { opening: 'x'.repeat(180), factIds: [], closing: 'y'.repeat(180) }, turnPlan: plan(
  operation('service', longEvidence, { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('name', longEvidence, { value: 'Matías' }), operation('date', longEvidence, { expression: 'mañana', value: null }),
  operation('professional', longEvidence, { mode: 'specific', mention: 'Ramiro' }), operation('time', longEvidence, { value: '17:00' }),
  operation('information', longEvidence, { target: { kind: 'business', actions: ['ADDRESS'] } }),
  operation('information', longEvidence, { target: { kind: 'presented_offer', actions: [] } }),
  ...['CANCEL', 'RESCHEDULE', 'HUMAN_HANDOFF'].map(action => operation('unsupported_action', longEvidence, { action }))
) }
assert.ok(JSON.stringify(longCandidate).length > 4096)
const longHttp = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async () => new Response(JSON.stringify(completion(longCandidate)), { status: 200 }) })
assert.deepEqual(await longHttp({ message: longEvidence, state: initialDialogueState('tenant'), services }, new AbortController().signal), longCandidate)
console.log('conversational turn-plan AI: offline PASS (HTTP contract, modular updates, diagnostics, legacy, copy guards)')
