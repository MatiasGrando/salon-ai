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
  assert.match(wronglyNamedChoice.reply, /Corte hombre.*27[.,]?000/)

  const selected = await say(price.state, 'hombre')
  assert.match(selected.reply, /Corte hombre.*27[.,]?000/)
  assert.doesNotMatch(selected.reply, /Corte mujer|Corte y barba/)
  assert.equal(selected.state.serviceId, null)
  assert.equal(selected.state.informationFocus?.serviceId, 'cut')
  assert.equal(selected.bookingCommand, undefined)
  const fallback = await respondWithAiInterpreter(context, price.state, 'corte hombre', port, async () => { throw new Error('fake failure') })
  assert.match(fallback.reply, /Corte hombre.*27[.,]?000/)
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
  assert.match(duration.reply, /Baño de crema.*30 min/)
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
  assert.doesNotMatch(missing.reply, /presupuesto|opciones del servicio pendiente/)
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
  assert.match(newService.reply, /Corte hombre.*27[.,]?000/)
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
  console.log('information focus, price continuity, loaded service facts and missing-data regression: PASS')
} finally {
  globalThis.fetch = originalFetch
  http.request = originalHttp
  https.request = originalHttps
  http.get = originalHttpGet
  https.get = originalHttpsGet
}
