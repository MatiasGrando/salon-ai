import assert from 'node:assert/strict'
import Fastify from 'fastify'
import vm from 'node:vm'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const response = await app.inject('/crm')
assert.equal(response.statusCode, 200)
await app.close()

function source(name: string, required = true) {
  const match = response.body.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))?.[0]
  if (required) assert.ok(match, 'rendered production function ' + name)
  return match || ''
}

const functions = ['normalizePhone', 'whatsappAppUrl', 'formatAppointmentReminderDate', 'formatAppointmentReminderTime', 'buildAppointmentReminderMessage', 'updateAppointmentContactActions'].map((name) => source(name)).join('\n') + source('buildAgendaAppointmentWhatsappMessage', false)

function harness() {
  const appointment: any = {
    id: 'appointment-1', startAt: '2026-08-19T19:30:00.000Z',
    customer: { name: 'Leo', phone: '+54 9 11 1234-5678' },
    service: { id: 'cut', name: 'Corte' }, professional: { id: 'mati', name: 'Mati Castellino' }
  }
  const state: any = {
    editingAppointmentId: appointment.id,
    business: { publicAddress: 'Franklin Delano Roosevelt 5520', timezone: 'America/Argentina/Buenos_Aires' },
    services: [appointment.service, { id: 'color', name: 'Color & nutrición' }],
    professionals: [appointment.professional, { id: 'other', name: 'María Pérez' }]
  }
  const els: any = {
    appointmentCustomerName: { value: 'Leo' }, appointmentCustomerPhone: { value: appointment.customer.phone },
    appointmentStart: { value: '2026-08-19T16:30' }, appointmentService: { value: 'cut' }, appointmentProfessional: { value: 'mati' },
    appointmentWhatsapp: { href: '', hidden: false }, appointmentOpenChat: { dataset: {}, disabled: false }, appointmentAttentionPicker: {}
  }
  let mayMessage = true, mayView = true
  const context: any = vm.createContext({ state, els,
    canViewAppointmentCustomerData: () => mayView,
    canOpenAppointmentConversations: () => true,
    canMessageAppointmentCustomer: () => mayMessage,
    canEditAppointments: () => true, canCreateAppointments: () => true
  })
  vm.runInContext(functions, context)
  return { appointment, state, els, context, denyMessage: () => { mayMessage = false }, denyContact: () => { mayView = false } }
}

function message(h: ReturnType<typeof harness>) {
  h.context.updateAppointmentContactActions(h.appointment)
  return new URL(h.els.appointmentWhatsapp.href).searchParams.get('text')
}

{
  const h = harness()
  assert.equal(message(h), [
    'Hola Leo!', 'Te queremos recordar tu cita de Corte', '',
    '⏰ ¿Cuándo?: 19/08/2026 16:30hs',
    '📍 ¿Dónde?: Franklin Delano Roosevelt 5520',
    '👤 ¿Con quién?: Mati Castellino', '', '¡Te esperamos!'
  ].join('\n'), 'Agenda WhatsApp matches the requested personalized reminder')
  assert.match(h.els.appointmentWhatsapp.href, /^whatsapp:\/\/send\?phone=5491112345678&text=/)
  assert.match(h.els.appointmentWhatsapp.href, /%0A|%C2%BF/)
  assert.equal(h.els.appointmentOpenChat.dataset.reminderMessage, h.context.buildAppointmentReminderMessage({
    ...h.appointment, startAt: h.els.appointmentStart.value
  }), 'chat keeps the original shared reminder')
}

{
  const h = harness()
  h.els.appointmentCustomerName.value = 'José Álvarez'
  h.els.appointmentService.value = 'color'
  h.els.appointmentProfessional.value = 'other'
  h.els.appointmentStart.value = '2026-09-20T09:05'
  h.state.business.publicAddress = 'Av. Córdoba 123 & local 2'
  const text = message(h)!
  assert.ok(text.startsWith('Hola José Álvarez!\nTe queremos recordar tu cita de Color & nutrición'))
  assert.ok(text.includes('20/09/2026 09:05hs'))
  assert.ok(text.includes('👤 ¿Con quién?: María Pérez'))
  assert.ok(text.includes('📍 ¿Dónde?: Av. Córdoba 123 & local 2'))
  assert.doesNotMatch(text, /Leo|Mati Castellino/)
  assert.equal(new URL(h.els.appointmentWhatsapp.href).searchParams.get('phone'), '5491112345678', 'multiline text cannot modify recipient')
}

{
  const h = harness()
  h.state.business.publicAddress = '  '
  h.state.professionals = []
  h.els.appointmentProfessional.value = ''
  h.appointment.professional = null
  h.els.appointmentStart.value = ''
  const text = message(h)!
  assert.ok(text.includes('19/08/2026 16:30hs'), 'stored instant falls back to the business timezone')
  assert.doesNotMatch(text, /📍|👤|undefined|null/)
  h.appointment.startAt = null
  h.appointment.customer.name = ''
  h.appointment.service = null
  h.state.services = []
  h.els.appointmentCustomerName.value = ''
  h.els.appointmentService.value = ''
  const missing = message(h)!
  assert.ok(missing.startsWith('Hola cliente!\nTe queremos recordar tu cita de servicio'))
  assert.ok(missing.includes('Fecha y horario a confirmar'))
  h.appointment.startAt = 'invalid'
  assert.ok(h.context.buildAgendaAppointmentWhatsappMessage(h.appointment).includes('Fecha y horario a confirmar'), 'new generator safely handles an invalid date without changing the shared legacy formatter')
}

for (const deny of ['denyMessage', 'denyContact'] as const) {
  const h = harness()
  h[deny]()
  h.context.updateAppointmentContactActions(h.appointment)
  assert.equal(h.els.appointmentWhatsapp.hidden, true)
  assert.equal(h.els.appointmentWhatsapp.href, '#')
}

{
  const h = harness()
  h.els.appointmentCustomerPhone.value = ''
  h.appointment.customer.phone = ''
  h.context.updateAppointmentContactActions(h.appointment)
  assert.equal(h.els.appointmentWhatsapp.hidden, true, 'no phone means no WhatsApp action')
  h.state.editingAppointmentId = null
  h.context.updateAppointmentContactActions(null)
  assert.equal(h.els.appointmentWhatsapp.href, '#', 'new unsaved appointment still has no message action')
}

console.log('Agenda WhatsApp reminder: exact wording, live selections, date/time, optional details, URL and permissions OK')
