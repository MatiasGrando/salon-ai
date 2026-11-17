import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {
  publishAppointmentChanged,
  publishConversationUpdated,
  publishDepositUpdated,
  publishIncomingConversationMessage,
  publishInstagramPublicationChanged,
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
const changedPublicationsByGlow: string[] = []
const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => {
    receivedTypesByGlow.push(event.type)
    if (event.type === 'conversation_message_received') receivedByGlow.push(event.messageId)
    if (event.type === 'conversation_message_sent') sentByGlow.push(event.messageId)
    if (event.type === 'appointment_changed') changedAppointmentsByGlow.push(event.appointmentId)
    if (event.type === 'instagram_publication_changed') changedPublicationsByGlow.push(event.publicationId)
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

publishInstagramPublicationChanged({
  businessId: 'glow',
  publicationId: 'publication-1',
  status: 'PROCESSING',
  updatedAt: '2026-09-14T15:30:04.000Z'
})

assert.deepEqual(changedAppointmentsByGlow, ['appointment-1'])
assert.deepEqual(changedAppointmentsByOtherBusiness, [])
assert.deepEqual(changedPublicationsByGlow, ['publication-1'])

assert.deepEqual(receivedTypesByGlow, [
  'conversation_message_received',
  'conversation_message_sent',
  'conversation_updated',
  'deposit_updated',
  'appointment_changed',
  'instagram_publication_changed'
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
  /source\.addEventListener\('appointment_changed',[\s\S]*?refreshAgendaAppointment\(payload\.appointmentId\)/,
  'los cambios de turnos deben actualizar solo el turno identificado por SSE'
)
assert.match(
  crmUiSource,
  /function refreshAgendaAppointment\(appointmentId\)[\s\S]*?agendaAppointmentRefreshes/,
  'la actualización puntual debe compartir consultas en curso por turno'
)
const incrementalAgendaFunctions = crmUiSource.match(
  /function appointmentFitsAgendaRange\([\s\S]*?(?=\n    function queueAgendaRealtimeRefresh\()/
)?.[0]
assert.ok(incrementalAgendaFunctions, 'la Agenda debe incluir reconciliación puntual de un turno')
const appointmentDay = new Date('2026-11-16T00:00:00.000Z')
const originalAppointment = {
  id: 'appointment-1', professionalId: 'professional-1', startAt: '2026-11-16T15:00:00.000Z',
  status: 'CONFIRMED', financeSummary: { accountId: 'account-1', pendingAmount: 1200 }
}
const unrelatedAppointment = {
  id: 'appointment-2', professionalId: 'professional-2', startAt: '2026-11-16T16:00:00.000Z',
  status: 'CONFIRMED', financeSummary: { accountId: 'account-2', pendingAmount: 500 }
}
const rangeFrom = new Date('2026-11-09T00:00:00.000Z')
const rangeTo = new Date('2026-11-23T00:00:00.000Z')
const state = {
  businessId: 'business-1', agendaSelectedDate: appointmentDay, agendaViewDays: 1,
  agendaDeletingAppointmentIds: new Set(), agendaAppointments: [originalAppointment, unrelatedAppointment],
  agendaLoadedRangeStart: rangeFrom, agendaLoadedRangeEnd: rangeTo, agendaPointerDrag: false, agendaRangeSelection: false
}
const requestResolvers: ((value: unknown[]) => void)[] = []
const requestRejectors: ((error: Error) => void)[] = []
const agendaRequests: URL[] = []
let agendaRenderCount = 0
const agendaRefreshContext = {
  state,
  originalAppointment,
  unrelatedAppointment,
  els: { agendaProfessional: { value: '' }, appShell: { dataset: { section: 'agenda' } }, agendaGridWrap: { scrollTop: 88 } },
  URLSearchParams,
  document: { body: { dataset: { currentSection: 'agenda' } } },
  invalidateCustomerOverview: () => {},
  loadCustomerOverview: async () => {},
  agendaProfessionalPreferenceKey: () => 'business-scope',
  startOfDay: (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
  addDays: (date: Date, count: number) => new Date(date.getTime() + count * 86_400_000),
  renderAgenda: () => { agendaRenderCount += 1 },
  getJson: (url: string) => {
    agendaRequests.push(new URL(url, 'https://agenda.invalid'))
    return new Promise<unknown[]>((resolve, reject) => {
      requestResolvers.push(resolve)
      requestRejectors.push(reject)
    })
  }
}
const agendaRefreshApi = runInNewContext(`
  let crmWorkspaceVersion = 7, agendaRequest = null, agendaDataScope = 'business-scope',
    agendaDataProfessional = '', agendaDataStale = false, agendaMutationVersion = 2
  const agendaRangeCache = new Map([['all-professionals', {
    scope: 'business-scope', from: new Date('2026-11-09T00:00:00.000Z'), to: new Date('2026-11-23T00:00:00.000Z'),
    professional: '', mutationVersion: 2, appointments: [originalAppointment, unrelatedAppointment]
  }]])
  const agendaAppointmentRefreshes = new Map()
  ${incrementalAgendaFunctions}
  ;({ refreshAgendaAppointment, setWorkspaceVersion: (version) => { crmWorkspaceVersion = version } })
`, agendaRefreshContext) as {
  refreshAgendaAppointment: (id: string) => Promise<void>
  setWorkspaceVersion: (version: number) => void
}
const firstRefresh = agendaRefreshApi.refreshAgendaAppointment('appointment-1')
const duplicateRefresh = agendaRefreshApi.refreshAgendaAppointment('appointment-1')
assert.equal(agendaRequests.length, 1, 'los avisos concurrentes del mismo turno comparten su primera consulta')
assert.equal(agendaRequests[0].pathname, '/appointments')
assert.equal(agendaRequests[0].searchParams.get('businessId'), 'business-1')
assert.equal(agendaRequests[0].searchParams.get('appointmentId'), 'appointment-1')
assert.equal(agendaRequests.some(({ pathname }) => pathname === '/schedule-blocks'), false)
const { financeSummary: omittedFinance, ...appointmentWithoutFinance } = originalAppointment
void omittedFinance
requestResolvers[0]([{
  ...appointmentWithoutFinance, status: 'COMPLETED', updatedAt: '2026-11-16T16:00:00.000Z'
}])
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(agendaRequests.length, 2, 'un aviso recibido mientras la consulta está en curso programa una sola lectura posterior')
assert.deepEqual(state.agendaAppointments.find((item) => item.id === 'appointment-1')?.financeSummary, originalAppointment.financeSummary)
assert.deepEqual(state.agendaAppointments.find((item) => item.id === 'appointment-2'), unrelatedAppointment)
requestResolvers[1]([{ ...originalAppointment, status: 'COMPLETED', financeSummary: null }])
await Promise.all([firstRefresh, duplicateRefresh])
assert.equal(state.agendaAppointments.find((item) => item.id === 'appointment-1')?.financeSummary, null)
assert.equal(state.agendaAppointments.find((item) => item.id === 'appointment-2')?.financeSummary.pendingAmount, 500)
assert.equal(agendaRenderCount, 2, 'solo se redibuja cuando cambió el turno visible')
const failedRefresh = agendaRefreshApi.refreshAgendaAppointment('appointment-2')
requestRejectors[2](new Error('offline'))
await assert.rejects(failedRefresh, /offline/)
assert.equal(state.agendaAppointments.some((item) => item.id === 'appointment-2'), true, 'un fallo puntual conserva el turno y su resumen')
const lateRefresh = agendaRefreshApi.refreshAgendaAppointment('appointment-1')
state.businessId = 'business-2'
agendaRefreshApi.setWorkspaceVersion(8)
requestResolvers[3]([{ ...appointmentWithoutFinance, status: 'NO_SHOW' }])
await lateRefresh
assert.equal(state.agendaAppointments.find((item) => item.id === 'appointment-1')?.status, 'COMPLETED', 'una respuesta tardía de otro comercio se descarta')
assert.match(
  crmUiSource.slice(crmUiSource.indexOf('async function saveManualAppointment('), crmUiSource.indexOf('async function deleteManualAppointment(')),
  /refreshAgendaAppointment\(savedAppointmentId\)/,
  'el guardado actualiza su turno por ID'
)
assert.doesNotMatch(
  crmUiSource.slice(crmUiSource.indexOf('async function saveManualAppointment('), crmUiSource.indexOf('async function deleteManualAppointment(')),
  /await loadAgenda\(\)/,
  'el guardado no vuelve a cargar el rango completo'
)
assert.match(
  crmUiSource,
  /source\.addEventListener\('instagram_publication_changed',[\s\S]*?refreshInstagramPublication\(payload\.publicationId\)/,
  'los estados del Reel deben actualizarse por SSE sin salir y volver a entrar'
)
assert.match(
  crmUiSource,
  /function queueAgendaRealtimeRefresh\(\)[\s\S]*?currentSection !== 'agenda'[\s\S]*?setTimeout[\s\S]*?loadAgenda\(\)/,
  'la Agenda debe recargarse con debounce únicamente cuando su sección está visible'
)
assert.doesNotMatch(
  appointmentServiceSource,
  /publishAppointmentChanged\(/,
  'AppointmentService no debe duplicar las notificaciones emitidas por el trigger transaccional'
)
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
