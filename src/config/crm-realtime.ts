import 'dotenv/config'

export const crmRealtimeConfig = {
  eventsEnabled: booleanEnvironmentValue(process.env.CRM_REALTIME_EVENTS_ENABLED, true),
  fallbackRefreshMs: 15_000,
  pollingMarkerHeader: 'X-CRM-Refresh-Mode' as const,
  pollingMarkerValue: 'fallback-poll' as const
}

function booleanEnvironmentValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}
