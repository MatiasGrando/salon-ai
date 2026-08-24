import type { ServerResponse } from 'node:http'

export const MAX_COUNTER = Number.MAX_SAFE_INTEGER

export interface Clock {
  monotonicNow(): number
  utcNow(): Date
}

export interface TimerHandle { unref(): void }

export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
  setImmediate(callback: () => void): TimerHandle
}

export interface RandomSource { nextUnit(): number }
export interface WritableLike {
  write(chunk: string, callback?: (error?: Error | null) => void): boolean
  on(event: 'error' | 'drain', listener: (error?: Error) => void): this
  once(event: 'error' | 'drain', listener: (error?: Error) => void): this
  removeListener(event: 'error' | 'drain', listener: (...args: unknown[]) => void): this
}

export type PollingMarkerConfig = Readonly<{
  effective: boolean
  headerName: 'X-CRM-Refresh-Mode'
  headerValue: 'fallback-poll'
}>

export const DISABLED_POLLING_MARKER: PollingMarkerConfig = Object.freeze({
  effective: false,
  headerName: 'X-CRM-Refresh-Mode',
  headerValue: 'fallback-poll'
})

export interface SseMeasurementHandle {
  control(chunk: string, accepted: boolean): void
  heartbeat(chunk: string, accepted: boolean): void
  business(chunk: string, accepted: boolean): void
  writeBackpressure(): void
  writeFailure(): void
  close(reason: SseCloseReason): void
  detach(): void
}

export type SseCloseReason = 'client_close' | 'server_shutdown' | 'write_failure' | 'unknown'
export interface FunctionalSseSession {
  close(reason: SseCloseReason): void
  bindCleanup(cleanup: (reason: SseCloseReason) => void): void
}
export type SseOpenResult =
  | { status: 'opened'; session: FunctionalSseSession; measurement: SseMeasurementHandle | null }
  | { status: 'closing' }

export interface SseRecorderFacade {
  isClosing(): boolean
  canOpenSse(): boolean
  openSse(response: ServerResponse): SseOpenResult
  beginClosingAndSnapshotFunctionalSse(): readonly FunctionalSseSession[]
}

export interface EgressBaselineInstallation {
  readonly sseRecorder: SseRecorderFacade
  readonly pollingMarker: PollingMarkerConfig
}

export type MetricSource = 'crm' | 'webhook' | 'public' | 'internal' | 'unknown'
export type MeasurementMode = 'serialized_string' | 'buffer' | 'typed_array' | 'zero_semantic' | 'unknown'

export interface EgressBaselineConfig {
  sinkEffective: boolean
  httpEffective: boolean
  sseEffective: boolean
  pollingMarkerEffective: boolean
  windowMs: number
  jitterMs: number
  maxHttpKeys: number
  maxRecordBytes: number
  maxRecords: number
  maxFlushBytes: number
  metadataMaxChars: number
  shutdownBudgetMs: number
  finalFlushEffective: boolean
  replicaId: string
  deploymentId: string
}
