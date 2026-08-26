import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'

export type BotOptionsStage =
  | 'webhook_ack'
  | 'admitted_to_claim'
  | 'transition_execution'
  | 'outbox_wait'
  | 'meta_request'
  | 'dispatch_quiescence'

const BUCKETS_MS = [50, 100, 200, 500, 1000, 1500, 3000, 6000, 10_000, 30_000] as const

type Histogram = { count: number; sumMs: number; buckets: number[]; errors: number }
type OperationalGauges = { oldestReadyJobMs: number; unknownDispatches: number; staleSending: number; poisonOutbox: number }

export type BotOptionsMetricsSnapshot = {
  durations: Record<BotOptionsStage, Histogram>
  gauges: {
    oldestReadyJobMs: number
    unknownDispatches: number
    staleSending: number
    poisonOutbox: number
  }
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
    transition_execution: emptyHistogram(),
    outbox_wait: emptyHistogram(),
    meta_request: emptyHistogram(),
    dispatch_quiescence: emptyHistogram()
  }
  readonly #gauges = { oldestReadyJobMs: 0, unknownDispatches: 0, staleSending: 0, poisonOutbox: 0 }

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

  snapshot(): BotOptionsMetricsSnapshot {
    const alerts: string[] = []
    if (this.#gauges.oldestReadyJobMs > 300_000) alerts.push('bot_job_backlog_critical')
    else if (this.#gauges.oldestReadyJobMs > 60_000) alerts.push('bot_job_backlog_warning')
    if (this.#gauges.unknownDispatches > 0) alerts.push('bot_dispatch_unknown')
    if (this.#gauges.staleSending > 0) alerts.push('bot_sending_stale')
    if (this.#gauges.poisonOutbox > 0) alerts.push('bot_outbox_poison')
    return {
      durations: Object.fromEntries(Object.entries(this.#durations).map(([key, value]) => [key, {
        count: value.count, sumMs: value.sumMs, errors: value.errors, buckets: [...value.buckets]
      }])) as Record<BotOptionsStage, Histogram>,
      gauges: { ...this.#gauges },
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
    oldestReadyJobMs: number; unknownDispatches: bigint; staleSending: bigint; poisonOutbox: bigint
  }>>(Prisma.sql`
    SELECT
      COALESCE((SELECT EXTRACT(EPOCH FROM (clock_timestamp() - min("availableAt"))) * 1000
        FROM "BotJob" WHERE "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")), 0)::double precision AS "oldestReadyJobMs",
      ((SELECT count(*) FROM "BotOutbox" WHERE "status" = 'UNKNOWN'::"BotOutboxStatus")
        + (SELECT count(*) FROM "BotDispatchClaim" WHERE "status" = 'UNKNOWN'::"BotDispatchStatus"))::bigint AS "unknownDispatches",
      ((SELECT count(*) FROM "BotOutbox" WHERE "status" = 'SENDING'::"BotOutboxStatus" AND "leasedUntil" < clock_timestamp())
        + (SELECT count(*) FROM "BotDispatchClaim" WHERE "status" = 'SENDING'::"BotDispatchStatus" AND "claimedUntil" < clock_timestamp()))::bigint AS "staleSending",
      (SELECT count(*) FROM "BotOutbox" WHERE "status" = 'POISON'::"BotOutboxStatus")::bigint AS "poisonOutbox"
  `)
  const row = rows[0] ?? { oldestReadyJobMs: 0, unknownDispatches: 0n, staleSending: 0n, poisonOutbox: 0n }
  metrics.setOperationalGauges({
    oldestReadyJobMs: row.oldestReadyJobMs,
    unknownDispatches: Number(row.unknownDispatches),
    staleSending: Number(row.staleSending),
    poisonOutbox: Number(row.poisonOutbox)
  })
  return metrics.snapshot()
}

export function startBotOptionsMetricsLoop(input: {
  client: MetricsClient
  publish(snapshot: BotOptionsMetricsSnapshot): void
  intervalMs?: number
}): { stop(): void } {
  let stopped = false
  const collect = async () => {
    if (stopped) return
    try { input.publish(await collectBotOptionsOperationalMetrics(input.client)) } catch {}
  }
  const timer = setInterval(collect, input.intervalMs ?? 60_000)
  timer.unref?.()
  void collect()
  return { stop() { stopped = true; clearInterval(timer) } }
}
