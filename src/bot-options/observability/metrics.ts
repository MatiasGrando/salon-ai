import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'

export type BotOptionsStage =
  | 'webhook_ack'
  | 'admitted_to_claim'
  | 'session_context_load'
  | 'session_effects'
  | 'session_persist_view'
  | 'session_critical_transaction'
  | 'transition_execution'
  | 'outbox_wait'
  | 'meta_request'
  | 'dispatch_quiescence'

const BUCKETS_MS = [50, 100, 200, 500, 1000, 1500, 3000, 6000, 10_000, 30_000] as const

type Histogram = { count: number; sumMs: number; buckets: number[]; errors: number }
type OperationalGauges = { oldestReadyJobMs: number; unknownDispatches: number; staleSending: number; poisonOutbox: number; noAvailabilityHorizon: number }

/**
 * F10.5 privacy-safe handoff observability. Every field is derived from a
 * SELECT-only source — `BotHandoff` status/time columns and `BotHandoffAudit.action`
 * — never from `BotOperation` free-text status (reserved for F11), and carries no
 * PII (no IDs, phones or free-text). Counts are scoped to a trailing window so
 * they express recent outcome rates rather than unbounded cumulative totals.
 */
export type BotOptionsHandoffGauges = {
  /** TAKE attempts started within the window. */
  handoffTakeStarted: number
  /** TAKE attempts that reached ownership within the window. */
  handoffTakeCompleted: number
  /** TAKE drains that timed out and reopened the exact gate within the window. */
  handoffTakeTimeoutReopened: number
  /** TAKE operations currently and durably blocked by UNKNOWN. */
  handoffTakeBlockedUnknown: number
  /** TAKE_BLOCKED_UNKNOWN transitions observed within the trailing window. */
  handoffTakeBlockedUnknownRecent: number
  /** RESOLVE attempts that completed within the window. */
  handoffResolveCompleted: number
  /** RESOLVE operations currently and durably blocked by UNKNOWN. */
  handoffResolveBlockedUnknown: number
  /** RESOLVE_BLOCKED_UNKNOWN transitions observed within the trailing window. */
  handoffResolveBlockedUnknownRecent: number
  /** QUEUED handoffs older than the stuck threshold. */
  handoffQueuedStuck: number
  /** Age in ms of the oldest QUEUED handoff (0 when none). */
  handoffQueuedOldestMs: number
  /** TAKEN handoffs whose ownership exceeds the stale threshold. */
  handoffStaleOwnership: number
  /** Age in ms of the oldest TAKEN handoff (0 when none). */
  handoffStaleOwnershipMs: number
}

export type BotOptionsMetricsSnapshot = {
  durations: Record<BotOptionsStage, Histogram>
  gauges: {
    oldestReadyJobMs: number
    unknownDispatches: number
    staleSending: number
    poisonOutbox: number
    noAvailabilityHorizon: number
  }
  handoff: BotOptionsHandoffGauges
  alerts: string[]
  capturedAt: string
}

function emptyHistogram(): Histogram {
  return { count: 0, sumMs: 0, buckets: BUCKETS_MS.map(() => 0), errors: 0 }
}

