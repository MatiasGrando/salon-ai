import assert from 'node:assert/strict'
import { createInitialBotOptionsState, parseBotOptionsState } from '../src/bot-options/domain/state.js'
import { transition, renderCurrentView, normalizeContext } from '../src/bot-options/domain/transition.js'

const service = {
  id: 'light', name: 'Iluminación', attentionMode: 'GUIDED_ESTIMATE',
  price: 50000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: null, estimateOptions: [], estimateExplanation: 'Depende del largo.',
  estimateDisclaimer: 'El precio final se confirma en el local.', requiresPhoto: false,
  validationEnabled: false, validationMessage: null, validationQuestion: null
}
const ctx = (overrides = {}) => normalizeContext({
  dbNowIso: '2026-08-31T12:00:00Z', customerNameOnFile: 'Ana',
  serviceActive: true, serviceBookable: true, serviceCompatibleWithCart: true,
  requiresConsultation: false, serviceBooking: service,
  labels: { serviceName: service.name }, ...overrides
} as any)
const state = () => ({ ...createInitialBotOptionsState(), flow: 'SERVICE_DETAIL' as const,
  pendingEntityRef: { type: 'SERVICE' as const, id: service.id } })
const click = (s: any, actionType: string, c = ctx(), entityRef: any = { type: 'SERVICE', id: service.id }) =>
  transition(s, { actionType, entityRef, payload: null } as any, c)
const text = (r: any) => [...r.view.informativeTexts, r.view.interactiveBody].join('\n')

// RED first: same displayed detail must offer reservation even for assisted modes.
assert.ok(renderCurrentView(state(), ctx({ requiresConsultation: true })).choices.some(c => c.actionType === 'service.book'))
let result = click(state(), 'service.book')
assert.equal(result.state.flow, 'CART_REVIEW')
assert.deepEqual(result.state.cart, [{ serviceId: 'light' }])
assert.equal((result.state as any).serviceDecisions.light.estimate.priceMin, 50000)
assert.match(text(result), /50.000/)
assert.match(text(result), /no es.*definitivo|no es.*final/i)
assert.ok(!result.view.choices.some(c => c.actionType === ('estimate.continue' as any)))
assert.equal(parseBotOptionsState(createInitialBotOptionsState()).ok, true)
assert.equal(parseBotOptionsState(result.state).ok, true)

const unknown = click(state(), 'service.book', ctx({ customerNameOnFile: null }))
assert.equal(unknown.state.flow, 'NAME_INPUT')
result = click({ ...unknown.state, flow: 'NAME_CONFIRM', nameCandidate: 'Ana' }, 'name.confirm', ctx({ customerNameOnFile: null }), null)
assert.equal(result.state.flow, 'CART_REVIEW')
assert.ok(result.outcome !== 'RECOVERED' && result.effects.some(e => e.kind === 'PERSIST_CUSTOMER_NAME'))

const optionService = { ...service, estimateQuestion: '¿Qué largo tenés?', estimateOptions: [
  { id: 'long', label: 'Largo', priceMin: 60000, priceMax: 80000, note: 'Según cantidad.' }
] }
const optionsContext = ctx({ serviceBooking: optionService })
let options = click(state(), 'service.book', optionsContext)
assert.equal(options.state.flow, 'SERVICE_ESTIMATE')
assert.match(text(options), /Qué largo/)
const choice = options.view.choices.find(c => c.actionType === ('service.estimate_option' as any))!
assert.ok(choice)
result = transition(options.state, { actionType: choice.actionType, entityRef: choice.entityRef ?? null, payload: choice.payload ?? null }, optionsContext)
assert.equal(result.state.flow, 'CART_REVIEW')
assert.equal((result.state as any).serviceDecisions.light.estimate.optionId, 'long')
assert.match(text(result), /60.000.*80.000/)

for (const attentionMode of ['QUOTE', 'ADVISOR', 'GUIDED_ESTIMATE']) {
  const existing = { ...state(), cart: [{ serviceId: 'cut' }] }
  const handoff = click(existing, 'service.book', ctx({ serviceBooking: { ...service, attentionMode, estimateAllowsBooking: false }, requiresConsultation: true }))
  assert.equal(handoff.state.flow, 'HANDOFF_QUEUED', attentionMode)
  assert.deepEqual(handoff.state.cart, existing.cart)
  assert.equal(handoff.state.pendingEntityRef?.id, 'light')
  assert.match(text(handoff), /Iluminación/)
  assert.match(text(handoff), /equipo/)
}
const invalid = click(options.state, 'service.estimate_option', optionsContext, { type: 'ESTIMATE_OPTION', id: 'forged' })
assert.equal(invalid.outcome, 'RECOVERED')
const stale = click(state(), 'service.book', ctx({ serviceActive: false }))
assert.equal(stale.outcome, 'RECOVERED')
const validation = click(state(), 'service.book', ctx({ serviceBooking: { ...service, validationEnabled: true, validationMessage: 'Aviso configurado', validationQuestion: '¿Estás de acuerdo?' } }))
assert.equal(validation.state.flow, 'SERVICE_VALIDATION')
assert.match(text(validation), /Aviso configurado/)
const photoPolicy = { ...service, attentionMode: 'QUOTE', estimateAllowsBooking: false, requiresPhoto: true }
const photos = click(state(), 'service.book', ctx({ serviceBooking: photoPolicy, requiresConsultation: true }))
assert.equal(photos.state.flow, 'SERVICE_PHOTOS')
assert.equal(click(photos.state, 'service.photos_done', ctx({ serviceBooking: photoPolicy })).outcome, 'RECOVERED')
assert.equal(click({ ...photos.state, servicePhotoIds: { light: ['media-1'] } }, 'service.photos_done', ctx({ serviceBooking: photoPolicy })).state.flow, 'HANDOFF_QUEUED')
console.log('service modalities pure contracts passed')
