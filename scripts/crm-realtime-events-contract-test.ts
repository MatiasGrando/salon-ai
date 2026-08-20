import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  publishConversationUpdated,
  publishIncomingConversationMessage,
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'

const receivedByGlow: string[] = []
const receivedByOtherBusiness: string[] = []
const receivedTypesByGlow: string[] = []
const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => {
    receivedTypesByGlow.push(event.type)
    if (event.type === 'conversation_message_received') receivedByGlow.push(event.messageId)
  }
})
const unsubscribeOtherBusiness = subscribeToCrmRealtimeEvents({
  businessId: 'other-business',
  send: (event) => {
    if (event.type === 'conversation_message_received') receivedByOtherBusiness.push(event.messageId)
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

publishConversationUpdated({
  businessId: 'glow',
  conversationId: 'conversation-1',
  updatedAt: '2026-08-19T15:30:01.000Z'
})

assert.deepEqual(receivedTypesByGlow, [
  'conversation_message_received',
  'conversation_updated'
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

assert.match(
  crmUiSource,
  /source\.addEventListener\('conversation_updated',[\s\S]*?scheduleConversationStateRefresh\(\)/,
  'el CRM debe refrescar el estado visual cuando termina el procesamiento de una conversación'
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
