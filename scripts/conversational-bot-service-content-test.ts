import { initialDialogueState, respond, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import assert from 'node:assert/strict'
import { contentSourceHash, resolveServiceContent, stageContent, parseDefinitionServiceContent, attachServiceContent } from '../src/bot-options/domain/service-content.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import { guidanceQuestion } from '../src/conversational-bot/service-guidance.js'
const policy: ServiceBookingPolicy = { id: 'service', name: 'Servicio', attentionMode: 'GUIDED_ESTIMATE', price: 100, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué variante preferís?', estimateOptions: [{ id: 'short', label: 'Corto', priceMin: 100, priceMax: 200, note: 'Evaluación previa obligatoria.' }],
  estimateExplanation: 'El presupuesto depende del largo.', estimateDisclaimer: 'Precio estimado.\nAsistir con el cabello limpio.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
const raw = { version: 1, businessId: 'tenant', serviceId: policy.id, reviewed: true, revision: 1, sourceHash: contentSourceHash(policy), segments: [
  { id: 'why', source: 'explanation', start: 0, end: policy.estimateExplanation!.length, stage: 'choice', role: 'prose', variants: ['El largo determina el presupuesto.'] },
  { id: 'estimated', source: 'disclaimer', start: 0, end: 'Precio estimado.'.length, stage: 'both', role: 'condition', variants: [] },
  { id: 'prepare', source: 'disclaimer', start: 'Precio estimado.'.length, end: policy.estimateDisclaimer!.length, stage: 'attendance', role: 'condition', variants: [] },
  { id: 'evaluation', source: 'option:short', start: 0, end: policy.estimateOptions![0]!.note!.length, stage: 'both', role: 'condition', variants: [] }
] }
const reviewed = resolveServiceContent(raw, 'tenant', policy)
assert.ok(reviewed)
const configured = attachServiceContent(policy, 'tenant', { version: 1, businessId: 'tenant', services: [raw] })
assert.equal(stageContent(configured, 'tenant', 'choice').reviewed, true)
const choice = stageContent(configured, 'tenant', 'choice').fragments
assert.ok(choice.some(fragment => fragment.text === policy.estimateExplanation && fragment.variants?.length === 1))
assert.ok(choice.some(fragment => fragment.text === 'Precio estimado.'))
assert.ok(!choice.some(fragment => fragment.text.includes('cabello limpio')))
const attendance = stageContent(configured, 'tenant', 'attendance').fragments
assert.ok(attendance.some(fragment => fragment.text.includes('cabello limpio')))
assert.ok(attendance.some(fragment => fragment.text.includes('Precio estimado.')))
assert.notEqual(serviceConfigurationKey(configured), serviceConfigurationKey(policy), 'reviewed staging changes configuration evidence')
for (const changed of [
  { ...raw, businessId: 'foreign' }, { ...raw, sourceHash: '0'.repeat(64) }, { ...raw, reviewed: false }, { ...raw, version: 2 },
  { ...raw, segments: raw.segments.slice(0, -1) },
  { ...raw, segments: raw.segments.map(segment => segment.id === 'prepare' ? { ...segment, start: segment.start + 1 } : segment) },
  { ...raw, segments: raw.segments.map(segment => segment.id === 'estimated' ? { ...segment, variants: ['Precio fijo.'] } : segment) },
  { ...raw, segments: raw.segments.map(segment => segment.id === 'why' ? { ...segment, variants: ['Cuesta $ 50'] } : segment) },
  { ...raw, segments: raw.segments.map(segment => segment.id === 'prepare' ? { ...segment, stage: 'choice' } : segment) }
]) {
  assert.equal(resolveServiceContent(changed, 'tenant', policy), null)
  const safe = attachServiceContent(policy, 'tenant', { version: 1, businessId: 'tenant', services: [changed] })
  const fallback = stageContent(safe, 'tenant', 'choice')
  assert.equal(fallback.reviewed, false)
  assert.ok(fallback.fragments.some(fragment => fragment.text === policy.estimateDisclaimer), 'legacy fallback conserves all conditions without keyword separation')
}
assert.equal(parseDefinitionServiceContent({ serviceContent: { version: 1, businessId: 'foreign', services: [raw] } }, 'tenant'), null)
const numericSource = { ...policy, estimateExplanation: 'El descuento es 15%.' }
const numericRewrite = { ...raw, sourceHash: contentSourceHash(numericSource), segments: raw.segments.map(segment => segment.id === 'why' ? { ...segment, end: numericSource.estimateExplanation.length } : segment) }
assert.equal(resolveServiceContent(numericRewrite, 'tenant', numericSource), null, 'reviewed prose cannot erase monetary/numeric source atoms')
const text = guidanceQuestion({ id: policy.id, name: policy.name, price: policy.price, priceMode: policy.priceMode, durationMinutes: 30, requiresConsultation: false, bookingPolicy: policy })
assert.ok(text.includes('• Corto: $ 100 a $ 200'))
assert.ok(text.includes(policy.estimateDisclaimer!))
assert.ok(text.endsWith(policy.estimateQuestion!), 'choice question must follow options and all relevant facts')
console.log('PASS reviewed service content: exact source coverage, tenant/version/digest, phase invariants and legacy complete fallback')

const contentContext = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T15:00:00Z') }
const contentService: DialogueService = { id: policy.id, name: policy.name, price: policy.price, priceMode: policy.priceMode, durationMinutes: 30, requiresConsultation: false, bookingPolicy: configured }
let contentAgendaCalls = 0
const contentPort: DialoguePort = { catalog: async () => [contentService], availability: async () => { contentAgendaCalls++; return { professionals: [], slots: [] } } }
const contentPrice = await respond(contentContext, initialDialogueState('tenant'), 'precio Servicio', contentPort, { intent: 'information', serviceId: null, candidateIds: [], correction: false,
  turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: [policy.id], aspect: 'price' }, evidence: 'precio Servicio', confidence: 1 }] } })
