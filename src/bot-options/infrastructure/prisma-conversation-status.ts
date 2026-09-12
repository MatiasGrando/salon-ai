import { Prisma } from '../../generated/prisma/client.js'
import type { ConversationUpdatedEvent } from '../../services/crm-realtime-events.js'
import type { BotOptionsConversationStep } from '../domain/conversation-status.js'

export async function projectBotOptionsConversationStepTx(
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; step: BotOptionsConversationStep }
): Promise<Omit<ConversationUpdatedEvent, 'type'> | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`
    UPDATE "Conversation" conversation
    SET "currentStep"=${input.step}::"ConversationStep", "updatedAt"=clock_timestamp()
    FROM "BotSession" session
    WHERE session."id"=${input.sessionId} AND session."businessId"=${input.businessId}
      AND conversation."id"=session."conversationId" AND conversation."businessId"=session."businessId"
      AND conversation."currentStep" IS DISTINCT FROM ${input.step}::"ConversationStep"
    RETURNING conversation."id", conversation."updatedAt"
  `)
  if (rows.length > 1) throw new Error('ambiguous bot options conversation projection')
  const row = rows[0]
  return row ? {
    businessId: input.businessId,
    conversationId: row.id,
    updatedAt: row.updatedAt.toISOString()
  } : null
}
