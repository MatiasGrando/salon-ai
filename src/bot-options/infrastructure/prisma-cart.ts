import { Prisma } from '../../generated/prisma/client.js'
import { buildCartSnapshot, type CartCombinationPolicy, type CartService, type CartSnapshot } from '../application/cart-operations.js'
import { parseEstimateOptions, resolveServiceEstimate, serviceConfigurationKey, type ServiceBookingDecision, type ServiceBookingPolicy } from '../domain/service-booking.js'

export class CartServicePolicyChangedError extends Error {
  constructor(readonly serviceId: string) { super('cart service policy must be resolved again') }
}

type CartClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }

export class PrismaCartRepository {
  constructor(private readonly client: CartClient) {}

  async load(input: { businessId: string; serviceIds: readonly string[]; serviceDecisions?: Record<string, ServiceBookingDecision>; preview?: boolean }): Promise<{
    snapshot: CartSnapshot
    policies: ReadonlyMap<string, CartCombinationPolicy>
  }> {
    const ids = [...new Set(input.serviceIds)]
    if (ids.length === 0) return { snapshot: buildCartSnapshot([]), policies: new Map() }
    const rows = await this.client.$queryRaw<Array<{
      id: string; name: string; duration: number; price: number | null; priceMode: 'FIXED' | 'STARTING_AT'; professionalIds: string[]
      attentionMode: ServiceBookingPolicy['attentionMode']; estimateAllowsBooking: boolean; estimateOptions: unknown;
      estimateQuestion: string | null; estimateExplanation: string | null; estimateDisclaimer: string | null;
      requiresPhoto: boolean; validationEnabled: boolean; validationMessage: string | null; validationQuestion: string | null
    }>>(Prisma.sql`
      SELECT s."id", s."name", s."duration", s."price", s."priceMode"::text AS "priceMode",
        s."attentionMode"::text AS "attentionMode", s."estimateAllowsBooking", s."estimateOptions", s."estimateQuestion",
        s."estimateExplanation", s."estimateDisclaimer", s."requiresPhoto", s."validationEnabled", s."validationMessage", s."validationQuestion",
        COALESCE(array_agg(DISTINCT p."id" ORDER BY p."id") FILTER (WHERE p."id" IS NOT NULL), ARRAY[]::text[]) AS "professionalIds"
      FROM "Service" s
      JOIN "ServiceCategory" c ON c."id" = s."catalogCategoryId" AND c."businessId" = s."businessId" AND c."isActive" = true
      LEFT JOIN "ProfessionalService" ps ON ps."serviceId" = s."id"
      LEFT JOIN "Professional" p ON p."id" = ps."professionalId" AND p."businessId" = s."businessId"
        AND p."isActive" = true AND p."acceptsBotBookings" = true
      WHERE s."businessId" = ${input.businessId} AND s."id" IN (${Prisma.join(ids)})
        AND s."isBookable" = true AND (s."attentionMode" = 'DIRECT_BOOKING'::"ServiceAttentionMode"
          OR (s."attentionMode" = 'GUIDED_ESTIMATE'::"ServiceAttentionMode" AND s."estimateAllowsBooking" = true))
      GROUP BY s."id", s."name", s."duration", s."price", s."priceMode"
      ORDER BY array_position(ARRAY[${Prisma.join(ids)}]::text[], s."id")
    `)
    if (rows.length !== ids.length) throw new CartServicePolicyChangedError(ids.find(id => !rows.some(row => row.id === id))!)
    const services: CartService[] = rows.map((row) => {
      const policy = { ...row, estimateOptions: parseEstimateOptions(row.estimateOptions) }
      const decision = input.serviceDecisions?.[row.id]
      const requiresDecision = row.attentionMode === 'GUIDED_ESTIMATE' || row.validationEnabled
      if (!input.preview && requiresDecision && (decision?.configurationKey !== serviceConfigurationKey(policy) || (row.validationEnabled && !decision.validationAccepted))) throw new CartServicePolicyChangedError(row.id)
      const estimate = row.attentionMode === 'GUIDED_ESTIMATE' ? resolveServiceEstimate(policy, decision?.estimate?.optionId ?? null) : null
      if (!input.preview && row.attentionMode === 'GUIDED_ESTIMATE' && (!estimate || JSON.stringify(estimate) !== JSON.stringify(decision?.estimate))) throw new CartServicePolicyChangedError(row.id)
      return { id: row.id, name: row.name, durationMinutes: row.duration,
        priceMinor: estimate?.priceMin ?? row.price, priceMode: row.attentionMode === 'GUIDED_ESTIMATE' ? 'STARTING_AT' : row.priceMode,
        professionalIds: row.professionalIds, ...(estimate ? { estimate } : {}) }
    })
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
