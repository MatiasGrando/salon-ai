import { pathToFileURL } from 'node:url'
import type { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient as RuntimePrismaClient } from '../src/generated/prisma/client.js'
import { PrismaCatalogRepository, UNCATEGORIZED_CATEGORY_ID } from '../src/bot-options/infrastructure/prisma-catalog.js'
import { PrismaHoursRepository } from '../src/bot-options/infrastructure/prisma-hours.js'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'
import { withAttemptMetrics, type AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'

const CUSTOMER_CODE = 'WX-38N6UG'
const DEFAULT_SAMPLES = 3
const MAX_SAMPLES = 5
const SEARCH_HORIZON_CAP_DAYS = 7

type StageSummary = { count: number; errors: number; p50Ms: number | null; p95Ms: number | null }
type ProbeSummary = {
  classification: 'exploratory'
  sampleCount: number
  successfulSamples: number
  failedSamples: number
  searchHorizonCapDays: number
  stages: Record<string, StageSummary>
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] ?? null : null
}

function summarize(events: readonly AttemptMetricEvent[], requested: number, successful: number): ProbeSummary {
  const stages: Record<string, StageSummary> = {}
  for (const stage of new Set(events.map(event => event.stage))) {
    const matching = events.filter(event => event.stage === stage)
    const durations = matching.filter(event => event.outcome === 'ok').map(event => event.durationMs).sort((a, b) => a - b)
    stages[stage] = { count: matching.length, errors: matching.filter(event => event.outcome === 'error').length,
      p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) }
  }
  return { classification: 'exploratory', sampleCount: requested, successfulSamples: successful,
    failedSamples: requested - successful, searchHorizonCapDays: SEARCH_HORIZON_CAP_DAYS, stages }
}

/** Performs only existing tenant-scoped reads, within one bounded read-only transaction per sample. */
export async function runBarberDemoQueryProbe(client: PrismaClient, options: { samples?: number } = {}): Promise<ProbeSummary> {
  const samples = options.samples ?? DEFAULT_SAMPLES
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > MAX_SAMPLES) throw new Error('INVALID_SAMPLE_COUNT')
  const events: AttemptMetricEvent[] = []
  let successful = 0
  for (let attempt = 0; attempt < samples; attempt += 1) {
    try {
      await withAttemptMetrics({ jobId: 'c02-barber-demo-query-probe', attempt }, () => client.$transaction(async tx => {
        // These are fixed SQL literals; no credential or business input is interpolated.
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'")
        const business = await tx.business.findUnique({ where: { customerCode: CUSTOMER_CODE }, select: { id: true } })
        if (!business) throw new Error('PILOT_BUSINESS_UNAVAILABLE')
        const service = await tx.service.findFirst({
          where: { businessId: business.id, isActive: true, isBookable: true, duration: { gt: 0 },
            professionalLinks: { some: { professional: { businessId: business.id, isActive: true, acceptsBotBookings: true } } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, duration: true, catalogCategoryId: true }
        })
        if (!service) throw new Error('PILOT_SERVICE_UNAVAILABLE')
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`)
        const now = clock[0]?.now
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('DATABASE_CLOCK_UNAVAILABLE')
        const catalog = new PrismaCatalogRepository(tx)
        const hours = new PrismaHoursRepository(tx)
        const availability = new PrismaAvailabilityRepository(tx)
        const validatedService = await catalog.getService({ businessId: business.id, serviceId: service.id })
        if (!validatedService || validatedService.kind !== 'SERVICE' || validatedService.requiresConsultation ||
            !Number.isSafeInteger(validatedService.durationMinutes) || validatedService.durationMinutes! <= 0) throw new Error('PILOT_SERVICE_INELIGIBLE')
        const settings = await availability.loadSettings(business.id)
        await catalog.listCategories({ businessId: business.id, page: 0 })
        await catalog.listServices({ businessId: business.id, categoryId: service.catalogCategoryId ?? UNCATEGORIZED_CATEGORY_ID, page: 0 })
        await hours.loadBusinessWeeklyHours({ businessId: business.id })
        await hours.loadBusinessOperationalExceptions({ businessId: business.id, dbNow: now, timezone: settings.timezone })
        const professionals = await availability.compatibleProfessionals({ businessId: business.id, serviceIds: [service.id] })
        if (!professionals.length) throw new Error('PILOT_PROFESSIONAL_UNAVAILABLE')
        await availability.search({ businessId: business.id, serviceIds: [service.id], durationMinutes: validatedService.durationMinutes!,
          dbNow: now, settings: { ...settings, horizonDays: Math.min(settings.horizonDays, SEARCH_HORIZON_CAP_DAYS) },
          professionalId: professionals[0]!.id })
      }, { maxWait: 1000, timeout: 20000, isolationLevel: 'ReadCommitted' }), { emit: event => events.push(event) })
      successful += 1
    } catch {
      // The metric events retain a sanitized error code. Never print exception text or SQL.
      break
    }
  }
  return summarize(events, successful + (successful < samples ? 1 : 0), successful)
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-barber-demo') throw new Error('EXPLICIT_RUN_FLAG_REQUIRED')
  const connectionString = process.env.C02_READONLY_DATABASE_URL
  if (!connectionString) throw new Error('EXPLICIT_C02_CONNECTION_REQUIRED')
  const client = new RuntimePrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, idleTimeoutMillis: 1000, connectionTimeoutMillis: 2000 }) })
  try {
    const result = await runBarberDemoQueryProbe(client)
    console.log(JSON.stringify(result))
    if (result.failedSamples > 0) process.exitCode = 1
  }
  finally { await client.$disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('C02_QUERY_PROBE_FAILED'); process.exitCode = 1 })
}