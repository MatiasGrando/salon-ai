import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  publishAppointmentChanged,
  publishConversationUpdated,
  publishDepositUpdated,
  publishIncomingConversationMessage,
  publishOutgoingConversationMessage,
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'

const receivedByGlow: string[] = []
const receivedByOtherBusiness: string[] = []
const sentByGlow: string[] = []
const sentByOtherBusiness: string[] = []
const receivedTypesByGlow: string[] = []
const changedAppointmentsByGlow: string[] = []
const changedAppointmentsByOtherBusiness: string[] = []
const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => {
    receivedTypesByGlow.push(event.type)
    if (event.type === 'conversation_message_received') receivedByGlow.push(event.messageId)
    if (event.type === 'conversation_message_sent') sentByGlow.push(event.messageId)
    if (event.type === 'appointment_changed') changedAppointmentsByGlow.push(event.appointmentId)
  }
})
const unsubscribeOtherBusiness = subscribeToCrmRealtimeEvents({
  businessId: 'other-business',
  send: (event) => {
    if (event.type === 'conversation_message_received') receivedByOtherBusiness.push(event.messageId)
    if (event.type === 'conversation_message_sent') sentByOtherBusiness.push(event.messageId)
    if (event.type === 'appointment_changed') changedAppointmentsByOtherBusiness.push(event.appointmentId)
  }
})

publishIncomingConversationMessage({
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  receivedAt: '2026-08-19T15:30:00.000Z'
})

assert.deepEqual(receivedByGlow, ['message-1'])
assert.deepEqual(receivedByOtherBusiness, [])

publishOutgoingConversationMessage({
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-out-1',
  sentAt: '2026-08-19T15:30:00.500Z'
})

assert.deepEqual(sentByGlow, ['message-out-1'])
assert.deepEqual(sentByOtherBusiness, [])

publishConversationUpdated({
  businessId: 'glow',
  conversationId: 'conversation-1',
  updatedAt: '2026-08-19T15:30:01.000Z'
})

publishDepositUpdated({
  businessId: 'glow',
  depositId: 'deposit-1',
  updatedAt: '2026-08-19T15:30:02.000Z'
})

publishAppointmentChanged({
  businessId: 'glow',
  appointmentId: 'appointment-1',
  updatedAt: '2026-08-19T15:30:03.000Z'
})

assert.deepEqual(changedAppointmentsByGlow, ['appointment-1'])
assert.deepEqual(changedAppointmentsByOtherBusiness, [])

assert.deepEqual(receivedTypesByGlow, [
  'conversation_message_received',
  'conversation_message_sent',
  'conversation_updated',
  'deposit_updated',
  'appointment_changed'
])

unsubscribeGlow()
publishIncomingConversationMessage({
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-2',
  receivedAt: '2026-08-19T15:31:00.000Z'
})

assert.deepEqual(receivedByGlow, ['message-1'])
unsubscribeOtherBusiness()

const crmUiSource = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const whatsappWebhookSource = readFileSync(
  new URL('../src/services/whatsapp-webhook-service.ts', import.meta.url),
  'utf8'
)
const crmRouteSource = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const publicBookingRouteSource = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
const appointmentServiceSource = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
const demoProfileRouteSource = readFileSync(new URL('../src/routes/demo-profile.ts', import.meta.url), 'utf8')
const realtimeConfigSource = readFileSync(new URL('../src/config/crm-realtime.ts', import.meta.url), 'utf8')

