import { Prisma } from '../../generated/prisma/client.js'
import { buildCartSnapshot, type CartCombinationPolicy, type CartService, type CartSnapshot } from '../application/cart-operations.js'

type CartClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }

export class PrismaCartRepository {
  constructor(private readonly client: CartClient) {}

  async load(input: { businessId: string; serviceIds: readonly string[] }): Promise<{
    snapshot: CartSnapshot
    policies: ReadonlyMap<string, CartCombinationPolicy>
  }> {
    const ids = [...new Set(input.serviceIds)]
    if (ids.length === 0) return { snapshot: buildCartSnapshot([]), policies: new Map() }
    const rows = await this.client.$queryRaw<Array<{
      id: string; name: string; duration: number; price: number | null; priceMode: 'FIXED' | 'STARTING_AT'; professionalIds: string[]
    }>>(Prisma.sql`
      SELECT s."id", s."name", s."duration", s."price", s."priceMode"::text AS "priceMode",
        COALESCE(array_agg(DISTINCT p."id" ORDER BY p."id") FILTER (WHERE p."id" IS NOT NULL), ARRAY[]::text[]) AS "professionalIds"
      FROM "Service" s
      JOIN "ServiceCategory" c ON c."id" = s."catalogCategoryId" AND c."businessId" = s."businessId" AND c."isActive" = true
      LEFT JOIN "ProfessionalService" ps ON ps."serviceId" = s."id"
      LEFT JOIN "Professional" p ON p."id" = ps."professionalId" AND p."businessId" = s."businessId"
        AND p."isActive" = true AND p."acceptsBotBookings" = true
      WHERE s."businessId" = ${input.businessId} AND s."id" IN (${Prisma.join(ids)})
        AND s."isBookable" = true AND s."attentionMode" = 'DIRECT_BOOKING'::"ServiceAttentionMode"
        AND s."estimateAllowsBooking" = true
      GROUP BY s."id", s."name", s."duration", s."price", s."priceMode"
      ORDER BY array_position(ARRAY[${Prisma.join(ids)}]::text[], s."id")
    `)
    if (rows.length !== ids.length) throw new Error('cart contains inactive, cross-tenant, or non-bookable service')
    const services: CartService[] = rows.map((row) => ({
      id: row.id, name: row.name, durationMinutes: row.duration, priceMinor: row.price,
      priceMode: row.priceMode, professionalIds: row.professionalIds
    }))
    const rules = ids.length < 2 ? [] : await this.client.$queryRaw<Array<{ serviceAId: string; serviceBId: string; policy: CartCombinationPolicy }>>(Prisma.sql`
      SELECT "serviceAId", "serviceBId", "policy"::text AS "policy"
      FROM "ServiceCombinationRule"
      WHERE "businessId" = ${input.businessId} AND "serviceAId" IN (${Prisma.join(ids)}) AND "serviceBId" IN (${Prisma.join(ids)})
    `)
    return {
      snapshot: buildCartSnapshot(services),
      policies: new Map(rules.map((rule) => [[rule.serviceAId, rule.serviceBId].sort().join(':'), rule.policy]))
    }
  }
}
