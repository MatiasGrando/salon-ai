import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { initialDialogueState, parseDialogueState, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { basketServiceIds, selectionBasket } from '../src/conversational-bot/service-basket.js'
import { TURN_PLAN_LIMITS } from '../src/conversational-bot/turn-plan.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

const context = { businessId: 'tenant-private', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T15:00:00Z') }
const services: DialogueService[] = [
  { id: 'cut-private', name: 'Corte hombre', durationMinutes: 30, price: 5000, requiresConsultation: false },
  { id: 'woman-private', name: 'Corte mujer', durationMinutes: 30, price: 6000, requiresConsultation: false },
  { id: 'smooth-private', name: 'Alisado', durationMinutes: 90, price: 10000, requiresConsultation: false },
  { id: 'cream-private', name: 'Baño de crema', durationMinutes: 30, price: 3000, requiresConsultation: false }
]
const ev = (evidence: string) => ({ evidence, confidence: .99 })
const member = (mode: string, serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...ev(evidence) })
const basket = (mutation: string, members: object[], evidence: string, targetMemberIds: string[] = [], scope = targetMemberIds.length ? 'members' : 'all') => ({ kind: 'basket', mutation, members, scope, targetMemberIds, ...ev(evidence) })
const plan = (...operations: object[]) => ({ version: 1, operations })
const legacy = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null }
const candidate = (turnPlan: unknown, intent = 'booking') => ({ ...legacy, intent, turnPlan })
const completion = (output: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] })
const facts: BusinessFacts = { businessId: context.businessId, name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Viernes 09:00 a 18:00' }
const firstOperations = () => plan(
  basket('set', [member('single', ['cut-private'], 'corte'), member('single', ['smooth-private'], 'alisado')], 'corte y alisado'),
  { kind: 'name', value: 'Matías', ...ev('Matías') },
  { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') },
  { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }
)
const initial = initialDialogueState(context.businessId)
const contextState: DialogueState = { ...initial, basket: { version: 1, nextMemberId: 3, members: [
  { memberId: 'm1', mode: 'alternatives', serviceIds: ['cut-private', 'woman-private'], evidence: 'corte' },
  { memberId: 'm2', mode: 'single', serviceIds: ['smooth-private'], evidence: 'alisado' }
] }, dialogueContext: { lastQuestion: '¿Cuál de estos servicios querés?', presentedOffer: null } }
let request: Record<string, any> | undefined
const http = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify(completion(candidate(plan()))), { status: 200 })
} })
await http({ message: 'corte hombre', state: contextState, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request!.input).basket, contextState.basket, 'actual HTTP request must include the whole bounded basket and stable targets')
assert.equal(JSON.parse(request!.input).dialogueContext.lastQuestion, contextState.dialogueContext!.lastQuestion)
const schema = request!.text.format.schema
const strict = (item: any) => {
  if (item.type === 'object' || Array.isArray(item.type) && item.type.includes('object')) {
    assert.equal(item.additionalProperties, false)
    assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort())
  }
  if (item.properties) Object.values(item.properties).forEach(strict)
  if (item.items) strict(item.items)
  if (item.anyOf) item.anyOf.forEach(strict)
}
strict(schema)
const opSchema = schema.properties.turnPlan.anyOf.find((item: any) => item.type === 'object').properties.operations.items.anyOf
assert.deepEqual(opSchema.find((item: any) => item.properties.kind.enum.includes('basket')).properties.mutation.enum, ['set', 'add', 'remove', 'replace'])
assert.match(request!.instructions, /integrante|miembro/i)
assert.match(request!.instructions, /targetMemberIds/)
assert.doesNotMatch(request!.instructions, /cesta no esté implementada/)
assert.equal(request!.store, false)
assert.equal(request!.model, 'gpt-6-luna')
assert.equal(request!.reasoning.effort, 'none')

