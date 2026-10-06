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

  // A grounded, specific information target must not become a generic menu again.
  // These controlled proposals test the reader, not live model understanding.
  const variantMessage = 'corte de mujer'
  let variantProviderCalls = 0
  const variantAgendaBefore = agendaCalls
  const variantRead = (state: DialogueState, message: string, serviceId = 'woman', dialoguePort = port, identity: string | null = message) =>
    respondWithAiInterpreter(context, state, message, dialoguePort, async () => {
      variantProviderCalls++
      return { ...legacy, turnPlan: { version: 1, operations: [info(message, service([serviceId], 'price'))] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message,
          confidence: 1, mention: identity, operationIndexes: [0] }] } }
    })
  const originalUnscopedVariant = await variantRead(namelessPrice.state, variantMessage, 'woman', port, null)
  assert.deepEqual(originalUnscopedVariant.state.informationFocus, namelessPrice.state.informationFocus)
  assert.deepEqual(selectionBasket(originalUnscopedVariant.state), selectionBasket(namelessPrice.state))
  assert.doesNotMatch(originalUnscopedVariant.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
  const variant = await variantRead(namelessPrice.state, variantMessage)
  assert.equal(variant.state.informationFocus?.serviceId, 'woman', 'retain the grounded specific information target')
  assert.equal(variant.state.informationFocus?.awaitingChoice, false)
  assert.match(variant.reply, /Corte mujer:[\s\S]*37[.,]?000/)
  assert.doesNotMatch(variant.reply, /Corte hombre|Corte y barba/)
  assert.deepEqual(selectionBasket(variant.state), selectionBasket(namelessPrice.state))
  assert.equal(variant.state.serviceId, namelessPrice.state.serviceId)
  assert.equal(variant.proposal, null)
  assert.equal(variant.bookingCommand, undefined)
  assert.equal(variantProviderCalls, 2)
  assert.equal(variant.interpretation.aiCalls, 1)
  assert.equal(agendaCalls, variantAgendaBefore)
  for (const [message, targetId] of [
    ['corte', 'woman'],
    ['corte de mujer sin lavado', 'woman'],
    ['no corte de mujer', 'woman'],
    ['corte de mujer', 'cut']
  ]) {
    const unresolved = await variantRead(namelessPrice.state, message!, targetId!)
    assert.equal(unresolved.state.informationFocus?.serviceId, null, 'an ID cannot hide ambiguous, qualified or contradictory evidence')
    assert.equal(unresolved.state.informationFocus?.awaitingChoice, true)
    assert.deepEqual(selectionBasket(unresolved.state), selectionBasket(namelessPrice.state))
    assert.equal(unresolved.state.serviceId, null)
    assert.equal(unresolved.proposal, null)
    assert.equal(unresolved.bookingCommand, undefined)
  }
  const foreignVariant = await variantRead(namelessPrice.state, variantMessage, 'foreign')
  assert.equal(foreignVariant.interpretation.reason, 'invalid_output')
  assert.equal(foreignVariant.state.serviceId, null)
  assert.equal(foreignVariant.proposal, null)
  const currentWoman = services.find(item => item.id === 'woman')!, currentWomanName = currentWoman.name
  try {
    currentWoman.name = 'Identidad publicada nueva'
    const staleVariant = await variantRead(namelessPrice.state, variantMessage)
    assert.notEqual(staleVariant.state.informationFocus?.serviceId, 'woman', 'the old option cannot identify a renamed catalog entry')
    assert.doesNotMatch(staleVariant.reply, /37[.,]?000/)
  } finally { currentWoman.name = currentWomanName }
  const removedVariant = await variantRead(namelessPrice.state, variantMessage, 'woman', {
    ...port, catalog: async () => services.filter(item => item.id !== 'woman')
  })
  assert.equal(removedVariant.interpretation.reason, 'invalid_output')
  assert.doesNotMatch(removedVariant.reply, /37[.,]?000/)
  assert.equal(agendaCalls, variantAgendaBefore)


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
  const lateralVariantBefore = variantProviderCalls
  const lateralVariant = await variantRead(sidePrice.state, variantMessage)
  assert.equal(lateralVariant.state.informationFocus?.serviceId, 'woman')
  assert.equal(lateralVariant.state.informationFocus?.awaitingChoice, false)
  assert.match(lateralVariant.reply, /Corte mujer:[\s\S]*37[.,]?000/)
  assert.deepEqual(selectionBasket(lateralVariant.state), selectionBasket(active), 'a typed information target never resolves a booking companion')
  for (const field of ['serviceId', 'date', 'customerName', 'professionalNameHint', 'timePreference'] as const)
    assert.deepEqual(lateralVariant.state[field], active[field])
  assert.equal(lateralVariant.proposal, null)
  assert.equal(lateralVariant.bookingCommand, undefined)
  assert.equal(variantProviderCalls, lateralVariantBefore + 1)
  const currentWomanPrice = currentWoman.price
  try {
    currentWoman.price = 41000
    const currentVariantPrice = await variantRead(namelessPrice.state, variantMessage)
    assert.equal(currentVariantPrice.state.informationFocus?.serviceId, 'woman')
    assert.match(currentVariantPrice.reply, /41[.,]?000/)
    assert.doesNotMatch(currentVariantPrice.reply, /37[.,]?000/)
    assert.equal(currentVariantPrice.state.serviceId, null)
  } finally { currentWoman.price = currentWomanPrice }
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
  assert.ok(creamPrice.state.informationFocus, 'the current informative estimate has a proved focus')
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
  // Qualified procedure inquiries stay reads; synthetic providers never prove model understanding.
  const inquiryCatalog: DialogueService[] = [...services, { id: 'light', name: 'Iluminación', price: 12000, durationMinutes: 60, requiresConsultation: false }]
  const inquiryPort: DialoguePort = { ...port, catalog: async () => inquiryCatalog }
  const inquiryFailures: string[] = []
  let inquiryPassed = 0
  const inquiryCheck = async (name: string, assertion: () => Promise<void>) => {
    try { await assertion(); inquiryPassed++; console.log('PASS inquiry ' + name) }
    catch (error) { inquiryFailures.push(name); console.error('RED inquiry ' + name + ': ' + (error instanceof Error ? error.message.split('\n')[0] : String(error))) }
  }
  const procedure = (evidence: string, ids = ['light'], disposition = 'unverified_variant', continuation = false, purpose = 'inquiry') => ({
    kind: 'service_request', purpose, disposition, serviceIds: ids, correction: false,
    basis: 'related_category', sourceQuote: null, continuation, ...ev(evidence)
  })
  let inquiryProviderCalls = 0
  const inquirySay = (state: DialogueState, message: string, operation: object, modern = true, customPort = inquiryPort) =>
    respondWithAiInterpreter(context, state, message, customPort, async () => {
      inquiryProviderCalls++
      return { ...legacy, turnPlan: { version: 1, operations: [operation] }, ...(modern ? {
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message,
          confidence: 1, mention: null, operationIndexes: [0] }] }
      } : {}) }
    })
  const inquiryNoEffects = (result: Awaited<ReturnType<typeof inquirySay>>, before: DialogueState, agendaBefore: number) => {
    assert.deepEqual(selectionBasket(result.state), selectionBasket(before))
    for (const field of ['serviceId', 'date', 'customerName', 'professionalNameHint', 'timePreference'] as const)
      assert.deepEqual(result.state[field], before[field])
    assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
    assert.equal(agendaCalls, agendaBefore); assert.equal(result.interpretation.aiCalls, 1)
  }
  for (const modern of [false, true]) await inquiryCheck('light query keeps object ' + (modern ? 'modern' : 'legacy'), async () => {
    const beforeAgenda = agendaCalls, beforeCalls = inquiryProviderCalls
    const result = await inquirySay(initial, '¿Cuánto cuesta el baño de luz?', procedure('baño de luz'), modern)
    assert.equal(result.interpretation.reason, null)
    assert.equal(result.state.serviceRequest?.purpose, 'inquiry')
    assert.equal(result.state.serviceRequest?.request, 'baño de luz')
    assert.deepEqual(result.state.serviceRequest?.serviceIds, ['light'])
    assert.notEqual(result.state.informationFocus?.serviceId, 'cream')
    assert.doesNotMatch(result.reply, /Baño de crema|25[.,]?000|40[.,]?000/)
    assert.match(result.reply, /baño de luz/)
    inquiryNoEffects(result, initial, beforeAgenda)
    assert.equal(inquiryProviderCalls, beforeCalls + 1)
  })
  await inquiryCheck('pre-provider partial singleton cannot become a price fact', async () => {
    let prepared = ''
    const result = await respondWithAiInterpreter(context, initial, '¿Cuánto cuesta el baño de luz?', inquiryPort, async input => {
      prepared = (input.firstReplyFacts ?? []).map(fact => fact.text).join(' ')
      return { ...legacy, turnPlan: { version: 1, operations: [procedure('baño de luz')] } }
    })
    assert.doesNotMatch(prepared, /Baño de crema|25[.,]?000|40[.,]?000/)
    assert.notEqual(result.state.informationFocus?.serviceId, 'cream')
    const generic = await say(initial, '¿Precio de corte?', [info('Precio de corte', business(['PRICES']))])
    assert.equal(generic.state.informationFocus?.awaitingChoice, true)
    assert.deepEqual(generic.state.informationFocus?.options.map(option => option.id).sort(), ['cut', 'cut-beard', 'woman'])
    const exact = await say(initial, '¿Precio de baño de crema?', [info('Precio de baño de crema', service(['cream'], 'price'))])
    assert.equal(exact.state.informationFocus?.serviceId, 'cream')
  })
  await inquiryCheck('unknown inclusion preserves the question, not a new procedure', async () => {
    const beforeAgenda = agendaCalls
    const result = await inquirySay(initial, '¿El corte incluye lavado?', procedure('El corte incluye lavado', ['cut'], 'needs_detail'))
    assert.equal(result.state.serviceRequest?.request, 'El corte incluye lavado')
    assert.match(result.reply, /información.*confirmada|confirmad.*información/i)
    assert.match(result.reply, /incluye lavado/)
    assert.doesNotMatch(result.reply, /resultado que buscás|producto elegís|Baño de crema|Voy a consultar|te aviso/)
    inquiryNoEffects(result, initial, beforeAgenda)
    const published = inquiryCatalog.map(item => item.id === 'cut' ? { ...item, description: 'Prestación publicada: incluye lavado.' } : item)
    const known = await inquirySay(initial, '¿El corte incluye lavado?', info('El corte incluye lavado', service(['cut'], 'description')), true,
      { ...inquiryPort, catalog: async () => published })
    assert.doesNotMatch(known.reply, /Prestación publicada: incluye lavado|27[.,]?000|37[.,]?000/)
    assert.equal(known.state.informationFocus, initial.informationFocus, 'generic inclusion and a scalar ID do not prove one current identity')
    inquiryNoEffects(known, initial, beforeAgenda)
    const publishedMessage = '¿Cuál es la descripción del Corte hombre?'
    const documented = await respondWithAiInterpreter(context, initial, publishedMessage,
      { ...inquiryPort, catalog: async () => published }, async () => ({
        ...legacy, turnPlan: { version: 1, operations: [info('la descripción del Corte hombre', service(['cut'], 'description'))] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: publishedMessage,
          confidence: 1, mention: 'Corte hombre', operationIndexes: [0] }] }
      }))
    assert.match(documented.reply, /Prestación publicada: incluye lavado/)
    inquiryNoEffects(documented, initial, beforeAgenda)
  })
  const retainedRequest: NonNullable<DialogueState['serviceRequest']> = {
    businessId: context.businessId, purpose: 'booking', disposition: 'needs_detail', serviceIds: ['cut'],
    correction: false, continuation: false, basis: 'related_category', sourceQuote: null, request: 'corte especial'
  }
  const inquiryDraft = { ...active, serviceRequest: retainedRequest }
  for (const modern of [false, true]) await inquiryCheck('lateral inquiry retains booking request ' + (modern ? 'modern' : 'legacy'), async () => {
    const beforeAgenda = agendaCalls
    const result = await inquirySay(inquiryDraft, '¿El corte incluye lavado?', procedure('El corte incluye lavado', ['cut'], 'needs_detail'), modern)
    assert.deepEqual(result.state.serviceRequest, retainedRequest)
    assert.match(result.reply, /incluye lavado/)
    inquiryNoEffects(result, inquiryDraft, beforeAgenda)
  })
  await inquiryCheck('pending inquiry blocks an unrelated inferred price', async () => {
    const previous = { ...initial, serviceRequest: { ...retainedRequest, purpose: 'inquiry' as const, serviceIds: ['light'], request: 'baño de luz' } }
    const result = await say(previous, '¿Cuánto cuesta el baño?', [])
    assert.doesNotMatch(result.reply, /Baño de crema|25[.,]?000|40[.,]?000/)
    assert.notEqual(result.state.informationFocus?.serviceId, 'cream')
    assert.equal(result.state.serviceRequest?.request, 'baño de luz')
  })
  await inquiryCheck('continuation retains its actual qualifier without authorizing a variant', async () => {
    const previous = { ...initial, serviceRequest: { ...retainedRequest, purpose: 'inquiry' as const, serviceIds: ['light'], request: 'baño de luz' } }
    const result = await inquirySay(previous, 'Sólo en raíces', procedure('Sólo en raíces', ['light'], 'unverified_variant', true))
    assert.equal(result.state.serviceRequest?.request, 'baño de luz')
    assert.equal((result.state.serviceRequest as any)?.detail, 'Sólo en raíces')
    assert.equal(result.state.serviceRequest?.disposition, 'unverified_variant')
    assert.deepEqual(result.state.serviceRequest?.serviceIds, ['light'])
    assert.match(result.reply, /raíces/)
    assert.equal(result.state.serviceId, null)
  })
  await inquiryCheck('an inquiry cannot confirm a pending booking identity', async () => {
    const previous = { ...initial, serviceRequest: { ...retainedRequest, basis: 'semantic_equivalent' as const,
      candidateName: 'Corte hombre' } }
    const beforeAgenda = agendaCalls
    const result = await inquirySay(previous, 'sí', { ...procedure('sí', ['cut'], 'needs_detail', true), basis: 'semantic_equivalent' })
    assert.deepEqual(result.state.serviceRequest, previous.serviceRequest)
    inquiryNoEffects(result, previous, beforeAgenda)
  })
  for (const modern of [false, true]) await inquiryCheck('an exact public price is read with retained booking ' + (modern ? 'modern' : 'legacy'), async () => {
    const beforeAgenda = agendaCalls
    const result = await inquirySay(inquiryDraft, '¿Precio de Corte mujer?', {
      ...procedure('Corte mujer', ['woman'], 'clear'), basis: 'exact_public_name'
    }, modern)
    assert.deepEqual(result.state.serviceRequest, retainedRequest)
    assert.equal(result.state.informationFocus?.serviceId, 'woman')
    assert.equal(result.state.informationFocus?.aspect, 'price')
    assert.match(result.reply, /37[.,]?000/)
    assert.doesNotMatch(result.reply, /25[.,]?000/)
    inquiryNoEffects(result, inquiryDraft, beforeAgenda)
  })
  await inquiryCheck('a qualified new query cannot inherit an old price focus', async () => {
    const cream = await say(initial, '¿Precio de baño de crema?', [info('Precio de baño de crema', service(['cream'], 'price'))])
    const elliptical = await say(cream.state, '¿Y el precio?', [])
    assert.equal(elliptical.state.informationFocus?.serviceId, 'cream')
    assert.match(elliptical.reply, /25[.,]?000|40[.,]?000/)
    let prepared = ''
    const result = await respondWithAiInterpreter(context, cream.state, '¿Cuánto cuesta el baño de luz?', inquiryPort, async input => {
      prepared = (input.firstReplyFacts ?? []).map(fact => fact.text).join(' ')
      return { ...legacy, turnPlan: { version: 1, operations: [procedure('baño de luz')] } }
    })
    assert.doesNotMatch(prepared, /Baño de crema|25[.,]?000|40[.,]?000/)
    assert.doesNotMatch(result.reply, /Baño de crema|25[.,]?000|40[.,]?000/)
    assert.equal(result.state.serviceRequest?.request, 'baño de luz')
  })
  await inquiryCheck('a current explicit booking replaces a prior inquiry without granting consent', async () => {
    const previous = { ...initial, serviceRequest: { ...retainedRequest, purpose: 'inquiry' as const, serviceIds: ['light'], request: 'baño de luz' } }
    const beforeAgenda = agendaCalls
    const result = await respondWithAiInterpreter(context, previous, 'Quiero reservar Corte mujer', inquiryPort, async () => ({
      ...legacy, intent: 'booking', turnPlan: { version: 1, operations: [{
        ...procedure('Corte mujer', ['woman'], 'clear', false, 'booking'), basis: 'exact_public_name'
      }] }, communicativeActs: { version: 1, acts: [{ kind: 'request', field: 'service', evidence: 'Quiero reservar Corte mujer',
        confidence: 1, mention: null, operationIndexes: [0] }] }
    }))
    assert.equal(result.state.serviceRequest, undefined)
    assert.equal(result.state.serviceId, 'woman')
    assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
    assert.equal(agendaCalls, beforeAgenda); assert.equal(result.interpretation.aiCalls, 1)
  })

  // I: current-act bindings are server metadata, never inferred from a retained draft.
  const bindingSource = () => ({version:1,operations:[procedure('corte francés', [], 'needs_detail'),info('precio',service([], 'price'))]})
  const bindingActs = (indexes = [0,1], confidence = 1, kind = 'inquiry', field = 'service') => ({version:1,acts:[{kind,field,evidence:'corte francés precio',confidence,mention:null,operationIndexes:indexes}]})
  const iModule = await import('../src/conversational-bot/communicative-act.js') as any
  const requestModule = await import('../src/conversational-bot/service-request.js') as any
  const boundSay = (state = initial, acts = bindingActs(), operations = bindingSource().operations, message = 'corte francés precio') =>
    respondWithAiInterpreter(context,state,message,port,async () => ({...legacy,turnPlan:{version:1,operations},communicativeActs:acts}))
  await inquiryCheck('I1 unknown price has one specific clarification and no empty focus', async () => {
    const result = await boundSay()
    assert.equal(result.interpretation.mode,'ai'); assert.match(result.reply,/corte francés/)
    assert.doesNotMatch(result.reply,/De qué servicio querés consultar|Sobre qué servicio querés información/)
    assert.equal(result.state.informationFocus,undefined); assert.equal(result.interpretation.aiCalls,1)
    assert.equal((result.reply.match(/¿/g) ?? []).length,1)
  })
  await inquiryCheck('I2 current qualifier keeps base and latest detail', async () => {
    const state={...initial,serviceRequest:{...retainedRequest,purpose:'inquiry' as const,serviceIds:[],request:'corte francés'}}
    const result=await inquirySay(state,'con tijera',procedure('con tijera',[],'needs_detail',true))
    assert.equal(result.state.serviceRequest?.request,'corte francés'); assert.equal((result.state.serviceRequest as any)?.detail,'con tijera')
    assert.match(result.reply,/corte francés/); assert.match(result.reply,/con tijera/)
    assert.equal((parseDialogueState(JSON.parse(JSON.stringify(result.state)),context.businessId).serviceRequest as any)?.detail,'con tijera')
    for(const detail of [7,'x'.repeat(301),'bad\u0007text','bad\u0000text']) assert.throws(()=>parseDialogueState({...result.state,serviceRequest:{...result.state.serviceRequest,detail}},context.businessId))
    assert.throws(()=>parseDialogueState({...result.state,serviceRequest:{...result.state.serviceRequest,detail:'current',unexpected:true}},context.businessId))
    const changed=await inquirySay(result.state,'otro procedimiento',procedure('otro procedimiento',[],'needs_detail',false))
    assert.equal((changed.state.serviceRequest as any)?.detail,undefined); assert.equal(changed.state.serviceRequest?.request,'otro procedimiento')
  })
  await inquiryCheck('I3 independent public read remains visible', async () => {
    const message='corte francés precio dónde están'
    const acts={version:1,acts:[{...bindingActs().acts[0]!,evidence:message},{kind:'inquiry',field:'general',evidence:'dónde están',confidence:1,mention:null,operationIndexes:[2]}]}
    const result=await boundSay(initial,acts,[...bindingSource().operations,info('dónde están',business(['ADDRESS']))],message)
    assert.match(result.reply,/Calle 123/); assert.match(result.reply,/corte francés/)
    assert.doesNotMatch(result.reply,/De qué servicio querés consultar/)
    assert.equal(result.bookingCommand,undefined); assert.equal(result.proposal,null)
  })
  await inquiryCheck('I4 separate acts cannot bind independent empty reads', async () => {
    const source=bindingSource(), metadata={version:1,acts:[{...bindingActs([0]).acts[0]!,evidence:'corte francés'},{...bindingActs([1]).acts[0]!,evidence:'precio'}]}
    assert.deepEqual(iModule.deriveInquiryBindings(metadata,source,source),[])
    assert.match((await boundSay(initial,metadata)).reply,/De qué servicio querés consultar/)
  })
  await inquiryCheck('I5 weak reference uncertain wrong field and incomplete coverage do not bind', async () => {
    const source=bindingSource()
    for(const metadata of [bindingActs([0,1],.84),bindingActs([0,1],1,'reference'),bindingActs([0,1],1,'uncertain'),bindingActs([0,1],1,'inquiry','general'),bindingActs([0])])
      assert.deepEqual(iModule.deriveInquiryBindings(metadata,source,source),[])
  })
  await inquiryCheck('I6 identified and estimate reads keep their normal route', async () => {
    for(const target of [service(['cut'],'price'),{...service([],'price'),estimateOptionId:'k'}]) {
      const source={version:1,operations:[bindingSource().operations[0],info('precio',target)]}
      assert.deepEqual(iModule.deriveInquiryBindings(bindingActs(),source,source),[])
    }
  })
  await inquiryCheck('I7 final positions survive preceding rejected operation', async () => {
    const pair=bindingSource(), name={kind:'name',value:'Ana',evidence:'Ana',confidence:1}
    const source={version:1,operations:[name,...pair.operations]}
    const metadata={version:1,acts:[{...bindingActs([1,2]).acts[0]}]}
    assert.deepEqual(iModule.deriveInquiryBindings(metadata,source,pair),[{requestOperationIndex:0,informationOperationIndex:1}])
    assert.deepEqual(iModule.deriveInquiryBindings(metadata,source,{version:1,operations:[pair.operations[1]]}),[])
  })
  await inquiryCheck('I8 corrupt internal indexes never suppress a read', async () => {
    const plan=bindingSource()
    for(const binding of [{requestOperationIndex:9,informationOperationIndex:1},{requestOperationIndex:1,informationOperationIndex:0}]) {
      const result=await respond(context,initial,'corte francés precio',port,{intent:'information',turnPlan:plan as any,serviceId:null,candidateIds:[],correction:false,communicative:{plan:plan as any,blockedFields:[],inquiryBindings:[binding]} as any})
      assert.match(result.reply,/De qué servicio querés consultar/)
    }
  })
  await inquiryCheck('I9 correction purpose identity and retired catalog reject base inheritance', async () => {
    const old={...retainedRequest,purpose:'inquiry',request:'corte francés',candidateName:'Corte hombre'}
    const next=procedure('actual',['cut'],'needs_detail',true) as any
    for(const [current,catalog,admitted] of [[{...next,correction:true},services,true],[{...next,purpose:'booking'},services,true],[{...next,serviceIds:['woman']},services,true],[next,services.filter(s=>s.id!=='cut'),true],[next,services,false]])
      assert.equal(requestModule.retainServiceRequestBase(old,current,'actual',catalog,admitted),'actual')
  })
  await inquiryCheck('I10 current yes resolves candidate while renamed candidate stays unproven', async () => {
    const old={...initial,serviceRequest:{...retainedRequest,purpose:'inquiry' as const,basis:'semantic_equivalent' as const,candidateName:'Corte hombre'}}
    const request={...procedure('sí',['cut'],'clear',true),basis:'exact_public_name'}
    const result=await inquirySay(old,'sí',request)
    assert.equal(result.state.serviceRequest,undefined); assert.equal(result.state.serviceId,null)
    const renamed={...port,catalog:async()=>services.map(s=>s.id==='cut'?{...s,name:'Otro'}:s)}
    assert.ok((await inquirySay(old,'sí',request,true,renamed)).state.serviceRequest)
  })
  await inquiryCheck('I11 invalid companion remains a global rejected interpretation', async () => {
    const malformed=await boundSay(initial,bindingActs(),[bindingSource().operations[0]!,info('invented',service([],'price'))])
    assert.equal(malformed.interpretation.mode,'fallback')
    assert.equal(malformed.state.serviceRequest,undefined)
    assert.equal(malformed.bookingCommand,undefined)
  })
  await inquiryCheck('I12 temporal pending and independent fields remain while linked read is quiet', async () => {
    const beforeAgenda=agendaCalls,state={...initial,timeMeaningClarification:true as const,customerName:'Ana'}
    const result=await boundSay(state)
    assert.equal(result.state.timeMeaningClarification,true); assert.equal(result.state.customerName,'Ana')
    assert.equal(agendaCalls,beforeAgenda); assert.equal(result.state.slot,null)
    assert.doesNotMatch(result.reply,/De qué servicio querés consultar/)
    assert.equal(result.bookingCommand,undefined)
  })

  await inquiryCheck('I13 detail preserves current customer formatting and replaces previous qualifier', async () => {
    const message = 'con tijera\nsolamente arriba'
    const current = {...initial,serviceRequest:{...retainedRequest,purpose:'inquiry' as const,request:'corte francés',serviceIds:[]}}
    const first = await inquirySay(current,message,procedure(message,[],'needs_detail',true))
    assert.equal(first.state.serviceRequest?.request,'corte francés')
    assert.equal(first.state.serviceRequest?.detail,message)
    assert.equal(parseDialogueState(JSON.parse(JSON.stringify(first.state)),context.businessId).serviceRequest?.detail,message)
    const evidence = 'más corto', operation = procedure(evidence,[],'needs_detail',true)
    const candidate = {...legacy,turnPlan:{version:1,operations:[operation]},communicativeActs:{version:1,acts:[{
      kind:'inquiry',field:'service',evidence,confidence:1,mention:null,operationIndexes:[0]}]}}
    const result = await respondWithAiInterpreter(context,first.state,evidence,inquiryPort,async input => {
      assert.equal(input.message,evidence)
      assert.equal(input.state.serviceRequest?.request,'corte francés')
      assert.equal(input.state.serviceRequest?.detail,message)
      return candidate
    })
    assert.equal(operation.evidence,evidence, 'retaining the base never rewrites current provider evidence')
    assert.equal(result.state.serviceRequest?.request,'corte francés')
    assert.equal(result.state.serviceRequest?.detail,evidence)
    assert.doesNotMatch(result.reply,/solamente arriba/)
    assert.match(result.reply,/corte francés/); assert.match(result.reply,/más corto/)
  })


  // M: current inquiry ownership separates factual operators from a proven identity.
  const currentModule = await import('../src/conversational-bot/communicative-act.js')
  let currentPassed = 0, currentProviderCalls = 0
  const currentFailures: string[] = []
  const currentCheck = async (name: string, run: () => Promise<void>) => {
    try { await run(); currentPassed++; console.log('PASS current inquiry ' + name) }
    catch (error) { currentFailures.push(name); console.log('RED current inquiry ' + name + ': ' + (error instanceof Error ? error.message.split('\n')[0] : String(error))) }
  }
  const query = 'Me interesa saber el valor del corte de mujer.'
  const queryQuote = 'el valor del corte de mujer'
  const mention = 'corte de mujer'
  const currentRead = (state: DialogueState, message = query, quote = queryQuote, identity: string | null = mention,
    targetId = 'woman', fields: object = {}, currentPort = port, operations?: object[]) =>
    respondWithAiInterpreter(context, state, message, currentPort, async () => {
      currentProviderCalls++
      return { ...legacy, turnPlan: { version: 1, operations: operations ?? [info(quote, service([targetId], 'price'))] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message,
          confidence: 1, mention: identity, operationIndexes: [0], ...fields }] } }
    })
  await currentCheck('N raw V7 separates short current owner quote from full neutral body', async () => {
    const message = 'De esas opciones, me interesa el valor del corte de mujer.'
    const quote = 'me interesa el valor del corte de mujer'
    const catalog = services.slice(0, 3).map((item, index) => ({ ...item,
      id: ['cut-m', 'cut-w', 'cut-b'][index]!, price: [15000, 20000, 18000][index]! }))
    const scopedPort = { ...port, catalog: async () => catalog }
    const state = { ...namelessPrice.state, informationFocus: { ...namelessPrice.state.informationFocus!,
      options: catalog.map(item => ({ id: item.id, label: item.name })) } }
    const beforeProvider = currentProviderCalls, beforeAgenda = agendaCalls
    const result = await respondWithAiInterpreter(context, state, message, scopedPort, async () => {
      currentProviderCalls++
      return { ...legacy, turnPlan: { version: 1, operations: [info(quote, service(['cut-w'], 'price'))] },
        communicativeActs: { version: 1, acts: [
          { kind: 'answer', field: 'service', ...ev('el corte de mujer'), mention: 'corte de mujer', operationIndexes: [] },
          { kind: 'inquiry', field: 'service', ...ev(quote), mention: 'corte de mujer', operationIndexes: [0] }
        ] } }
    })
    assert.equal(result.state.informationFocus?.serviceId, 'cut-w'); assert.equal(result.state.informationFocus?.awaitingChoice, false)
    assert.match(result.reply, /20[.,]?000/); assert.doesNotMatch(result.reply, /15[.,]?000|18[.,]?000|Corte hombre|Corte y barba/)
    assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(result.state.serviceId, null)
    assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
    assert.equal(currentProviderCalls, beforeProvider + 1); assert.equal(agendaCalls, beforeAgenda)
  })
  await currentCheck('N short owners keep full-body residue and dimension grammar authoritative', async () => {
    for (const [message, quote, aspect] of [
      ['De esas opciones, me interesa el valor del corte de mujer.', 'me interesa el valor del corte de mujer', 'price'],
      ['De esas opciones, quiero saber la duración del corte de mujer.', 'la duración del corte de mujer', 'duration'],
      ['De esas opciones, quiero saber la descripción del corte de mujer.', 'la descripción del corte de mujer', 'description'],
      ['De esas opciones,\nme interesa el valor del\tcorte de mujer.', 'corte de mujer', 'price']
    ] as const) {
      const result = await currentRead(namelessPrice.state, message, quote, mention, 'woman', { evidence: quote }, port,
        [info(quote, service(['woman'], aspect))])
      assert.equal(result.state.informationFocus?.serviceId, 'woman', message)
      assert.equal(result.state.informationFocus?.aspect, aspect); assert.equal(result.state.serviceId, null)
    }
    const quote = 'me interesa el valor del corte de mujer'
    for (const message of ['De esas opciones, ' + quote + ' sin lavado.', 'Sin lavado, ' + quote + '.',
      'No, ' + quote + '.', 'Si conviene, ' + quote + '.', quote + ' extraño.', 'Extraño, ' + quote + '.',
      'De esas opciones, ' + quote + ' más barato.', quote + ' '.repeat(2000 - quote.length - 'sin lavado.'.length) + 'sin lavado.'])
      for (const state of [initial, namelessPrice.state]) {
        const result = await currentRead(state, message, quote, mention, 'woman', { evidence: quote })
        assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
        assert.deepEqual(result.state.informationFocus, state.informationFocus)
        assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(result.state.serviceId, state.serviceId)
        assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
      }
  })
  await currentCheck('N short ownership cannot rescue weak missing foreign stale or duplicate identity proof', async () => {
    const message = 'De esas opciones, me interesa el valor del corte de mujer.'
    const quote = 'me interesa el valor del corte de mujer'
    for (const fields of [{ confidence: .84 }, { kind: 'reference' }, { field: 'general' },
      { operationIndexes: [] }, { mention: null }]) {
      const result = await currentRead(namelessPrice.state, message, quote, mention, 'woman', { evidence: quote, ...fields })
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/, 'short-owner controls: ' + JSON.stringify(fields))
      assert.deepEqual(result.state.informationFocus, namelessPrice.state.informationFocus)
      assert.deepEqual(selectionBasket(result.state), selectionBasket(namelessPrice.state))
    }
    const beforeProvider = currentProviderCalls, beforeAgenda = agendaCalls
    const malformed = await currentRead(namelessPrice.state, message, quote, mention, 'woman', { evidence: 'me interesa' })
    assert.equal(malformed.interpretation.reason, 'invalid_output')
    assert.doesNotMatch(malformed.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
    assert.deepEqual(malformed.state.informationFocus, namelessPrice.state.informationFocus)
    const source = { version: 1 as const, operations: [info(quote, service(['woman'], 'price'))] }
    assert.deepEqual(currentModule.deriveCurrentServiceInquiries({ version: 1, acts: [{ kind: 'inquiry', field: 'service',
      evidence: 'me interesa', confidence: 1, mention, operationIndexes: [0] }] } as any, source as any, source as any,
      message, context.businessId), [])
    assert.deepEqual(selectionBasket(malformed.state), selectionBasket(namelessPrice.state))
    assert.equal(malformed.state.serviceId, namelessPrice.state.serviceId)
    assert.equal(malformed.bookingCommand, undefined); assert.equal(malformed.proposal, null)
    assert.equal(currentProviderCalls, beforeProvider + 1); assert.equal(agendaCalls, beforeAgenda)
    const wrong = await currentRead(namelessPrice.state, message, quote, mention, 'cut', { evidence: quote })
    assert.doesNotMatch(wrong.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
    const foreign = await currentRead(namelessPrice.state, message, quote, mention, 'foreign', { evidence: quote })
    assert.equal(foreign.interpretation.reason, 'invalid_output')
    const badIndex = await currentRead(namelessPrice.state, message, quote, mention, 'woman', { evidence: quote, operationIndexes: [9] })
    assert.equal(badIndex.interpretation.reason, 'invalid_output')
    for (const currentPort of [
      { ...port, catalog: async () => services.map(item => item.id === 'woman' || item.id === 'cut' ? { ...item, name: 'Renombrado' } : item) },
      { ...port, catalog: async () => services.filter(item => item.id !== 'cut') }
    ]) {
      const result = await currentRead(namelessPrice.state, message, quote, mention, 'woman', { evidence: quote }, currentPort)
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state.informationFocus, namelessPrice.state.informationFocus)
    }
    const duplicate = await currentRead(namelessPrice.state, message + ' corte de mujer', quote, mention, 'woman', { evidence: quote })
    assert.doesNotMatch(duplicate.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
    assert.deepEqual(duplicate.state.informationFocus, namelessPrice.state.informationFocus)
  })
  await currentCheck('captured V6 current identity keeps one price and no effects', async () => {
    const before = currentProviderCalls, agendaBefore = agendaCalls
    const result = await currentRead(namelessPrice.state)
    assert.equal(result.state.informationFocus?.serviceId, 'woman')
    assert.equal(result.state.informationFocus?.awaitingChoice, false)
    assert.match(result.reply, /37[.,]?000/)
    assert.doesNotMatch(result.reply, /Corte hombre|Corte y barba|27[.,]?000|32[.,]?000/)
    assert.deepEqual(selectionBasket(result.state), selectionBasket(namelessPrice.state))
    assert.equal(result.state.serviceId, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
    assert.equal(currentProviderCalls, before + 1); assert.equal(result.interpretation.aiCalls, 1); assert.equal(agendaCalls, agendaBefore)
  })
  await currentCheck('generic read carriers compose; Unicode LF and tabs preserve offsets', async () => {
    for (const message of ['Quisiera consultar el costo de corte de mujer.', '¿Cuál es el valor del corte de mujer?',
      'Me gustaría saber el precio de corte de mujer.', 'Deseo consultar el precio de corte de mujer.', 'De esas opciones, me interesa el valor del corte de mujer.',
      'Me interesa\nsaber el valor del\tcorte de mujer.']) {
      const result = await currentRead(namelessPrice.state, message, message)
      assert.equal(result.state.informationFocus?.serviceId, 'woman', message)
      assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
    }
  })
  await currentCheck('qualified contradictory conditional comparator and unknown residues do not vanish', async () => {
    for (const message of ['Me interesa saber el valor del corte de mujer sin lavado.',
      'Sin lavado me interesa saber el valor del corte de mujer.', 'Me interesa saber el valor del corte de mujer con técnica x.',
      'Me interesa saber el valor del corte de mujer especial.', 'No me interesa saber el valor del corte de mujer.',
      'Si me conviene quiero saber el valor del corte de mujer.', 'Me interesa saber el valor del corte de mujer más barato.',
      'Me interesa saber el valor del corte de mujer extraño.', 'Me interesa saber el costo y valor del corte de mujer.',
      'Me interesa saber el valor del corte de mujer; soy Ana.']) {
      const result = await currentRead(namelessPrice.state, message, 'corte de mujer')
      assert.notEqual(result.state.informationFocus?.serviceId, 'woman', message)
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/, message)
      assert.deepEqual(result.state.informationFocus, namelessPrice.state.informationFocus, 'unproven inquiry retains previous factual choice scope')
      assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
    }
  })
  await currentCheck('weak reference wrong field missing mention and inherited quote cannot rescue singleton', async () => {
    const partialNeutral = await currentRead(namelessPrice.state, query, queryQuote, mention, 'woman', { evidence: queryQuote })
    assert.equal(partialNeutral.state.informationFocus?.serviceId, 'woman', 'original short neutral quote now has separately proven full-body scope')
    for (const [identity, fields] of [[null, {}], [mention, { confidence: .84 }], [mention, { kind: 'reference' }],
      [mention, { field: 'general' }], [mention, { operationIndexes: [] }], [mention, { evidence: 'Me interesa saber' }]] as const) {
      const result = await currentRead(namelessPrice.state, query, queryQuote, identity, 'woman', fields)
      assert.notEqual(result.state.informationFocus?.serviceId, 'woman')
      assert.equal(result.state.serviceId, null)
    }
    const ambiguous = await currentRead(namelessPrice.state, query + ' corte de mujer', queryQuote)
    assert.notEqual(ambiguous.state.informationFocus?.serviceId, 'woman')
  })
  await currentCheck('missing identity proof cannot hide qualified full text behind a bare operation quote', async () => {
    for (const state of [namelessPrice.state, initial]) for (const message of [
      'Me interesa saber el valor del corte de mujer sin lavado.', 'Sin lavado me interesa saber el valor del corte de mujer.',
      '¿Precio de corte de mujer sin lavado?'
    ]) for (const [identity, fields] of [[null, {}], [mention, { evidence: 'corte de mujer' }]] as const) {
      const result = await currentRead(state, message, 'corte de mujer', identity, 'woman', fields)
      assert.notEqual(result.state.informationFocus?.serviceId, 'woman')
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state.informationFocus, state.informationFocus)
    }
    for (const state of [namelessPrice.state, initial]) {
      const exact = await currentRead(state, mention, mention, null)
      assert.deepEqual(exact.state.informationFocus, state.informationFocus, 'non-public literal without scope is not an exact-name proof')
      assert.doesNotMatch(exact.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      const publicExact = await currentRead(state, 'Corte mujer', 'Corte mujer', null)
      assert.equal(publicExact.state.informationFocus?.serviceId, 'woman')
    }
  })
  await currentCheck('weak original modern information retains rejection instead of legacy price authority', async () => {
    for (const confidence of [0, .5, .84]) for (const state of [initial, namelessPrice.state])
      for (const fields of [{}, { evidence: 'corte de mujer' }]) {
        const message = 'Me interesa saber el valor del corte de mujer sin lavado.'
        const beforeProvider = currentProviderCalls, beforeAgenda = agendaCalls
        const result = await currentRead(state, message, 'corte de mujer', null, 'woman', fields, port,
          [{ ...info('corte de mujer', service(['woman'], 'price')), confidence }])
        assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
        assert.deepEqual(result.state.informationFocus, state.informationFocus)
        assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
        assert.equal(result.state.serviceId, state.serviceId)
        assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
        assert.equal(currentProviderCalls, beforeProvider + 1); assert.equal(agendaCalls, beforeAgenda)
      }
    for (const confidence of [.5, .84]) {
      const message = 'Cuánto cuesta Corte mujer'
      const result = await currentRead(initial, message, message, null, 'woman', {}, port,
        [{ ...info(message, service(['woman'], 'price')), confidence }])
      assert.doesNotMatch(result.reply, /37[.,]?000/)
      assert.deepEqual(result.state.informationFocus, initial.informationFocus)
    }
  })
  await currentCheck('full server body through 2000 characters never downgrades to a short quoted price', async () => {
    const head = 'Me interesa saber el valor del corte de mujer', tail = 'sin lavado.'
    for (const length of [301, 356, 2000]) for (const state of [initial, namelessPrice.state]) {
      const message = head + ' '.repeat(length - head.length - tail.length) + tail
      assert.equal(message.length, length)
      const beforeProvider = currentProviderCalls, beforeAgenda = agendaCalls
      const result = await currentRead(state, message, 'corte de mujer', null, 'woman',
        { evidence: 'el valor del corte de mujer', confidence: .99 }, port,
        [{ ...info('corte de mujer', service(['woman'], 'price')), confidence: .99 }])
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state.informationFocus, state.informationFocus)
      assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
      assert.equal(result.state.serviceId, state.serviceId)
      assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
      assert.equal(currentProviderCalls, beforeProvider + 1); assert.equal(agendaCalls, beforeAgenda)
    }
    const scope = await import('../src/conversational-bot/service-information-scope.js')
    const message = 'Corte mujer' + ' '.repeat(301 - 'Corte mujer'.length)
    const operation = info('Corte mujer', service(['woman'], 'price')) as any
    const proof = { operationIndex: 0, businessId: context.businessId, serviceId: 'woman',
      aspect: 'price' as const, identityMention: 'Corte mujer', ownerEvidence: message, inquiryEvidence: message, operationEvidence: 'Corte mujer' }
    assert.equal(scope.validCurrentServiceInquiry(proof, operation, message, context.businessId), false,
      'positive act scope keeps the provider evidence bound even when server body is longer')
  })
  await currentCheck('exact public-name fallback consumes the full current body without acquiring', async () => {
    const scope = await import('../src/conversational-bot/service-information-scope.js') as unknown as Record<string, (...args: any[]) => any>
    for (const verb of ['cuesta', 'sale', 'vale']) {
      const message = '¿Cuánto ' + verb + ' Corte mujer?'
      assert.equal(scope.neutralCatalogServiceInquiry!(message, 'woman', 'price', services), true)
      const result = await currentRead(namelessPrice.state, message, message, null)
      assert.equal(result.state.informationFocus?.serviceId, 'woman'); assert.match(result.reply, /37[.,]?000/)
      assert.equal(result.state.serviceId, null); assert.equal(result.proposal, null)
    }
    for (const message of ['Cuánto cuesta Corte mujer sin lavado', 'Sin lavado cuánto cuesta Corte mujer',
      'No quiero saber cuánto cuesta Corte mujer', 'Si conviene cuánto cuesta Corte mujer',
      'Cuánto cuesta Corte mujer extraño', 'Soy Ana. Cuánto cuesta Corte mujer', 'Cuánto cuesta Corte mujer Corte mujer']) {
      assert.equal(scope.neutralCatalogServiceInquiry!(message, 'woman', 'price', services), false)
      const result = await currentRead(namelessPrice.state, message, 'Corte mujer', null)
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state.informationFocus, namelessPrice.state.informationFocus)
    }
    assert.equal(scope.neutralCatalogServiceInquiry!('Cuánto cuesta Corte mujer', 'cut', 'price', services), false)
    assert.equal(scope.neutralCatalogServiceInquiry!('Cuánto cuesta corte de mujer', 'woman', 'price', services), false)
    assert.equal(scope.neutralCatalogServiceInquiry!('Cuánto cuesta Corte mujer', 'woman', 'duration', services), false)
    assert.equal(scope.neutralCatalogServiceInquiry!('Cuánto cuesta Corte mujer', 'woman', 'price',
      [...services, {...services.find(item => item.id === 'woman')!, id: 'duplicate'}]), false)
  })
  await currentCheck('full current catalog and every old option must remain fresh', async () => {
    const wrong = await currentRead(namelessPrice.state, query, queryQuote, mention, 'cut')
    assert.notEqual(wrong.state.informationFocus?.serviceId, 'cut')
    const foreign = await currentRead(namelessPrice.state, query, queryQuote, mention, 'foreign')
    assert.equal(foreign.interpretation.reason, 'invalid_output')
    for (const id of ['woman', 'cut']) {
      const renamed = { ...port, catalog: async () => services.map(item => item.id === id ? { ...item, name: 'Renombrado' } : item) }
      const result = await currentRead(namelessPrice.state, query, queryQuote, mention, 'woman', {}, renamed)
      assert.notEqual(result.state.informationFocus?.serviceId, 'woman')
      assert.doesNotMatch(result.reply, /37[.,]?000/)
    }
    const stale = { ...port, catalog: async () => services.filter(item => item.id !== 'cut') }
    assert.notEqual((await currentRead(namelessPrice.state, query, queryQuote, mention, 'woman', {}, stale)).state.informationFocus?.serviceId, 'woman')
  })
  await currentCheck('lateral factual selection retains the produced booking draft', async () => {
    const current = { ...sidePrice.state, informationFocus: namelessPrice.state.informationFocus! }
    const agendaBefore = agendaCalls, result = await currentRead(current)
    assert.equal(result.state.informationFocus?.serviceId, 'woman')
    for (const key of ['basket', 'serviceId', 'date', 'customerName', 'professionalNameHint', 'timePreference'] as const)
      assert.deepEqual(result.state[key], current[key])
    assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null); assert.equal(agendaCalls, agendaBefore)
  })
  await currentCheck('metadata derives after final filtering and remaps clones, not positions blindly', async () => {
    const module = currentModule as unknown as Record<string, (...args: any[]) => any>
    const source = { version: 1, operations: [{ kind: 'name', value: 'Ana', ...ev('Ana') }, info(queryQuote, service(['woman'], 'price'))] }
    const final = { version: 1, operations: [source.operations[1]!] }
    const acts = { version: 1, acts: [{ kind: 'inquiry', field: 'service', confidence: 1, evidence: query, mention, operationIndexes: [1] }] }
    const scopes = module.deriveCurrentServiceInquiries!(acts, source, final, query, context.businessId)
    assert.equal(scopes.length, 1); assert.equal(scopes[0].operationIndex, 0)
    assert.equal(scopes[0].identityMention, mention); assert.equal(scopes[0].ownerEvidence, query); assert.equal(scopes[0].inquiryEvidence, query); assert.equal(scopes[0].operationEvidence, queryQuote)
    assert.deepEqual(module.remapCurrentServiceInquiries!(scopes, final, structuredClone(final), query, context.businessId), scopes)
    assert.deepEqual(module.remapCurrentServiceInquiries!(scopes, final, { version: 1, operations: [] }, query, context.businessId), [])
    for (const patch of [{ businessId: 'foreign' }, { operationIndex: 8 }, { serviceId: 'cut' }, { aspect: 'duration' }, { operationEvidence: 'inventado' }, { identityMention: 'inventado' }])
      assert.deepEqual(module.remapCurrentServiceInquiries!([{ ...scopes[0], ...patch }], final, final, query, context.businessId), [])
  })
  await currentCheck('modern original-read fence survives changed target and quote as rejection', async () => {
    const module = currentModule as unknown as Record<string, (...args: any[]) => any>
    const source = { version: 1, operations: [info(queryQuote, service(['woman'], 'price'))] }
    const acts = { version: 1, acts: [{ kind: 'inquiry', field: 'service', confidence: 1, evidence: query, mention: null, operationIndexes: [0] }] }
    const fences = module.deriveCurrentServiceReads!(acts, source, source, query, context.businessId)
    assert.equal(fences.length, 1)
    for (const confidence of [Infinity, NaN, 1.5]) {
      const invalid = { ...source, operations: [{ ...source.operations[0], confidence }] }
      assert.deepEqual(module.deriveCurrentServiceReads!(acts, invalid, invalid, query, context.businessId), [])
    }
    assert.deepEqual(module.deriveCurrentServiceReads!(null, source, source, query, context.businessId), [])
    for (const op of [info(queryQuote, service(['cut'], 'price')), info(mention, service(['woman'], 'price')),
      { ...source.operations[0], confidence: .5 }]) {
      const final = { version: 1, operations: [op] }
      const remapped = module.remapCurrentServiceReads!(fences, source, final, query, context.businessId)
      assert.equal(remapped.length, 1, 'changed read retains a rejection fence rather than dropping to legacy')
      const result = await respond(context, namelessPrice.state, query, port, { intent: 'information',
        turnPlan: final as any, serviceId: null, candidateIds: [], correction: false,
        communicative: { plan: source, blockedFields: [], currentServiceReads: fences } as any })
      assert.notEqual(result.state.informationFocus?.serviceId, 'woman')
      assert.doesNotMatch(result.reply, /37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state.informationFocus, namelessPrice.state.informationFocus)
    }
  })
  await currentCheck('pure resolver conserves material residue and explicit dimension compatibility', async () => {
    const scope = await import('../src/conversational-bot/service-information-scope.js')
    assert.equal(scope.neutralServiceInquiry(query, mention, 'price'), true)
    assert.equal(scope.neutralServiceInquiry('De esas opciones, me interesa el valor del corte de mujer.', mention, 'price'), true)
    assert.equal(scope.neutralServiceInquiry('Sobre ese corte de mujer, ¿qué duración tiene?', mention, 'duration'), true)
    assert.equal(scope.neutralServiceInquiry('¿Cuál es la duración de corte de mujer?', mention, 'duration'), true)
    assert.equal(scope.neutralServiceInquiry('¿Cuál es la duración de corte de mujer?', mention, 'price'), false)
    assert.equal(scope.neutralServiceInquiry('Ásí me interesa saber el valor del corte de mujer', mention, 'price'), false)
    assert.equal(scope.neutralServiceInquiry('corte de mujer corte de mujer', mention, 'price'), false)
    assert.equal(scope.neutralServiceInquiry('Me interesa saber el valor de corte de mujer con algo', mention, 'price'), false)
  })
  await currentCheck('P raw V9 rejects the act but answers the independently proven current duration', async () => {
    const catalog = services.slice(0, 3).map((item, index) => ({ ...item,
      id: ['cut-m', 'cut-w', 'cut-b'][index]!, price: [15000, 20000, 18000][index]!, durationMinutes: index === 1 ? 40 : item.durationMinutes }))
    const scopedPort = { ...port, catalog: async () => catalog }
    const state = { ...initial, informationFocus: { version: 1 as const, businessId: context.businessId,
      topic: 'price' as const, aspect: 'price' as const, serviceId: 'cut-w', awaitingChoice: false, candidateId: null,
      options: catalog.map(item => ({ id: item.id, label: item.name })) } }
    const message = 'Sobre ese corte de mujer, ¿qué duración tiene?', before = JSON.stringify(state), reads = agendaCalls
    let calls = 0
    const result = await respondWithAiInterpreter(context, state, message, scopedPort, async () => {
      calls++
      return { ...legacy, turnPlan: { version: 1, operations: [info('qué duración tiene', service(['cut-w'], 'duration'))] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', ...ev('¿qué duración tiene?'),
          mention: 'corte de mujer', operationIndexes: [0] }] } }
    })
    assert.equal(result.interpretation.reason, 'invalid_output'); assert.equal(result.interpretation.mode, 'fallback')
    assert.match(result.reply, /40 min(?:utos)?/); assert.doesNotMatch(result.reply, /20[.,]?000|15[.,]?000|18[.,]?000/)
    assert.equal(result.state.informationFocus?.aspect, 'duration'); assert.equal(result.state.informationFocus?.serviceId, 'cut-w')
    assert.equal(JSON.stringify(state), before); assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
    assert.equal(result.state.serviceId, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
    assert.equal(calls, 1); assert.equal(agendaCalls, reads)
  })
  const pFocus: DialogueState = { ...sidePrice.state, informationFocus: { ...namelessPrice.state.informationFocus!,
    serviceId: 'woman', awaitingChoice: false } }
  const pRead = (message: string, quote = 'qué duración tiene', aspect = 'duration', confidence = .99,
    targetId = 'woman', currentPort = port, providerError = false) =>
    respondWithAiInterpreter(context, pFocus, message, currentPort, async () => {
      currentProviderCalls++
      if (providerError) throw new Error('controlled offline provider error')
      return { ...legacy, turnPlan: { version: 1, operations: [{ ...info(quote, service([targetId], aspect)), confidence }] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', ...ev(quote),
          mention: 'corte de mujer', operationIndexes: [0] }] } }
    })
  await currentCheck('P independent facets preserve booking draft and original rejection', async () => {
    for (const [message, quote, aspect] of [
      ['Sobre ese corte de mujer, ¿qué duración tiene?', 'qué duración tiene', 'duration'],
      ['Sobre ese corte de mujer, ¿cuál es la descripción?', 'cuál es la descripción', 'description'],
      ['Sobre ese corte de mujer, ¿cuál es el precio?', 'cuál es el precio', 'price'],
      ['Sobre ese\ncorte de mujer,\t¿qué duración tiene?', 'qué duración tiene', 'duration']
    ] as const) {
      const reads = agendaCalls, calls = currentProviderCalls, result = await pRead(message, quote, aspect)
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.equal(result.state.informationFocus?.aspect, aspect)
      if (aspect === 'duration') { assert.match(result.reply, /30 min(?:utos)?/); assert.doesNotMatch(result.reply, /37[.,]?000/) }
      for (const key of ['basket', 'serviceId', 'date', 'customerName', 'professionalNameHint', 'timePreference'] as const)
        assert.deepEqual(result.state[key], pFocus[key])
      assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
      assert.equal(agendaCalls, reads); assert.equal(currentProviderCalls, calls + 1)
    }
  })
  await currentCheck('P denial-only provenance and whole-body residue prevent fallback old facts', async () => {
    for (const message of ['Sin lavado, sobre ese corte de mujer, ¿qué duración tiene?',
      'Sobre ese corte de mujer, ¿qué duración tiene sin lavado?', 'No, sobre ese corte de mujer, ¿qué duración tiene?',
      'Si conviene, sobre ese corte de mujer, ¿qué duración tiene?', 'Sobre ese corte de mujer, ¿qué duración tiene extraño?',
      'Sobre ese corte de mujer, ¿qué duración tiene y precio?', '¿Qué duración tiene?', 'Sobre Corte hombre, ¿qué duración tiene?']) {
      const result = await pRead(message)
      assert.doesNotMatch(result.reply, /30 min(?:utos)?|37[.,]?000|27[.,]?000|32[.,]?000/)
      assert.deepEqual(result.state, pFocus)
    }
    for (const [confidence, target, quote] of [[.84, 'woman', 'qué duración tiene'], [.5, 'woman', 'qué duración tiene'],
      [.99, 'foreign', 'qué duración tiene'], [.99, 'woman', 'inventado']] as const) {
      const result = await pRead('Sobre ese corte de mujer, ¿qué duración tiene?', quote, 'duration', confidence, target)
      assert.doesNotMatch(result.reply, /30 min(?:utos)?|37[.,]?000/); assert.deepEqual(result.state, pFocus)
    }
    const failed = await pRead('Sobre ese corte de mujer, ¿qué duración tiene?', 'qué duración tiene', 'duration', .99, 'woman', port, true)
    assert.equal(failed.interpretation.reason, 'provider_error'); assert.doesNotMatch(failed.reply, /30 min(?:utos)?|37[.,]?000/)
    assert.deepEqual(failed.state, pFocus)
    for (const currentPort of [{ ...port, catalog: async () => services.map(item => item.id === 'woman' || item.id === 'cut'
      ? { ...item, name: 'Renombrado' } : item) }, { ...port, catalog: async () => services.filter(item => item.id !== 'cut') }]) {
      const result = await pRead('Sobre ese corte de mujer, ¿qué duración tiene?', 'qué duración tiene', 'duration', .99, 'woman', currentPort)
      assert.doesNotMatch(result.reply, /30 min(?:utos)?|37[.,]?000/); assert.deepEqual(result.state, pFocus)
    }
  })
  await currentCheck('P full-body proof remains independent of rejected targets and finite catalog aliases', async () => {
    const scope = await import('../src/conversational-bot/service-information-scope.js')
    const message = 'Sobre ese corte de mujer, ¿qué duración tiene?'
    assert.equal(scope.independentServiceInformationInquiry(message, 'duration', pFocus.informationFocus, context.businessId, services)?.serviceId, 'woman')
    for (const body of ['Sobre ese córte de mujer, ¿qué duración tiene?', message + ' corte de mujer', message + ' especial.',
      'Sobre ese corte de mujer, ¿qué duración tiene? Soy Ana.']) {
      assert.equal(scope.independentServiceInformationInquiry(body, 'duration', pFocus.informationFocus, context.businessId, services), null)
      const result = await pRead(body); assert.doesNotMatch(result.reply, /30 min(?:utos)?|37[.,]?000/)
      assert.deepEqual(result.state, pFocus)
    }
    const long = 'Sobre ese corte de mujer,' + ' '.repeat(2000 - 'Sobre ese corte de mujer,'.length - '¿qué duración tiene?'.length) + '¿qué duración tiene?'
    const result = await pRead(long)
    assert.match(result.reply, /30 min(?:utos)?/); assert.doesNotMatch(result.reply, /37[.,]?000/)
    assert.equal(result.state.informationFocus?.aspect, 'duration')
    const deniedWrongTarget = await pRead(message, 'qué duración tiene', 'price', .99, 'cut')
    assert.match(deniedWrongTarget.reply, /30 min(?:utos)?/); assert.doesNotMatch(deniedWrongTarget.reply, /37[.,]?000|27[.,]?000/)
    assert.equal(deniedWrongTarget.state.informationFocus?.serviceId, 'woman', 'rejected ID/aspect only restrict eligibility, never provide positive proof')
    const original = info('qué duración tiene', service(['woman'], 'duration'))
    const weakCompanion = await respondWithAiInterpreter(context, pFocus, message, port, async () => ({ ...legacy,
      turnPlan: { version: 1, operations: [original, { ...original, confidence: .5 }] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', ...ev('qué duración tiene'),
        mention: 'corte de mujer', operationIndexes: [0, 1] }] } }))
    assert.equal(weakCompanion.interpretation.reason, 'invalid_output')
    assert.doesNotMatch(weakCompanion.reply, /30 min(?:utos)?|37[.,]?000/); assert.deepEqual(weakCompanion.state, pFocus)
    const closed = await respondWithAiInterpreter(context, pFocus, 'Corte mujer', port, async () => { throw new Error('controlled offline') })
    assert.match(closed.reply, /37[.,]?000/); assert.equal(closed.state.serviceId, pFocus.serviceId)
    assert.equal(closed.bookingCommand, undefined); assert.equal(closed.proposal, null)
  })

  // T: V13 captured semantic intent was correct; ownership and dimension fences lost it.
  const tScope = await import('../src/conversational-bot/service-information-scope.js')
  const tCatalog = services.slice(0, 3).map((item, index) => ({ ...item,
    id: ['cut-m', 'cut-w', 'cut-b'][index]!, price: [15000, 20000, 18000][index]!,
    durationMinutes: index === 1 ? 40 : item.durationMinutes }))
  const tPort: DialoguePort = { ...port, catalog: async () => tCatalog }
  const tBody = 'Para el servicio Corte mujer, ¿cuántos minutos dura?'
  const tQuote = '¿cuántos minutos dura?'
  const tRaw = {
    turnPlan: { version: 1, operations: [{ kind: 'information', evidence: tQuote, confidence: .99,
      target: { kind: 'service', actions: [], serviceIds: ['cut-w'], aspect: 'duration' } }] },
    communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: tBody,
      confidence: .99, mention: 'Corte mujer', operationIndexes: [0] }] },
    ...legacy, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false,
    informationTarget: null, intakeReply: null,
    firstReply: { salutation: null, opening: 'Con gusto te ayudo con esa consulta.',
      factIds: ['next'], closing: null, variantChoices: null }
  }
  const tAsk = async (message = tBody, quote = tQuote, fields: object = {}, state = initial,
    operations?: object[], acts?: object[]) => {
    let calls = 0
    const before = JSON.stringify(state), reads = agendaCalls
    const result = await respondWithAiInterpreter(context, state, message, tPort, async () => {
      calls++
      return { ...tRaw, turnPlan: { version: 1, operations: operations ??
        [{ ...tRaw.turnPlan.operations[0]!, evidence: quote }] },
        communicativeActs: { version: 1, acts: acts ??
          [{ ...tRaw.communicativeActs.acts[0]!, evidence: message, ...fields }] } }
    })
    assert.equal(calls, 1); assert.equal(agendaCalls, reads)
    assert.equal(JSON.stringify(state), before); assert.deepEqual(selectionBasket(result.state), selectionBasket(state), JSON.stringify({message, fields, operations, acts}))
    assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
    return result
  }
  await currentCheck('T captured V13 projects identity from the same current owner, not only opquote', async () => {
    const plan = tRaw.turnPlan as any, metadata = tRaw.communicativeActs as any
    const scopes = currentModule.deriveCurrentServiceInquiries(metadata, plan, plan, tBody, context.businessId)
    assert.equal(scopes.length, 1)
    assert.equal(scopes[0]!.identityMention, 'Corte mujer')
    assert.equal(scopes[0]!.operationEvidence, tQuote)
  })
  await currentCheck('T captured V13 public answer is duration40 and focused, not merely safe typed state', async () => {
    const result = await tAsk()
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.interpretation.validation?.turnPlan?.outcome, 'accepted')
    assert.match(result.reply, /40 min(?:utos)?/); assert.doesNotMatch(result.reply, /20[.,]?000|precisar|confirmada/)
    assert.equal(result.state.informationFocus?.serviceId, 'cut-w')
    assert.equal(result.state.informationFocus?.aspect, 'duration')
    assert.equal(result.state.serviceId, null)
  })
  await currentCheck('T verbal duration operators work only with owned current identity and full neutral body', async () => {
    for (const [message, quote] of [
      [tBody, tQuote], ['Sobre Corte mujer, ¿cuánto dura?', '¿cuánto dura?'],
      ['¿Cuántos minutos dura Corte mujer?', '¿Cuántos minutos dura Corte mujer?'],
      ['Para Corte mujer, ¿cuál es la duración?', '¿cuál es la duración?'],
      ['Del servicio Corte mujer, ¿qué duración tiene?', '¿qué duración tiene?']
    ]) {
      const result = await tAsk(message!, quote!)
      assert.match(result.reply, /40 min(?:utos)?/); assert.doesNotMatch(result.reply, /20[.,]?000/)
      assert.equal(result.state.informationFocus?.aspect, 'duration')
    }
    assert.equal(tScope.neutralCatalogServiceInquiry(tBody, 'cut-w', 'duration', tCatalog), false,
      'new owned grammar must not expand catalog-only fallback or P rejection provenance')
  })
  await currentCheck('T owners, literal quotes, catalog identity and final indices remain boundaries', async () => {
    for (const fields of [{ confidence: .5 }, { mention: null }, { mention: 'Corte hombre' },
      { evidence: tQuote }, { field: 'professional' }, { operationIndexes: [] }, { operationIndexes: [8] }]) {
      const result = await tAsk(tBody, tQuote, fields)
      assert.doesNotMatch(result.reply, /40 min(?:utos)?/)
      assert.notEqual(result.state.informationFocus?.serviceId, 'cut-w')
    }
    const owner = tRaw.communicativeActs.acts[0]!
    const duplicate = await tAsk(tBody, tQuote, {}, initial, undefined, [owner, owner])
    assert.doesNotMatch(duplicate.reply, /40 min(?:utos)?/)
    for (const op of [{ ...tRaw.turnPlan.operations[0]!, confidence: .5 },
      { ...tRaw.turnPlan.operations[0]!, evidence: 'inventado' },
      { ...tRaw.turnPlan.operations[0]!, target: service(['foreign'], 'duration') },
      { ...tRaw.turnPlan.operations[0]!, target: service(['cut-m'], 'duration') }]) {
      const result = await tAsk(tBody, tQuote, {}, initial, [op])
      assert.doesNotMatch(result.reply, /40 min(?:utos)?|30 min(?:utos)?/)
    }
    const plan = tRaw.turnPlan as any
    const scopes = currentModule.deriveCurrentServiceInquiries(tRaw.communicativeActs as any, plan, plan, tBody, context.businessId)
    assert.deepEqual(currentModule.remapCurrentServiceInquiries(scopes, plan, { version: 1, operations: [] }, tBody, context.businessId), [])
    assert.equal(tScope.validCurrentServiceInquiry({ ...scopes[0]!, businessId: 'foreign' }, plan.operations[0], tBody, context.businessId), false)
    assert.deepEqual(currentModule.remapCurrentServiceInquiries([{ ...scopes[0]!, operationIndex: 8 }],
      plan, plan, tBody, context.businessId), [])
  })
  await currentCheck('T qualifiers, mixed clauses and unknown facets cannot borrow base catalog facts', async () => {
    for (const message of [tBody + ' con lavado.', 'No quiero saber: ' + tBody, 'Si incluye lavado, ' + tBody,
      tBody + ' y cuánto cuesta.', tBody + ' para Corte hombre.', tBody + ' presupuesto exacto.',
      'Para el servicio Corte mujer sin lavado, ¿cuántos minutos dura?',
      'Para el servicio Corte mujer, ¿cuántos minutos dura si incluye lavado?']) {
      const quote = message.includes(tQuote) ? tQuote : '¿cuántos minutos dura'
      const result = await tAsk(message, quote)
      assert.doesNotMatch(result.reply, /40 min(?:utos)?|20[.,]?000/)
      assert.equal(result.state.informationFocus, undefined)
    }
  })
  await currentCheck('T current duration replaces produced price focus, without acquisition or extra agenda', async () => {
    const priceMessage = '¿Cuánto cuesta Corte mujer?'
    const priced = await respondWithAiInterpreter(context, initial, priceMessage, tPort, async () => ({ ...legacy,
      turnPlan: { version: 1, operations: [info(priceMessage, service(['cut-w'], 'price'))] },
      communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: priceMessage,
        confidence: 1, mention: 'Corte mujer', operationIndexes: [0] }] } }))
    assert.match(priced.reply, /20[.,]?000/)
    const result = await tAsk(tBody, tQuote, {}, priced.state)
    assert.match(result.reply, /40 min(?:utos)?/); assert.doesNotMatch(result.reply, /20[.,]?000/)
    assert.equal(result.state.informationFocus?.aspect, 'duration')
    let calls = 0
    // Build an active draft through the public API; its pending date is not a service-choice menu.
    const bookingBody = 'Quiero Corte hombre'
    const draft = await respondWithAiInterpreter(context, initial, bookingBody, tPort, async () => ({ ...legacy, intent: 'booking',
      turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [],
        members: [{ mode: 'single', serviceIds: ['cut-m'], evidence: 'Corte hombre', confidence: 1 }], ...ev('Corte hombre') }] },
      communicativeActs: { version: 1, acts: [{ kind: 'request', field: 'service', evidence: bookingBody,
        confidence: 1, mention: 'Corte hombre', operationIndexes: [0] }] } }))
    const focusedDraft = await tAsk(tBody, tQuote, {}, draft.state)
    // Separate compatible prepared query: raw V13 legitimately creates new facts after admission.
    const preparedBody = '¿Cuál es la duración de Corte mujer?'
    const prepared = await respondWithAiInterpreter(context, focusedDraft.state, preparedBody, tPort, async input => {
      calls++
      return { ...tRaw, turnPlan: { version: 1, operations: [{ ...tRaw.turnPlan.operations[0]!, evidence: preparedBody }] },
        communicativeActs: { version: 1, acts: [{ ...tRaw.communicativeActs.acts[0]!, evidence: preparedBody }] },
        firstReply: { salutation: null, opening: 'Con gusto te ayudo.',
        factIds: input.firstReplyFacts!.map(fact => fact.id), closing: null, variantChoices: null } }
    })
    assert.equal(calls, 1); assert.equal(prepared.interpretation.aiCalls, 1)
    assert.equal(prepared.interpretation.replyValidation?.firstCall.status, 'accepted')
    assert.equal(prepared.interpretation.replyValidation?.secondCall.status, 'not_attempted')
    assert.equal(prepared.interpretation.copyMode, 'ai')
    assert.match(prepared.reply, /40 min(?:utos)?/)
  })


  await currentCheck('T rejected current inquiry denies acquisition without an old focus', async () => {
    const draftBody = 'Quiero Corte hombre'
    const draft = await respondWithAiInterpreter(context, initial, draftBody, tPort, async () => ({ ...legacy, intent: 'booking',
      turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [],
        members: [{ mode: 'single', serviceIds: ['cut-m'], ...ev('Corte hombre') }], ...ev('Corte hombre') }] },
      communicativeActs: { version: 1, acts: [{ kind: 'request', field: 'service', evidence: draftBody,
        confidence: 1, mention: 'Corte hombre', operationIndexes: [0] }] } }))
    for (const state of [initial, pFocus, draft.state]) {
      const result = await tAsk(tBody, tQuote, { mention: 'Corte hombre' }, state)
      assert.equal(result.interpretation.mode, 'fallback'); assert.equal(result.interpretation.reason, 'invalid_output')
      assert.deepEqual(result.state.informationFocus, state.informationFocus)
      assert.equal(result.state.serviceId, state.serviceId)
      assert.equal(result.state.date, state.date); assert.equal(result.state.slot, state.slot)
      assert.doesNotMatch(result.reply, /40 min(?:utos)?|20[.,]?000|reservar tu/)
      assert.match(result.reply, /No pude confirmar.*consulta/)
    }
  })
  await currentCheck('T original malformed companions and forged markers gain no new denial authority', async () => {
    for (const patch of [
      { turnPlan: { version: 1, operations: [{ ...tRaw.turnPlan.operations[0]!, evidence: 'inventado' }] } },
      { turnPlan: { version: 1, operations: [{ ...tRaw.turnPlan.operations[0]!, target: service(['foreign'], 'duration') }] } },
      { turnPlan: { version: 1, operations: [tRaw.turnPlan.operations[0]!, info(tQuote, service(['cut-w'], 'duration'))] } },
      { rejectedInformation: { businessId: context.businessId, currentBody: tBody } },
      { rejectedInformation: { businessId: 'foreign', currentBody: 'previous body' } }
    ]) {
      let calls = 0
      const before = JSON.stringify(initial), reads = agendaCalls
      const result = await respondWithAiInterpreter(context, initial, tBody, tPort, async () => { calls++; return { ...tRaw, ...patch } })
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.equal(result.interpretation.validation?.outcome, 'rejected')
      assert.doesNotMatch(result.reply, /40 min(?:utos)?/)
      assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
      assert.equal(JSON.stringify(initial), before); assert.equal(calls, 1); assert.equal(agendaCalls, reads)
      // Malformed original sources carry no eligible marker. The retained original no-acquisition
      // regression above independently verifies this boundary; rejection alone is not safety proof.
    }
    let providerCalls = 0
    await assert.rejects(() => respondWithAiInterpreter(context, initialDialogueState('foreign'), tBody, tPort,
      async () => { providerCalls++; return tRaw }), /state|scope/)
    assert.equal(providerCalls, 0)
  })


  await currentCheck('T independent rejection denial preserves empty or produced draft without trusting invalid IDs', async () => {
    for (const state of [initial, pFocus]) for (const patch of [
      { evidence: 'inventado' }, { target: service(['foreign'], 'duration') }
    ]) {
      const result = await tAsk(tBody, tQuote, {}, state, [{ ...tRaw.turnPlan.operations[0]!, ...patch }])
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.deepEqual(result.state.informationFocus, state.informationFocus)
      assert.equal(result.state.serviceId, state.serviceId)
      assert.doesNotMatch(result.reply, /40 min(?:utos)?|20[.,]?000|reservar tu/)
      assert.match(result.reply, /No pude confirmar.*consulta/)
    }
  })
  await currentCheck('T deny-only body gate does not widen qualified history mixed or provider-failure routes', async () => {
    for (const message of [tBody + ' con lavado.', 'Antes consulté: ' + tBody,
      tBody + ' y Corte hombre.', tBody + ' Quiero agendar Corte hombre.']) {
      const before = JSON.stringify(initial), reads = agendaCalls
      assert.equal(tScope.neutralOwnedServiceInquiry(message, 'Corte mujer', 'duration'), false)
      const result = await respondWithAiInterpreter(context, initial, message, tPort,
        async () => ({ ...tRaw, turnPlan: { version: 1, operations: [{ ...tRaw.turnPlan.operations[0]!, evidence: 'inventado' }] } }))
      assert.equal(result.interpretation.reason, 'invalid_output')
      assert.doesNotMatch(result.reply, /No pude confirmar esa consulta/)
      if (!message.includes('Corte hombre')) assert.doesNotMatch(result.reply, /40 min(?:utos)?/)
      // Mixed or multi-identity legacy menus may show existing catalog facts; the new deny guard supplies none.
      assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined)
      assert.equal(JSON.stringify(initial), before); assert.equal(agendaCalls, reads)
    }
    const failed = await respondWithAiInterpreter(context, initial, tBody, tPort,
      async () => { throw new Error('controlled provider failure') })
    assert.equal(failed.interpretation.mode, 'fallback')
    assert.notEqual(failed.interpretation.reason, 'invalid_output')
    assert.doesNotMatch(failed.reply, /No pude confirmar esa consulta/)
  })

  console.log('current service inquiry: ' + currentPassed + ' passed, ' + currentFailures.length + ' failed')
  assert.deepEqual(currentFailures, [], 'current service inquiry regressions')

  console.log('qualified inquiry: ' + inquiryPassed + ' passed, ' + inquiryFailures.length + ' failed')
  assert.deepEqual(inquiryFailures, [], 'qualified inquiry regressions')
  console.log('information focus, price continuity, loaded service facts and missing-data regression: PASS')
} finally {
  globalThis.fetch = originalFetch
  http.request = originalHttp
  https.request = originalHttps
  http.get = originalHttpGet
  https.get = originalHttpsGet
}
