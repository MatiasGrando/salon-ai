import { Client } from 'pg'
import { publishAppointmentChanged } from './crm-realtime-events.js'

const CHANNEL = 'appointment_changed'
const RECONNECT_DELAY_MS = 1_000

type AppointmentDatabaseNotification = {
  businessId: string
  appointmentId: string
  updatedAt: string
}

type AppointmentRealtimeListenerOptions = {
  connectionString: string
  onError?: (error: unknown) => void
  reconnectDelayMs?: number
}

export type AppointmentRealtimeListener = {
  stop: () => Promise<void>
}

export function dispatchAppointmentDatabaseNotification(
  payload: string | undefined,
  publish: (event: AppointmentDatabaseNotification) => void = publishAppointmentChanged
): boolean {
  if (!payload) return false
  try {
    const parsed = JSON.parse(payload) as Partial<AppointmentDatabaseNotification>
    if (
      typeof parsed.businessId !== 'string' || parsed.businessId.length === 0
      || typeof parsed.appointmentId !== 'string' || parsed.appointmentId.length === 0
      || typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length === 0
    ) return false
    publish({
      businessId: parsed.businessId,
      appointmentId: parsed.appointmentId,
      updatedAt: parsed.updatedAt
    })
    return true
  } catch {
    return false
  }
}

/**
 * Opens one dedicated LISTEN connection per server replica and fans committed
 * PostgreSQL notifications into that replica's in-memory SSE subscribers.
 */
export function startAppointmentRealtimeListener(
  options: AppointmentRealtimeListenerOptions
): AppointmentRealtimeListener {
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
      if (!dispatchAppointmentDatabaseNotification(message.payload)) {
        report(new Error('Notificacion appointment_changed invalida'))
      }
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
