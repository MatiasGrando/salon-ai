/// <reference types="node" />
import assert from 'node:assert/strict'
import { presentAvailability, type AvailabilityPresentationInput } from '../src/conversational-bot/availability-presentation.js'
import { coordinationKey, type DialogueAvailabilitySlot } from '../src/conversational-bot/coordinated-booking.js'
import { adaptChoicePresentation } from '../src/conversational-bot/dialogue-choice-presentation.js'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { planConversationChoiceView, resolveConversationChoicePayload } from '../src/conversational-bot/runtime-choice-persistence.js'

const timezone = 'America/Argentina/Buenos_Aires'
const scope = { businessId: 'fixture', serviceIds: ['light', 'cut'], date: '2026-10-13', professionalId: null }
const choiceScope = { businessId: 'fixture', conversationKey: 'session', policyKey: 'policy', policyGeneration: 1, revision: '3' }
const draft = { businessId: 'fixture', pending: 'time', date: scope.date }
function slot(time: string, professional = 'ana'): DialogueAvailabilitySlot {
  const startAt = new Date(scope.date + 'T' + time + ':00-03:00').toISOString()
  const cutAt = new Date(Date.parse(startAt) + 120 * 60_000).toISOString()
  const endAt = new Date(Date.parse(cutAt) + 30 * 60_000).toISOString()
  const segments = [
    { serviceId: 'light', serviceName: 'Iluminación', professionalId: professional, professionalName: professional === 'ana' ? 'Ana' : 'Andrea', startAt, endAt: cutAt, durationMinutes: 120, customerDurationMinutes: 120 },
    { serviceId: 'cut', serviceName: 'Corte', professionalId: 'gas', professionalName: 'Gaspar', startAt: cutAt, endAt, durationMinutes: 30, customerDurationMinutes: 30 }
  ]
  return { date: scope.date!, time, startAt, professionalId: professional, professionalName: segments[0]!.professionalName, occupiedMinutes: 150, band: 'AFTERNOON', coordination: { key: coordinationKey(scope.businessId, segments), segments } }
}
const input = (slots: DialogueAvailabilitySlot[], changes: Partial<AvailabilityPresentationInput> = {}): AvailabilityPresentationInput => ({
  scope, read: { fresh: true, scope, slots }, timezone, now: new Date('2026-10-10T12:00:00Z'), ...changes
})
function view(slots: DialogueAvailabilitySlot[], reply?: string, changes: Partial<AvailabilityPresentationInput> = {}) {
  const presentation = presentAvailability(input(slots, changes))
  const adapted = adaptChoicePresentation(presentation, 'slots', changes.cursor ?? 0)!
  const question = issueChoiceQuestion(choiceScope, draft, adapted)
  const plan = planConversationChoiceView({ question, reply: reply ?? presentation.text, transitionId: 'fixture-transition' })
  return { presentation, adapted, question, plan }
}
const bodies = (plan: ReturnType<typeof planConversationChoiceView>) => plan.outboxRows.map(row => row.item.body).join('\n')
const menu = (plan: ReturnType<typeof planConversationChoiceView>) => plan.outboxRows.find(row => row.item.type === 'interactive')!.item
let passed = 0, failed = 0
function test(name: string, run: () => void) { try { run(); passed++; console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message) } }

