import type { ConsolidationEnvelope } from './inbound-consolidation.js'
import { Prisma } from '../generated/prisma/client.js'
import type { BotOptionsConversationStep } from '../bot-options/domain/conversation-status.js'
import type { ConversationUpdatedEvent } from '../services/crm-realtime-events.js'

/** Internal conversational write unit; callers retain all fresh read/lock guards and commit ownership. */
export async function persistConversationTurnTx(tx: Prisma.TransactionClient, input: {
  businessId: string; sessionId: string; expectedRevision: bigint; revision: bigint; handoffFenceEpoch: number
  state: unknown; transitionId: string; deploymentId: string; generation: number
  consolidation?: ConsolidationEnvelope | undefined; admittedAt?: Date | undefined; providerEventId: string; actionType: string; step: BotOptionsConversationStep | null
}): Promise<Omit<ConversationUpdatedEvent, 'type'> | null> {
  const rows = await tx.$queryRaw<Array<{ sessionCount: bigint; stepCount: bigint; conversationId: string | null; updatedAt: Date | null }>>(Prisma.sql`
    /* conversation-turn-persist */
    WITH saved_session AS (
      UPDATE "BotSession" SET "state" = ${JSON.stringify(input.state)}::jsonb, "revision" = ${input.revision}, "updatedAt" = clock_timestamp()
        ${input.admittedAt ? Prisma.sql`, "draftTouchedAt" = GREATEST(COALESCE("draftTouchedAt", ${input.admittedAt}::timestamptz), ${input.admittedAt}::timestamptz), "draftExpiresAt" = GREATEST(COALESCE("draftExpiresAt", ${input.admittedAt}::timestamptz + interval '24 hours'), ${input.admittedAt}::timestamptz + interval '24 hours')` : Prisma.empty}
      WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId} AND "revision" = ${input.expectedRevision}
        AND "status" = 'ACTIVE'::"BotSessionStatus" AND "handoffClaimsPausedAt" IS NULL AND "handoffFenceEpoch" = ${input.handoffFenceEpoch}
      RETURNING "id", "businessId", "conversationId"
    ), inserted_transition AS (
      INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId"${input.consolidation ? Prisma.sql`, "detail"` : Prisma.empty})
      SELECT ${input.transitionId}, s."businessId", s."id", ${input.deploymentId}, ${input.generation}, ${input.expectedRevision}, ${input.revision},
        ${input.actionType}, 'APPLIED', ${input.providerEventId}${input.consolidation ? Prisma.sql`, ${JSON.stringify({ consolidation: input.consolidation })}::jsonb` : Prisma.empty}
      FROM saved_session s
      RETURNING "sessionId", "businessId"
    ), projected_step AS (
      UPDATE "Conversation" conversation
      SET "currentStep" = ${input.step}::"ConversationStep", "updatedAt" = clock_timestamp()
      FROM saved_session s JOIN inserted_transition t ON t."sessionId" = s."id" AND t."businessId" = s."businessId"
      WHERE ${input.step}::text IS NOT NULL AND conversation."id" = s."conversationId" AND conversation."businessId" = s."businessId"
        AND conversation."currentStep" IS DISTINCT FROM ${input.step}::"ConversationStep"
      RETURNING conversation."id", conversation."updatedAt"
    )
    SELECT (SELECT count(*) FROM saved_session)::bigint AS "sessionCount",
      (SELECT count(*) FROM projected_step)::bigint AS "stepCount",
      (SELECT "id" FROM projected_step LIMIT 1) AS "conversationId",
      (SELECT "updatedAt" FROM projected_step LIMIT 1) AS "updatedAt"
  `)
  const row = rows[0]
  if (row?.sessionCount !== 1n) throw new Error('conversation revision lost')
  if (row.stepCount > 1n) throw new Error('ambiguous bot options conversation projection')
  return row.conversationId && row.updatedAt ? {
    businessId: input.businessId, conversationId: row.conversationId, updatedAt: row.updatedAt.toISOString()
  } : null
}
