import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { resolveGuidance } from '../src/conversational-bot/service-guidance.js'
import { matchContextualItems, affirmativeMatchAnswer } from '../src/conversational-bot/contextual-matching.js'
import { rememberDialogueQuestion, expectedDialogueAnswer } from '../src/conversational-bot/dialogue-context.js'
import type { TurnOperation } from '../src/conversational-bot/turn-plan.js'

const context = { businessId: 'matching-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z') }
const cut = { id: 'cut', name: 'Corte hombre', aliases: ['recorte'], durationMinutes: 30, requiresConsultation: false, price: 100 }
const smooth: DialogueService = { id: 'smooth', name: 'Alisado', durationMinutes: 90, requiresConsultation: false, price: 200, priceMode: 'STARTING_AT', bookingPolicy: {
  id: 'smooth', name: 'Alisado', attentionMode: 'GUIDED_ESTIMATE', price: 200, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué largo tiene tu cabello?', estimateOptions: [
    { id: 'short', label: 'Hasta los hombros', priceMin: 200, priceMax: 300, note: null },
    { id: 'long', label: 'Debajo de los hombros', priceMin: 300, priceMax: 400, note: null }
  ], estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null
} }
let services: DialogueService[] = [cut, smooth]
let professionals = [{ id: 'cin', name: 'Cin', aliases: ['Cintia'], priority: 0 }, { id: 'ana', name: 'Ana', aliases: [], priority: 1 }]
let agendaCalls = 0
const slots = (date: string) => professionals.map(p => ({ date, time: '17:00', startAt: date + 'T20:00:00Z', professionalId: p.id, professionalName: p.name, band: 'AFTERNOON' as const, occupiedMinutes: 0 }))
const port: DialoguePort = { catalog: async () => services,
  availability: async (_service, date, id) => { agendaCalls++; return { professionals, slots: slots(date).filter(slot => !id || id === slot.professionalId) } },
  availabilityBasket: async (selected, date, id, selections) => {
    agendaCalls++
    const fresh = selected.flatMap(item => services.filter(service => service.id === item.id))
    const guide = resolveGuidance(fresh, selections)
    if (guide.pending) return { ok: false, reason: 'GUIDANCE_REQUIRED', services: fresh }
    return { ok: true, services: fresh, durationMinutes: fresh.reduce((sum, item) => sum + item.durationMinutes!, 0), customerDurationMinutes: fresh.reduce((sum, item) => sum + item.durationMinutes!, 0), totalPrice: null, professionals, slots: slots(date).filter(slot => !id || id === slot.professionalId) }
  }
}
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const candidate = (...operations: TurnOperation[]) => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations } })
const initial = initialDialogueState(context.businessId)
const act = (kind: string, field: string, evidence: string, operationIndexes: number[], mention: string | null = null) => ({ kind, field, evidence, operationIndexes, mention, confidence: 1 })
// Only declared current controlled proposals receive speech-act authority. Legacy
// abstention and stale/malformed candidates below deliberately remain unchanged.
const currentActs: Record<string, object[]> = {
  'cinn': [act('answer', 'professional', 'cinn', [0], 'cinn')],
  'cinn 17:00': [act('answer', 'professional', 'cinn', [0], 'cinn'), act('request', 'time', '17:00', [1])],
  'Cintia': [act('answer', 'professional', 'Cintia', [0], 'Cintia')],
  'soy cinn': [act('change', 'name', 'soy cinn', [0])],
  'sí, 2026-10-04': [act('change', 'date', '2026-10-04', [0])],
  'Alisado mañana sin preferencia soy Matías': [act('request', 'service', 'Alisado', [0]), act('request', 'date', 'mañana', [1]), act('request', 'professional', 'sin preferencia', [2]), act('request', 'name', 'soy Matías', [3])]
}
const say = (state: unknown, message: string, ...operations: TurnOperation[]) => respondWithAiInterpreter(context, state, message, port, async () => ({ ...candidate(...operations), ...(currentActs[message] ? { communicativeActs: { version: 1, acts: currentActs[message] } } : {}) }))
const offered = await say(initial, 'Corte hombre mañana soy Matías',
  { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') },
  { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
const wrongRoleLegacy = await respondWithAiInterpreter(context, offered.state, 'cinn', port,
  async () => candidate({ kind: 'name', value: 'cinn', ...ev('cinn') }))
assert.equal(wrongRoleLegacy.state.customerName, 'Matías')
assert.equal(wrongRoleLegacy.state.professional, null)
assert.equal(wrongRoleLegacy.state.questionContext?.matchCandidateIds, undefined, 'a wrong legacy customer role is not current professional authority')
assert.match(wrongRoleLegacy.reply, /cliente o al profesional/)
const typo = await say(offered.state, 'cinn', { kind: 'professional', mode: 'specific', mention: 'cinn', ...ev('cinn') })
assert.equal(typo.state.customerName, 'Matías')
assert.equal(typo.state.professional, null)
assert.match(typo.reply, /¿Te referís a Cin\?/)
assert.deepEqual((typo.state.questionContext as any).matchCandidateIds, ['cin'])
assert.deepEqual(parseDialogueState(typo.state, context.businessId), typo.state)
const mixedTypo = await say(offered.state, 'cinn 17:00', { kind: 'professional', mode: 'specific', mention: 'cinn', ...ev('cinn') }, { kind: 'time', value: '17:00', ...ev('17:00') })
assert.equal(mixedTypo.state.customerName, 'Matías')
assert.equal(mixedTypo.state.requestedTime, '17:00')
assert.deepEqual(mixedTypo.state.questionContext?.matchCandidateIds, ['cin'], 'role-ambiguous literal span can retrieve a professional while independent time survives')
const confirmed = await say(typo.state, 'sí')
assert.deepEqual(confirmed.state.professional, { kind: 'specific', id: 'cin' }, 'affirmative confirmation resolves a stored candidate via fresh eligibility, never fabricated current-message name evidence')
assert.equal(confirmed.state.customerName, 'Matías')
assert.equal(confirmed.state.pending, 'time')
const canonical = await say(typo.state, 'Cin', { kind: 'professional', mode: 'specific', mention: 'Cin', ...ev('Cin') })
assert.deepEqual(canonical.state.professional, { kind: 'specific', id: 'cin' })
const alias = await say(offered.state, 'Cintia', { kind: 'professional', mode: 'specific', mention: 'Cintia', ...ev('Cintia') })
assert.deepEqual(alias.state.professional, { kind: 'specific', id: 'cin' }, 'exact alias is current port data, not a hardcoded name rewrite')
assert.equal(alias.state.customerName, 'Matías')
const fallbackTypo = await respond(context, offered.state, 'cinn', port)
assert.match(fallbackTypo.reply, /¿Te referís a Cin\?/)
assert.equal(fallbackTypo.state.professional, null)
assert.equal((await respond(context, fallbackTypo.state, 'sí', port)).state.professional?.kind, 'specific')

const semanticTypo = await say(initial, 'cortee hombre', { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('cortee hombre') })
assert.equal(semanticTypo.state.serviceId, 'cut', 'validated semantic IDs keep literal typo evidence; Fuse does not police AI vocabulary')
const semanticParaphrase = await say(initial, 'quiero cortarme el pelo', { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('cortarme el pelo') })
assert.equal(semanticParaphrase.state.serviceId, null, 'a paraphrase without public identity support asks for confirmation')
assert.equal(semanticParaphrase.interpretation.reason, null)
assert.match(semanticParaphrase.reply, /cortarme el pelo.*Corte hombre/)
const paraphraseConfirmed = await say(semanticParaphrase.state, 'sí', { kind: 'service_request', purpose: 'booking', disposition: 'clear', serviceIds: ['cut'], correction: false, continuation: true, basis: 'exact_public_name', sourceQuote: null, ...ev('sí') })
assert.equal(paraphraseConfirmed.state.serviceId, 'cut', 'explicit identity confirmation closes the useful semantic proposal')
services = [{ ...cut, aliases: [...cut.aliases, 'cortarme el pelo'] }, smooth]
const publishedParaphrase = await say(initial, 'quiero cortarme el pelo', { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('cortarme el pelo') })
assert.equal(publishedParaphrase.state.serviceId, 'cut', 'a current published alias resolves the same literal evidence directly')
services = [cut, smooth]
const serviceTypo = await say(initial, 'cortee hombre', { kind: 'service', mode: 'unresolved', serviceIds: [], correction: false, ...ev('cortee hombre') })
assert.equal(serviceTypo.state.serviceId, null, 'approximate service proposal must remain unselected')
assert.match(serviceTypo.reply, /Corte hombre/)
assert.deepEqual((serviceTypo.state.questionContext as any).matchCandidateIds, ['cut'])
const serviceConfirmed = await say(serviceTypo.state, 'sí')
assert.equal(serviceConfirmed.state.serviceId, 'cut')
assert.equal(serviceConfirmed.state.pending, 'date')
const serviceAlias = await respond(context, initial, 'recorte', port)
assert.equal(serviceAlias.state.serviceId, 'cut', 'exact aliases use injected current catalogue data')

const guide = await say(initial, 'Alisado mañana sin preferencia soy Matías',
  { kind: 'service', mode: 'single', serviceIds: ['smooth'], correction: false, ...ev('Alisado') },
  { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'professional', mode: 'any', ...ev('sin preferencia') }, { kind: 'name', value: 'Matías', ...ev('Matías') })
assert.equal(guide.state.pending, 'estimate')
const semanticEstimateTypo = await say(guide.state, 'hsata los hombros', { kind: 'estimate', serviceId: 'smooth', optionId: 'short', ...ev('hsata los hombros') })
assert.equal(semanticEstimateTypo.state.serviceEstimates?.smooth?.optionId, 'short', 'valid semantic estimate IDs retain original typo evidence')
const semanticEstimateParaphrase = await say(guide.state, 'medio largo', { kind: 'estimate', serviceId: 'smooth', optionId: 'short', ...ev('medio largo') })
assert.equal(semanticEstimateParaphrase.state.serviceEstimates?.smooth?.optionId, 'short', 'AI choice understanding is not replaced with literal vocabulary restrictions')
const estimateTypo = await say(guide.state, 'hsata los hombros')
assert.equal(estimateTypo.state.serviceEstimates?.smooth, undefined)
assert.match(estimateTypo.reply, /Hasta los hombros/)
assert.deepEqual((estimateTypo.state.questionContext as any).matchCandidateIds, ['short'])
const contradictedEstimate = await say(estimateTypo.state, 'sí pero no Hasta los hombros')
assert.equal(contradictedEstimate.state.serviceEstimates?.smooth, undefined, 'a contradictory prefix cannot select an estimate option through label containment')
assert.equal((expectedDialogueAnswer(estimateTypo.state) as any).matchConfigurationKey, undefined, 'internal configuration proof is not prompt metadata')
const estimateConfirmed = await say(estimateTypo.state, 'sí')
assert.equal(estimateConfirmed.state.serviceEstimates?.smooth?.optionId, 'short')
assert.equal(estimateConfirmed.state.customerName, 'Matías')
assert.equal(estimateConfirmed.state.pending, 'time')
const ungroundedModel = await say(guide.state, 'hsata los hombros', { kind: 'estimate', serviceId: 'smooth', optionId: 'short', ...ev('hasta los hombros') })
assert.equal(ungroundedModel.interpretation.reason, 'invalid_output', 'literal evidence checks remain strict')
assert.equal(ungroundedModel.state.serviceEstimates?.smooth, undefined)
assert.match(ungroundedModel.reply, /Hasta los hombros/)
const noMatch = await say(guide.state, 'zzzzzz')
assert.equal(noMatch.state.pending, 'estimate')
assert.equal(noMatch.state.serviceEstimates?.smooth, undefined)
assert.match(noMatch.reply, /Qué largo|opción|Hasta los hombros/)
assert.doesNotMatch(noMatch.reply, /Qué servicio necesitás/)

const changedDate = await say(typo.state, 'sí, 2026-10-04', { kind: 'date', expression: '2026-10-04', value: '2026-10-04', ...ev('2026-10-04') })
assert.equal(changedDate.state.date, '2026-10-04')
assert.equal(changedDate.state.professional, null, 'dependent scope change expires prior candidate rather than treating it as an authoritative choice')
assert.equal(changedDate.state.customerName, 'Matías')
const withTime = await say(typo.state, 'sí, 17:00', { kind: 'time', value: '17:00', ...ev('17:00') })
assert.deepEqual(withTime.state.professional, { kind: 'specific', id: 'cin' })
assert.equal(withTime.state.requestedTime, '17:00', 'confirmation keeps independent current-message entities')

const contradicted = await say(typo.state, 'sí pero no Cin')
assert.equal(contradicted.state.professional, null, 'an affirmative prefix with contradictory free text does not confirm a candidate')
const beforeSocial = agendaCalls
await say(typo.state, 'hola')
assert.equal(agendaCalls, beforeSocial, 'candidate context never preloads availability for social turns')
const preservedCandidate = await say(typo.state, 'hola')
assert.deepEqual((preservedCandidate.state.questionContext as any).matchCandidateIds, ['cin'], 'a social turn does not consume or replace a candidate confirmation')
const customer = await say(offered.state, 'soy cinn', { kind: 'name', value: 'cinn', ...ev('cinn') })
assert.equal(customer.state.customerName, 'cinn', 'customer identities are never corrected by Fuse')
assert.equal(customer.state.professional, null)
const savedServices = services
services = [...services, { ...cut, id: 'name-collision', name: 'Matías', aliases: [] }]
const initialCustomer = await say(initial, 'Matías', { kind: 'name', value: 'Matías', ...ev('Matías') })
assert.equal(initialCustomer.state.customerName, 'Matías')
assert.equal(initialCustomer.state.serviceId, null, 'a grounded initial customer identity is not recycled as catalog matching evidence')
services = savedServices
const savedProfessionals = professionals
professionals = [{ id: 'm1', name: 'Manola', aliases: [], priority: 0 }, { id: 'm2', name: 'Ramiro Díaz', aliases: [], priority: 1 }, { id: 'm3', name: 'Ramiro López', aliases: [], priority: 2 }]
const collisionState = (await say(initial, 'Corte hombre mañana', { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('Corte hombre') }, { kind: 'date', expression: 'mañana', ...ev('mañana') })).state
const dateOnly = await say(collisionState, 'mañana', { kind: 'date', expression: 'mañana', ...ev('mañana') })
assert.equal(dateOnly.state.professional, null)
assert.equal(dateOnly.state.questionContext?.matchCandidateIds, undefined, 'recognized date evidence is not recycled as fuzzy professional evidence')
const rawDateOnly = await respond(context, collisionState, 'mañana', port)
assert.equal(rawDateOnly.state.questionContext?.matchCandidateIds, undefined, 'raw fallback date parsing likewise avoids mañana/Manola collision')
const timeOnly = await say(collisionState, '17:00', { kind: 'time', value: '17:00', ...ev('17:00') })
assert.equal(timeOnly.state.questionContext?.matchCandidateIds, undefined)
const infoBefore = agendaCalls
const infoOnly = await say(collisionState, 'servicios', { kind: 'information', target: { kind: 'business', actions: ['SERVICES'] }, ...ev('servicios') })
assert.equal(agendaCalls, infoBefore)
assert.equal(infoOnly.state.questionContext?.matchCandidateIds, undefined)
const multiple = await say(collisionState, 'ramiro')
assert.deepEqual(multiple.state.questionContext?.matchCandidateIds, ['m2','m3'])
const multipleYes = await say(multiple.state, 'sí')
assert.equal(multipleYes.state.professional, null, 'yes cannot choose arbitrarily among close candidates')
assert.match(multipleYes.reply, /Ramiro Díaz.*Ramiro López/)
professionals = savedProfessionals
const partial = await say(initial, 'cortee hombre y Alisado mañana',
  { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [
    { mode: 'unresolved', serviceIds: [], ...ev('cortee hombre') }, { mode: 'single', serviceIds: ['smooth'], ...ev('Alisado') }
  ], ...ev('cortee hombre y Alisado') }, { kind: 'date', expression: 'mañana', ...ev('mañana') })
assert.equal(partial.state.basket?.members[1]?.serviceIds[0], 'smooth')
assert.equal(partial.state.date, '2026-10-03')
assert.ok(partial.state.questionContext?.matchTargetMemberId)
const partialYes = await say(partial.state, 'sí')
assert.deepEqual(partialYes.state.basket?.members.flatMap(member => member.serviceIds), ['cut','smooth'], 'confirmation replaces only the unresolved member and keeps its exact companion')
assert.equal(partialYes.state.pending, 'estimate')
const scope = { businessId: context.businessId, category: 'service' as const }
const scoped = matchContextualItems(scope, 'cortee hombre', [
  { ...scope, id: 'cut', label: 'Corte hombre' }, { ...scope, businessId: 'foreign', id: 'other', label: 'cortee hombre' },
  { ...scope, category: 'professional', id: 'person', label: 'cortee hombre' }
])
assert.deepEqual(scoped.items.map(item => item.id), ['cut'])
assert.equal(scoped.kind, 'candidates')
assert.throws(() => matchContextualItems(scope, 'cut', [{ ...scope, id: 'cut', label: 'Cut', aliases: ['bad\u0000alias'] }]))
assert.throws(() => matchContextualItems(scope, 'cut', [{ ...scope, id: 'cut', label: 'Cut' }, { ...scope, id: 'cut', label: 'Duplicate' }]))
assert.equal(affirmativeMatchAnswer('sí pero no Cin'), false)
assert.equal(affirmativeMatchAnswer('sí, 17:00', ['17:00']), true)
const unsafe = structuredClone(typo.state)
unsafe.questionContext!.matchCandidateIds = ['foreign']
assert.throws(() => parseDialogueState(unsafe, context.businessId))
const boundedState = structuredClone(offered.state)
rememberDialogueQuestion(boundedState, '¿Cuál elegís?', Array.from({ length: 51 }, (_, index) => ({ id: 'p' + index, label: 'Person ' + index })), null, { candidateIds: ['p0'] })
assert.equal(boundedState.questionContext?.complete, false)
assert.equal(boundedState.questionContext?.matchCandidateIds, undefined, 'over-budget metadata cannot retain a confirmable candidate')
assert.deepEqual(parseDialogueState(boundedState, context.businessId), boundedState)
professionals = [{ id: 'ana', name: 'Ana', aliases: [], priority: 1 }]
const unavailable = await say(typo.state, 'sí')
assert.equal(unavailable.state.professional, null, 'a removed professional cannot be selected from old candidate metadata')
assert.equal(unavailable.proposal, null)
professionals = [{ id: 'cin', name: 'Cin', aliases: ['Cintia'], priority: 0 }, { id: 'ana', name: 'Ana', aliases: [], priority: 1 }]
services = [cut, { ...smooth, bookingPolicy: { ...smooth.bookingPolicy!, estimateOptions: [{ id: 'new', label: 'Otra variante', priceMin: 500, priceMax: 600, note: null }] } }]
const staleChoice = await say(estimateTypo.state, 'sí')
assert.equal(staleChoice.state.serviceEstimates?.smooth, undefined, 'changed configuration invalidates old approximate-choice confirmation')
assert.equal(staleChoice.state.pending, 'estimate')
assert.match(staleChoice.reply, /Otra variante/)
console.log('PASS contextual matching integration: candidate-only typos, explicit fresh confirmation, aliases-as-data, roles, independent updates and stale scope')