let singularCalls = 0, jointCalls = 0, informationCalls = 0, copyCalls = 0
const professionals = [{ id: 'ramiro-private', name: 'Ramiro', priority: 0 }]
const slot = (date: string) => ({ date, time: '17:00', startAt: date + 'T20:00:00.000Z', professionalId: 'ramiro-private', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 })
const port: DialoguePort = {
  catalog: async () => services,
  information: async () => { informationCalls++; return facts },
  availability: async (_service, date) => { singularCalls++; return { professionals, slots: [slot(date)] } },
  availabilityBasket: async (selected, date) => { jointCalls++; return { ok: true, services: selected, durationMinutes: selected.reduce((sum, service) => sum + service.durationMinutes!, 0), totalPrice: selected.reduce((sum, service) => sum + service.price!, 0), professionals, slots: [slot(date)] } }
}
async function say(previous: DialogueState, message: string, output: unknown, selectedPort = port, draft = false) {
  const provider = Object.assign(async (input: { firstReplyFacts?: readonly { id: string; text: string }[] }) => ({ ...(output as object), ...(draft ? { firstReply: { opening: 'Hola.', factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [], closing: null } } : {}) }), {
    respond: async (input: { facts: readonly { id: string; text: string }[] }) => { copyCalls++; return { opening: null, closing: null, factIds: input.facts.map(fact => fact.id) } }
  }) as AiInterpretationProvider
  return respondWithAiInterpreter(context, previous, message, selectedPort, provider)
}
const first = await say(initial, 'soy Matías, corte y alisado mañana con Ramiro', candidate(firstOperations(), 'other'), port, true)
assert.equal(first.interpretation.mode, 'ai')
assert.equal(first.state.basket?.members[0]?.mode, 'alternatives', 'generic cut evidence cannot hide another cut candidate')
assert.deepEqual(first.state.basket?.members[0]?.serviceIds, ['cut-private', 'woman-private'])
assert.deepEqual(first.state.basket?.members[1]?.serviceIds, ['smooth-private'], 'exact straightening member survives cut ambiguity')
assert.equal(first.state.customerName, 'Matías')
assert.equal(first.state.date, '2026-10-02')
assert.equal(first.state.professionalNameHint, 'ramiro')
assert.equal(first.proposal, null)
assert.equal(jointCalls, 0)
assert.equal(singularCalls, 0)
assert.equal(first.interpretation.replyRoute, 'motor', 'prepared clarification uses verified post-mutation facts, never the old-state draft')
assert.equal(first.interpretation.deliveryOrigin, 'prepared')
assert.match(first.reply, /Alisado/)
assert.match(first.reply, /Corte hombre/)
assert.match(first.reply, /Corte mujer/)
assert.deepEqual(first.interpretation.proposal?.turnPlan?.kinds, ['basket', 'name', 'date', 'professional'])
assert.deepEqual(first.interpretation.proposal?.turnPlan?.basket, { mutation: 'set', memberCount: 2, targetCount: 0, singleCount: 2, alternativeCount: 0, unresolvedCount: 0 })
assert.equal(first.interpretation.stateAfter?.basketMembers, 2)
assert.equal(first.interpretation.stateAfter?.basketAlternatives, 1)
assert.doesNotMatch(JSON.stringify(first.interpretation), /private|Matías|alisado|corte|Ramiro|2026-10-02/i)
const groupId = first.state.basket!.members[0]!.memberId
const exactId = first.state.basket!.members[1]!.memberId
const resolved = await say(first.state, 'corte hombre', candidate(plan(basket('replace', [member('single', ['cut-private'], 'corte hombre')], 'corte hombre', [groupId]))))
assert.deepEqual(basketServiceIds(resolved.state), ['cut-private', 'smooth-private'])
assert.equal(resolved.state.basket!.members[1]!.memberId, exactId)
assert.equal(resolved.state.serviceId, null)
assert.equal(resolved.state.customerName, 'Matías')
assert.equal(resolved.state.pending, 'time')
assert.ok(jointCalls > 0)
assert.equal(singularCalls, 0)
const beforeProposalCopies = copyCalls
const proposed = await say(resolved.state, 'a las cinco de la tarde', candidate(plan({ kind: 'time', value: '17:00', ...ev('cinco de la tarde') }), 'other'), port, true)
assert.deepEqual(proposed.proposal?.serviceIds, ['cut-private', 'smooth-private'])
assert.equal(proposed.proposal?.durationMinutes, 120)
assert.equal(proposed.proposal?.totalPrice, 15000)
assert.equal(proposed.proposal?.customerName, 'Matías')
assert.match(proposed.reply, /Corte hombre.*Alisado/)
assert.match(proposed.reply, /120 min/)
assert.match(proposed.reply, /Todavía no está reservado/)
assert.equal(copyCalls, beforeProposalCopies, 'whole-basket proposal is canonical only')
assert.equal(proposed.interpretation.replyRoute, 'motor')

