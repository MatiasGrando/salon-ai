import { pendingQuestion } from '../src/conversational-bot/information.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, parseDialogueState, respond, hasActiveBooking, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { basketServiceIds, selectionBasket } from '../src/conversational-bot/service-basket.js'

const originalFetch = globalThis.fetch, originalHttp = http.request, originalHttps = https.request, originalHttpGet = http.get, originalHttpsGet = https.get
const blocked = () => { throw new Error('external transport forbidden in information regression') }
globalThis.fetch = blocked
http.request = blocked as typeof http.request
https.request = blocked as typeof https.request
http.get = blocked as typeof http.get
https.get = blocked as typeof https.get
try {
  const context = { businessId: 'information-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z'), sandboxBooking: true }
  const services: DialogueService[] = [
    { id: 'cut', name: 'Corte hombre', price: 27000, durationMinutes: 30, requiresConsultation: false },
    { id: 'woman', name: 'Corte mujer', price: 37000, durationMinutes: 30, requiresConsultation: false },
    { id: 'cut-beard', name: 'Corte y barba', price: 32000, durationMinutes: 45, requiresConsultation: false },
    { id: 'cream', name: 'Baño de crema', description: 'Tratamiento hidratante con lavado.', price: 25000, priceMode: 'STARTING_AT', durationMinutes: 30, requiresConsultation: false, bookingPolicy: {
      id: 'cream', name: 'Baño de crema', attentionMode: 'GUIDED_ESTIMATE', price: 25000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
      estimateQuestion: '¿Qué producto elegís?', estimateOptions: [
        { id: 'k', label: 'Karsell', priceMin: 25000, priceMax: null, note: 'Opción hidratante configurada.' },
        { id: 's', label: 'Schwarzkopf', priceMin: 40000, priceMax: null, note: null }
      ], estimateExplanation: 'Elegí un producto.', estimateDisclaimer: 'Precio estimado.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null
    } }
  ]
  const facts = { businessId: context.businessId, name: 'Demo', address: 'Calle 123', area: 'Centro', mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: 'Local de servicios.', hours: 'Martes a sábado: 11:00 a 20:00' }
  let agendaCalls = 0
  const port: DialoguePort = { catalog: async () => services, information: async () => facts,
    availability: async () => { agendaCalls++; return { professionals: [], slots: [] } },
    availabilityBasket: async () => { agendaCalls++; return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' } } }
  const legacy = { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null }
  const ev = (evidence: string) => ({ evidence, confidence: 1 })
  const say = (state: DialogueState, message: string, operations: object[] = []) => respondWithAiInterpreter(context, state, message, port,
    async () => ({ ...legacy, turnPlan: { version: 1, operations } }))
  const info = (evidence: string, target: object) => ({ kind: 'information', target, ...ev(evidence) })
  const business = (actions: string[]) => ({ kind: 'business', actions })
  const service = (serviceIds: string[], aspect = 'overview') => ({ kind: 'service', actions: [], serviceIds, aspect })
  const initial = initialDialogueState(context.businessId)
  const price = await say(initial, 'Hola, mi nombre es Jessica, quería saber el precio de corte de pelo', [
    { kind: 'name', value: 'Jessica', ...ev('Jessica') },
    info('precio de corte de pelo', business(['PRICES']))
  ])
  assert.equal(price.state.customerName, 'Jessica')
  assert.equal(hasActiveBooking(price.state), false, 'identity and information alone do not start a booking')
  assert.equal(price.state.serviceId, null)
  assert.equal(price.state.basket, undefined)
  assert.match(price.reply, /querés saber el precio/)
  assert.match(price.reply, /Corte hombre/)
  assert.match(price.reply, /Corte mujer/)
  assert.match(price.reply, /Corte y barba/)
  assert.doesNotMatch(price.reply, /Qué servicio necesitás|Para qué día|Qué opción del presupuesto/)
  assert.equal(price.state.informationFocus?.topic, 'price')
  assert.equal(price.state.informationFocus?.awaitingChoice, true)

  const namelessPrice = await say(initial, '¿Precio de corte?', [info('Precio de corte', business(['PRICES']))])
  const wronglyNamedChoice = await say(namelessPrice.state, 'hombre', [{ kind: 'name', value: 'hombre', ...ev('hombre') }])
  assert.equal(wronglyNamedChoice.state.customerName, null, 'a price-choice token cannot become customer identity')
  assert.equal(wronglyNamedChoice.state.serviceId, null)
  assert.match(wronglyNamedChoice.reply, /Corte hombre:[\s\S]*27[.,]?000/)

  const selected = await say(price.state, 'hombre')
  assert.match(selected.reply, /Corte hombre:[\s\S]*27[.,]?000/)
  assert.doesNotMatch(selected.reply, /Corte mujer|Corte y barba/)
  assert.equal(selected.state.serviceId, null)
  assert.equal(selected.state.informationFocus?.serviceId, 'cut')
  assert.equal(selected.bookingCommand, undefined)
  const fallback = await respondWithAiInterpreter(context, price.state, 'corte hombre', port, async () => { throw new Error('fake failure') })
  assert.match(fallback.reply, /Corte hombre:[\s\S]*27[.,]?000/)
  assert.equal(fallback.interpretation.mode, 'fallback')
  assert.equal(fallback.state.basket, undefined)
  const typo = await say(price.state, 'cortee hombre')
  assert.equal(typo.state.informationFocus?.candidateId, 'cut')
  assert.match(typo.reply, /Te referís a Corte hombre/)
  assert.equal(typo.state.informationFocus?.serviceId, null)
  const yes = await say(typo.state, 'sí')
  assert.equal(yes.state.informationFocus?.serviceId, 'cut')
  assert.equal(yes.bookingCommand, undefined)

  const detail = await say(initial, '¿Me podés dar más info sobre baño de crema?', [info('info sobre baño de crema', service(['cream']))])
  assert.equal(detail.interpretation.mode, 'ai')
  assert.match(detail.reply, /Tratamiento hidratante/)
  assert.match(detail.reply, /30 min/)
  assert.match(detail.reply, /Karsell/)
  assert.match(detail.reply, /Schwarzkopf/)
  assert.match(detail.reply, /Desde|desde/)
  assert.doesNotMatch(detail.reply, /Corte hombre|Qué producto elegís|Para qué día/)
  const duration = await say(detail.state, '¿Cuánto dura?')
  assert.match(duration.reply, /Baño de crema:[\s\S]*30 min/)
  assert.doesNotMatch(duration.reply, /Corte mujer/)
  const products = await say(duration.state, '¿Qué producto usan?')
  assert.match(products.reply, /Karsell/)
  assert.match(products.reply, /Schwarzkopf/)
  const difference = await say(products.state, '¿Qué diferencia hay entre Karsell y Schwarzkopf?')
  assert.match(difference.reply, /25[.,]?000/)
  assert.match(difference.reply, /40[.,]?000/)
  assert.doesNotMatch(difference.reply, /mejor que|recomiendo|15%/)
  const discount = await say(difference.state, '¿Tiene descuento?')
  assert.match(discount.reply, /información.*cargada|descuento.*cargad/)
  assert.doesNotMatch(discount.reply, /15%|Qué opción del presupuesto/)
  assert.equal(discount.state.informationFocus?.serviceId, 'cream')
  const cash = await say(discount.state, '¿Cuánto sale con efectivo?')
  assert.match(cash.reply, /cargad/)
  assert.doesNotMatch(cash.reply, /21[.,]?250|15%/)
  const social = await say(detail.state, '¿Tienen Facebook?', [info('Facebook', business(['BUSINESS_INFO']))])
  assert.match(social.reply, /cargad|publicad/i)
  assert.doesNotMatch(social.reply, /presupuesto|producto elegís|servicio necesitás/)
  const generalSocial = await respond(context, initial, '¿Cuáles son las redes que tienen?', port)
  assert.match(generalSocial.reply, /redes|información cargada/)
  assert.doesNotMatch(generalSocial.reply, /Local de servicios/)
  const hours = await say(detail.state, '¿Cuáles son los horarios del local?', [info('horarios del local', business(['HOURS']))])
  assert.match(hours.reply, /11:00 a 20:00/)
  assert.doesNotMatch(hours.reply, /presupuesto|servicio necesitás/)
  const beforeBooking = await say(detail.state, 'quiero reservar corte hombre', [
    { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, ...ev('corte hombre') }
  ])
  assert.equal(beforeBooking.state.serviceId, 'cut', 'an explicit booking transition still works')

  const active = { ...initial, basket: { version: 1 as const, nextMemberId: 3, members: [
    { memberId: 'm1', mode: 'alternatives' as const, serviceIds: ['cut', 'woman'], evidence: 'corte' },
    { memberId: 'm2', mode: 'single' as const, serviceIds: ['cream'], evidence: 'baño de crema' }
  ] }, customerName: 'Matías', date: '2026-10-03', professionalNameHint: 'cin', timePreference: { kind: 'after' as const, time: '13:00' } }
  const sidePrice = await say(active, '¿Precio corte?', [info('Precio corte', business(['PRICES']))])
  const sideChoice = await respondWithAiInterpreter(context, sidePrice.state, 'hombre', port, async () => { throw new Error('fake failure') })
  assert.deepEqual(selectionBasket(sideChoice.state), selectionBasket(active), 'price choice must not resolve the pending booking basket')
  assert.equal(sideChoice.state.customerName, active.customerName)
  assert.equal(sideChoice.state.date, active.date)
  assert.deepEqual(sideChoice.state.timePreference, active.timePreference)
  assert.equal(sideChoice.state.professionalNameHint, 'cin')
  const missing = await say(sideChoice.state, '¿Tienen Facebook?', [info('Facebook', business(['BUSINESS_INFO']))])
  assert.deepEqual(selectionBasket(missing.state), selectionBasket(active))
  assert.doesNotMatch(missing.reply, /presupuesto/)
  assert.equal(missing.reply.endsWith(pendingQuestion(active)), true, 'missing lateral information resumes the unchanged pending draft')
  assert.equal(agendaCalls, 0, 'informational reads never query availability')

  assert.deepEqual(parseDialogueState(initial, context.businessId), initial)
  assert.deepEqual(parseDialogueState(detail.state, context.businessId), detail.state)
  const foreign = structuredClone(detail.state)
  foreign.informationFocus!.businessId = 'foreign'
  assert.throws(() => parseDialogueState(foreign, context.businessId), /information/)
  const malformed = structuredClone(detail.state)
  malformed.informationFocus!.options.push(...Array.from({ length: 11 }, (_, i) => ({ id: 'x' + i, label: 'X' })))
  assert.throws(() => parseDialogueState(malformed, context.businessId), /information/)
  const removedPort = { ...port, catalog: async () => services.filter(item => item.id !== 'cream') }
  const removed = await respondWithAiInterpreter(context, detail.state, '¿Cuánto dura?', removedPort, async () => ({ ...legacy, turnPlan: { version: 1, operations: [] } }))
  assert.doesNotMatch(removed.reply, /30 min/)
  assert.match(removed.reply, /cargad|disponible|identificar/)


  const professionalTarget = { kind: 'professional', actions: [], mention: 'Ana', serviceIds: ['cut'], date: null, weekday: 6, aspect: 'schedule' }
  let professionalReads = 0
  const professionalPort: DialoguePort = { ...port, professionalInformation: async target => {
    professionalReads++
    assert.equal(target.weekday, 6)
    assert.equal(target.mention, 'Ana')
    return { businessId: context.businessId, complete: false, professionals: [{ id: 'ana', name: 'Ana', services: [{ id: 'cut', name: 'Corte hombre' }], schedule: null }] }
  } }
  const unknownSchedule = await respondWithAiInterpreter(context, active, '¿Ana trabaja los sábados?', professionalPort,
    async () => ({ ...legacy, turnPlan: { version: 1, operations: [info('Ana trabaja los sábados', professionalTarget)] } }))
  assert.match(unknownSchedule.reply, /horario|jornada/i)
  assert.doesNotMatch(unknownSchedule.reply, /demasiadas coincidencias|presupuesto|horarios disponibles/i)
  assert.deepEqual(selectionBasket(unknownSchedule.state), selectionBasket(active))
  assert.equal(professionalReads, 1)
  const knownProfessionalPort: DialoguePort = { ...port, professionalInformation: async () => ({
    businessId: context.businessId, complete: true, professionals: [{ id: 'ana', name: 'Ana', description: 'Profesional configurada.', services: [{ id: 'cut', name: 'Corte hombre' }], schedule: 'Sábado: 10:00 a 14:00. Jornada habitual, no turnos libres.' }]
  }) }
  const knownSchedule = await respondWithAiInterpreter(context, initial, '¿Ana trabaja los sábados?', knownProfessionalPort,
    async () => ({ ...legacy, turnPlan: { version: 1, operations: [info('Ana trabaja los sábados', professionalTarget)] } }))
  assert.match(knownSchedule.reply, /Sábado: 10:00 a 14:00/)
  assert.match(knownSchedule.reply, /no turnos libres/)
  assert.equal(knownSchedule.state.professional, null)
  assert.equal(knownSchedule.state.date, null)
  const loadedPayment = await respond(context, initial, '¿Qué medios de pago tienen?', { ...port, information: async () => ({ ...facts, paymentMethods: 'Efectivo, Tarjeta' }) })
  assert.match(loadedPayment.reply, /Efectivo, Tarjeta/)
  assert.doesNotMatch(loadedPayment.reply, /15%|presupuesto|Qué servicio necesitás/)
  const newService = await say(detail.state, '¿Precio corte hombre?', [info('Precio corte hombre', business(['PRICES']))])
  assert.match(newService.reply, /Corte hombre:[\s\S]*27[.,]?000/)
  assert.doesNotMatch(newService.reply, /Karsell/)
  assert.equal(newService.state.informationFocus?.serviceId, 'cut')
  const malformedCatalog = { ...port, catalog: async () => [{ ...services[0]!, price: -10 }] }
  await assert.rejects(() => respond(context, initial, '¿Qué servicios tienen?', malformedCatalog), /catalog/)

  let request: Record<string, any> | undefined
  const provider = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
    request = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...legacy, turnPlan: { version: 1, operations: [info('Cuánto dura', service(['cream'], 'duration'))] } }) }] }] }), { status: 200 })
  } })
  await provider({ message: 'Cuánto dura', state: detail.state, services }, new AbortController().signal)
  assert.equal(JSON.parse(request!.input).informationFocus.serviceId, 'cream')
  assert.match(request!.instructions, /informativ|precio/)
  assert.equal(request!.store, false)
  assert.equal(basketServiceIds(detail.state).length, 0)

  const creamPrice = await say(initial, '¿Precio de baño de crema?', [info('Precio de baño de crema', service(['cream'], 'price'))])
  const beforeInformativeAgenda = agendaCalls
  const informativeTarget = { ...service(['cream'], 'price'), estimateOptionId: 's' }
  const informative = await say(creamPrice.state, 'mi pelo es largo, Schwarzkopf', [info('Schwarzkopf', informativeTarget)])
  assert.equal(informative.interpretation.reason, null)
  assert.match(informative.reply, /40[.,]?000/)
  assert.doesNotMatch(informative.reply, /25[.,]?000|Qué servicio necesitás/)
  assert.match(informative.reply, /agendar/)
  assert.equal(informative.state.serviceId, null)
  assert.equal(informative.state.basket, undefined)
  assert.equal(informative.state.serviceEstimates, undefined)
  assert.equal(informative.proposal, null)
  assert.equal(informative.bookingCommand, undefined)
  assert.equal(agendaCalls, beforeInformativeAgenda)
  const legacyInformative = await say(creamPrice.state, 'perfecto, me interesa Schwarzkopf', [
    { kind: 'estimate', serviceId: 'cream', optionId: 's', ...ev('Schwarzkopf') }
  ])
  assert.equal(legacyInformative.interpretation.reason, null, 'legacy estimate over a current information focus is a read, not a booking')
  assert.match(legacyInformative.reply, /40[.,]?000/)
  assert.equal(legacyInformative.state.serviceId, null)
  assert.equal(legacyInformative.state.serviceEstimates, undefined)
  assert.equal(agendaCalls, beforeInformativeAgenda)
  for (const operation of [
    { kind: 'estimate', serviceId: 'cream', optionId: 'foreign', ...ev('Schwarzkopf') },
    { kind: 'estimate', serviceId: 'foreign', optionId: 's', ...ev('Schwarzkopf') },
    { kind: 'estimate', serviceId: 'cream', optionId: 's', ...ev('not in this message') }
  ]) {
    const failed = await say(creamPrice.state, 'Schwarzkopf', [operation])
    assert.equal(failed.interpretation.reason, 'invalid_output')
    assert.equal(failed.state.serviceId, null)
    assert.equal(failed.state.serviceEstimates, undefined)
    assert.equal(failed.state.informationFocus?.serviceId, 'cream')
    assert.match(failed.reply, /Baño de crema|producto|presupuesto/)
    assert.doesNotMatch(failed.reply, /Qué servicio necesitás/)
  }
  const lateralEstimate = await say({ ...active, informationFocus: creamPrice.state.informationFocus }, 'Schwarzkopf', [info('Schwarzkopf', informativeTarget)])
  assert.deepEqual(selectionBasket(lateralEstimate.state), selectionBasket(active))
  assert.equal(lateralEstimate.state.date, active.date)
  assert.equal(lateralEstimate.state.customerName, active.customerName)
  assert.deepEqual(lateralEstimate.state.professional, active.professional)
  assert.equal(lateralEstimate.state.slot?.startAt, active.slot?.startAt)
  assert.equal(lateralEstimate.proposal, null)
  assert.equal(lateralEstimate.bookingCommand, undefined)
  assert.equal(agendaCalls, beforeInformativeAgenda)

  const acceptedInvitation = await say(informative.state, 'sí', [])
  assert.equal(acceptedInvitation.state.serviceId, 'cream', 'explicit answer to a fresh published-service invitation may start acquisition')
  assert.equal(acceptedInvitation.state.serviceEstimates?.cream, undefined, 'an informative option is not inherited as booking consent or selection')
  assert.equal(acceptedInvitation.state.pending, 'estimate')
  assert.equal(acceptedInvitation.proposal, null)
  assert.equal(acceptedInvitation.bookingCommand, undefined)
  for (const message of ['no', 'sí, si el precio cambia']) {
    const notAccepted = await say(informative.state, message, [])
    assert.equal(notAccepted.state.serviceId, null)
    assert.equal(notAccepted.bookingCommand, undefined)
  }
  const creamService = services.find(service => service.id === 'cream')!, previousName = creamService.name
  try {
    creamService.name = 'Tratamiento renombrado'
    const staleInvitation = await say(informative.state, 'sí', [])
    assert.equal(staleInvitation.state.serviceId, null, 'a stored invitation cannot select a renamed public identity')
    assert.equal(staleInvitation.proposal, null)
  } finally { creamService.name = previousName }
  const informativeWithData = await say(creamPrice.state, 'Schwarzkopf mañana soy Laura', [info('Schwarzkopf', informativeTarget),
    { kind: 'date', expression: 'mañana', ...ev('mañana') }, { kind: 'name', value: 'Laura', ...ev('Laura') }])
  assert.equal(informativeWithData.state.date, '2026-10-03')
  assert.equal(informativeWithData.state.customerName, 'Laura')
  assert.equal(informativeWithData.state.serviceId, null)
  assert.equal(informativeWithData.proposal, null)
  assert.equal(informativeWithData.bookingCommand, undefined)
  assert.equal(agendaCalls, beforeInformativeAgenda)


  for (const target of [
    { ...informativeTarget, estimateOptionId: 'foreign' },
    { ...informativeTarget, estimateOptionId: null },
    { ...informativeTarget, serviceIds: ['cream', 'cut'] },
    { ...informativeTarget, priceMin: 1 }
  ]) {
    const rejected = await say(creamPrice.state, 'Schwarzkopf', [info('Schwarzkopf', target)])
    assert.equal(rejected.interpretation.reason, 'invalid_output')
    assert.equal(rejected.state.serviceId, null)
    assert.equal(rejected.state.serviceEstimates, undefined)
    assert.equal(rejected.proposal, null)
    assert.equal(rejected.bookingCommand, undefined)
    assert.doesNotMatch(rejected.reply, /Qué servicio necesitás/)
  }
  for (const option of [null, 's']) {
    const uncertainChoice = await say(creamPrice.state, 'Schwarzkopf', [{ kind: 'estimate', serviceId: 'cream', optionId: option, evidence: 'Schwarzkopf', confidence: .5 }])
    assert.equal(uncertainChoice.interpretation.reason, 'invalid_output')
    assert.equal(uncertainChoice.state.serviceId, null)
    assert.equal(uncertainChoice.state.serviceEstimates, undefined)
  }
  const originalOptions = creamService.bookingPolicy!.estimateOptions
  try {
    creamService.bookingPolicy!.estimateOptions = originalOptions!.filter(option => option.id !== 's')
    const removedOption = await say(creamPrice.state, 'Schwarzkopf', [info('Schwarzkopf', informativeTarget)])
    assert.equal(removedOption.interpretation.reason, 'invalid_output')
    assert.doesNotMatch(removedOption.reply, /40[.,]?000|Qué servicio necesitás/)
    assert.equal(removedOption.state.serviceId, null)
    creamService.bookingPolicy!.estimateOptions = originalOptions!.map(option => option.id === 's' ? { ...option, priceMin: 45000 } : option)
    const freshPrice = await say(creamPrice.state, 'Schwarzkopf', [info('Schwarzkopf', informativeTarget)])
    assert.match(freshPrice.reply, /45[.,]?000/)
    assert.doesNotMatch(freshPrice.reply, /40[.,]?000/)
    assert.equal(freshPrice.state.serviceId, null)
  } finally { creamService.bookingPolicy!.estimateOptions = originalOptions }
  assert.equal(agendaCalls, beforeInformativeAgenda)
  for (const [label, result] of [['price', creamPrice], ['overview', detail], ['duration', duration]] as const) {
    assert.match(result.reply, /¿Querés agendar Baño de crema\?/, label + ' needs a non-mutating contextual next step')
    assert.equal((result.reply.match(/¿Querés agendar/g) ?? []).length, 1)
    assert.equal(result.state.serviceId, null)
    assert.equal(result.bookingCommand, undefined)
  }
  assert.match(discount.reply, /¿En qué más te puedo ayudar\?/, 'missing discount facts offer further help rather than invented booking facts')
  const addressCTA = await say(initial, '¿Dónde están?', [info('Dónde están', business(['ADDRESS']))])
  assert.match(addressCTA.reply, /Calle 123/)
  assert.match(addressCTA.reply, /¿En qué más te puedo ayudar\?/)
  assert.equal(addressCTA.state.serviceId, null)
  const genericCTA = await say(initial, '¿Qué información tienen del local?', [info('información tienen del local', business(['BUSINESS_INFO']))])
  assert.match(genericCTA.reply, /¿En qué más te puedo ayudar\?/)
  const activeCTA = await say(active, '¿Precio de baño de crema?', [info('Precio de baño de crema', service(['cream'], 'price'))])
  assert.equal(activeCTA.reply.endsWith(pendingQuestion(active)), true, 'retained draft owns the pending clarification')
  assert.doesNotMatch(activeCTA.reply, /¿Querés agendar Baño de crema/)
  assert.deepEqual(selectionBasket(activeCTA.state), selectionBasket(active))
  assert.doesNotMatch(price.reply, /¿Querés agendar/, 'ambiguous services clarify before inviting one arbitrarily')
  let firstCallNextFacts: readonly { id: string; text: string }[] = []
  const oneCallCTA = await respondWithAiInterpreter(context, initial, '¿Precio de baño de crema?', port, async input => {
    firstCallNextFacts = input.firstReplyFacts ?? []
    return { ...legacy, turnPlan: { version: 1, operations: [info('Precio de baño de crema', service(['cream'], 'price'))] },
      firstReply: { salutation: null, opening: null, closing: null, factIds: firstCallNextFacts.map(fact => fact.id) } }
  })
  assert.match(oneCallCTA.reply, /¿Querés agendar Baño de crema\?/)
  assert.equal(firstCallNextFacts.at(-1)?.id, 'next')
  assert.equal(oneCallCTA.interpretation.aiCalls, 1)
  assert.equal(oneCallCTA.interpretation.replyValidation?.firstCall.status, 'not_attempted')
  assert.equal(oneCallCTA.interpretation.replyValidation?.firstCall.reason, 'canonical_only', 'published identity choices preserve their canonical guard')
  const oneCallGeneral = await respondWithAiInterpreter(context, initial, '¿Dónde están?', port, async input => ({ ...legacy,
    turnPlan: { version: 1, operations: [info('Dónde están', business(['ADDRESS']))] },
    firstReply: { salutation: null, opening: 'Claro, te cuento.', closing: null, factIds: (input.firstReplyFacts ?? []).map(fact => fact.id) }
  }))
  assert.equal(oneCallGeneral.interpretation.aiCalls, 1)
  assert.equal(oneCallGeneral.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.match(oneCallGeneral.reply, /Claro, te cuento/)
  assert.match(oneCallGeneral.reply, /¿En qué más te puedo ayudar\?/)
  assert.equal(oneCallGeneral.state.serviceId, null)
  assert.equal(agendaCalls, beforeInformativeAgenda)
  console.log('information focus, price continuity, loaded service facts and missing-data regression: PASS')
} finally {
  globalThis.fetch = originalFetch
  http.request = originalHttp
  https.request = originalHttps
  http.get = originalHttpGet
  https.get = originalHttpsGet
}
