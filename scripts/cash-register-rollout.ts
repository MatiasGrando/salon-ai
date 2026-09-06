import { Prisma } from '../src/generated/prisma/client.js'
import { prisma } from '../src/config/prisma.js'
import { PrismaCashRepository } from '../src/repositories/prisma-cash-repository.js'
import { CashService } from '../src/services/cash-service.js'
import { legacyPaymentEntryId } from '../src/services/cash-service.js'
import { assertIanaTimezone } from '../src/services/cash-domain.js'

type RolloutArguments = {
  mode: 'audit' | 'apply'
  businessId: string
  batchSize: number
}

function argumentValue(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function rolloutArguments(): RolloutArguments {
  const businessId = argumentValue('business-id')?.trim() ?? ''
  const apply = process.argv.includes('--apply')
  const batchSize = Number(argumentValue('batch-size') ?? '100')
  if (!businessId) throw new Error('--business-id es obligatorio; el rollout siempre se audita por tenant')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('--batch-size debe ser un entero entre 1 y 500')
  }
  if (apply && process.env.CASH_REGISTER_BACKFILL_APPLY !== 'true') {
    throw new Error('CASH_REGISTER_BACKFILL_APPLY must be exactly "true" before --apply')
  }
  return { mode: apply ? 'apply' : 'audit', businessId, batchSize }
}

async function auditBusiness(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, timezone: true }
  })
  if (!business) throw new Error('El negocio solicitado no existe')
  const rows = await prisma.$queryRaw<Array<{
    appointments: bigint
    unlinkedAppointments: bigint
    accounts: bigint
    linkedAppointments: bigint
    legacyPaymentsMissing: bigint
    approvedDepositsMissing: bigint
    ledgerEntries: bigint
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "Appointment" WHERE "businessId" = ${businessId}) AS appointments,
      (SELECT count(*) FROM "Appointment" a WHERE a."businessId" = ${businessId}
        AND NOT EXISTS (SELECT 1 FROM "AppointmentAccountLink" l WHERE l."businessId" = a."businessId" AND l."appointmentId" = a."id")) AS "unlinkedAppointments",
      (SELECT count(*) FROM "AppointmentAccount" WHERE "businessId" = ${businessId}) AS accounts,
      (SELECT count(*) FROM "AppointmentAccountLink" WHERE "businessId" = ${businessId}) AS "linkedAppointments",
      0::bigint AS "legacyPaymentsMissing",
      (SELECT count(*) FROM "BookingDeposit" d WHERE d."businessId" = ${businessId} AND d."status" = 'APPROVED'
        AND NOT EXISTS (SELECT 1 FROM "CashEntry" e WHERE e."businessId" = d."businessId" AND e."bookingDepositId" = d."id")) AS "approvedDepositsMissing",
      (SELECT count(*) FROM "CashEntry" WHERE "businessId" = ${businessId}) AS "ledgerEntries"
  `)
  let legacyPaymentsMissing = 0
  let afterAppointmentId: string | null = null
  do {
    const appointments: Array<{ id: string }> = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a."id"
      FROM "Appointment" AS a
      WHERE a."businessId" = ${businessId}
        AND a."manualDepositPaid" = true
        AND a."manualDepositAmount" > 0
        AND (${afterAppointmentId}::text IS NULL OR a."id" > ${afterAppointmentId})
      ORDER BY a."id" ASC
      LIMIT 500
    `)
    if (!appointments.length) break
    const expectedIds: string[] = appointments.map((appointment: { id: string }) => legacyPaymentEntryId(businessId, appointment.id))
    const existing = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT entry."id"
      FROM "CashEntry" AS entry
      WHERE entry."businessId" = ${businessId}
        AND entry."type" = 'LEGACY_PAYMENT'::"CashEntryType"
        AND entry."id" IN (${Prisma.join(expectedIds)})
    `)
    legacyPaymentsMissing += expectedIds.length - existing.length
    afterAppointmentId = appointments.length === 500 ? appointments.at(-1)!.id : null
  } while (afterAppointmentId)
  const counts = rows[0]!
  counts.legacyPaymentsMissing = BigInt(legacyPaymentsMissing)
  let timezoneValid = false
  try {
    assertIanaTimezone(business.timezone)
    timezoneValid = true
  } catch {}
  return {
    business: { ...business, timezoneValid },
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
    readyForActivation: timezoneValid
      && counts.unlinkedAppointments === 0n
      && counts.legacyPaymentsMissing === 0n
      && counts.approvedDepositsMissing === 0n
  }
}

const args = rolloutArguments()
try {
  const before = await auditBusiness(args.businessId)
  if (args.mode === 'audit') {
    console.log(JSON.stringify({ mode: args.mode, ...before }, null, 2))
  } else {
    const service = new CashService(new PrismaCashRepository(prisma))
    const totals = { scanned: 0, accountsCreated: 0, linksCreated: 0, legacyEntriesCreated: 0, conflicts: [] as Array<{ code: string; appointmentIds: string[] }> }
    let afterAppointmentId: string | null = null
    do {
      const batch = await service.backfillAppointmentAccounts({
        businessId: args.businessId,
        batchSize: args.batchSize,
        afterAppointmentId
      })
      totals.scanned += batch.scanned
      totals.accountsCreated += batch.accountsCreated
      totals.linksCreated += batch.linksCreated
      totals.legacyEntriesCreated += batch.legacyEntriesCreated
      totals.conflicts.push(...batch.conflicts)
      afterAppointmentId = batch.nextCursor
    } while (afterAppointmentId)
    const approvedDepositBackfill = { scanned: 0, created: 0, replayed: 0, conflicts: [] as Array<{ depositId: string; code: string }> }
    let afterDepositId: string | null = null
    do {
      const batch = await service.backfillApprovedDeposits({
        businessId: args.businessId,
        batchSize: args.batchSize,
        afterDepositId
      })
      approvedDepositBackfill.scanned += batch.scanned
      approvedDepositBackfill.created += batch.created
      approvedDepositBackfill.replayed += batch.replayed
      approvedDepositBackfill.conflicts.push(...batch.conflicts)
      afterDepositId = batch.nextCursor
    } while (afterDepositId)
    const after = await auditBusiness(args.businessId)
    console.log(JSON.stringify({ mode: args.mode, before, backfill: totals, approvedDepositBackfill, after }, null, 2))
    if (totals.conflicts.length > 0 || approvedDepositBackfill.conflicts.length > 0 || !after.readyForActivation) {
      process.exitCode = 2
    }
  }
} finally {
  await prisma.$disconnect()
}
