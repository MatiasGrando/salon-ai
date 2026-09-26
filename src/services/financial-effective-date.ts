import { Prisma } from '../generated/prisma/client.js'

export function isFinancialEffectiveDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

export function financialCorrectionDirections(direction: 'INFLOW' | 'OUTFLOW') {
  return {
    reversal: direction === 'INFLOW' ? 'OUTFLOW' as const : 'INFLOW' as const,
    replacement: direction
  }
}

export async function resolveFinancialEffectiveAt(
  transaction: Prisma.TransactionClient,
  businessId: string,
  effectiveDate: string
) {
  if (!isFinancialEffectiveDate(effectiveDate)) throw new Error('FINANCIAL_EFFECTIVE_DATE_INVALID')
  const rows = await transaction.$queryRaw<Array<{ effectiveAt: Date }>>(Prisma.sql`
    SELECT CASE
      WHEN ${effectiveDate}::date > (clock_timestamp() AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires'))::date THEN NULL
      WHEN ${effectiveDate}::date = (clock_timestamp() AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires'))::date THEN clock_timestamp()
      ELSE (${effectiveDate}::date::timestamp + time '12:00') AT TIME ZONE COALESCE(business."timezone", 'America/Argentina/Buenos_Aires')
    END AS "effectiveAt"
    FROM "Business" business
    WHERE business."id" = ${businessId}
  `)
  if (!rows[0]) throw new Error('BUSINESS_NOT_FOUND')
  if (!rows[0].effectiveAt) throw new Error('FINANCIAL_EFFECTIVE_DATE_FUTURE')
  return rows[0].effectiveAt
}