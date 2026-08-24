import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  TamaraOptionsBot,
  type TamaraOptionsBotGateway
} from '../src/services/tamara-options-bot.js'

const reservationCalls: unknown[] = []
const rescheduleCalls: unknown[] = []
let availableDateCalls = 0
const exactTimeSearches: string[] = []
const gateway: TamaraOptionsBotGateway = {
  async getContact() {
    return {
      email: 'contacto@tamara.test',
      website: 'https://tamara.test',
      instagram: 'https://instagram.com/tamara',
      facebook: null,
      tiktok: null
    }
  },
  async getWorkingHours() {
    return [{ dayLabel: 'Lunes', ranges: ['09:00 a 18:00'] }]
  },
  async getCategories() {
    return [{ id: 'consultas', name: 'Consultas' }]
  },
  async getServices() {
    return [{ id: 'consulta', name: 'Consulta inicial', durationMinutes: 60 }]
  },
  async getAvailableDates(input) {
    availableDateCalls += 1
    if (input.exactTime) exactTimeSearches.push(input.exactTime)
    if (input.exactTime === '23:00') return []
    return [{ date: '2026-08-25', label: 'Martes 25/08' }]
  },
  async getAvailableTimes() {
    return ['14:00', '15:00']
  },
  async getUpcomingAppointments() {
    return [{
      id: 'appointment-1',
      date: '2026-08-25',
      dateLabel: 'Martes 25/08',
      time: '14:00',
      serviceName: 'Consulta inicial',
      serviceId: 'consulta',
      serviceIds: ['consulta'],
      depositStatus: 'APPROVED'
    }]
  },
  async getCustomerName() {
    return null
  },
  async reserve(input) {
    reservationCalls.push(input)
    return { ok: true, appointmentId: 'appointment-2', requiresDeposit: false }
  },
  async reschedule(input) {
    rescheduleCalls.push(input)
    return { ok: true }
  }
}

const bot = new TamaraOptionsBot(gateway)
const [configurationService, runtimeSource, webhookSource, gatewaySource, crmRoute, crmUi] = await Promise.all([
  readFile('src/services/business-bot-configuration-service.ts', 'utf8'),
  readFile('src/services/business-support-bot-runtime.ts', 'utf8'),
  readFile('src/services/whatsapp-webhook-service.ts', 'utf8'),
  readFile('src/services/tamara-options-bot-gateway.ts', 'utf8'),
  readFile('src/routes/crm.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8')
])

