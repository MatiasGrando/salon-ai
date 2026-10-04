import { presentAvailability, presentProfessionals, presentDateTimeQuestion, presentVerifiedDates } from '../src/conversational-bot/availability-presentation.js'
import { readInformation } from '../src/conversational-bot/information-read.js'
import assert from 'node:assert/strict'
import { initialDialogueState, respond, hasActiveBooking, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00Z') }
const services = [
  { id: 'cut', name: 'Corte hombre', price: 27000, durationMinutes: 30, requiresConsultation: false },
  { id: 'woman', name: 'Corte mujer', price: 37000, durationMinutes: 30, requiresConsultation: false },
  { id: 'both', name: 'Corte y barba', price: 32000, durationMinutes: 45, requiresConsultation: false }
]
const hours = '*Lunes*: Cerrado\n*Martes*: 11:00 a 20:00\n*Miércoles*: 11:00 a 20:00\n*Jueves*: 11:00 a 20:00\n*Viernes*: 11:00 a 20:00\n*Sábado*: 11:00 a 20:00\n*Domingo*: Cerrado\n\nLos horarios pueden variar por feriados o eventos especiales.'
const facts = { businessId: 'tenant', name: 'Negocio público', address: 'Calle 5252', area: 'Barrio', mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: 'https://www.instagram.com/negocio/', facebook: null, tiktok: null, description: null, hours }
let agendaCalls = 0
const port: DialoguePort = { identity: async () => ({ businessId: 'tenant', assistantName: 'Alba', businessName: 'Negocio público', treatment: 'vos', greetingEmoji: '😊' }), catalog: async () => services, information: async () => facts,
  availability: async () => { agendaCalls++; return { professionals: [], slots: [] } } }
const intro = '¡Holaa! 😊 Soy Alba, de Negocio público.\n\n'
const expectedHours = 'Estos son nuestros horarios de atención 😊\n\n• Lunes: Cerrado\n• Martes: 11:00 a 20:00\n• Miércoles: 11:00 a 20:00\n• Jueves: 11:00 a 20:00\n• Viernes: 11:00 a 20:00\n• Sábado: 11:00 a 20:00\n• Domingo: Cerrado\n\nLos horarios pueden cambiar en fechas especiales.\n\nSi querés saber qué turnos hay disponibles para un día en particular, decime qué día te interesa y lo revisamos.'
const list = '• Corte hombre — $27.000 · 30 min\n• Corte mujer — $37.000 · 30 min\n• Corte y barba — $32.000 · 45 min'
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
async function main() {
  const initial = () => initialDialogueState('tenant')
  const greeting = await respond(context, initial(), 'hola', port)
  assert.equal(greeting.reply, intro + '¿En qué te puedo ayudar?'); assert.equal(hasActiveBooking(greeting.state), false)
  const schedule = await respond(context, initial(), 'horarios del local', port)
  assert.equal(schedule.reply, intro + expectedHours)
  const social = await respond(context, greeting.state, 'instagram', port)
  assert.equal(social.reply, 'Claro 😊\n\nInstagram: https://www.instagram.com/negocio/')
  const missing = await respond(context, greeting.state, 'facebook', port)
  assert.equal(missing.reply, 'Todavía no tengo esa información cargada 😊\n\nSi querés, puedo ayudarte con otra consulta sobre Negocio público.')
  const address = await respond(context, greeting.state, 'dirección', port)
  assert.equal(address.reply, 'Estamos en Calle 5252, Barrio.\n\nTe dejo la ubicación para que llegues fácil:\nMaps: https://www.google.com/maps/search/?api=1&query=Negocio+p%C3%BAblico%2C+Calle+5252%2C+Barrio')
  const ambiguity = await respond(context, greeting.state, 'precio del corte', port)
  assert.equal(ambiguity.reply, 'Claro. ¿De cuál de estos servicios querés saber el precio?\n\n' + list)
  assert.equal(hasActiveBooking(ambiguity.state), false)
  const booking = await respond(context, greeting.state, 'quiero un corte mañana', port)
  assert.equal(booking.reply, 'Dale, por supuesto. ¿Cuál de estos servicios querés?\n\n' + list)
  const aiAmbiguity = await respondWithAiInterpreter(context, greeting.state, 'quiero un corte', port, async () => ({ intent: 'booking', serviceId: null, serviceEvidence: 'corte', professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: ['cut', 'woman', 'both'] }))
  assert.equal(aiAmbiguity.reply, 'Dale, por supuesto. ¿Cuál de estos servicios querés?\n\n' + list)
  assert.equal(aiAmbiguity.state.serviceId, null); assert.equal(aiAmbiguity.proposal, null)
  const provider: AiInterpretationProvider = async input => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, informationTarget: { kind: 'business', actions: ['HOURS'] }, firstReply: { opening: null, closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } })
  const ai = await respondWithAiInterpreter(context, initial(), 'horarios del local', port, provider)
  assert.equal(ai.reply, intro + expectedHours); assert.equal(ai.interpretation.aiCalls, 1)
  const rejected = await respondWithAiInterpreter(context, initial(), 'horarios del local', port, async () => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, informationTarget: { kind: 'business', actions: ['HOURS'] }, firstReply: { opening: 'Reservado', closing: null, factIds: [] } }), { responseProvider: async () => { throw new Error('stable facts forbid second call') } })
  assert.equal(rejected.reply, intro + expectedHours); assert.equal(rejected.interpretation.copyReason, 'invalid_response')
  const timed = await respondWithAiInterpreter(context, initial(), 'horarios del local', port, async () => new Promise(() => {}), { timeoutMs: 1 })
  assert.equal(timed.interpretation.reason, 'timeout'); assert.equal(timed.reply, intro + expectedHours); assert.equal((timed.reply.match(/Soy Alba/g) ?? []).length, 1)
  const repeatedFrame = await respondWithAiInterpreter(context, initial(), 'horarios del local', port, async input => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, informationTarget: { kind: 'business', actions: ['HOURS'] }, firstReply: { opening: '¡Dale!', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }))
  assert.ok(repeatedFrame.reply.startsWith(intro), 'configured introduction is first')
  const framedHours = repeatedFrame.reply.slice(intro.length).split('\n')
  assert.equal(framedHours.shift(), '¡Dale!', 'accepted transition follows the introduction')
  assert.equal(framedHours.join('\n'), expectedHours, 'all server-owned hours and conditions remain unchanged')
  assert.equal((repeatedFrame.reply.match(/Soy Alba/g) ?? []).length, 1)
  assert.equal((repeatedFrame.reply.match(/¡Holaa!/g) ?? []).length, 1)
  assert.equal(repeatedFrame.interpretation.aiCalls, 1)
  assert.equal(repeatedFrame.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.equal(repeatedFrame.interpretation.copyMode, 'ai')
  const proPort: DialoguePort = { ...port, professionalInformation: async () => ({ businessId: 'tenant', complete: true, professionals: [{ id: 'p', name: 'Ana', description: null, services: [], schedule: '*Martes*: 11:00 a 20:00\nJornada habitual; no indica turnos libres.' }] }) }
  const professionals = await readInformation(context, greeting.state, 'profesionales', proPort, { kind: 'professional', actions: [], mention: null, serviceIds: [], date: null, weekday: null, aspect: 'overview' })
  assert.equal(professionals.reply, 'Estos son los profesionales del local 😊\n\n• Ana\n\nSi querés, también te puedo decir qué días y horarios trabaja cada uno.')
  assert.equal(presentProfessionals([{ id: 'p', name: 'Ana' }]).text, 'Perfecto 😊 ¿Con qué profesional te gustaría reservar?\n\nPodés elegir:\n1. Cualquier profesional\n2. Ana')
  assert.equal(presentDateTimeQuestion({ date: null, hasTemporalRequest: false, serviceName: 'Corte hombre' }), 'Perfecto 😊 ¿Para qué día y horario querés reservar tu Corte hombre?')
  const scope = { businessId: 'tenant', serviceIds: ['cut'], date: '2026-10-03', professionalId: 'p' }
  const slot = (time: string) => ({ date: '2026-10-03', time, startAt: '2026-10-03T' + String(Number(time.slice(0, 2)) + 3).padStart(2, '0') + time.slice(2) + ':00Z', professionalId: 'p', professionalName: 'Ana', occupiedMinutes: 30, band: 'AFTERNOON' as const })
  const availability = (times: string[]) => ({ scope, timezone: context.timezone, now: context.dbNow, read: { scope, fresh: true, slots: times.map(slot) } })
  const offered = presentAvailability({ ...availability(['13:00', '15:00']), preference: { kind: 'after', time: '13:00' } })
  assert.equal(offered.text, 'Perfecto 😊 Después de las 13:00 tengo estos horarios para el sábado 03/10 con Ana:\n\n1. sáb 03-10 a las 13:00 con Ana\n2. sáb 03-10 a las 15:00 con Ana\n\n¿Cuál te queda mejor?')
  assert.deepEqual(offered.choices.filter(choice => choice.kind === 'slot').map(choice => choice.slot.time), ['13:00', '15:00'])
  assert.equal('selectedSlot' in offered, false)
  const many = presentAvailability(availability(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']))
  assert.equal(many.text, 'Tengo bastante disponibilidad para el sábado 03/10 😊\n\n¿Más o menos en qué horario te gustaría venir?\n\nPodés indicar una hora o una preferencia: Por la tarde · Cualquier horario.')
  const extraHours = await respond(context, greeting.state, 'horarios del local', { ...port, information: async () => ({ ...facts, hours: hours + '\nExcepción: 05/10 cerrado por mantenimiento.\nAtención especial: martes sólo con turno.' }) })
  assert.equal(extraHours.reply, expectedHours.replace('\n\nLos horarios pueden cambiar', '\nExcepción: 05/10 cerrado por mantenimiento.\nAtención especial: martes sólo con turno.\n\nLos horarios pueden cambiar'))
  const unsafeSocial = await respond(context, greeting.state, 'instagram', { ...port, information: async () => ({ ...facts, instagram: 'javascript:alert(1)' }) })
  assert.equal(unsafeSocial.reply, missing.reply); assert.equal(hasActiveBooking(unsafeSocial.state), false)
  const scheduleRead = await readInformation(context, greeting.state, 'jornada Ana', proPort, { kind: 'professional', actions: [], mention: 'Ana', serviceIds: [], date: null, weekday: 2, aspect: 'schedule' })
  assert.equal(scheduleRead.reply, 'Estos son los profesionales del local 😊\n\n• Ana\n\nAna:\nHorario habitual:\n• Martes: 11:00 a 20:00\nJornada habitual; no indica turnos libres.')
  const detailPort: DialoguePort = { ...port, catalog: async () => [{ ...services[0]!, description: 'Incluye lavado y corte. Preparación: llegar con pelo seco.' }] }
  const detail = await respond(context, greeting.state, 'más info sobre corte hombre', detailPort)
  assert.equal(detail.reply, 'Claro 😊\n\nCorte hombre:\nIncluye lavado y corte. Preparación: llegar con pelo seco.\n$ 27.000\n30 min')
  const includes = await respond(context, detail.state, '¿Qué incluye?', detailPort)
  assert.equal(includes.reply, 'Claro 😊\n\nCorte hombre:\nIncluye lavado y corte. Preparación: llegar con pelo seco.')
  assert.equal(hasActiveBooking(includes.state), false)
  const conditions = 'Condición uno.\n  \nCondición dos.\r\n \t\r\nCondición tres.'
  const conditionsPort: DialoguePort = { ...port, catalog: async () => [{ ...services[0]!, description: conditions }] }
  const conditionMessage = 'más info sobre corte hombre'
  const canonicalConditions = await respond(context, greeting.state, conditionMessage, conditionsPort)
  const conditionProvider: AiInterpretationProvider = async input => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, informationTarget: { kind: 'service', actions: [], serviceIds: ['cut'], aspect: 'overview' }, firstReply: { opening: null, closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } })
  const validConditions = await respondWithAiInterpreter(context, greeting.state, conditionMessage, conditionsPort, conditionProvider)
  assert.equal(validConditions.reply, canonicalConditions.reply, 'valid IA keeps whitespace/CRLF-separated material facts')
  assert.ok(validConditions.reply.includes(conditions))
  const rejectedConditions = await respondWithAiInterpreter(context, greeting.state, conditionMessage, conditionsPort, async input => ({ intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, firstReply: { opening: null, closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id).reverse() } }))
  assert.equal(rejectedConditions.reply, canonicalConditions.reply)
  assert.equal(rejectedConditions.interpretation.copyReason, 'invalid_response')
  const failedConditions = await respondWithAiInterpreter(context, greeting.state, conditionMessage, conditionsPort, async () => { throw new Error('offline fixture failure') })
  assert.equal(failedConditions.reply, canonicalConditions.reply)
  const activeConditions = { ...greeting.state, serviceId: 'cut', pending: 'date' as const }
  const activeCanonical = await respond(context, activeConditions, conditionMessage, conditionsPort)
  const activeValid = await respondWithAiInterpreter(context, activeConditions, conditionMessage, conditionsPort, conditionProvider)
  assert.equal(activeValid.reply, activeCanonical.reply)
  assert.match(activeValid.reply, /¿Para qué día querés el turno\?$/)
  assert.ok(activeValid.reply.includes(conditions)); assert.equal(activeValid.state.serviceId, 'cut')
  const duration = await respond(context, includes.state, '¿Cuánto dura?', detailPort)
  assert.equal(duration.reply, 'Claro 😊\n\nCorte hombre:\n30 min')
  const side = await respond(context, { ...greeting.state, serviceId: 'cut', pending: 'date' }, 'dirección', port)
  assert.equal(side.reply, address.reply + '\n¿Para qué día querés el turno?')
  assert.equal(side.state.serviceId, 'cut'); assert.equal(side.proposal, null)
  const dateScope = { ...scope, date: null }
  const tomorrow = presentVerifiedDates({ ...availability(['13:00']), scope: dateScope, read: { fresh: true, scope: dateScope, slots: [slot('13:00')] } })
  assert.match(tomorrow.text, /Podés escribir, por ejemplo: Mañana a las 13:00/)
  assert.equal(tomorrow.example, '2026-10-03 a las 13:00', 'internal exact evidence is not rewritten')
  assert.equal(agendaCalls, 0)
  console.log('PASS final standard delivery: configured intro, hours, socials, missing, address, booking/price intent, valid/rejected/fallback AI')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
