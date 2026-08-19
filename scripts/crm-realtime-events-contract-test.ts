import assert from 'node:assert/strict'
import {
  publishIncomingConversationMessage,
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'

const receivedByGlow: string[] = []
const receivedByOtherBusiness: string[] = []
const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => receivedByGlow.push(event.messageId)
})
const unsubscribeOtherBusiness = subscribeToCrmRealtimeEvents({
  businessId: 'other-business',
  send: (event) => receivedByOtherBusiness.push(event.messageId)
})

publishIncomingConversationMessage({
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  receivedAt: '2026-08-19T15:30:00.000Z'
})

assert.deepEqual(receivedByGlow, ['message-1'])
assert.deepEqual(receivedByOtherBusiness, [])

unsubscribeGlow()
publishIncomingConversationMessage({
  businessId: 'glow',
  conversationId: 'conversation-1',
  messageId: 'message-2',
  receivedAt: '2026-08-19T15:31:00.000Z'
})

assert.deepEqual(receivedByGlow, ['message-1'])
unsubscribeOtherBusiness()

console.log('CRM realtime events contract: OK')
