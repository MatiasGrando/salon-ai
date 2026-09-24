import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'

export async function ensureProfessionalSettlementCategory(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CashExpenseCategory" ("id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${businessId}, 'Liquidaciones profesionales', 'liquidaciones profesionales', 0, false, true, clock_timestamp(), clock_timestamp())
    ON CONFLICT ("businessId", "normalizedName") DO NOTHING
  `)
  const categories = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "isActive" FROM "CashExpenseCategory"
    WHERE "businessId" = ${businessId} AND "normalizedName" = 'liquidaciones profesionales' FOR KEY SHARE
  `)
  if (!categories[0]?.isActive) throw new Error('LIQUIDATION_CATEGORY_INACTIVE')
  return categories[0].id
}
