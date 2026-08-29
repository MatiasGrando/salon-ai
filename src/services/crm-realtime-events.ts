export type IncomingConversationMessageEvent = {
  type: 'conversation_message_received'
  businessId: string
  conversationId: string
  messageId: string
  receivedAt: string
}

export type ConversationUpdatedEvent = {
  type: 'conversation_updated'
  businessId: string
  conversationId: string
  updatedAt: string
}

export type DepositUpdatedEvent = {
  type: 'deposit_updated'
  businessId: string
  depositId: string
  updatedAt: string
}

export type CrmRealtimeEvent = IncomingConversationMessageEvent | ConversationUpdatedEvent | DepositUpdatedEvent

type CrmRealtimeSubscriber = {
  businessId: string
  send: (event: CrmRealtimeEvent) => void
}

const subscribers = new Map<number, CrmRealtimeSubscriber>()
let nextSubscriberId = 1

export function subscribeToCrmRealtimeEvents(input: CrmRealtimeSubscriber) {
  const subscriberId = nextSubscriberId++
  subscribers.set(subscriberId, input)

  return () => {
    subscribers.delete(subscriberId)
  }
}

export function publishIncomingConversationMessage(input: Omit<IncomingConversationMessageEvent, 'type'>) {
  const event: IncomingConversationMessageEvent = {
    type: 'conversation_message_received',
    ...input
  }

  publishCrmRealtimeEvent(event)
}

export type InboundConversationMessageProjection = {
  businessId: string
  conversationId: string
  messageId: string
}

/**
 * Records an inbound projection that has been written inside an open
 * transaction but must NOT be published until that transaction commits.
 * The caller owns the array and passes it to `flushInboundConversationMessages`
 * only after the surrounding transaction resolves successfully. This keeps the
 * CRM realtime delivery strictly after-commit and free of durable semantics.
 */
export function collectInboundConversationMessage(
  pending: InboundConversationMessageProjection[],
  input: InboundConversationMessageProjection
): void {
  pending.push(input)
}

/**
 * Emits `conversation_message_received` SSE notifications for inbound messages
 * that were projected and committed. Intentionally invoked AFTER the database
 * transaction commits so the CRM never observes a message that could still be
 * rolled back. Tenant isolation is preserved by the underlying subscriber map.
 */
export function flushInboundConversationMessages(
  pending: readonly InboundConversationMessageProjection[]
): void {
  for (const event of pending) {
    publishIncomingConversationMessage({
      businessId: event.businessId,
      conversationId: event.conversationId,
      messageId: event.messageId,
      receivedAt: new Date().toISOString()
    })
  }
}

export function publishConversationUpdated(input: Omit<ConversationUpdatedEvent, 'type'>) {
  const event: ConversationUpdatedEvent = {
    type: 'conversation_updated',
    ...input
  }

  publishCrmRealtimeEvent(event)
}

export function publishDepositUpdated(input: Omit<DepositUpdatedEvent, 'type'>) {
  const event: DepositUpdatedEvent = {
    type: 'deposit_updated',
    ...input
  }

  publishCrmRealtimeEvent(event)
}

function publishCrmRealtimeEvent(event: CrmRealtimeEvent) {
  for (const [subscriberId, subscriber] of subscribers) {
    if (subscriber.businessId !== event.businessId) continue
    try {
      subscriber.send(event)
    } catch {
      subscribers.delete(subscriberId)
    }
  }
}
