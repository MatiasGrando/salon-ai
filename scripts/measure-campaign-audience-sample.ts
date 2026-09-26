import { performance } from 'node:perf_hooks'
import { prisma } from '../src/config/prisma.js'

type Measured = { query: string; rows: number; jsonBytes: number; durationMs: number; processCpuMs: number }

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const activeAutomatedCampaigns = await tx.campaign.count({ where: { type: 'AUTOMATED', status: 'ACTIVE' } })
    const businesses = await tx.$queryRawUnsafe<Array<{ businessId: string; appointments: number; customers: number }>>(
      'SELECT "businessId", COUNT(*)::int AS appointments, COUNT(DISTINCT "customerId")::int AS customers FROM "Appointment" GROUP BY "businessId" ORDER BY customers DESC LIMIT 1'
    )
    const business = businesses[0]
    if (!business) return { activeAutomatedCampaigns, sampleCustomers: 0, availableCustomers: 0, totalBusinessAppointments: 0, measurements: [], rssBaselineBytes: 0, rssPeakBytes: 0, heapPeakBytes: 0 }

    const sample = await tx.$queryRawUnsafe<Array<{ customerId: string }>>(
      'SELECT "customerId" FROM "Appointment" WHERE "businessId" = $1 GROUP BY "customerId" ORDER BY md5("customerId") LIMIT 100',
      business.businessId
    )
    const sampleIds = sample.map((row) => row.customerId)
    const measurements: Measured[] = []
    const memory = process.memoryUsage()
    let rssPeakBytes = memory.rss
    let heapPeakBytes = memory.heapUsed
    const sampleMemory = () => {
      const current = process.memoryUsage()
      rssPeakBytes = Math.max(rssPeakBytes, current.rss)
      heapPeakBytes = Math.max(heapPeakBytes, current.heapUsed)
    }
    const timer = setInterval(sampleMemory, 5)
    try {
      async function measure<T>(query: string, run: () => Promise<T[]>): Promise<void> {
        const started = performance.now()
        const cpuStart = process.cpuUsage()
        const rows = await run()
        const jsonBytes = Buffer.byteLength(JSON.stringify(rows), 'utf8')
        const cpu = process.cpuUsage(cpuStart)
        sampleMemory()
        measurements.push({
          query,
          rows: rows.length,
          jsonBytes,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
          processCpuMs: Math.round((cpu.user + cpu.system) / 100) / 10
        })
      }
      await measure('appointments', () => tx.appointment.findMany({
        where: { businessId: business.businessId, customerId: { in: sampleIds } },
        select: { customerId: true, startAt: true, status: true, customer: { select: { id: true, name: true, phone: true } } },
        orderBy: { startAt: 'asc' }
      }))
      await measure('marketingPreferences', () => tx.customerMarketingPreference.findMany({
        where: { businessId: business.businessId, customerId: { in: sampleIds } }
      }))
      await measure('campaignDeliveries', () => tx.campaignDelivery.findMany({
        where: { businessId: business.businessId, customerId: { in: sampleIds }, status: { notIn: ['FAILED', 'CANCELLED'] } },
        orderBy: { sentAt: 'desc' }
      }))
      await measure('competingCampaigns', () => tx.$queryRawUnsafe<Array<{ id: string; segment: string; priority: number; createdAt: Date }>>(
        'SELECT "id", "segment", "priority", "createdAt" FROM "Campaign" WHERE "businessId" = $1 AND "type" = $2 AND "status" = $3',
        business.businessId, 'AUTOMATED', 'ACTIVE'
      ))
    } finally {
      clearInterval(timer)
      sampleMemory()
    }
    return {
      activeAutomatedCampaigns,
      sampleCustomers: sampleIds.length,
      availableCustomers: business.customers,
      totalBusinessAppointments: business.appointments,
      measurements,
      rssBaselineBytes: memory.rss,
      rssPeakBytes,
      heapPeakBytes
    }
  }, { timeout: 60_000 })
  const total = result.measurements.reduce((accumulator, item) => ({
    rows: accumulator.rows + item.rows,
    jsonBytes: accumulator.jsonBytes + item.jsonBytes,
    durationMs: accumulator.durationMs + item.durationMs,
    processCpuMs: accumulator.processCpuMs + item.processCpuMs
  }), { rows: 0, jsonBytes: 0, durationMs: 0, processCpuMs: 0 })
  console.log(JSON.stringify({
    ...result,
    total,
    rssDeltaBytes: Math.max(0, result.rssPeakBytes - result.rssBaselineBytes),
    warning: result.activeAutomatedCampaigns === 0
      ? 'No hay campañas automáticas activas: esta es una muestra de lectura, no una corrida real de campaña.'
      : null,
    byteDefinition: 'Tamaño UTF-8 de resultados serializados como JSON; no equivale a bytes facturados por Supabase.',
    cpuDefinition: 'CPU del proceso Node durante las consultas y serialización; no incluye CPU de PostgreSQL.'
  }, null, 2))
}

main().catch((error) => {
  console.error('No se pudo medir la muestra:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}).finally(async () => { await prisma.$disconnect() })