assert.match(configurationService, /assignTamaraOptionsBotToBusiness/)
assert.match(configurationService, /TAMARA_OPTIONS_BOT_DEFINITION/)
assert.match(runtimeSource, /TAMARA_OPTIONS_BOT_KEY/)
assert.match(runtimeSource, /PrismaTamaraOptionsBotGateway/)
assert.match(runtimeSource, /select: \{ supportBotState: true, updatedAt: true, phone: true \}/)
assert.doesNotMatch(runtimeSource, /async function conversationPhone/)
assert.match(runtimeSource, /const conversation = input\.conversationSnapshot \?\? await prisma\.conversation\.findUnique/)
assert.match(webhookSource, /previousActivityAt: firstMessage\.previousActivityAt/)
assert.match(webhookSource, /interactiveReplyId: effectiveInteractiveReplyId/)
assert.match(webhookSource, /TAMARA_STALE_INTERACTIVE_REPLY_ID/)
assert.match(webhookSource, /recoverStaleTamaraReply/)
assert.match(webhookSource, /conversation\.supportBotKey === TAMARA_OPTIONS_BOT_KEY/)
assert.match(webhookSource, /immediate: Boolean\(message\.interactiveReplyId \|\| message\.media \|\| isTamaraOptionsBot\)/)
assert.match(webhookSource, /new LatencyDiagnostic\('whatsapp_inbound'\)/)
assert.match(webhookSource, /conversationResult as \{ supportBot\?: string \}\)\.supportBot === TAMARA_OPTIONS_BOT_KEY/)
assert.match(webhookSource, /existingConversationPromise = prisma\.conversation\.findUnique/)
assert.match(webhookSource, /existingConversation \?\? await prisma\.conversation\.upsert\(conversationUpsert\)/)
assert.match(webhookSource, /conversationSnapshot: \{\s*supportBotState: firstMessage\.supportBotState,\s*updatedAt: firstMessage\.previousActivityAt,\s*phone: firstMessage\.phone/s)
assert.match(webhookSource, /status: admission\.accepted\s*\? isTamaraOptionsBot && conversation\.aiEnabled\s*\? 'queued_bot'\s*: 'received'/s)
assert.match(webhookSource, /activeInteractivePromptToken: null/)
assert.match(webhookSource, /!isTamaraOptionsBot &&\s*!recoverStaleTamaraReply &&\s*message\.interactiveReplyId &&\s*parseVersionedInteractiveReplyId/s)
assert.match(webhookSource, /!automaticMessage\.interactivePromptToken && inboundMessage\.status === 'received'/)
assert.match(gatewaySource, /findAvailabilityMany\(/)
assert.match(gatewaySource, /professional: \{\s*businessId: input\.businessId,\s*isActive: true,\s*acceptsBotBookings: true\s*\}/s)
assert.doesNotMatch(gatewaySource, /Promise\.all\(candidates\.map\(async \(date\).*findAvailability/s)
assert.match(crmRoute, /tamaraOptionsBotEnabled/)
assert.match(crmUi, /id="tamara-options-bot-toggle"/)
assert.match(crmUi, /toggleTamaraOptionsBot/)

const start = await bot.start({ businessId: 'business-1', phone: '5491100000000' })

assert.equal(start.state.node, 'MAIN_MENU')
assert.deepEqual(start.options.slice(0, 7).map((option) => option.title), [
  'Reservar un horario',
  'Mis reservas',
  'Primera consulta',
  'Horarios de atención',
  'Propuestas laborales',
  'Redes y contacto',
  'Atención humana'
])

const invalid = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'reservar un horario',
  state: start.state,
  previousActivityAt: new Date('2026-08-24T10:00:00.000Z'),
  now: new Date('2026-08-24T10:05:00.000Z')
})
assert.equal(invalid.state.node, 'MAIN_MENU')
assert.match(invalid.message, /no coincide/i)

const proposal = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Propuestas laborales',
  state: start.state,
  previousActivityAt: new Date('2026-08-24T10:00:00.000Z'),
  now: new Date('2026-08-24T10:05:00.000Z')
})
assert.equal(proposal.state.node, 'PROPOSAL_CHANNEL')
assert.match(proposal.message, /contacto@tamara\.test/)

const proposalByChat = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Enviar por este medio',
  state: proposal.state,
  previousActivityAt: new Date('2026-08-24T10:05:00.000Z'),
  now: new Date('2026-08-24T10:06:00.000Z')
})
assert.equal(proposalByChat.state.node, 'PROPOSAL_NAME')
assert.match(proposalByChat.message, /nombre/i)

const namedProposal = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Lucía Pérez',
  state: proposalByChat.state,
  previousActivityAt: new Date('2026-08-24T10:06:00.000Z'),
  now: new Date('2026-08-24T10:07:00.000Z')
})
assert.equal(namedProposal.state.node, 'PROPOSAL_TEXT')
assert.equal(namedProposal.state.context.customerName, 'Lucía Pérez')

const expired = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Una propuesta que ya no debe continuar',
  state: namedProposal.state,
  previousActivityAt: new Date('2026-08-24T10:07:00.000Z'),
  now: new Date('2026-08-24T12:07:00.001Z')
})
assert.equal(expired.state.node, 'MAIN_MENU')
assert.deepEqual(expired.state.context, {})
assert.equal(expired.reset, true)
assert.match(expired.message, /empezar/i)

const appointments = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Mis reservas',
  state: start.state,
  previousActivityAt: new Date('2026-08-24T10:00:00.000Z'),
  now: new Date('2026-08-24T10:05:00.000Z')
})
assert.equal(appointments.state.node, 'APPOINTMENT_LIST')

const selectedAppointment = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Martes 25/08 · 14:00',
  state: appointments.state,
  previousActivityAt: new Date('2026-08-24T10:05:00.000Z'),
  now: new Date('2026-08-24T10:06:00.000Z')
})
assert.equal(selectedAppointment.state.node, 'APPOINTMENT_ACTION')
assert.ok(selectedAppointment.options.some((option) => option.title === 'Cancelar reserva'))

