import { Prisma } from '../generated/prisma/client.js'
import { parseDefinitionServiceContent, type ServiceContentConfiguration } from '../bot-options/domain/service-content.js'
type ContentClient = Partial<Pick<Prisma.TransactionClient, 'businessBotConfiguration' | '$queryRaw'>>
/** Existing active configuration is the only authority; absence/ambiguity stays conservative legacy. */
export async function loadActiveServiceContent(client: ContentClient, businessId: string, lock = false): Promise<ServiceContentConfiguration | null> {
  if (!client.businessBotConfiguration || !client.$queryRaw) return null
  const rows = await client.$queryRaw<Array<{ id: string; businessId: string; definition: unknown }>>(Prisma.sql`
    /* service-content-definition */ SELECT cfg."id", cfg."businessId", cfg."definition"
    FROM "BusinessBotConfiguration" cfg
    WHERE cfg."businessId" = ${businessId} AND cfg."status" = 'ACTIVE'
      AND cfg."definition"->'conversation' = '{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb
    ORDER BY cfg."id" LIMIT 2 ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}
  `)
  if (rows.length !== 1 || rows[0]!.businessId !== businessId) return null
  return parseDefinitionServiceContent(rows[0]!.definition, businessId)
}
