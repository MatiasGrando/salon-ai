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