assert.match(contentPrice.reply, /Precio estimado/)
assert.doesNotMatch(contentPrice.reply, /cabello limpio/, 'reviewed attendance content is not premature price-choice content')
assert.equal(contentAgendaCalls, 0)
assert.equal(contentPrice.state.serviceId, null)
console.log('PASS information price delivery observes reviewed stages without starting booking')

const contextualService = { ...contentService, professionalDurationMinutes: 30, customerDurationMinutes: 30 }
const contentSlot = { date: '2026-10-03', time: '17:00', startAt: '2026-10-03T20:00:00.000Z', professionalId: 'cin', professionalName: 'Cin', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
const bookingContentPort: DialoguePort = { ...contentPort, catalog: async () => [contextualService], availabilityBasket: async selected => {
  contentAgendaCalls++
  return { ok: true, services: selected, durationMinutes: 30, customerDurationMinutes: 30, totalPrice: null, professionals: [{ id: 'cin', name: 'Cin', priority: 0 }], slots: [contentSlot] }
} }
const bookingContentContext = { ...contentContext, sandboxBooking: true }
const selectedContent = await respond(bookingContentContext, initialDialogueState('tenant'), 'quiero Servicio y su precio', bookingContentPort, {
  intent: 'booking', serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
    { kind: 'service', mode: 'single', serviceIds: [policy.id], correction: false, evidence: 'Servicio', confidence: 1 },
    { kind: 'information', target: { kind: 'service', actions: [], serviceIds: [policy.id], aspect: 'price' }, evidence: 'precio', confidence: 1 }
  ] }
})
assert.doesNotMatch(selectedContent.reply, /cabello limpio/)
assert.equal((selectedContent.reply.match(/Precio estimado/g) ?? []).length, 1)
assert.equal(contentAgendaCalls, 0)
const consentContent = await respond(bookingContentContext, selectedContent.state, 'Corto mañana 17:00 con Cin soy Laura', bookingContentPort, {
  intent: 'booking', serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
    { kind: 'estimate', serviceId: policy.id, optionId: 'short', evidence: 'Corto', confidence: 1 },
    { kind: 'date', expression: 'mañana', evidence: 'mañana', confidence: 1 },
    { kind: 'time', value: '17:00', evidence: '17:00', confidence: 1 },
    { kind: 'professional', mode: 'specific', mention: 'Cin', evidence: 'Cin', confidence: 1 },
    { kind: 'name', value: 'Laura', evidence: 'Laura', confidence: 1 }
  ] }
})
assert.ok(consentContent.state.sandboxReservation?.presented.conditionsPresented)
assert.match(consentContent.reply, /cabello limpio/)
assert.ok(consentContent.reply.indexOf('cabello limpio') < consentContent.reply.lastIndexOf('¿'), 'attendance conditions precede the consent question')
assert.equal(consentContent.state.sandboxReservation?.receipt, undefined)
assert.equal(consentContent.bookingCommand, undefined)
console.log('PASS staged price/guidance coverage does not omit attendance conditions before explicit consent')