for (const pending of ['service', 'date', 'professional', 'time', 'name', 'proposal'] as const) {
  const state = { ...proposed.state, pending }
  for (const mutation of ['set', 'add', 'remove', 'replace'] as const) {
    const targets = mutation === 'remove' || mutation === 'replace' ? [state.basket!.members.find(item => item.serviceIds.includes('smooth-private'))!.memberId] : []
    const selected = mutation === 'remove' ? [] : mutation === 'set' ? [member('single', ['smooth-private'], 'Alisado')] : [member('single', ['cream-private'], 'Baño de crema')]
    const operation = basket(mutation, selected, 'Alisado Baño de crema', targets)
    const changed = await say(state, 'Alisado Baño de crema', candidate(plan(operation)), port, true)
    assert.equal(changed.state.customerName, 'Matías', pending + '/' + mutation)
    assert.equal(changed.state.date, '2026-10-02')
    assert.equal(changed.state.slot, null)
    assert.equal(changed.proposal, null)
    assert.notEqual(changed.interpretation.replyRoute, 'first_call')
    const expected = mutation === 'set' ? ['smooth-private'] : mutation === 'add' ? ['cut-private', 'smooth-private', 'cream-private'] : mutation === 'remove' ? ['cut-private'] : ['cut-private', 'cream-private']
    assert.deepEqual(basketServiceIds(changed.state), expected)
  }
}
for (const state of [first.state, resolved.state, proposed.state]) {
  const beforeAgenda: number = jointCalls + singularCalls
  const commercial = await say(state, 'dónde están?', candidate(plan({ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dónde están') }), 'information'), port, true)
  assert.deepEqual(commercial.state.basket, state.basket)
  assert.match(commercial.reply, /Calle 123/)
  assert.equal(jointCalls + singularCalls, beforeAgenda)
  assert.equal(commercial.interpretation.replyRoute, 'first_call')
  const greeting = await say(state, 'hola', candidate(plan(), 'other'), port, true)
  assert.deepEqual(greeting.state.basket, state.basket)
  assert.equal(jointCalls + singularCalls, beforeAgenda)
  assert.equal(greeting.interpretation.replyRoute, 'first_call')
}
for (const bad of [
  plan(basket('set', [member('single', ['foreign-private'], 'corte')], 'corte')),
  plan(basket('set', [member('single', ['cut-private'], 'not-mentioned')], 'corte')),
  plan(basket('replace', [member('single', ['cut-private'], 'corte')], 'corte', ['m999']))
]) {
  const rejected = await say(first.state, 'corte', candidate(bad))
  assert.equal(rejected.interpretation.reason, 'invalid_output', 'invalid basket or unknown stable target must fail safely before motor')
  assert.equal(rejected.proposal, null)
  assert.deepEqual(rejected.state.basket, first.state.basket, 'invalid plan cannot silently overwrite an existing partial basket')
  assert.doesNotMatch(JSON.stringify(rejected.interpretation), /private|not-mentioned|m999/i)
}
const providerError = await respondWithAiInterpreter(context, proposed.state, 'hola', port, async () => { throw new Error('private Matías') })
assert.equal(providerError.interpretation.reason, 'provider_error')
assert.equal(providerError.proposal, null)
assert.deepEqual(providerError.state.basket, proposed.state.basket)

// Preview storage plus production runtime sidecar projection must preserve unresolved and resolved baskets.
const policy = { businessId: context.businessId, deploymentId: 'dep', generation: 1, configurationId: 'cfg', engine: 'conversational-booking-v1', schemaVersion: 1 } as const
const stored = new Map<string, unknown>()
let nextOutput: unknown = candidate(firstOperations())
const previewProvider = Object.assign(async () => nextOutput, { respond: async (input: { facts: readonly { id: string; text: string }[] }) => ({ opening: null, closing: null, factIds: input.facts.map(fact => fact.id) }) }) as AiInterpretationProvider
const dependencies = { load: async (phone: string) => stored.has(phone) ? readConversationDraft(stored.get(phone), policy, context.timezone) : null,
  save: async (phone: string, _message: string, _reply: string, state: DialogueState) => { stored.set(phone, projectConversationDraft(state, policy)) },
  createPort: async () => ({ context, port }), interpretationProvider: previewProvider }
const previewFirst = await runConversationalPreview(dependencies, context.businessId, 'preview-only', 'soy Matías, corte y alisado mañana con Ramiro')
assert.equal(previewFirst.state.basket?.members.length, 2)
assert.deepEqual((stored.get('preview-only') as { cart: unknown[] }).cart, [], 'unresolved basket cannot project a partial operational cart')
const persistedFirst = readConversationDraft(JSON.parse(JSON.stringify(stored.get('preview-only'))), policy, context.timezone)
nextOutput = candidate(plan(basket('replace', [member('single', ['cut-private'], 'corte hombre')], 'corte hombre', [persistedFirst.basket!.members[0]!.memberId])))
await runConversationalPreview(dependencies, context.businessId, 'preview-only', 'corte hombre')
nextOutput = candidate(plan({ kind: 'time', value: '17:00', ...ev('17hs') }))
const previewProposal = await runConversationalPreview(dependencies, context.businessId, 'preview-only', '17hs')
assert.equal(previewProposal.proposalReady, true)
assert.deepEqual((stored.get('preview-only') as { cart: { serviceId: string }[] }).cart.map(item => item.serviceId), ['cut-private', 'smooth-private'])
assert.deepEqual(readConversationDraft(JSON.parse(JSON.stringify(stored.get('preview-only'))), policy, context.timezone).basket, previewProposal.state.basket)
assert.match(previewProposal.reply, /120 min/)
assert.match(previewProposal.reply, /Todavía no está reservado/)
assert.deepEqual(basketServiceIds(parseDialogueState({ ...initial, serviceId: 'cut-private' }, context.businessId)), ['cut-private'])

// Align HTTP response parsing with the common bounded plan, without truncating ten groups or their candidates.
const longServices = Array.from({ length: 100 }, (_unused, index) => ({ ...services[0]!, id: 'catalog-' + index + '-' + 'x'.repeat(74), name: 'Service ' + index }))
const evidence = ('servicios ' + 'detalle '.repeat(32)).trim()
const longPlan = plan(basket('set', Array.from({ length: 10 }, (_unused, group) => member('alternatives', longServices.slice(group * 10, group * 10 + 10).map(item => item.id), evidence)), evidence))
assert.ok(JSON.stringify(longPlan).length > 8192)
assert.ok(JSON.stringify(longPlan).length < TURN_PLAN_LIMITS.serialized)
const longOutput = candidate(longPlan)
const longHttp = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async () => new Response(JSON.stringify(completion(longOutput)), { status: 200 }) })
assert.deepEqual(await longHttp({ message: evidence, state: initial, services: longServices }, new AbortController().signal), longOutput)
await http({ message: 'hola', state: initial, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request!.input).basket, selectionBasket(initial))
console.log('conversational basket AI: HTTP strict/context, per-member ambiguity, mutations, copy/privacy, preview/runtime projection and bounds PASS')
