import { Client } from 'pg'
import { publishCashChanged } from './crm-realtime-events.js'

const CHANNEL = 'cash_changed'
const RECONNECT_DELAY_MS = 1_000

export type CashDatabaseNotification = {
  businessId: string
  entity: 'ENTRY' | 'DAY' | 'SESSION' | 'ACCOUNT'
  entityId: string
  updatedAt: string
}

type CashRealtimeListenerOptions = {
  connectionString: string
  onError?: (error: unknown) => void
  reconnectDelayMs?: number
}

export type CashRealtimeListener = {
  stop: () => Promise<void>
}

export function dispatchCashDatabaseNotification(
  payload: string | undefined,
  publish: (event: CashDatabaseNotification) => void = publishCashChanged
): boolean {
  if (!payload) return false
  try {
    const parsed = JSON.parse(payload) as Partial<CashDatabaseNotification>
    if (
      typeof parsed.businessId !== 'string' || !parsed.businessId
      || !['ENTRY', 'DAY', 'SESSION', 'ACCOUNT'].includes(parsed.entity ?? '')
      || typeof parsed.entityId !== 'string' || !parsed.entityId
      || typeof parsed.updatedAt !== 'string' || !parsed.updatedAt
    ) return false
    publish(parsed as CashDatabaseNotification)
    return true
  } catch {
    return false
  }
}

export function startCashRealtimeListener(options: CashRealtimeListenerOptions): CashRealtimeListener {
  let client: Client | null = null
  let stopped = false
  let reconnectTimer: NodeJS.Timeout | null = null
  let generation = 0
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
  const report = (error: unknown) => options.onError?.(error)

  const scheduleReconnect = (expectedGeneration: number) => {
    if (stopped || generation !== expectedGeneration || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, reconnectDelayMs)
    reconnectTimer.unref?.()
  }

  const connect = async () => {
    if (stopped) return
    const currentGeneration = ++generation
    const nextClient = new Client({ connectionString: options.connectionString })
    client = nextClient
    let disconnected = false
    const reconnect = (error?: unknown) => {
      if (disconnected) return
      disconnected = true
      if (error) report(error)
      if (client === nextClient) client = null
      void nextClient.end().catch(() => undefined)
      scheduleReconnect(currentGeneration)
    }
    nextClient.on('notification', (message) => {
      if (message.channel !== CHANNEL) return
      if (!dispatchCashDatabaseNotification(message.payload)) report(new Error('Notificacion cash_changed invalida'))
    })
    nextClient.on('error', reconnect)
    nextClient.on('end', () => reconnect())
    try {
      await nextClient.connect()
      if (stopped || generation !== currentGeneration) {
        await nextClient.end().catch(() => undefined)
        return
      }
      await nextClient.query(`LISTEN ${CHANNEL}`)
    } catch (error) {
      reconnect(error)
    }
  }

  void connect()

  return {
    stop: async () => {
      stopped = true
      generation += 1
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      const activeClient = client
      client = null
      if (activeClient) await activeClient.end().catch(() => undefined)
    }
  }
}
