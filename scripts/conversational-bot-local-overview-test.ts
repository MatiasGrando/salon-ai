import assert from 'node:assert/strict'
import { initialDialogueState, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { deriveCatalogInquiry, catalogInformation, catalogInformationBody, CATALOG_ANSWER_INSTRUCTIONS } from '../src/conversational-bot/catalog-information-answer.js'
import { publicServiceRequestCatalog } from '../src/conversational-bot/service-request.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { parseCommunicativeActs } from '../src/conversational-bot/communicative-act.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { contentSourceHash, resolveServiceContent } from '../src/bot-options/domain/service-content.js'

// Synthetic catalog only; no network, database or agenda effects.
const context = { businessId: 'local-overview', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T18:00:00Z') }
const catalog: DialogueService[] = [
  { id: 'straight', name: 'Alisado sin formol', description: 'Usamos productos marca OneLook. Incluye lavado.', price: 29000, durationMinutes: 30, requiresConsultation: false },
  { id: 'keratin', name: 'Keratina', description: 'Usamos productos MG Dis para el acabado.', price: 30000, priceMode: 'STARTING_AT', durationMinutes: 30, requiresConsultation: false,
    bookingPolicy: { id: 'keratin', name: 'Keratina', attentionMode: 'GUIDED_ESTIMATE', price: 30000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
      estimateQuestion: '¿Qué largo tiene tu cabello?', estimateExplanation: null, estimateDisclaimer: 'El valor final depende del cabello.', requiresPhoto: false,
      estimateOptions: [{ id: 'short', label: 'Hasta los hombros', priceMin: 30000, priceMax: 40000, note: null },
        { id: 'long', label: 'Debajo de los hombros', priceMin: 40000, priceMax: 60000, note: null }], validationEnabled: false, validationMessage: null, validationQuestion: null } }
]
const initial = () => initialDialogueState(context.businessId)
const message = 'dame informacion del alisado del local'
const value = (body = message, mention = 'alisado', serviceId = 'straight', kind = 'inquiry', confidence = .98) => ({
  intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
  turnPlan: { version: 1, operations: [{ kind: 'information', evidence: body, confidence,
    target: { kind: 'service', actions: [], serviceIds: [serviceId], aspect: 'overview' } }] },
  communicativeActs: { version: 1, acts: [{ kind, field: 'service', evidence: body, confidence, mention, operationIndexes: [0] }] },
  firstReply: { salutation: null, opening: null, closing: null, factIds: null, variantChoices: null,
    catalogAnswer: { blocks: [{ kind: 'published', text: catalog.find(service => service.id === serviceId)?.description ?? 'Información publicada.',
      sources: [{ serviceId, field: 'description', quote: catalog.find(service => service.id === serviceId)?.description ?? 'Información publicada.' }] }] } }
})
function scope(proposal = value(), state = initial(), services = catalog) {
  const body = proposal.turnPlan.operations[0]!.evidence
  const plan = parseTurnPlan(proposal.turnPlan, body, services.map(service => service.id))
  const acts = parseCommunicativeActs(proposal.communicativeActs, body, plan.operations.length, plan)
  return deriveCatalogInquiry(plan, acts, body, state, services)
}
async function run(proposal = value(), state: DialogueState = initial(), services = catalog) {
  let agendaCalls = 0, aiCalls = 0
  const port: DialoguePort = { catalog: async () => services, availability: async () => { agendaCalls++; throw new Error('overview cannot consult agenda') } }
  const response = await respondWithAiInterpreter(context, state, proposal.turnPlan.operations[0]!.evidence, port, async () => { aiCalls++; return structuredClone(proposal) })
  assert.equal(agendaCalls, 0)
  assert.deepEqual(selectionBasket(response.state), selectionBasket(state))
  for (const key of ['date', 'professional', 'slot', 'customerName', 'serviceId'] as const) assert.deepEqual(response.state[key], state[key])
  assert.equal(response.proposal, null)
  assert.equal(response.bookingCommand, undefined)
  return { response, aiCalls }
}
let passed = 0
const failures: string[] = []
async function check(name: string, test: () => void | Promise<void>) {
  try { await test(); passed++; console.log('PASS local overview ' + name) }
  catch (error) { failures.push(name); console.error('RED local overview ' + name + ': ' + String(error)) }
}
await check('exact request grants current informative ownership without closed sentence grammar', () => assert.equal(scope().length, 1))
await check('first call explains current description plus verified price and duration', async () => {
  const { response, aiCalls } = await run()
  assert.ok(response.reply.includes(catalog[0]!.description!))
  assert.match(response.reply, /29\.000/)
  assert.match(response.reply, /30 min/)
  assert.doesNotMatch(response.reply, /Qué dato o variante|Qué servicio necesitás|Qué servicio querés elegir/)
  assert.equal(response.interpretation.replyRoute, 'first_call')
  assert.equal(aiCalls, 1)
})
await check('following a comparison reads the selected local service instead of repeating the menu', async () => {
  const before = initial()
  before.informationFocus = { version: 1, businessId: context.businessId, topic: 'details', aspect: 'comparison', serviceId: null,
    awaitingChoice: false, candidateId: null, options: catalog.map(service => ({ id: service.id, label: service.name })) }
  const { response } = await run(value(), before)
  assert.ok(response.reply.includes(catalog[0]!.description!))
  assert.equal(response.state.informationFocus?.serviceId, 'straight')
  assert.match(response.reply, /29\.000/)
})
await check('overview publishes the existing Reservar action but the read never acquires the service', async () => {
  const { response } = await run()
  assert.match(response.reply, /¿Querés agendar Alisado sin formol\?/)
  assert.equal(response.choicePresentation?.choices[0]?.label, 'Reservar')
  assert.deepEqual(response.choicePresentation?.choices[0]?.operation, { kind: 'service', serviceId: 'straight' })
  let agendaCalls = 0
  const port: DialoguePort = { catalog: async () => catalog, availability: async () => { agendaCalls++; throw new Error('reserve must collect missing date first') } }
  const selected = await respondConversationChoice(context, response.state, response.choicePresentation!.choices[0]!.operation, port)
  assert.deepEqual(selectionBasket(selected.state).members.flatMap(member => member.serviceIds), ['straight'])
  assert.equal(selected.bookingCommand, undefined)
  assert.equal(selected.proposal, null)
  assert.equal(agendaCalls, 0)
})
await check('overview Reservar keeps a prior cart peer through the existing additive acquisition', async () => {
  const before = initial()
  before.basket = { version: 1, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single', serviceIds: ['straight'], evidence: 'Alisado sin formol' }] }
  before.serviceId = 'straight'
  const { response } = await run(value('contame la información de Keratina del local', 'Keratina', 'keratin'), before)
  assert.equal(response.choicePresentation?.choices[0]?.label, 'Reservar')
  const port: DialoguePort = { catalog: async () => catalog, availability: async () => { throw new Error('guided reserve cannot query agenda before variant') } }
  const selected = await respondConversationChoice(context, response.state, response.choicePresentation!.choices[0]!.operation, port)
  assert.deepEqual(selectionBasket(selected.state).members.find(member => member.memberId === 'm1'), before.basket.members[0])
  assert.deepEqual(selectionBasket(selected.state).members.flatMap(member => member.serviceIds).sort(), ['keratin', 'straight'])
  assert.equal(selected.bookingCommand, undefined)
  assert.equal(selected.state.pending, 'estimate')
})
await check('guided local overview includes description, both verified variants, duration and disclaimer', async () => {
  const { response } = await run(value('contame la información de Keratina del local', 'Keratina', 'keratin'))
  assert.ok(response.reply.includes(catalog[1]!.description!))
  assert.match(response.reply, /Hasta los hombros[\s\S]*30\.000[\s\S]*40\.000/)
  assert.match(response.reply, /Debajo de los hombros[\s\S]*40\.000[\s\S]*60\.000/)
  assert.match(response.reply, /30 min/)
  assert.match(response.reply, /El valor final depende del cabello/)
})
await check('reviewed attendance requirements stay out of the informational overview', async () => {
  const services = structuredClone(catalog)
  const policy = services[1]!.bookingPolicy!
  const choice = 'El valor final depende del cabello.'
  policy.estimateDisclaimer = choice + ' Asistir con cabello limpio y seco.'
  const reviewed = resolveServiceContent({ version: 1, businessId: context.businessId, serviceId: 'keratin', reviewed: true, revision: 1,
    sourceHash: contentSourceHash(policy), segments: [
      { id: 'price', source: 'disclaimer', start: 0, end: choice.length, stage: 'both', role: 'condition', variants: [] },
      { id: 'attendance', source: 'disclaimer', start: choice.length, end: policy.estimateDisclaimer.length, stage: 'attendance', role: 'condition', variants: [] }
    ] }, context.businessId, policy)
  assert.ok(reviewed)
  policy.contentPolicy = reviewed
  const { response } = await run(value('contame la información de Keratina del local', 'Keratina', 'keratin'), initial(), services)
  assert.ok(response.reply.includes(choice))
  assert.doesNotMatch(response.reply, /cabello limpio y seco/)
})
await check('missing description does not hide known price and duration', () => {
  const details = catalogInformation({ kind: 'service', actions: [], serviceIds: ['straight'], aspect: 'overview' }, [{ ...catalog[0]!, description: null }])
  const body = catalogInformationBody(details)
  assert.match(body, /No tengo una descripción publicada/)
  assert.match(body, /29\.000/)
  assert.match(body, /30 min/)
})
await check('public model catalog contains verified commercial data, never a selection', () => {
  const rows = publicServiceRequestCatalog(catalog) as unknown as Array<Record<string, any>>
  assert.equal(rows[0]!.price, 29000)
  assert.equal(rows[0]!.durationMinutes, 30)
  assert.equal(rows[1]!.priceMode, 'STARTING_AT')
  assert.equal(rows[1]!.guidance.options[0].priceMin, 30000)
  assert.equal(rows[1]!.guidance.options[0].priceMax, 40000)
  assert.equal(rows[0]!.selected, undefined)
})
await check('model guidance explains descriptions without rewriting known server commercial facts', () => {
  assert.match(CATALOG_ANSWER_INSTRUCTIONS, /overview[\s\S]*servidor[\s\S]*precio[\s\S]*duración[\s\S]*variantes/)
  assert.match(CATALOG_ANSWER_INSTRUCTIONS, /aunque[\s\S]*conocidos/)
})
await check('public catalog omits invalid numeric estimates rather than transporting them to the model', () => {
  const malformed = structuredClone(catalog[1]!)
  malformed.price = Infinity
  malformed.durationMinutes = -1
  malformed.bookingPolicy!.estimateOptions![0]!.priceMin = Infinity
  const row = publicServiceRequestCatalog([malformed])[0]!
  assert.equal(row.price, null)
  assert.equal(row.durationMinutes, null)
  assert.deepEqual(row.guidance!.options, [])
})
await check('overview authority still requires sufficiently confident current owner', () => assert.equal(scope(value(message, 'alisado', 'straight', 'inquiry', .5)).length, 0))
await check('unsupported qualified identity does not become a generic local service', () => assert.equal(scope(value('información del alisado importado', 'alisado importado')).length, 0))
await check('a generic owned mention never confirms an undocumented imported technique', async () => {
  const { response } = await run(value('contame información del alisado importado del local', 'alisado'))
  assert.doesNotMatch(response.reply, /(?:incluye|usamos|ofrecemos|realizamos|confirmado)[^.\n]*importado/i)
  assert.equal(response.bookingCommand, undefined)
})
await check('an answer without a current informative focus gains no ownership', () => assert.equal(scope(value('del alisado', 'alisado', 'straight', 'answer')).length, 0))
await check('ambiguous aliases cannot be hidden in a singleton proposed ID', () => {
  const services = [...catalog, { ...catalog[0]!, id: 'other-straight', name: 'Alisado tradicional', aliases: ['alisado'] }]
  assert.equal(scope(value(), initial(), services).length, 0)
})
await check('renamed previously presented option rejects stale scope', () => {
  const before = initial()
  before.informationFocus = { version: 1, businessId: context.businessId, topic: 'details', aspect: 'comparison', serviceId: null,
    awaitingChoice: false, candidateId: null, options: [{ id: 'straight', label: 'Nombre antiguo' }] }
  assert.equal(scope(value(), before).length, 0)
})
await check('model-invented commercial amount is rejected, not inserted as a published fact', async () => {
  const proposal = value()
  proposal.firstReply.catalogAnswer.blocks[0]!.text = 'El precio es $ 99.000 y demora 99 minutos.'
  const { response } = await run(proposal)
  assert.doesNotMatch(response.reply, /99\.000|99 minutos/)
  assert.equal(response.interpretation.replyValidation?.firstCall.status, 'rejected')
})
console.log(JSON.stringify({ passed, failed: failures.length, failures }))
if (failures.length) process.exitCode = 1
