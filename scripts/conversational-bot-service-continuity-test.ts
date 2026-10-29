import assert from 'node:assert/strict'
import { initialDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'

// Controlled semantic output exercises admission and real reducers; no lexical substitute or external effects.
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
const context = { businessId: 'service-continuity', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-29T12:00:00Z'), sandboxBooking: true }
const catalog: DialogueService[] = [
  { id: 'roots', name: 'Raíces', description: 'Coloración de raíces.', price: 20000, durationMinutes: 30, requiresConsultation: false },
  { id: 'cut', name: 'Corte', description: 'Corte con tijera.', price: 10000, durationMinutes: 30, requiresConsultation: false }
]
const slot = { date: '2026-10-30', time: '17:00', startAt: '2026-10-30T20:00:00.000Z', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
let agendaCalls = 0, passed = 0
const failures: string[] = []
const makePort = (services = catalog): DialoguePort => ({ catalog: async () => services,
  availability: async () => { agendaCalls++; return { professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [slot] } } })
const evidence = (body: string) => ({ evidence: body, confidence: 1 })
const select = (body: string) => ({ kind: 'service_reference', action: 'select', serviceId: 'roots', ...evidence(body) })
const ids = (state: DialogueState) => selectionBasket(state).members.flatMap(member => member.serviceIds)
async function say(state: DialogueState, body: string, operations: object[], kind = 'answer', services = catalog, intent = 'booking', runtimeContext = context) {
  let calls = 0
  const provider = Object.assign(async () => {
    calls++
    return { intent, serviceId: null, serviceEvidence: null, professionalMention: null,
      turnPlan: { version: 1, operations }, communicativeActs: { version: 1, acts: operations.map((_operation, index) => ({
        kind, field: 'service', mention: kind === 'inquiry' && body.includes('Raíces') ? 'Raíces' : null, operationIndexes: [index], ...evidence(body)
      })) }, firstReply: { salutation: null, opening: null, closing: null, factIds: null, variantChoices: null,
        catalogAnswer: { blocks: [{ kind: 'published', text: catalog[0]!.description!, sources: [{ serviceId: 'roots', field: 'description', quote: catalog[0]!.description! }] }] } }, intakeReply: null }
  }, { respond: async () => { throw new Error('additional model call forbidden') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(runtimeContext, state, body, makePort(services), provider)
  const rejectedCatalogReference = operations.some(operation => 'serviceId' in operation && !services.some(service => service.id === operation.serviceId))
  assert.equal(calls, rejectedCatalogReference ? 2 : 1)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  return result
}
async function invitation(state = initialDialogueState(context.businessId), aspect = 'price') {
  const body = aspect === 'price' ? '¿Cuánto sale Raíces?' : 'Contame de Raíces'
  const result = await say(state, body, [{ kind: 'information', target: { kind: 'service', serviceIds: ['roots'], actions: [], aspect }, ...evidence(body) }], 'inquiry', catalog, 'information')
  assert.deepEqual(ids(result.state), ids(state))
  assert.equal(result.choicePresentation?.choices[0]?.label, 'Reservar')
  assert.equal(result.state.informationFocus?.serviceId, 'roots')
  return result
}
async function check(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log('PASS service continuity ' + name) }
  catch (error) { failures.push(name); console.error('RED service continuity ' + name + ': ' + String(error)) }
}

for (const aspect of ['price', 'overview']) for (const body of ['sí, dale', 'quiero reservar', 'Reservar']) {
  await check(aspect + ' invitation accepts current semantic choice: ' + body, async () => {
    const read = await invitation(undefined, aspect)
    const clicked = await respondConversationChoice(context, read.state, read.choicePresentation!.choices[0]!.operation, makePort())
    const beforeAgenda = agendaCalls
    const result = await say(read.state, body, [select(body)])
    assert.deepEqual(ids(result.state), ['roots'])
    assert.equal(result.state.pending, clicked.state.pending)
    assert.equal(result.state.questionContext?.role, clicked.state.questionContext?.role)
    assert.equal(result.state.informationFocus, undefined)
    assert.equal(result.proposal, null); assert.equal(agendaCalls, beforeAgenda)
    assert.doesNotMatch(result.reply, /eleg[ií].*Reservar|no coincide con la propuesta|mensaje interno|Mantengo (los servicios|los datos) del pedido/i)
  })
}
async function descriptiveRead() {
  const body = 'Contame la descripción de Raíces'
  const result = await say(initialDialogueState(context.businessId), body, [{ kind: 'information',
    target: { kind: 'service', serviceIds: ['roots'], actions: [], aspect: 'description' }, ...evidence(body) }], 'inquiry', catalog, 'information')
  assert.equal(result.state.informationFocus?.serviceId, 'roots')
  assert.equal(result.choicePresentation, undefined)
  assert.match(result.reply, /Qué más querés saber sobre este servicio/)
  assert.deepEqual(ids(result.state), [])
  return result
}
async function needInquiry() {
  const body = '¿Hacen coloración sin amoníaco?'
  return say(initialDialogueState(context.businessId), body, [{ kind: 'service_request', purpose: 'inquiry',
    disposition: 'unverified_variant', basis: 'related_category', serviceIds: ['roots'], sourceQuote: null,
    correction: false, continuation: false, subject: 'coloración sin amoníaco', aspect: 'description', ...evidence(body) }], 'inquiry', catalog, 'information')
}
await check('need inquiry then candidate read consumes its request before textual booking choice', async () => {
  const inquiry = await needInquiry()
  assert.equal(inquiry.state.serviceRequest?.purpose, 'inquiry')
  const read = await respondConversationChoice(context, inquiry.state, inquiry.choicePresentation!.choices[0]!.operation, makePort())
  assert.equal(read.state.serviceRequest, undefined)
  assert.equal(read.state.informationFocus?.aspect, 'description')
  assert.equal(read.choicePresentation, undefined)
  const result = await say(read.state, 'quiero reservar', [select('quiero reservar')], 'request')
  assert.deepEqual(ids(result.state), ['roots'], JSON.stringify({ read: read.state, reply: read.reply, result: result.reply }))
  assert.equal(result.state.serviceRequest, undefined)
  assert.equal(result.state.pending, 'date')
})
for (const aspect of ['price', 'description']) await check('coexisting inquiry only yields to a current factual booking request: ' + aspect, async () => {
  const inquiry = await needInquiry()
  const body = aspect === 'price' ? '¿Cuánto sale Raíces?' : 'Contame la descripción de Raíces'
  const read = await say(inquiry.state, body, [{ kind: 'information', target: { kind: 'service', serviceIds: ['roots'], actions: [], aspect }, ...evidence(body) }], 'inquiry', catalog, 'information')
  assert.equal(read.state.serviceRequest?.purpose, 'inquiry')
  assert.equal(read.state.informationFocus?.serviceId, 'roots')
  const result = await say(read.state, 'quiero reservar', [select('quiero reservar')], 'request')
  if (aspect === 'price') {
    // This read resumes the unresolved inquiry, so its actual question offers no booking invitation.
    assert.equal(read.state.questionContext?.question, inquiry.state.questionContext?.question)
    assert.deepEqual(ids(result.state), [])
    assert.deepEqual(result.state.serviceRequest, inquiry.state.serviceRequest)
    return
  }
  assert.deepEqual(ids(result.state), ['roots'], JSON.stringify({ read: read.state, reply: read.reply, result: result.reply }))
  assert.equal(result.state.serviceRequest, undefined)
  assert.equal(result.state.pending, 'date')
  assert.match(result.reply, /no tengo confirmado.*coloración sin amoníaco/i)
})
await check('E4 explicit booking request selects the current descriptive focus without a booking invitation', async () => {
  const read = await descriptiveRead()
  const result = await say(read.state, 'sí quiero reservar', [select('sí quiero reservar')], 'request')
  assert.deepEqual(ids(result.state), ['roots'])
  assert.equal(result.state.informationFocus, undefined)
  assert.equal(result.proposal, null)
  assert.doesNotMatch(result.reply, /eleg[ií].*Reservar|no coincide con la propuesta|mensaje interno|Mantengo (los servicios|los datos) del pedido/i)
})
await check('runtime text and native CTA have the same selection and next missing field', async () => {
  const runtimeContext = { ...context, sandboxBooking: false }
  const read = await invitation()
  const clicked = await respondConversationChoice(runtimeContext, read.state, read.choicePresentation!.choices[0]!.operation, makePort())
  const result = await say(read.state, 'quiero reservar', [select('quiero reservar')], 'request', catalog, 'booking', runtimeContext)
  assert.deepEqual(ids(result.state), ids(clicked.state))
  assert.equal(result.state.pending, clicked.state.pending)
  assert.equal(result.state.questionContext?.question, clicked.state.questionContext?.question)
  assert.equal(result.proposal, null)
  assert.doesNotMatch(result.reply, /Mantengo (los servicios|los datos) del pedido/i)
})
await check('generic acceptance of an informational question does not select the descriptive focus', async () => {
  const read = await descriptiveRead()
  const result = await say(read.state, 'sí', [select('sí')])
  assert.deepEqual(ids(result.state), [])
})
for (const broken of ['no current question', 'unrelated question', 'changed draft scope', 'two focal services']) {
  await check('descriptive request rejects stale or ambiguous current grounding: ' + broken, async () => {
    const read = await descriptiveRead()
    const state = structuredClone(read.state)
    if (broken === 'no current question') delete state.questionContext
    if (broken === 'unrelated question') state.questionContext!.question = '¿Qué día preferís?'
    if (broken === 'changed draft scope') state.date = slot.date
    if (broken === 'two focal services') state.informationFocus!.options.push({ id: 'cut', label: 'Corte' })
    const result = await say(state, 'quiero reservar', [select('quiero reservar')], 'request')
    assert.deepEqual(ids(result.state), [])
  })
}
await check('current choice preserves name, date, time preference and companion', async () => {
  const prior = { ...initialDialogueState(context.businessId), customerName: 'Camila', date: slot.date,
    timePreference: { kind: 'band' as const, band: 'AFTERNOON' as const }, serviceId: 'cut',
    basket: { version: 1 as const, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single' as const, serviceIds: ['cut'], evidence: 'Corte' }] } }
  const read = await invitation(prior)
  const body = 'quiero reservar'
  const result = await say(read.state, body, [select(body)])
  assert.deepEqual(ids(result.state), ['cut', 'roots'])
  assert.deepEqual(result.state.basket?.members[0], prior.basket.members[0])
  assert.equal(result.state.customerName, prior.customerName); assert.equal(result.state.date, prior.date)
  assert.deepEqual(result.state.timePreference, prior.timePreference)
})
await check('selection of an existing service never duplicates the basket member', async () => {
  const prior = { ...initialDialogueState(context.businessId), serviceId: 'roots' }
  const read = await invitation(prior)
  const result = await say(read.state, 'sí, dale', [select('sí, dale')])
  assert.deepEqual(ids(result.state), ['roots'])
  assert.equal(result.state.informationFocus, undefined)
})
await check('expired button stays invalid while current text uses the current invitation', async () => {
  const read = await invitation()
  const scope = { businessId: context.businessId, conversationKey: 'chat', policyKey: 'policy', policyGeneration: 1, revision: '1' }
  const question = issueChoiceQuestion(scope, read.state, read.choicePresentation!)
  const action = publicChoiceQuestion(question).choices[0]!.id
  assert.throws(() => resolveChoice(question, { ...scope, revision: '2' }, read.state, action), /stale/)
  const result = await say(read.state, 'Reservar', [select('Reservar')])
  assert.deepEqual(ids(result.state), ['roots'])
})
await check('informative acceptance remains a read until a distinct booking choice', async () => {
  const read = await invitation()
  const body = 'bueno está bien Raíces'
  const info = await say(read.state, body, [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: ['roots'], aspect: 'overview' }, ...evidence(body) }], 'inquiry', catalog, 'information')
  assert.deepEqual(ids(info.state), [])
  const chosen = await say(info.state, 'quiero reservar', [select('quiero reservar')])
  assert.deepEqual(ids(chosen.state), ['roots'])
})
for (const [body, kind] of [['no quiero reservar', 'uncertain'], ['¿puedo reservar?', 'inquiry'], ['sí pero depende del precio', 'uncertain']]) {
  await check('nonselecting current act cannot acquire: ' + body, async () => {
    const read = await invitation()
    const result = await say(read.state, body!, [select(body!)], kind!)
    assert.deepEqual(ids(result.state), [])
  })
}
for (const broken of ['no question', 'other question', 'two options', 'other business', 'no focus']) {
  await check('rejects absent, ambiguous or foreign invitation: ' + broken, async () => {
    const read = await invitation()
    const state = structuredClone(read.state)
    if (broken === 'no question') delete state.questionContext
    if (broken === 'other question') state.questionContext!.question = '¿Qué día preferís?'
    if (broken === 'two options') state.informationFocus!.options.push({ id: 'cut', label: 'Corte' })
    if (broken === 'other business') state.informationFocus!.businessId = 'foreign'
    if (broken === 'no focus') delete state.informationFocus
    if (broken === 'other business') {
      await assert.rejects(() => say(state, 'sí, dale', [select('sí, dale')]), /invalid information focus/)
      return
    }
    const result = await say(state, 'sí, dale', [select('sí, dale')])
    assert.deepEqual(ids(result.state), [])
  })
}
for (const changed of ['removed', 'renamed', 'not bookable']) {
  await check('revalidates current catalog: ' + changed, async () => {
    const read = await invitation()
    const services = changed === 'removed' ? [catalog[1]!] : catalog.map(service => service.id !== 'roots' ? service : {
      ...service, ...(changed === 'renamed' ? { name: 'Nombre nuevo' } : { requiresConsultation: true })
    })
    const result = await say(read.state, 'sí, dale', [select('sí, dale')], 'answer', services)
    assert.deepEqual(ids(result.state), [])
  })
}
await check('confirm_proposal cannot replace service selection', async () => {
  const read = await invitation()
  const result = await say(read.state, 'sí, dale', [{ kind: 'confirm_proposal', ...evidence('sí, dale') }])
  assert.deepEqual(ids(result.state), []); assert.equal(result.proposal, null)
})
await check('choosing service discards an obsolete proposed slot and consent', async () => {
  const ready = { ...initialDialogueState(context.businessId), serviceId: 'roots', date: slot.date,
    professional: { kind: 'specific' as const, id: 'ana' }, requestedTime: slot.time, slot, customerName: 'Camila' }
  const shown = await respond(context, ready, 'quiero reservar', makePort())
  assert.ok(shown.state.sandboxReservation)
  const read = await invitation(shown.state)
  const result = await say(read.state, 'quiero reservar', [select('quiero reservar')])
  assert.deepEqual(ids(result.state), ['roots'])
  assert.equal(result.state.slot, null); assert.equal(result.state.requestedTime, null)
  assert.equal(result.state.sandboxReservation, undefined); assert.equal(result.state.bookingReservation, undefined)
  assert.equal(result.proposal, null)
})
console.log(JSON.stringify({ passed, failed: failures.length, failures }))
if (failures.length) process.exitCode = 1
