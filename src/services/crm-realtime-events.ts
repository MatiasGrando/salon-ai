export type CrmRealtimeEvent = {
  type: 'conversation_message_received'
  businessId: string
  conversationId: string
  messageId: string
  receivedAt: string
}

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

export function publishIncomingConversationMessage(input: Omit<CrmRealtimeEvent, 'type'>) {
  const event: CrmRealtimeEvent = {
    type: 'conversation_message_received',
    ...input
  }

  for (const [subscriberId, subscriber] of subscribers) {
    if (subscriber.businessId !== event.businessId) continue
    try {
      subscriber.send(event)
    } catch {
      subscribers.delete(subscriberId)
    }
  }
}