const cancellation = await bot.handle({
  businessId: 'business-1',
  phone: '5491100000000',
  message: 'Cancelar reserva',
  state: selectedAppointment.state,
  previousActivityAt: new Date('2026-08-24T10:06:00.000Z'),
  now: new Date('2026-08-24T10:07:00.000Z')
})
assert.equal(cancellation.status, 'completed')
assert.equal(cancellation.handoff?.kind, 'cancellation_retention')
assert.equal(cancellation.handoff?.appointmentId, 'appointment-1')
assert.equal(cancellation.mutation, undefined)

const bookingCategory = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Reservar un horario', state: start.state,
  previousActivityAt: new Date('2026-08-24T10:00:00.000Z'), now: new Date('2026-08-24T10:01:00.000Z')
})
const bookingService = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Consultas', state: bookingCategory.state,
  previousActivityAt: new Date('2026-08-24T10:01:00.000Z'), now: new Date('2026-08-24T10:02:00.000Z')
})
const bookingDate = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Consulta inicial', state: bookingService.state,
  previousActivityAt: new Date('2026-08-24T10:02:00.000Z'), now: new Date('2026-08-24T10:03:00.000Z')
})
assert.equal(bookingDate.state.node, 'BOOK_DATE_METHOD')
assert.deepEqual(bookingDate.options.slice(0, 3).map((option) => option.title), [
  'Ver próximos días',
  'Elegir fecha exacta',
  'Buscar por horario'
])
const bookingAvailableDates = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Ver próximos días', state: bookingDate.state,
  previousActivityAt: new Date('2026-08-24T10:03:00.000Z'), now: new Date('2026-08-24T10:03:30.000Z')
})
assert.equal(bookingAvailableDates.state.node, 'BOOK_DATE')
const availableDateCallsBeforeSelection = availableDateCalls
const bookingTime = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Martes 25/08', state: bookingAvailableDates.state,
  previousActivityAt: new Date('2026-08-24T10:03:00.000Z'), now: new Date('2026-08-24T10:04:00.000Z')
})
assert.equal(availableDateCalls, availableDateCallsBeforeSelection + 1, 'seleccionar un día no debe recalcular dos veces la misma lista')
const bookingName = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: '14:00', state: bookingTime.state,
  previousActivityAt: new Date('2026-08-24T10:04:00.000Z'), now: new Date('2026-08-24T10:05:00.000Z')
})

const specificTimePrompt = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Buscar horario exacto', state: bookingTime.state,
  previousActivityAt: new Date('2026-08-24T10:04:00.000Z'), now: new Date('2026-08-24T10:04:15.000Z')
})
const nearbyTimes = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: '23:00', state: specificTimePrompt.state,
  previousActivityAt: new Date('2026-08-24T10:04:15.000Z'), now: new Date('2026-08-24T10:04:30.000Z')
})
assert.equal(nearbyTimes.state.node, 'BOOK_TIME')
assert.match(nearbyTimes.message, /horarios disponibles más cercanos/i)
assert.match(nearbyTimes.message, /próximos días/i)
assert.match(nearbyTimes.message, /sin (?:tener que )?probar día por día/i)
assert.deepEqual(nearbyTimes.options.slice(0, 3).map((option) => option.title), [
  '15:00',
  '14:00',
  'Buscar por horario'
])
const searchedUpcomingDays = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Buscar por horario', state: nearbyTimes.state,
  previousActivityAt: new Date('2026-08-24T10:04:30.000Z'), now: new Date('2026-08-24T10:04:45.000Z')
})
assert.ok(exactTimeSearches.includes('23:00'))
assert.equal(searchedUpcomingDays.state.node, 'BOOK_TIME')
assert.match(searchedUpcomingDays.message, /próximos 30 días/i)

const bookingConfirm = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Lucía Pérez', state: bookingName.state,
  previousActivityAt: new Date('2026-08-24T10:05:00.000Z'), now: new Date('2026-08-24T10:06:00.000Z')
})
const booked = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Confirmar', state: bookingConfirm.state,
  previousActivityAt: new Date('2026-08-24T10:06:00.000Z'), now: new Date('2026-08-24T10:07:00.000Z')
})
assert.equal(booked.mutation?.kind, 'reserved')
assert.equal(reservationCalls.length, 1)
assert.equal(booked.state.node, 'MAIN_MENU')