export class BotOptionsMetrics {
  readonly #durations: Record<BotOptionsStage, Histogram> = {
    webhook_ack: emptyHistogram(),
    admitted_to_claim: emptyHistogram(),
    session_context_load: emptyHistogram(),
    session_effects: emptyHistogram(),
    session_persist_view: emptyHistogram(),
    session_critical_transaction: emptyHistogram(),
    transition_execution: emptyHistogram(),
    outbox_wait: emptyHistogram(),
    meta_request: emptyHistogram(),
    dispatch_quiescence: emptyHistogram()
  }
  readonly #gauges = { oldestReadyJobMs: 0, unknownDispatches: 0, staleSending: 0, poisonOutbox: 0, noAvailabilityHorizon: 0 }
  readonly #handoffGauges: BotOptionsHandoffGauges = {
    handoffTakeStarted: 0,
    handoffTakeCompleted: 0,
    handoffTakeTimeoutReopened: 0,
    handoffTakeBlockedUnknown: 0,
    handoffTakeBlockedUnknownRecent: 0,
    handoffResolveCompleted: 0,
    handoffResolveBlockedUnknown: 0,
    handoffResolveBlockedUnknownRecent: 0,
    handoffQueuedStuck: 0,
    handoffQueuedOldestMs: 0,
    handoffStaleOwnership: 0,
    handoffStaleOwnershipMs: 0
  }

  observe(stage: BotOptionsStage, durationMs: number, outcome: 'ok' | 'error' = 'ok'): void {
    const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
    const histogram = this.#durations[stage]
    histogram.count += 1
    histogram.sumMs += safe
    if (outcome === 'error') histogram.errors += 1
    for (let index = 0; index < BUCKETS_MS.length; index += 1) {
      if (safe <= BUCKETS_MS[index]!) histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1
    }
  }

  setOperationalGauges(input: OperationalGauges): void {
    Object.assign(this.#gauges, input)
  }

  setHandoffGauges(input: BotOptionsHandoffGauges): void {
    Object.assign(this.#handoffGauges, input)
  }

  /**
   * Privacy-safe in-memory reset of the handoff gauges. Used when a handoff
   * collection fails so a previously successful collection cannot leak stale
   * handoff alerts into the next published snapshot. No DB writes/deps.
   */
  resetHandoffGauges(): void {
    Object.assign(this.#handoffGauges, {
      handoffTakeStarted: 0,
      handoffTakeCompleted: 0,
      handoffTakeTimeoutReopened: 0,
      handoffTakeBlockedUnknown: 0,
      handoffTakeBlockedUnknownRecent: 0,
      handoffResolveCompleted: 0,
      handoffResolveBlockedUnknown: 0,
      handoffResolveBlockedUnknownRecent: 0,
      handoffQueuedStuck: 0,
      handoffQueuedOldestMs: 0,
      handoffStaleOwnership: 0,
      handoffStaleOwnershipMs: 0
    })
  }

  snapshot(): BotOptionsMetricsSnapshot {
    const alerts: string[] = []
    if (this.#gauges.oldestReadyJobMs > 300_000) alerts.push('bot_job_backlog_critical')
    else if (this.#gauges.oldestReadyJobMs > 60_000) alerts.push('bot_job_backlog_warning')
    if (this.#gauges.unknownDispatches > 0) alerts.push('bot_dispatch_unknown')
    if (this.#gauges.staleSending > 0) alerts.push('bot_sending_stale')
    if (this.#gauges.poisonOutbox > 0) alerts.push('bot_outbox_poison')
    if (this.#gauges.noAvailabilityHorizon > 0) alerts.push('bot_no_availability_in_horizon')
    // F10.5 handoff alerts. These intentionally do NOT duplicate the global
    // `bot_dispatch_unknown` signal (which counts raw UNKNOWN dispatches anywhere
    // in BotOutbox/BotDispatchClaim). They instead count handoff operations that
    // remain durably blocked by an UNKNOWN, plus queue/ownership staleness derived
    // from BotHandoff columns — a distinct, more actionable signal. Recent audit
    // transition counts remain metrics, but do not keep an alert alive after the
    // operation recovers.
    if (this.#handoffGauges.handoffTakeBlockedUnknown > 0) alerts.push('bot_handoff_take_blocked_unknown')
    if (this.#handoffGauges.handoffResolveBlockedUnknown > 0) alerts.push('bot_handoff_resolve_blocked_unknown')
    if (this.#handoffGauges.handoffQueuedStuck > 0) alerts.push('bot_handoff_queue_stuck')
    if (this.#handoffGauges.handoffStaleOwnership > 0) alerts.push('bot_handoff_stale_ownership')
    return {
      durations: Object.fromEntries(Object.entries(this.#durations).map(([key, value]) => [key, {
        count: value.count, sumMs: value.sumMs, errors: value.errors, buckets: [...value.buckets]
      }])) as Record<BotOptionsStage, Histogram>,
      gauges: { ...this.#gauges },
      handoff: { ...this.#handoffGauges },
      alerts,
      capturedAt: new Date().toISOString()
    }
  }
}

export const botOptionsMetrics = new BotOptionsMetrics()

type MetricsClient = Pick<PrismaClient, '$queryRaw'>

export async function collectBotOptionsOperationalMetrics(
  client: MetricsClient,
  metrics: BotOptionsMetrics = botOptionsMetrics
): Promise<BotOptionsMetricsSnapshot> {
  const rows = await client.$queryRaw<Array<{
    oldestReadyJobMs: number; unknownDispatches: bigint; staleSending: bigint; poisonOutbox: bigint; noAvailabilityHorizon: bigint
  }>>(Prisma.sql`
    SELECT
      COALESCE((SELECT EXTRACT(EPOCH FROM (clock_timestamp() - min("availableAt"))) * 1000
        FROM "BotJob" WHERE "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")), 0)::double precision AS "oldestReadyJobMs",
      ((SELECT count(*) FROM "BotOutbox" WHERE "status" = 'UNKNOWN'::"BotOutboxStatus")
        + (SELECT count(*) FROM "BotDispatchClaim" WHERE "status" = 'UNKNOWN'::"BotDispatchStatus"))::bigint AS "unknownDispatches",
      ((SELECT count(*) FROM "BotOutbox" WHERE "status" = 'SENDING'::"BotOutboxStatus" AND "leasedUntil" < clock_timestamp())
        + (SELECT count(*) FROM "BotDispatchClaim" WHERE "status" = 'SENDING'::"BotDispatchStatus" AND "claimedUntil" < clock_timestamp()))::bigint AS "staleSending",
      (SELECT count(*) FROM "BotOutbox" WHERE "status" = 'POISON'::"BotOutboxStatus")::bigint AS "poisonOutbox",
      (SELECT count(*) FROM "BotOperation" WHERE "type" = 'EMIT_OPERATIONAL_ALERT:NO_AVAILABILITY_IN_HORIZON'
        AND "createdAt" >= clock_timestamp() - interval '24 hours')::bigint AS "noAvailabilityHorizon"
  `)
  const row = rows[0] ?? { oldestReadyJobMs: 0, unknownDispatches: 0n, staleSending: 0n, poisonOutbox: 0n, noAvailabilityHorizon: 0n }
  metrics.setOperationalGauges({
    oldestReadyJobMs: row.oldestReadyJobMs,
    unknownDispatches: Number(row.unknownDispatches),
    staleSending: Number(row.staleSending),
    poisonOutbox: Number(row.poisonOutbox),
    noAvailabilityHorizon: Number(row.noAvailabilityHorizon)
  })
  return metrics.snapshot()
}

/**
 * F10.5 SELECT-only collector. It never writes and never reads `BotOperation`
 * unrelated operation status; transition rates come from the append-only
 * `BotHandoffAudit`, while current blocking is scoped to HANDOFF_TAKE/RESOLVE
 * operations and queue/ownership age comes from `BotHandoff`.
 */
export async function collectBotOptionsHandoffMetrics(
  client: MetricsClient,
  metrics: BotOptionsMetrics = botOptionsMetrics
): Promise<BotOptionsMetricsSnapshot> {
  const auditRows = await client.$queryRaw<Array<{ action: string; count: bigint }>>(Prisma.sql`
    SELECT "action" AS "action", count(*)::bigint AS "count"
    FROM "BotHandoffAudit"
    WHERE "createdAt" >= clock_timestamp() - interval '24 hours'
    GROUP BY "action"
  `)
  const byAction = new Map<string, number>(auditRows.map((row) => [row.action, Number(row.count)]))
  const handoffs = await client.$queryRaw<Array<{
    takeBlockedUnknown: bigint; resolveBlockedUnknown: bigint; queuedStuck: bigint; queuedOldestMs: number; staleOwnership: bigint; staleOwnershipMs: number
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*)::bigint FROM "BotOperation" WHERE "type"='HANDOFF_TAKE' AND "status"='BLOCKED_UNKNOWN') AS "takeBlockedUnknown",
      (SELECT count(*)::bigint FROM "BotOperation" WHERE "type"='HANDOFF_RESOLVE' AND "status"='BLOCKED_UNKNOWN') AS "resolveBlockedUnknown",
      (SELECT count(*)::bigint FROM "BotHandoff" WHERE "status"='QUEUED'::"BotHandoffStatus" AND "queuedAt" < clock_timestamp() - interval '30 minutes') AS "queuedStuck",
      COALESCE((SELECT EXTRACT(EPOCH FROM (clock_timestamp() - min("queuedAt"))) * 1000 FROM "BotHandoff" WHERE "status"='QUEUED'::"BotHandoffStatus"), 0)::double precision AS "queuedOldestMs",
      (SELECT count(*)::bigint FROM "BotHandoff" WHERE "status"='TAKEN'::"BotHandoffStatus" AND "takenAt" < clock_timestamp() - interval '6 hours') AS "staleOwnership",
      COALESCE((SELECT EXTRACT(EPOCH FROM (clock_timestamp() - min("takenAt"))) * 1000 FROM "BotHandoff" WHERE "status"='TAKEN'::"BotHandoffStatus"), 0)::double precision AS "staleOwnershipMs"
  `)
  const handoff = handoffs[0] ?? { takeBlockedUnknown: 0n, resolveBlockedUnknown: 0n, queuedStuck: 0n, queuedOldestMs: 0, staleOwnership: 0n, staleOwnershipMs: 0 }
  metrics.setHandoffGauges({
    handoffTakeStarted: byAction.get('TAKE_STARTED') ?? 0,
    handoffTakeCompleted: byAction.get('TAKE_COMPLETED') ?? 0,
    handoffTakeTimeoutReopened: byAction.get('TAKE_TIMEOUT_REOPENED') ?? 0,
    handoffTakeBlockedUnknown: Number(handoff.takeBlockedUnknown),
    handoffTakeBlockedUnknownRecent: byAction.get('TAKE_BLOCKED_UNKNOWN') ?? 0,
    handoffResolveCompleted: byAction.get('RESOLVE_COMPLETED') ?? 0,
    handoffResolveBlockedUnknown: Number(handoff.resolveBlockedUnknown),
    handoffResolveBlockedUnknownRecent: byAction.get('RESOLVE_BLOCKED_UNKNOWN') ?? 0,
    handoffQueuedStuck: Number(handoff.queuedStuck),
    handoffQueuedOldestMs: Number(handoff.queuedOldestMs),
    handoffStaleOwnership: Number(handoff.staleOwnership),
    handoffStaleOwnershipMs: Number(handoff.staleOwnershipMs)
  })
  return metrics.snapshot()
}

export function startBotOptionsMetricsLoop(input: {
  client: MetricsClient
  publish(snapshot: BotOptionsMetricsSnapshot): void
  intervalMs?: number
}): { stop(): void } {
  let stopped = false
  let collecting = false
  const collect = async () => {
    if (stopped) return
    // Do not let overlapping interval ticks start concurrent collections.
    if (collecting) return
    collecting = true
    try {
      // The operational collector is authoritative: if it fails, retain the
      // pre-F10 behavior of NOT publishing a (partial) snapshot.
      try {
        await collectBotOptionsOperationalMetrics(input.client, botOptionsMetrics)
      } catch {
        return
      }
      try {
        await collectBotOptionsHandoffMetrics(input.client, botOptionsMetrics)
      } catch {
        // Handoff collection failed: still publish the operational snapshot,
        // but reset the handoff gauges so a prior successful collection cannot
        // leak stale handoff alerts. Privacy-safe: in-memory only, no DB writes.
        botOptionsMetrics.resetHandoffGauges()
      }
      input.publish(botOptionsMetrics.snapshot())
    } finally {
      collecting = false
    }
  }
  const timer = setInterval(collect, input.intervalMs ?? 60_000)
  timer.unref?.()
  void collect()
  return { stop() { stopped = true; clearInterval(timer) } }
}