test('coordinated offer has one date and no repeated anchor time', () => {
  const { presentation } = view([slot('16:00'), slot('15:30')])
  assert.doesNotMatch(presentation.text, /a las 16:00\s*·\s*16:00/)
  assert.equal((presentation.text.match(/13[-/]10/g) ?? []).length, 1)
  assert.match(presentation.text, /16:00 Iluminación con Ana\n\s*18:00 Corte con Gaspar/)
})
test('canonical offer is not repeated before the interactive menu', () => {
  const { presentation, plan } = view([slot('16:00'), slot('15:30')])
  assert.equal(bodies(plan), presentation.text)
})
test('superficial paraphrase does not append the full coordinated labels', () => {
  const prepared = view([slot('16:00')])
  const label = prepared.question.choices[0]!.label
  const paraphrase = label.replace(/a las /g, 'a ').replace(/ → /g, '\n')
  const reply = 'Estos horarios están disponibles:\n' + paraphrase + '\n¿Cuál te queda mejor?'
  const plan = planConversationChoiceView({ question: prepared.question, reply, transitionId: 'paraphrase' })
  assert.equal(bodies(plan), reply)
})
test('missing material segment retains a complete canonical fallback', () => {
  const prepared = view([slot('16:00')])
  const plan = planConversationChoiceView({ question: prepared.question, reply: '16:00 Iluminación con Ana. ¿Te sirve?', transitionId: 'missing-segment' })
  assert.match(bodies(plan), /18:00 Corte con Gaspar/)
  assert.ok(bodies(plan).includes(prepared.question.choices[0]!.label))
})
test('same-start coordinated assignments have brief distinct row titles and original payloads', () => {
  const { plan, question } = view([slot('16:00', 'ana'), slot('16:00', 'andrea')])
  const item = menu(plan)
  assert.ok(item.type === 'interactive' && item.mode === 'list')
  if (item.type !== 'interactive' || item.mode !== 'list') return
  assert.equal(new Set(item.rows!.map(row => row.title)).size, 2)
  assert.ok(item.rows!.every(row => row.title.length <= 24 && /^16:00/.test(row.title)))
  assert.ok(item.rows!.every(row => (row.description?.length ?? 0) <= 72))
  const original = publicChoiceQuestion(question).choices
  for (const [index, row] of plan.choiceRows.entries()) {
    assert.equal(row.payload.choiceId, original[index]!.id)
    assert.deepEqual(resolveConversationChoicePayload(row.payload, choiceScope, draft).operation, question.choices[index]!.operation)
    assert.equal(row.labelSnapshot, question.choices[index]!.label)
  }
  assert.notDeepEqual(question.choices[0]!.operation, question.choices[1]!.operation)
})
test('pagination keeps finite operations, bounded rows and distinct selection identities', () => {
  const slots = Array.from({ length: 11 }, (_, index) => slot(String(9 + Math.floor(index / 2)).padStart(2, '0') + (index % 2 ? ':30' : ':00')))
  const first = view(slots, undefined, { preference: { kind: 'any' } })
  const second = view(slots, undefined, { preference: { kind: 'any' }, cursor: 1 })
  assert.ok(second.adapted.choices.some(choice => choice.operation.kind === 'page' && choice.operation.cursor === 0))
  assert.ok(second.adapted.choices.some(choice => choice.operation.kind === 'page' && choice.operation.cursor === 2))
  const item = menu(second.plan)
  assert.ok(item.type === 'interactive' && item.mode === 'list' && item.rows!.length <= 10)
  if (item.type === 'interactive' && item.mode === 'list') assert.equal(new Set(item.rows!.map(row => row.title)).size, item.rows!.length)
  const firstKeys = first.adapted.choices.flatMap(choice => choice.operation.kind === 'slot' ? [choice.operation.coordinationKey] : [])
  assert.ok(second.adapted.choices.every(choice => choice.operation.kind !== 'slot' || !firstKeys.includes(choice.operation.coordinationKey)))
})
test('stale scope, draft and extra client operation remain rejected', () => {
  const { plan } = view([slot('16:00')])
  const payload = plan.choiceRows[0]!.payload
  assert.throws(() => resolveConversationChoicePayload(payload, { ...choiceScope, revision: '4' }, draft), /scope/)
  assert.throws(() => resolveConversationChoicePayload(payload, choiceScope, { ...draft, date: '2026-10-14' }), /draft/)
  assert.throws(() => resolveConversationChoicePayload({ ...payload, operation: { kind: 'confirm' } }, choiceScope, draft), /payload/)
})
test('coordinated DST fold retains both UTC offsets and distinct identities', () => {
  const foldScope = { ...scope, date: '2026-11-01' }
  const foldSlots = ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'].map(startAt => {
    const base = slot('16:00')
    const segments = base.coordination!.segments.map((segment, index) => ({
      ...segment, startAt: new Date(Date.parse(startAt) + index * 120 * 60_000).toISOString(),
      endAt: new Date(Date.parse(startAt) + (index ? 150 : 120) * 60_000).toISOString()
    }))
    return { ...base, date: foldScope.date!, time: '01:30', startAt, band: 'MORNING' as const, coordination: { key: coordinationKey(scope.businessId, segments), segments } }
  })
  const presentation = presentAvailability({ scope: foldScope, read: { fresh: true, scope: foldScope, slots: foldSlots },
    timezone: 'America/New_York', now: new Date('2026-10-10T12:00:00Z') })
  assert.match(presentation.text, /UTC-4/)
  assert.match(presentation.text, /UTC-5/)
  assert.equal(presentation.choices.length, 2)
  assert.notEqual(presentation.choices[0]!.label, presentation.choices[1]!.label)
})
test('fragmented coordinated explanation preserves delivery dependency and payload', () => {
  const prepared = view([slot('16:00')])
  const reply = 'Información pública adicional. '.repeat(100) + prepared.presentation.text
  const plan = planConversationChoiceView({ question: prepared.question, reply, transitionId: 'fragmented' })
  assert.ok(plan.outboxRows.length > 1)
  assert.equal(plan.outboxRows.at(-1)!.dependsOnSequence, plan.outboxRows.length - 2)
  assert.deepEqual(plan.choiceRows[0]!.payload.question, prepared.question)
  assert.equal((bodies(plan).match(/18:00 Corte con Gaspar/g) ?? []).length, 1)
})
console.log(`coordinated presentation: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
