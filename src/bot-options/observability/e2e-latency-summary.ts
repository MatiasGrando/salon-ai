export type BotOptionsLatencyTrace = {
  correlationId: string
  admittedAt: number | null
  eventJobCreatedAt: number | null
  eventJobCompletedAt: number | null
  transitionedAt: number | null
  outboxCreatedAt: number | null
  metaAcceptedAt: number | null
  deliveredAt: number | null
  failedBeforeAcceptance?: boolean
}

type Percentiles = { count: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }
type LatencyStages = {
  eventJobLifecycle: Percentiles
  eventJobCompletionToTransition: Percentiles
  admissionToTransition: Percentiles
  transitionToOutbox: Percentiles
  outboxToMetaAcceptance: Percentiles
  metaAcceptanceToDelivery: Percentiles
  admissionToMetaAcceptance: Percentiles
  admissionToDelivery: Percentiles
}
export type BotOptionsLatencySummary = {
  traceCount: number
  duplicateCorrelationCount: number
  invalidCorrelationCount: number
  metaAcceptedCount: number
  deliveredCount: number
  failedBeforeAcceptanceCount: number
  unresolvedCount: number
  /** Timestamp-valid traces with provider acceptance but no delivered callback timestamp; not a reliability denominator. */
  missingStageCount: number
  /** Traces with at least one timestamp earlier than a preceding persisted milestone. */
  invalidTimestampOrderCount: number
  stages: LatencyStages
}

const STAGES = [
  'eventJobLifecycle', 'eventJobCompletionToTransition', 'admissionToTransition',
  'transitionToOutbox', 'outboxToMetaAcceptance', 'metaAcceptanceToDelivery',
  'admissionToMetaAcceptance', 'admissionToDelivery'
] as const

/**
 * Summarizes DB-observed milestones for one source event/outbox row. The first
 * timestamp is durable event admission, not webhook arrival/ACK. Job lifecycle
 * includes queue time, attempts and execution; it is not a pure worker-runtime measure.
 * Percentiles use nearest-rank; absent, duplicate, invalid, and impossible durations are omitted.
 */
export function summarizeBotOptionsLatencyTraces(
  traces: readonly BotOptionsLatencyTrace[]
): BotOptionsLatencySummary {
  const seen = new Set<string>()
  const unique: BotOptionsLatencyTrace[] = []
  let duplicateCorrelationCount = 0
  let invalidCorrelationCount = 0

  for (const trace of traces) {
    const id = trace.correlationId.trim()
    if (!id) {
      invalidCorrelationCount += 1
      continue
    }
    if (seen.has(id)) {
      duplicateCorrelationCount += 1
      continue
    }
    seen.add(id)
    unique.push(trace)
  }

  const values: Record<typeof STAGES[number], number[]> = {
    eventJobLifecycle: [], eventJobCompletionToTransition: [], admissionToTransition: [],
    transitionToOutbox: [], outboxToMetaAcceptance: [], metaAcceptanceToDelivery: [],
    admissionToMetaAcceptance: [], admissionToDelivery: []
  }
  let metaAcceptedCount = 0
  let deliveredCount = 0
  let failedBeforeAcceptanceCount = 0
  let unresolvedCount = 0
  let missingStageCount = 0
  let invalidTimestampOrderCount = 0

  for (const trace of unique) {
    const admitted = validTimestamp(trace.admittedAt)
    const jobCreated = validTimestamp(trace.eventJobCreatedAt)
    const jobCompleted = validTimestamp(trace.eventJobCompletedAt)
    const transitioned = validTimestamp(trace.transitionedAt)
    const outboxCreated = validTimestamp(trace.outboxCreatedAt)
    const accepted = validTimestamp(trace.metaAcceptedAt)
    const delivered = validTimestamp(trace.deliveredAt)
    const milestones = [admitted, jobCreated, jobCompleted, transitioned, outboxCreated, accepted, delivered]
      .filter((value): value is number => value !== null)
    const hasInvalidOrder = milestones.some((value, index) => index > 0 && value < milestones[index - 1]!)
    if (hasInvalidOrder) invalidTimestampOrderCount += 1

    if (!hasInvalidOrder) {
      addDuration(values.eventJobLifecycle, jobCreated, jobCompleted)
      addDuration(values.eventJobCompletionToTransition, jobCompleted, transitioned)
      addDuration(values.admissionToTransition, admitted, transitioned)
      addDuration(values.transitionToOutbox, transitioned, outboxCreated)
      addDuration(values.outboxToMetaAcceptance, outboxCreated, accepted)
      addDuration(values.metaAcceptanceToDelivery, accepted, delivered)
      addDuration(values.admissionToMetaAcceptance, admitted, accepted)
      addDuration(values.admissionToDelivery, admitted, delivered)
    }

    if (!hasInvalidOrder) {
      if (accepted !== null) metaAcceptedCount += 1
      if (delivered !== null) deliveredCount += 1
      if (accepted === null && delivered === null) {
        if (trace.failedBeforeAcceptance === true) failedBeforeAcceptanceCount += 1
        else unresolvedCount += 1
      }
      if (accepted !== null && delivered === null) missingStageCount += 1
    }
  }

  return {
    traceCount: traces.length, duplicateCorrelationCount, invalidCorrelationCount,
    metaAcceptedCount, deliveredCount, failedBeforeAcceptanceCount, unresolvedCount,
    missingStageCount, invalidTimestampOrderCount,
    stages: Object.fromEntries(STAGES.map((stage) => [stage, summarize(values[stage])])) as LatencyStages
  }
}

function validTimestamp(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}
function addDuration(values: number[], start: number | null, end: number | null) {
  if (start === null || end === null || end < start) return
  values.push(Math.round((end - start) * 100) / 100)
}
function summarize(samples: readonly number[]): Percentiles {
  if (samples.length === 0) return { count: 0, p50Ms: null, p95Ms: null, p99Ms: null }
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99)
  }
}
function percentile(sorted: readonly number[], rank: number): number {
  return sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)]!
}