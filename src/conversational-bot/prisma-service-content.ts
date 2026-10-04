import { Prisma } from '../generated/prisma/client.js'
import { parseDefinitionServiceContent, type ServiceContentConfiguration } from '../bot-options/domain/service-content.js'
type ContentClient = Partial<Pick<Prisma.TransactionClient, 'businessBotConfiguration' | '$queryRaw'>>
/** Metadata projection belongs to the same public snapshot/stamp, never a previously loaded definition. */
export function serviceContentFromPublicSnapshot(rows: unknown, businessId: string, options: { qaPreview?: boolean } = {}): ServiceContentConfiguration | null {
  if (!Array.isArray(rows) || rows.length > 64) return null
  const scoped = rows.filter(row => row && typeof row === 'object' && row.businessId === businessId && row.status === 'ACTIVE' &&
    (options.qaPreview ? row.qaEligible === true : row.conversationEligible === true))
  if (scoped.length !== 1) return null
  return parseDefinitionServiceContent({ serviceContent: scoped[0].serviceContent }, businessId)
}
/** Existing active configuration is the only authority; absence/ambiguity stays conservative legacy. */
export async function loadActiveServiceContent(client: ContentClient, businessId: string, lock = false, options: { qaPreview?: boolean } = {}): Promise<ServiceContentConfiguration | null> {
  if (!client.businessBotConfiguration || !client.$queryRaw) return null
  const rows = await client.$queryRaw<Array<{ id: string; businessId: string; definition: unknown }>>(Prisma.sql`
    /* service-content-definition */ SELECT cfg."id", cfg."businessId", cfg."definition"
    FROM "BusinessBotConfiguration" cfg
    ${options.qaPreview ? Prisma.sql`JOIN "Business" b ON b."id" = cfg."businessId" AND b."isDemo" = true AND b."demoType" = 'QA_SANDBOX'` : Prisma.empty}
    WHERE cfg."businessId" = ${businessId} AND cfg."status" = 'ACTIVE'
      AND ${options.qaPreview ? Prisma.sql`cfg."definition"->'qaSimulator' = 'true'::jsonb` : Prisma.sql`cfg."definition"->'conversation' = '{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb`}
    ORDER BY cfg."id" LIMIT 2 ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}
  `)
  if (rows.length !== 1 || rows[0]!.businessId !== businessId) return null
  return parseDefinitionServiceContent(rows[0]!.definition, businessId)
}