const rescheduleDate = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Reprogramar turno', state: selectedAppointment.state,
  previousActivityAt: new Date('2026-08-24T10:06:00.000Z'), now: new Date('2026-08-24T10:07:00.000Z')
})
assert.equal(rescheduleDate.state.node, 'BOOK_DATE_METHOD')
const rescheduleAvailableDates = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Ver próximos días', state: rescheduleDate.state,
  previousActivityAt: new Date('2026-08-24T10:07:00.000Z'), now: new Date('2026-08-24T10:07:30.000Z')
})
const rescheduleTime = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Martes 25/08', state: rescheduleAvailableDates.state,
  previousActivityAt: new Date('2026-08-24T10:07:00.000Z'), now: new Date('2026-08-24T10:08:00.000Z')
})
const rescheduleConfirm = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: '15:00', state: rescheduleTime.state,
  previousActivityAt: new Date('2026-08-24T10:08:00.000Z'), now: new Date('2026-08-24T10:09:00.000Z')
})
const rescheduled = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Confirmar', state: rescheduleConfirm.state,
  previousActivityAt: new Date('2026-08-24T10:09:00.000Z'), now: new Date('2026-08-24T10:10:00.000Z')
})
assert.equal(rescheduled.mutation?.kind, 'rescheduled')
assert.equal((rescheduleCalls[0] as { appointmentId: string }).appointmentId, 'appointment-1')

const exactDatePrompt = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Elegir fecha exacta', state: bookingDate.state,
  previousActivityAt: new Date('2026-08-24T10:03:00.000Z'), now: new Date('2026-08-24T10:03:30.000Z')
})
assert.equal(exactDatePrompt.state.node, 'BOOK_SPECIFIC_DATE')
assert.match(exactDatePrompt.message, /DD\/MM\/AAAA/)
const exactDateTime = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: '25/08/2026', state: exactDatePrompt.state,
  previousActivityAt: new Date('2026-08-24T10:03:30.000Z'), now: new Date('2026-08-24T10:04:00.000Z')
})
assert.equal(exactDateTime.state.node, 'BOOK_TIME')
assert.equal(exactDateTime.state.context.selectedDate, '2026-08-25')

const staleDateReply = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Lunes 24-08',
  interactiveReplyId: 'system:tamara_stale_prompt', state: bookingAvailableDates.state,
  previousActivityAt: new Date('2026-08-24T10:04:00.000Z'), now: new Date('2026-08-24T10:04:30.000Z')
})
assert.equal(staleDateReply.state.node, 'BOOK_DATE')
assert.equal(staleDateReply.state.invalidAttempts, 0)
assert.match(staleDateReply.message, /lista anterior ya venció/i)
assert.ok(staleDateReply.options.some((option) => option.title === 'Martes 25/08'))

const navigableResults = [
  start,
  invalid,
  proposal,
  proposalByChat,
  namedProposal,
  expired,
  appointments,
  selectedAppointment,
  bookingCategory,
  bookingService,
  bookingDate,
  bookingAvailableDates,
  bookingTime,
  specificTimePrompt,
  nearbyTimes,
  searchedUpcomingDays,
  bookingName,
  bookingConfirm,
  rescheduleDate,
  rescheduleAvailableDates,
  rescheduleTime,
  rescheduleConfirm,
  exactDatePrompt,
  exactDateTime,
  staleDateReply
]

for (const result of navigableResults) {
  assert.ok(result.options.length <= 10, `${result.state.node} excede el máximo de opciones interactivas`)
  for (const navigation of [
    { id: 'global:back', title: 'Volver' },
    { id: 'global:menu', title: 'Menú principal' },
    { id: 'global:human', title: 'Atención humana' }
  ]) {
    assert.ok(
      result.options.some((option) => option.id === navigation.id && option.title === navigation.title),
      `${result.state.node} debe conservar la opción ${navigation.title}`
    )
  }
}

console.log('Tamara options bot contract: OK (opciones estrictas, timeout, propuestas y retención)')
