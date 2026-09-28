import { Prisma } from '../generated/prisma/client.js'

export type ConversationPolicy = { businessId: string; deploymentId: string; generation: number; configurationId: string }
export type PolicyRow = ConversationPolicy & { customerCode: string; configurationBusinessId: string; configurationStatus: string; engineKey: string; definition: unknown }
/** Absence opts out; a claimed but invalid marker must never fall through to legacy. */
export function resolveConversationPolicy(row: PolicyRow): ConversationPolicy | null {
  const definition = row.definition
  if (!definition || typeof definition !== 'object' || Array.isArray(definition) || !Object.hasOwn(definition, 'conversation')) return null
  const marker = (definition as { conversation: unknown }).conversation
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) ||
      Object.keys(marker).sort().join(',') !== 'engine,schemaVersion' ||
      (marker as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      (marker as { engine?: unknown }).engine !== 'conversational-booking-v1' ||
      row.customerCode !== 'WX-38N6UG' || row.configurationBusinessId !== row.businessId || row.configurationStatus !== 'ACTIVE' ||
      row.engineKey !== 'deterministic-options' || !row.businessId || !row.deploymentId || !row.configurationId || !Number.isSafeInteger(row.generation) || row.generation < 1) {
    throw new Error('invalid conversational runtime policy')
  }
  return { businessId: row.businessId, deploymentId: row.deploymentId, generation: row.generation, configurationId: row.configurationId }
}
export async function loadConversationPolicy(client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: { businessId: string; deploymentId?: string; generation?: number }): Promise<ConversationPolicy | null> {
  const rows = await client.$queryRaw<PolicyRow[]>(Prisma.sql`
    /* conversation-policy */
    SELECT d."businessId", d."id" AS "deploymentId", d."generation", d."engineKey", b."customerCode",
      cfg."id" AS "configurationId", cfg."businessId" AS "configurationBusinessId", cfg."status" AS "configurationStatus", cfg."definition"
    FROM "BotChannelDeployment" d JOIN "Business" b ON b."id" = d."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg."id" = d."activeConfigurationId" AND cfg."businessId" = d."businessId"
    WHERE d."businessId" = ${input.businessId} AND d."channel" = 'WHATSAPP'::"BotChannel"
      AND (${input.deploymentId ?? null}::text IS NULL OR d."id" = ${input.deploymentId ?? null})
      AND (${input.generation ?? null}::integer IS NULL OR d."generation" = ${input.generation ?? null})
      AND d."claimsPausedAt" IS NULL
  `)
  if (rows.length > 1) throw new Error('ambiguous conversational deployment')
  return rows[0] ? resolveConversationPolicy(rows[0]) : null
}
