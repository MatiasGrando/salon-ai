/**
 * Recovery script: reset POISON jobs back to READY so they can be retried.
 *
 * Usage:
 *   npx tsx scripts/recover-poison-jobs.ts                    # list all POISON jobs
 *   npx tsx scripts/recover-poison-jobs.ts --reset <jobId>    # reset specific job
 *   npx tsx scripts/recover-poison-jobs.ts --reset-all        # reset all POISON jobs
 *
 * The script reads DATABASE_URL from .env.
 */
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.js'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })

async function main() {
  const args = process.argv.slice(2)

  // List POISON jobs
  const poisons = await prisma.$queryRaw<Array<{
    id: string; kind: string; aggregateId: string; businessId: string
    attempts: number; maxAttempts: number; lastError: string | null; updatedAt: Date
  }>>`
    SELECT "id", "kind", "aggregateId", "businessId", "attempts", "maxAttempts",
      "lastError", "updatedAt"
    FROM "BotJob" WHERE "status" = 'POISON'::"BotJobStatus"
    ORDER BY "updatedAt" DESC
  `

  if (poisons.length === 0) {
    console.log('No POISON jobs found.')
    await prisma.$disconnect()
    return
  }

  console.log(`\nFound ${poisons.length} POISON job(s):\n`)
  for (const j of poisons) {
    console.log(`  ${j.id}  kind=${j.kind}  agg=${j.aggregateId}  biz=${j.businessId}  attempts=${j.attempts}/${j.maxAttempts}`)
    if (j.lastError) console.log(`    lastError: ${j.lastError.slice(0, 120)}`)
    console.log(`    updatedAt: ${j.updatedAt.toISOString()}`)
  }

  const resetAll = args.includes('--reset-all')
  const resetId = args.includes('--reset') ? args[args.indexOf('--reset') + 1] : null

  if (resetAll) {
    const result = await prisma.$executeRaw`
      UPDATE "BotJob" SET
        "status" = 'READY'::"BotJobStatus",
        "attempts" = 0,
        "availableAt" = clock_timestamp(),
        "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = NULL, "updatedAt" = clock_timestamp()
      WHERE "status" = 'POISON'::"BotJobStatus"
    `
    console.log(`\nReset ${result} POISON job(s) to READY.`)
  } else if (resetId) {
    const result = await prisma.$executeRaw`
      UPDATE "BotJob" SET
        "status" = 'READY'::"BotJobStatus",
        "attempts" = 0,
        "availableAt" = clock_timestamp(),
        "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${resetId} AND "status" = 'POISON'::"BotJobStatus"
    `
    if (result === 1) {
      console.log(`\nJob ${resetId} reset to READY.`)
    } else {
      console.log(`\nJob ${resetId} not found or not POISON.`)
    }
  } else {
    console.log('\nNo --reset <id> or --reset-all flag. Listing only. Re-run with --reset-all to recover.')
  }

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
