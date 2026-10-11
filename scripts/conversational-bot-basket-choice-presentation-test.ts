import assert from 'node:assert/strict'
import { initialDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { issueChoiceQuestion, publicChoiceQuestion, resolveChoice } from '../src/conversational-bot/choices.js'
import { choicePresentationForQuestion } from '../src/conversational-bot/dialogue-choice-presentation.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import type { TurnOperation } from '../src/conversational-bot/turn-plan.js'

const context = { businessId: 'basket-choices', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T15:00:00Z') }
const catalog: DialogueService[] = [
  { id: 'light', name: 'Iluminacion', durationMinutes: 120, price: 40000, requiresConsultation: false },
  { id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 15000, requiresConsultation: false },
  { id: 'beard', name: 'Corte y barba', durationMinutes: 60, price: 40000, requiresConsultation: false },
  { id: 'woman', name: 'Corte Mujer', durationMinutes: 30, price: 18000, requiresConsultation: false },
  { id: 'child', name: 'Corte infantil', durationMinutes: 30, price: 12000, requiresConsultation: false }
]
let agendaReads = 0
const port: DialoguePort = {
  catalog: async () => catalog,
  availability: async () => { agendaReads++; return { professionals: [{ id: 'stylist', name: 'Profesional', priority: 0 }], slots: [] } },
  availabilityBasket: async services => {
    agendaReads++
    return { ok: true, services, durationMinutes: services.reduce((sum, service) => sum + service.durationMinutes!, 0),
      totalPrice: services.reduce((sum, service) => sum + service.price!, 0), professionals: [{ id: 'stylist', name: 'Profesional', priority: 0 }], slots: [] }
  }
}
const say = (state: DialogueState, message: string, operations: TurnOperation[]) => respond(context, state, message, port,
  { serviceId: null, candidateIds: [], correction: false, intent: 'booking', turnPlan: { version: 1, operations } })
const fixture = async (ids = ['cut', 'beard']) => {
  const state = { ...initialDialogueState(context.businessId), serviceId: 'light', date: '2026-10-13', pending: 'professional' as const, introduced: true }
  const message = 'ademas tambien quiero un corte sera posible?'
  return say(state, message, [{ kind: 'basket', mutation: 'add', scope: 'all', targetMemberIds: [], evidence: message, confidence: .99,
    members: [{ mode: 'alternatives', serviceIds: ids, evidence: 'corte', confidence: .99 }] }])
}
const scope = { businessId: context.businessId, conversationKey: 'synthetic', policyKey: 'policy', policyGeneration: 1, revision: '1' }
let sequence = 0
const token = () => 'choice_token_' + String(++sequence).padStart(10, '0')
let passed = 0, failed = 0
async function test(title: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log('PASS ' + title) }
  catch (error) { failed++; console.error('FAIL ' + title + ': ' + (error instanceof Error ? error.message : String(error))) }
}
await test('adding ambiguous corte publishes two current buttons, preserving Iluminacion and date', async () => {
  const before = agendaReads
  const reply = await fixture()
  assert.equal(reply.state.pending, 'service')
  assert.equal(reply.state.date, '2026-10-13')
  assert.equal(reply.state.basket?.members.length, 2)
  assert.deepEqual(reply.state.basket?.members[0]?.serviceIds, ['light'])
  assert.equal(reply.proposal, null)
  assert.equal(agendaReads, before, 'no partial availability while a member is ambiguous')
  assert.ok(reply.choicePresentation, 'fresh basket clarification must carry its existing structured choices')
  const dto = publicChoiceQuestion(issueChoiceQuestion(scope, reply.state, reply.choicePresentation, token))
  assert.equal(dto.mode, 'buttons')
  assert.deepEqual(dto.choices.map(choice => choice.title), ['Corte Hombre', 'Corte y barba'])
})
await test('four alternatives use native list rather than losing choices', async () => {
  const reply = await fixture(['cut', 'beard', 'woman', 'child'])
  assert.ok(reply.choicePresentation, 'four current basket alternatives must be delivered')
  const dto = publicChoiceQuestion(issueChoiceQuestion(scope, reply.state, reply.choicePresentation, token))
  assert.equal(dto.mode, 'list')
  assert.equal(dto.choices.length, 4)
})
await test('repeat clarification without a mutation still delivers the current member choices', async () => {
  const reply = await fixture()
  const repeated = await say(reply.state, 'no se cual elegir', [])
  assert.deepEqual(repeated.state.basket, reply.state.basket)
  assert.ok(repeated.choicePresentation, 'no-operation clarification exit must also carry fresh choices')
  assert.deepEqual(repeated.choicePresentation.choices.map(choice => choice.operation), choicePresentationForQuestion(repeated.state, catalog)!.choices.map(choice => choice.operation))
})
await test('verified member choice replaces only corte and retains companion/date', async () => {
  const reply = await fixture()
  // Independently exercising the existing generator shows the admission/reducer is reusable.
  const presentation = choicePresentationForQuestion(reply.state, catalog)!
  const question = issueChoiceQuestion(scope, reply.state, presentation, token)
  const dto = publicChoiceQuestion(question)
  const selected = resolveChoice(question, scope, reply.state, dto.choices[0]!.id)
  const pending = reply.state.basket!.members.find(member => member.mode === 'alternatives')!
  assert.deepEqual(selected.operation, { kind: 'service', serviceId: 'cut', targetMemberId: pending.memberId })
  const completed = await respondConversationChoice(context, reply.state, selected.operation, port)
  assert.deepEqual(basketServiceIds(completed.state), ['light', 'cut'])
  assert.equal(completed.state.date, '2026-10-13')
  assert.equal(completed.proposal, null)
})
await test('stale drafts/tokens and wrong member never acquire another service', async () => {
  const reply = await fixture()
  const presentation = choicePresentationForQuestion(reply.state, catalog)!
  const question = issueChoiceQuestion(scope, reply.state, presentation, token)
  const id = publicChoiceQuestion(question).choices[0]!.id
  assert.throws(() => resolveChoice(question, { ...scope, revision: '2' }, reply.state, id), /stale/)
  assert.throws(() => resolveChoice(question, scope, { ...reply.state, date: '2026-10-14' }, id), /stale/)
  assert.throws(() => resolveChoice(question, scope, reply.state, 'c1.unknown_token_12345.unknown_token_54321'), /stale|unknown/)
  await assert.rejects(() => respondConversationChoice(context, reply.state, { kind: 'service', serviceId: 'cut', targetMemberId: 'm999' }, port), /vigente|unavailable|no longer available|opción/)
  await assert.rejects(() => respondConversationChoice(context, reply.state, { kind: 'service', serviceId: 'child' }, port), /vigente|unavailable|no longer available|opción/)
  assert.equal(reply.state.basket!.members.find(member => member.mode === 'alternatives')!.mode, 'alternatives')
  assert.deepEqual(reply.state.basket!.members[0]!.serviceIds, ['light'])
})
await test('missing current alternative rejects a previously issued choice', async () => {
  const reply = await fixture()
  const operation = choicePresentationForQuestion(reply.state, catalog)!.choices[0]!.operation
  await assert.rejects(() => respondConversationChoice(context, reply.state, operation, { ...port, catalog: async () => catalog.filter(service => service.id !== 'cut') }), /vigente|unavailable|no longer available|opción/)
  assert.equal(reply.state.pending, 'service')
})
console.log(`basket choice presentation: ${passed} PASS / ${failed} FAIL`)
if (failed) process.exitCode = 1