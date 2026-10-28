import type { InstagramConversationSubject } from './conversation-subject.js'
import type { ConsolidationEnvelope } from './inbound-consolidation.js'
import { Prisma } from '../generated/prisma/client.js'
import type { BotOptionsConversationStep } from '../bot-options/domain/conversation-status.js'
import type { ConversationUpdatedEvent } from '../services/crm-realtime-events.js'
import { randomUUID } from 'node:crypto'
import { planPersistedView } from '../bot-options/application/process-session-job.js'
import { textView } from '../bot-options/domain/views.js'
import type { PublicLocationAction } from './maps-link.js'
import { recordProducedOutbox } from '../bot-options/observability/queue-milestones.js'

/** Internal conversational write unit; callers retain all fresh read/lock guards and commit ownership. */
export async function persistConversationTurnTx(tx: Prisma.TransactionClient, input: {
  subject?: InstagramConversationSubject
  businessId: string; sessionId: string; expectedRevision: bigint; revision: bigint; handoffFenceEpoch: number
  state: unknown; transitionId: string; deploymentId: string; generation: number
  consolidation?: ConsolidationEnvelope | undefined; admittedAt?: Date | undefined; providerEventId: string; actionType: string; step: BotOptionsConversationStep | null
  finalizeText?: { reply: string; publicLink?: PublicLocationAction; toPhone: string; dbNow: Date; inboxId: string; coveredIds: string[];
    dispatchToken: string; jobId: string; jobToken: string }
}): Promise<Omit<ConversationUpdatedEvent, 'type'> | null> {
  const final = input.finalizeText
  const plan = final ? planPersistedView({ view: textView(final.reply, final.publicLink), transitionId: input.transitionId,
    toPhone: final.toPhone,...(input.subject?{subject:input.subject}:{}), promptToken: '', idFactory: randomUUID }) : null
  if (final && (!final.toPhone || !final.coveredIds.length)) throw new Error('text finalization destination or coverage unavailable')
  if (plan && (plan.promptId || plan.choiceRows.length || plan.outboxRows.some(row => row.kind !== 'informative_text' &&
      !(row.item.type === 'interactive' && row.item.mode === 'cta_url' && final?.publicLink)))) {
    throw new Error('text finalization requires a text-only view')
  }
  const rows = await tx.$queryRaw<Array<{ sessionCount: bigint; transitionCount: bigint; stepCount: bigint;
    outboxCount: bigint; inboxCount: bigint; dispatchCount: bigint; jobCount: bigint;
    conversationId: string | null; updatedAt: Date | null }>>(Prisma.sql`
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
    )${final && plan ? Prisma.sql`, step_done AS MATERIALIZED (
      SELECT count(*) AS completed FROM projected_step
    ), invalidated AS (
      UPDATE "BotPrompt" prompt SET "status" = 'INVALIDATED'::"BotPromptStatus", "resolvedAt" = clock_timestamp()
      FROM saved_session s JOIN inserted_transition t ON t."sessionId" = s."id" AND t."businessId" = s."businessId", step_done
      WHERE prompt."sessionId" = s."id" AND prompt."status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
        AND step_done.completed <= 1
      RETURNING prompt."id"
    ), prompt_done AS MATERIALIZED (
      SELECT count(*) AS completed FROM invalidated
    ), inserted_outbox AS (
      ${plan.outboxRows.length ? Prisma.sql`
        INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
          "idempotencyKey", "status", "dependsOnSequence", "availableAt", "updatedAt")
        SELECT planned.*, clock_timestamp()
        FROM (VALUES ${Prisma.join(plan.outboxRows.map(row => Prisma.sql`(
          ${row.id}, ${input.businessId}, ${input.sessionId}, ${input.transitionId}, ${row.deliveryGroupId}, ${row.sequence}::integer, ${row.kind},
          ${JSON.stringify({ to: final.toPhone, ...(input.subject?{channel:'INSTAGRAM',subject:input.subject,revision:String(input.revision)}:{}), item: row.item, ...(input.consolidation ? { consolidation: input.consolidation } : {}) })}::jsonb,
          ${row.idempotencyKey}, 'PENDING'::"BotOutboxStatus", ${row.dependsOnSequence}::integer, ${final.dbNow}::timestamptz
        )`))}) planned
        CROSS JOIN prompt_done
        WHERE (SELECT count(*) FROM saved_session) = 1 AND (SELECT count(*) FROM inserted_transition) = 1 AND prompt_done.completed >= 0
        RETURNING "id"
      ` : Prisma.sql`SELECT NULL::text AS "id" WHERE FALSE`}
    ), settled_inbox AS (
      UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "error" = NULL
      WHERE "id" = ${final.inboxId} AND "businessId" = ${input.businessId} AND "status" = 'ADMITTED'::"BotInboxStatus"
        AND (SELECT count(*) FROM saved_session) = 1 AND (SELECT count(*) FROM inserted_transition) = 1
        AND (SELECT count(*) FROM projected_step) <= 1 AND (SELECT count(*) FROM inserted_outbox) = ${plan.outboxRows.length}
        AND (SELECT completed FROM prompt_done) >= 0
      RETURNING "id"
    ), covered_inbox AS (
      UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "error" = NULL
      WHERE "businessId" = ${input.businessId} AND "providerEventId" IN (${Prisma.join(final.coveredIds)})
        AND "id" <> ${final.inboxId} AND "status"::text IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT')
        AND (SELECT count(*) FROM settled_inbox) = 1
      RETURNING "id"
    ), settled_event AS (
      UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus"
      WHERE "id" IN (${Prisma.join(final.coveredIds)}) AND "businessId" = ${input.businessId}
        AND (SELECT count(*) FROM settled_inbox) = 1 AND (SELECT count(*) FROM covered_inbox) >= 0
      RETURNING "id"
    ), event_done AS MATERIALIZED (
      SELECT count(*) AS completed FROM settled_event
    ), settled_dispatch AS (
      UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      FROM event_done
      WHERE "claimToken" = ${final.dispatchToken} AND "status" = 'CLAIMED'::"BotDispatchStatus"
        AND (SELECT count(*) FROM settled_inbox) = 1 AND event_done.completed >= 0
      RETURNING "id"
    ), settled_job AS (
      UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${final.jobId} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${final.jobToken}
        AND (SELECT count(*) FROM settled_dispatch) = 1
      RETURNING "id"
    )` : Prisma.empty}
    SELECT (SELECT count(*) FROM saved_session)::bigint AS "sessionCount",
      (SELECT count(*) FROM inserted_transition)::bigint AS "transitionCount",
      ${final ? Prisma.sql`(SELECT count(*) FROM inserted_outbox)::bigint AS "outboxCount",
        (SELECT count(*) FROM settled_inbox)::bigint AS "inboxCount",
        (SELECT count(*) FROM settled_dispatch)::bigint AS "dispatchCount",
        (SELECT count(*) FROM settled_job)::bigint AS "jobCount",` : Prisma.empty}
      (SELECT count(*) FROM projected_step)::bigint AS "stepCount",
      (SELECT "id" FROM projected_step LIMIT 1) AS "conversationId",
      (SELECT "updatedAt" FROM projected_step LIMIT 1) AS "updatedAt"
  `)
  const row = rows[0]
  if (row?.sessionCount !== 1n) throw new Error('conversation revision lost')
  if (row.transitionCount !== 1n) throw new Error('conversation transition row count mismatch')
  if (row.stepCount > 1n) throw new Error('ambiguous bot options conversation projection')
  if (final && plan) {
    if (row.outboxCount !== BigInt(plan.outboxRows.length)) throw new Error('persist view row count mismatch')
    if (row.inboxCount !== 1n) throw new Error('conversation inbox settlement lost')
    if (row.dispatchCount !== 1n) throw new Error('cannot complete stale dispatch claim')
    if (row.jobCount !== 1n) throw new Error('cannot complete stale bot job claim')
    for (const outbox of plan.outboxRows) recordProducedOutbox(tx, { businessId: input.businessId, id: outbox.id })
  }
  return row.conversationId && row.updatedAt ? {
    businessId: input.businessId, conversationId: row.conversationId, updatedAt: row.updatedAt.toISOString()
  } : null
}
