import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  TamaraOptionsBot,
  type TamaraOptionsBotGateway
} from '../src/services/tamara-options-bot.js'

const reservationCalls: unknown[] = []
const rescheduleCalls: unknown[] = []
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
  async getAvailableDates() {
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
const [configurationService, runtimeSource, webhookSource, crmRoute, crmUi] = await Promise.all([
  readFile('src/services/business-bot-configuration-service.ts', 'utf8'),
  readFile('src/services/business-support-bot-runtime.ts', 'utf8'),
  readFile('src/services/whatsapp-webhook-service.ts', 'utf8'),
  readFile('src/routes/crm.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8')
])

assert.match(configurationService, /assignTamaraOptionsBotToBusiness/)
assert.match(configurationService, /TAMARA_OPTIONS_BOT_DEFINITION/)
assert.match(runtimeSource, /TAMARA_OPTIONS_BOT_KEY/)
assert.match(runtimeSource, /PrismaTamaraOptionsBotGateway/)
assert.match(webhookSource, /previousActivityAt: firstMessage\.previousActivityAt/)
assert.match(webhookSource, /interactiveReplyId: effectiveInteractiveReplyId/)
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
const bookingTime = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Martes 25/08', state: bookingDate.state,
  previousActivityAt: new Date('2026-08-24T10:03:00.000Z'), now: new Date('2026-08-24T10:04:00.000Z')
})
const bookingName = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: '14:00', state: bookingTime.state,
  previousActivityAt: new Date('2026-08-24T10:04:00.000Z'), now: new Date('2026-08-24T10:05:00.000Z')
})
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
const rescheduleTime = await bot.handle({
  businessId: 'business-1', phone: '5491100000000', message: 'Martes 25/08', state: rescheduleDate.state,
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

for (const result of [start, proposal, appointments, selectedAppointment, bookingCategory, bookingService, bookingDate, bookingTime]) {
  assert.ok(result.options.length <= 10, `${result.state.node} excede el máximo de opciones interactivas`)
}

console.log('Tamara options bot contract: OK (opciones estrictas, timeout, propuestas y retención)')