assert.match(
  crmUiSource,
  /source\.addEventListener\('conversation_message_sent',[\s\S]*?queueConversationRealtimeRefresh\(payload\.conversationId,\s*\{[\s\S]*?messagesOnly:\s*true,[\s\S]*?messageId:\s*payload\.messageId/,
  'un mensaje saliente aceptado debe refrescarse por SSE sin esperar el sondeo de respaldo'
)
assert.match(
  crmUiSource,
  /source\.addEventListener\('conversation_updated',[\s\S]*?queueConversationRealtimeRefresh\(payload\.conversationId/,
  'el CRM debe refrescar el estado visual cuando termina el procesamiento de una conversación'
)
assert.match(
  crmUiSource,
  /fetchRealtimeConversation[\s\S]*?'\/crm\/conversations\/' \+ encodeURIComponent\(conversationId\)/,
  'los eventos deben consultar únicamente la conversación afectada'
)
assert.match(
  crmUiSource,
  /fetchRealtimeMessage[\s\S]*?'\/crm\/messages\/' \+ encodeURIComponent\(messageId\)/,
  'un mensaje entrante debe consultar únicamente el mensaje nuevo'
)
assert.match(
  crmRouteSource,
  /app\.get\('\/crm\/messages\/:id',[\s\S]*?prisma\.message\.findFirst/,
  'el servidor debe ofrecer una lectura puntual para un mensaje nuevo'
)
assert.match(
  crmUiSource,
  /if \(!CRM_REALTIME_EVENTS_ENABLED \|\| !window\.EventSource\)[\s\S]*?startCrmRealtimeFallback\(\)/,
  'el interruptor debe permitir volver al sondeo sin abrir el canal de eventos'
)
assert.match(
  crmUiSource,
  /source\.addEventListener\('open',[\s\S]*?stopCrmRealtimeFallback\(\)/,
  'el sondeo debe detenerse cuando el canal de eventos está conectado'
)
assert.match(
  realtimeConfigSource,
  /CRM_REALTIME_EVENTS_ENABLED,\s*true\)[\s\S]*?fallbackRefreshMs:\s*15_000/,
  'los eventos deben quedar activos por defecto y conservar un respaldo ante desconexiones'
)
assert.equal(
  crmUiSource.includes('CRM_REALTIME_SAFETY_POLLING_ENABLED'),
  false,
  'no debe mantenerse un sondeo paralelo mientras funcionan los eventos'
)
assert.match(
  crmUiSource,
  /source\.addEventListener\('deposit_updated',[\s\S]*?queueCrmRealtimeMetadataRefresh\(\{ refreshDeposits: true \}\)/,
  'las señas deben actualizar su contador o bandeja mediante un evento específico'
)
assert.match(
  crmUiSource,
  /source\.addEventListener\('appointment_changed',[\s\S]*?queueAgendaRealtimeRefresh\(\)/,
  'los cambios de turnos deben solicitar una actualización de la Agenda por SSE'
)
assert.match(
  crmUiSource,
  /function queueAgendaRealtimeRefresh\(\)[\s\S]*?currentSection !== 'agenda'[\s\S]*?setTimeout[\s\S]*?loadAgenda\(\)/,
  'la Agenda debe recargarse con debounce únicamente cuando su sección está visible'
)
for (const mutation of ['create', 'update', 'cancel', 'updateStatus', 'confirmPendingAppointments']) {
  const start = appointmentServiceSource.indexOf(`async ${mutation}(`)
  assert.notEqual(start, -1, `debe existir la mutación central ${mutation}`)
  const nextMethod = appointmentServiceSource.indexOf('\n  async ', start + 1)
  const source = appointmentServiceSource.slice(start, nextMethod === -1 ? undefined : nextMethod)
  assert.match(source, /publishAppointmentChanged\(/, `${mutation} debe publicar el cambio confirmado`)
  assert.ok(
    source.indexOf('await prisma.$transaction') < source.indexOf('publishAppointmentChanged('),
    `${mutation} debe publicar solamente después de resolver su transacción`
  )
}
assert.equal(
  crmUiSource.includes('CRM_LOCAL_EVENT_SYNC_MS'),
  false,
  'localhost tampoco debe mantener un sondeo paralelo cuando SSE funciona'
)
assert.match(
  crmRouteSource,
  /app\.get\('\/crm\/conversations\/:id',[\s\S]*?conversationListItemById/,
  'el servidor debe ofrecer una lectura puntual para actualizar una sola conversación'
)
assert.match(
  publicBookingRouteSource,
  /publishDepositUpdated\(\{[\s\S]*?depositId: deposit\.id/,
  'las señas web deben avisar al CRM al crearse o recibir un comprobante'
)
assert.match(
  demoProfileRouteSource,
  /publishIncomingConversationMessage\(\{[\s\S]*?messageId: inboundMessage\.id/,
  'el simulador local debe recorrer el mismo canal de eventos que los mensajes reales'
)
assert.match(
  crmRouteSource,
  /publishCrmConversationUpdated\(updated\)/,
  'los cambios manuales del CRM deben avisarse a las demás pestañas'
)
assert.match(
  crmUiSource,
  /const cached = serverFilter === 'handoff'\s*\? null\s*:\s*state\.conversationViewCache\.get/,
  'la bandeja de derivados siempre debe consultar su estado actual al abrirse'
)
const restoreConversationViewSource = crmUiSource.slice(
  crmUiSource.indexOf('function restoreConversationView('),
  crmUiSource.indexOf('function renderConversationTabActive(')
)
assert.doesNotMatch(
  restoreConversationViewSource,
  /state\.conversationCounts\s*=/,
  'una bandeja almacenada no debe reemplazar los contadores globales actuales'
)
assert.match(
  whatsappWebhookSource,
  /publishConversationUpdated\([\s\S]*?conversationId:\s*firstMessage\.conversationId/,
  'el webhook debe publicar el cambio de estado después de procesar la conversación'
)

console.log('CRM realtime events contract: OK')
