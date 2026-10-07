import { isBarberTestReset, resetTestDialogue } from './test-conversation-reset.js'
import type { DialoguePersonalityPort } from './dialogue-identity.js'
import { loadOwnConfirmedRuntimeGroupSnapshot, cancelGroupInTransaction, rescheduleGroupInTransaction } from './prisma-appointment-management.js'
import { GroupCancellationError, cancellationFingerprint, type CancellationSnapshot } from './appointment-management.js'
import { routeActions } from './actions.js'
import { canonicalJsonHash } from './canonical-json.js'
import { explicitReferralAction } from './conversational-referral.js'
import { isCustomerText } from './customer-text.js'
import { prismaHandoffEffectExecutor } from '../bot-options/infrastructure/prisma-handoff-effect-executor.js'
import { executePrismaConversationBooking, runtimeBookingReceiptReply } from './prisma-conversational-booking.js'
import { finalizeRuntimeBooking, finalizeAppointmentManagement } from './engine.js'
import { enqueueConversationalHandoffTx } from './prisma-conversational-handoff.js'
import type { ServiceContentConfiguration } from '../bot-options/domain/service-content.js'
import { canonicalConversationPhone, lockConversationPhoneTx, selectConsolidationGroupTx, supersedeConsolidationOutboxTx, type ConsolidationEnvelope } from './inbound-consolidation.js'
import { observeQueueProducerTransaction, type QueueMilestoneTracker } from '../bot-options/observability/queue-milestones.js'
import { measureAttemptStage, measureAttemptTransaction } from '../bot-options/observability/attempt-metrics.js'
import { respondWithAiInterpreter, type InterpretedDialogueResponse } from './ai-interpreter.js'
import type { WhatsAppConversationAi } from './whatsapp-ai.js'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { initialDialogueState, respond, respondConversationChoice, ConversationChoiceUnavailableError, type DialogueContext, type DialoguePort } from './engine.js'
import { createPrismaDialoguePort } from './prisma-dialogue-port.js'
import { loadConversationPolicy, resolveConversationPolicy, type PolicyRow } from './runtime-policy.js'
import { reconcileConversationDraft, projectConversationDraft } from './session-state.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../bot-options/domain/state.js'
import { textView } from '../bot-options/domain/views.js'
import { conversationStepForBotOptionsState } from '../bot-options/domain/conversation-status.js'
import { issueChoiceQuestion, parseConversationChoiceOperation, type ChoiceQuestion, type ChoiceScope } from './choices.js'
import { CONVERSATION_CHOICE_ACTION, persistConversationChoiceViewTx, resolveConversationChoicePayload } from './runtime-choice-persistence.js'
import { readConversationDraft } from './session-state.js'
import { persistConversationTurnTx } from './persist-conversation-turn.js'
import { applyLazyContextWindowTx } from '../bot-options/application/lazy-context-window.js'
import { acquireDispatchClaim, completeDispatchClaimTx, withDispatchClaimCleanup } from '../bot-options/infrastructure/dispatch-claims.js'
import { completeClaimedBotJobTx, rescheduleClaimedBotJobTx, type ClaimedBotJob } from '../bot-options/infrastructure/postgres-worker.js'
import { flushInboundConversationMessages, publishConversationUpdated, type InboundConversationMessageProjection, type ConversationUpdatedEvent } from '../services/crm-realtime-events.js'
import { persistView, type projectInboundMessage, type lockExistingInitialSession, type isConversationRestartCommand } from '../bot-options/application/process-session-job.js'

type Client = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>
export type ReplyPreparationHook = (context: { businessId: string; providerPhoneNumberId: string; providerMessageId: string }) => void | Promise<void>
export type DialogueFactory = (client: Client, businessId: string, serviceContent?: ServiceContentConfiguration) => Promise<{ context: DialogueContext; port: DialoguePort & DialoguePersonalityPort }>
const defaultFactory: DialogueFactory = (client, businessId, serviceContent) => {
  // Runtime receives the existing full Prisma client. No singleton or second connection.
  if (!('business' in client) || !('service' in client)) throw new Error('dialogue read delegates unavailable')
  return createPrismaDialoguePort(client as Parameters<typeof createPrismaDialoguePort>[0], businessId, serviceContent)
}
type Row = PolicyRow & { id: string; actionType: string; expectedRevision: bigint | null; deploymentGeneration: number; fenceEpoch: number; payload: Prisma.JsonValue;
  providerEventId: string; providerMessageId: string | null; providerPhoneNumberId: string | null; status: string; dbNow: Date; businessTimezone: string;
  admittedAt: Date; providerOccurredAt: Date | null; botEnabled: boolean; projectedConversationId: string | null }
type Session = NonNullable<Awaited<ReturnType<typeof lockExistingInitialSession>>> & { handoffFenceEpoch: number; handoffClaimsPausedAt: Date | null; deploymentId: string; deploymentGeneration: number }
const txOptions = { maxWait: 2_000, timeout: 10_000 } as const

/** Private PROCESS claim guard: this caller acquires its dispatch with sessionId null.
 * Snapshot/final callers already take the standalone shared cutover gate before identity/phone and row locks.
 * Never reacquire it here: validate from a new statement after the caller finishes that gate wait.
 * LATERAL tenant dependency + OFFSET barrier evaluates the job lock before dispatch lease predicates.
 * Both tenant inputs originate from the same job-scoped policy. Global/session-bound helpers are unchanged.
 */
async function assertConversationClaimsTx(tx: Prisma.TransactionClient, job: ClaimedBotJob, businessId: string, claimToken: string, resourceId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ jobCount: bigint; dispatchCount: bigint }>>(Prisma.sql`
    /* conversation-claims-assert */
    WITH locked_job AS MATERIALIZED (
      SELECT j."id", j."businessId" FROM "BotJob" j
      JOIN "BotChannelDeployment" d ON d."id" = j."deploymentId" AND d."businessId" = j."businessId"
      WHERE j."id" = ${job.id} AND j."status" = 'LEASED'::"BotJobStatus" AND j."leaseToken" = ${job.claimToken}
        AND j."leasedUntil" > clock_timestamp() AND j."businessId" = ${job.businessId}
        AND j."deploymentId" = ${job.deploymentId} AND j."deploymentGeneration" = ${job.deploymentGeneration}
        AND d."generation" = j."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
      FOR UPDATE OF j
    ), locked_dispatch AS MATERIALIZED (
      SELECT validated_claim."id" FROM locked_job validated_job
      CROSS JOIN LATERAL (
        SELECT c."id" FROM "BotDispatchClaim" c
        JOIN "BotChannelDeployment" d ON d."businessId" = c."businessId" AND d."channel" = c."channel"
        WHERE c."claimToken" = ${claimToken} AND c."businessId" = ${businessId}
          AND c."businessId" = validated_job."businessId" AND c."kind" = 'PROCESS'::"BotDispatchKind" AND c."resourceId" = ${resourceId}
          AND c."status" = 'CLAIMED'::"BotDispatchStatus"
          AND c."claimedUntil" > clock_timestamp() AND d."generation" = c."generation"
          AND d."dispatchFenceEpoch" = c."fenceEpoch" AND d."claimsPausedAt" IS NULL
          AND d."activeConfigurationId" IS NOT NULL AND d."legacyDispatchCoverageVersion" >= 1
          AND (c."sessionId" IS NULL OR EXISTS (
            SELECT 1 FROM "BotSession" s WHERE s."id" = c."sessionId" AND s."businessId" = c."businessId"
              AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
              AND s."handoffClaimsPausedAt" IS NULL AND s."handoffFenceEpoch" = c."handoffFenceEpoch"
          ))
        OFFSET 0
        FOR UPDATE OF c
      ) validated_claim
    )
    SELECT (SELECT count(*) FROM locked_job)::bigint AS "jobCount",
      (SELECT count(*) FROM locked_dispatch)::bigint AS "dispatchCount"
  `)
  if (rows[0]?.jobCount !== 1n) throw new Error('stale or fenced bot job claim')
  if (rows[0]?.dispatchCount !== 1n) throw new Error('stale or fenced dispatch claim')
}

/** Uses the existing inbox/job/outbox. Catalog queries and optional AI preparation run outside locks. */
export async function processConversationInbox(input: {
  client: Client; job: ClaimedBotJob; dialogueFactory?: DialogueFactory; conversationalAi?: WhatsAppConversationAi;
  queueMilestones?: QueueMilestoneTracker | undefined; onPreparingReply?: ReplyPreparationHook | undefined;
  writeView: typeof persistView; projectInbound: typeof projectInboundMessage;
  lockSession: typeof lockExistingInitialSession; isRestart: typeof isConversationRestartCommand
}): Promise<'PROCESSED' | 'STALE_REVISION' | null> {
  const policy = await measureAttemptStage('conversation_policy_load', () => loadConversationPolicy(input.client, { businessId: input.job.businessId, deploymentId: input.job.deploymentId, generation: input.job.deploymentGeneration }))
  if (!policy) {
    // A once-admitted conversational choice must never enter Booking V2 after policy removal.
    const actions = await input.client.$queryRaw<Array<{actionType:string}>>(Prisma.sql`
      /* conversation-choice-policy-guard */ SELECT "actionType" FROM "BotActionInbox"
      WHERE "id"=${input.job.aggregateId} AND "businessId"=${input.job.businessId}
        AND "deploymentId"=${input.job.deploymentId} AND "deploymentGeneration"=${input.job.deploymentGeneration}
    `)
    if (actions.some(row=>row.actionType===CONVERSATION_CHOICE_ACTION)) throw new Error('conversation choice policy unavailable')
    return null
  }
  const isRestart = (value: unknown) => input.isRestart(value) || isBarberTestReset(value, policy.businessId)
  const targets = await measureAttemptStage('conversation_target_read', () => input.client.$queryRaw<Array<{ fenceEpoch: number; phone: string | null }>>(Prisma.sql`
    /* conversation-target */ SELECT d."dispatchFenceEpoch" AS "fenceEpoch", e."payload"->>'fromPhone' AS "phone"
    FROM "BotChannelDeployment" d
    JOIN "BotActionInbox" i ON i."deploymentId" = d."id" AND i."businessId" = d."businessId" AND i."deploymentGeneration" = d."generation"
    JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" AND e."businessId" = i."businessId"
    WHERE d."id" = ${policy.deploymentId} AND d."businessId" = ${policy.businessId} AND d."generation" = ${policy.generation}
      AND i."id" = ${input.job.aggregateId} AND e."eventType" = 'MESSAGE'::"BotProviderEventType"
  `))
  const target = targets[0]
  if (targets.length !== 1 || !target?.phone) throw new Error('conversational target unavailable')
  const targetPhone = target.phone
  // One durable owner across workers; new inbound messages remain independently admissible.
  const resourceId = 'conversation-compute:' + createHash('sha256')
    .update(JSON.stringify([policy.businessId, canonicalConversationPhone(targetPhone)])).digest('hex')
  const token = await measureAttemptStage('conversation_dispatch_acquire', () => acquireDispatchClaim({ client: input.client, businessId: policy.businessId, sessionId: null,
    resourceId, generation: policy.generation, fenceEpoch: target.fenceEpoch, kind: 'PROCESS' }))
  if (!token) {
    // An owner can finish between acquisition and this transaction. A still-current gate permits
    // the same safe retry; a closed gate or lost job lease does not silently enter the old engine.
    const deferred = await input.client.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${policy.businessId}:WHATSAPP`}, 0))`)
      return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        /* conversation-compute-defer */
        WITH owned AS MATERIALIZED (
          SELECT j."id" FROM "BotJob" j JOIN "BotChannelDeployment" d ON d."id" = j."deploymentId" AND d."businessId" = j."businessId"
          WHERE j."id" = ${input.job.id} AND j."businessId" = ${policy.businessId} AND j."aggregateId" = ${input.job.aggregateId}
            AND j."status" = 'LEASED'::"BotJobStatus" AND j."leaseToken" = ${input.job.claimToken} AND j."leasedUntil" > clock_timestamp()
            AND j."deploymentId" = ${policy.deploymentId} AND j."deploymentGeneration" = ${policy.generation}
            AND d."generation" = j."deploymentGeneration" AND d."dispatchFenceEpoch" = ${target.fenceEpoch}
            AND d."channel" = 'WHATSAPP'::"BotChannel" AND d."engineKey" = 'deterministic-options'
            AND d."activeConfigurationId" IS NOT NULL AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
          FOR UPDATE OF j
        )
        UPDATE "BotJob" j SET "status" = 'READY'::"BotJobStatus", "attempts" = GREATEST(j."attempts" - 1, 0),
          "availableAt" = clock_timestamp() + interval '250 milliseconds', "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
        FROM owned WHERE j."id" = owned."id" RETURNING j."id"
      `)
    }, txOptions)
    if (deferred.length !== 1) throw new Error('conversation dispatch gate closed or stale job claim')
    return 'STALE_REVISION'
  }
  // Cleanup uses only executeRaw to release an unsettled claim; no global client proxy.
  const cleanupClient = {
    $queryRaw: input.client.$queryRaw.bind(input.client), $transaction: input.client.$transaction.bind(input.client),
    $executeRaw: (...args: Parameters<Client['$executeRaw']>) => measureAttemptStage('conversation_dispatch_release', () => input.client.$executeRaw(...args))
  } as Client
  return withDispatchClaimCleanup(cleanupClient, token, async markSettled => {
    const events: InboundConversationMessageProjection[] = []
    const updates: Array<Omit<ConversationUpdatedEvent, 'type'>> = []
    const readRow = async (tx: Prisma.TransactionClient): Promise<Row> => {
      await measureAttemptStage('conversation_claims_assert', () => assertConversationClaimsTx(tx, input.job, policy.businessId, token, resourceId))
      await measureAttemptStage('conversation_feature_lock', () => tx.$queryRaw(Prisma.sql`/* conversation-feature-lock */ SELECT "botEnabled" FROM "BusinessFeatureSettings" WHERE "businessId" = ${policy.businessId} FOR SHARE`))
      const rows = await measureAttemptStage('conversation_inbox_lock', () => tx.$queryRaw<Row[]>(Prisma.sql`
        /* conversation-inbox-lock */
        SELECT i."id", i."actionType", i."expectedRevision", i."businessId", i."deploymentId", i."deploymentGeneration", i."payload", i."providerEventId",
          i."providerMessageId", e."phoneNumberId" AS "providerPhoneNumberId", i."status"::text AS "status", clock_timestamp() AS "dbNow", e."admittedAt", e."providerOccurredAt",
          settings."timezone" AS "businessTimezone", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch", d."engineKey",
          cfg."id" AS "configurationId", cfg."businessId" AS "configurationBusinessId", cfg."status" AS "configurationStatus", cfg."definition", b."customerCode",
          (b."botEnabled" AND COALESCE(f."botEnabled", true)) AS "botEnabled",
          (SELECT projected."id" FROM "Message" message
            JOIN "Conversation" projected ON projected."id" = message."conversationId"
            WHERE message."id" = e."id" AND message."providerMessageId" = e."providerMessageId"
              AND message."providerMessageId" = i."providerMessageId" AND message."direction" = 'INBOUND'::"MessageDirection"
              AND projected."businessId" = i."businessId" AND projected."phone" = i."payload"->>'fromPhone'
              AND projected."phone" = e."payload"->>'fromPhone' AND message."phone" = projected."phone"
          ) AS "projectedConversationId"
        FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" AND e."businessId" = i."businessId"
        JOIN "BotChannelDeployment" d ON d."id" = i."deploymentId" AND d."businessId" = i."businessId"
        JOIN "BusinessBotConfiguration" cfg ON cfg."id" = d."activeConfigurationId" AND cfg."businessId" = d."businessId"
        JOIN "Business" b ON b."id" = i."businessId"
        JOIN "BusinessBotOptionsSettings" settings ON settings."businessId" = b."id"
        LEFT JOIN "BusinessFeatureSettings" f ON f."businessId" = b."id"
        WHERE i."id" = ${input.job.aggregateId} AND i."businessId" = ${policy.businessId}
          AND i."deploymentId" = ${policy.deploymentId} AND i."deploymentGeneration" = ${policy.generation}
          AND d."generation" = i."deploymentGeneration" AND d."claimsPausedAt" IS NULL
        FOR UPDATE OF i FOR SHARE OF d, cfg, b
      `))
      if (rows.length !== 1) throw new Error('conversation inbox no longer current')
      return rows[0]!
    }
    const ordered = async (tx: Prisma.TransactionClient, row: Row, phone: string) => {
      const rows = await measureAttemptStage('conversation_order_read', () => tx.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
        /* conversation-order */ SELECT EXISTS (
          SELECT 1 FROM "BotProviderEvent" e WHERE e."businessId" = ${row.businessId}
            AND e."eventType" = 'MESSAGE'::"BotProviderEventType" AND e."payload"->>'fromPhone' = ${phone}
            AND (e."admittedAt", e."id") < (${row.admittedAt}, ${row.providerEventId})
            AND (EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId" = e."id" AND i."businessId" = e."businessId"
              AND i."status" IN ('ADMITTED', 'CLAIMED', 'SELECTED', 'CONFLICT'))
              OR (e."status" = 'ADMITTED' AND NOT EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId" = e."id")))
        ) AS "blocked"
      `))
      if (!rows[0]) throw new Error('conversation order guard unavailable')
      return !rows[0].blocked
    }
    const finish = (tx: Prisma.TransactionClient, row: Row, coveredIds: string[] = [row.providerEventId]) => measureAttemptStage('conversation_settlement', async () => {
      const rows = await tx.$queryRaw<Array<{ inboxCount: bigint; dispatchCount: bigint; jobCount: bigint }>>(Prisma.sql`
        /* conversation-settle-batch */
        WITH settled_inbox AS (
          UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "error" = NULL
          WHERE "id" = ${row.id} AND "businessId" = ${row.businessId} AND "status" = 'ADMITTED'::"BotInboxStatus"
          RETURNING "id"
        ), covered_inbox AS (
          -- Only lifecycle rows are settled; jobs/dispatch leases belonging to other workers stay untouched.
          UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "error" = NULL
          WHERE "businessId" = ${row.businessId} AND "providerEventId" IN (${Prisma.join(coveredIds)})
            AND "id" <> ${row.id} AND "status"::text IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT')
            AND (SELECT count(*) FROM settled_inbox) = 1
          RETURNING "id"
        ), settled_event AS (
          UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus"
          WHERE "id" IN (${Prisma.join(coveredIds)}) AND "businessId" = ${row.businessId}
            AND (SELECT count(*) FROM settled_inbox) = 1 AND (SELECT count(*) FROM covered_inbox) >= 0
          RETURNING "id"
        ), event_done AS MATERIALIZED (
          -- Consume event completion even when no row matched: the existing event update has no required count.
          SELECT count(*) AS "completed" FROM settled_event
        ), settled_dispatch AS (
          UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
          FROM event_done
          WHERE "claimToken" = ${token} AND "status" = 'CLAIMED'::"BotDispatchStatus"
            AND (SELECT count(*) FROM settled_inbox) = 1 AND event_done."completed" >= 0
          RETURNING "id"
        ), settled_job AS (
          UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
            "lastError" = NULL, "updatedAt" = clock_timestamp()
          WHERE "id" = ${input.job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${input.job.claimToken}
            AND (SELECT count(*) FROM settled_dispatch) = 1
          RETURNING "id"
        )
        SELECT (SELECT count(*) FROM settled_inbox)::bigint AS "inboxCount",
          (SELECT count(*) FROM settled_dispatch)::bigint AS "dispatchCount",
          (SELECT count(*) FROM settled_job)::bigint AS "jobCount"
      `)
      if (rows[0]?.inboxCount !== 1n) throw new Error('conversation inbox settlement lost')
      if (rows[0]?.dispatchCount !== 1n) throw new Error('cannot complete stale dispatch claim')
      if (rows[0]?.jobCount !== 1n) throw new Error('cannot complete stale bot job claim')
    })
    // Under the existing phone mutex and session/CAS guards; never cancel or retry uncertain effects.
    const resetAllowedTx = async (tx: Prisma.TransactionClient, session: Session, timezone: string): Promise<boolean> => {
      const parsed = parseBotOptionsState(session.state)
      if (!parsed.ok || parsed.state.deposit !== 'NONE' || parsed.state.handoff !== 'NONE' ||
          !['NONE', 'DRAFT', 'CONFIRMED'].includes(parsed.state.booking)) return false
      try {
        const draft = readConversationDraft(session.state, policy, timezone)
        resetTestDialogue(draft)
        if (parsed.state.booking === 'CONFIRMED' && !draft.bookingReservation?.receipt) return false
      } catch { return false }
      const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
        /* test-reset-pending-effects */
        SELECT EXISTS (SELECT 1 FROM "BotOutbox"
          WHERE "businessId" = ${policy.businessId} AND "sessionId" = ${session.sessionId}
            AND "status"::text IN ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN'))
          OR EXISTS (SELECT 1 FROM "BotOperation"
            WHERE "businessId" = ${policy.businessId} AND "sessionId" = ${session.sessionId}
              AND "status" IS DISTINCT FROM 'COMPLETED') AS "blocked"
      `)
      if (rows.length !== 1 || typeof rows[0]?.blocked !== 'boolean') throw new Error('test reset effect guard unavailable')
      return !rows[0].blocked
    }
    const retry = async (tx: Prisma.TransactionClient, row: Row, immediate = false) => {
      await measureAttemptStage('conversation_dispatch_complete', () => completeDispatchClaimTx(tx, token))
      await measureAttemptStage('conversation_job_reschedule', () => rescheduleClaimedBotJobTx(tx, input.job, new Date(row.dbNow.getTime() + (immediate ? 0 : 500)), { refundClaimAttempt: true }))
    }
    const snapshot = await measureAttemptTransaction('conversation_snapshot', body => input.client.$transaction(body, txOptions), async (tx: Prisma.TransactionClient) => {
      // Take the conversation mutex before any job/deployment/event/session row lock.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${policy.businessId}:WHATSAPP`}, 0))`)
      const identity = await tx.$queryRaw<Array<{ phone: string }>>(Prisma.sql`
        /* consolidation-inbox-identity */ SELECT e."payload"->>'fromPhone' AS "phone" FROM "BotActionInbox" i
        JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" AND e."businessId" = i."businessId"
        WHERE i."id" = ${input.job.aggregateId} AND i."businessId" = ${policy.businessId}
      `)
      if (!identity[0]?.phone) throw new Error('conversation identity unavailable')
      await lockConversationPhoneTx(tx, policy.businessId, identity[0].phone)
      const row = await readRow(tx)
      const currentPolicy = resolveConversationPolicy(row)
      if (JSON.stringify(currentPolicy) !== JSON.stringify(policy)) { await retry(tx, row); return null }
      if (row.status !== 'ADMITTED') { await measureAttemptStage('conversation_dispatch_complete', () => completeDispatchClaimTx(tx, token)); await measureAttemptStage('conversation_job_complete', () => completeClaimedBotJobTx(tx, input.job)); return null }
      const payload = row.payload as { fromPhone?: unknown; textBody?: unknown; messageType?: unknown; contextWindowEvaluated?: unknown; conversationChoice?:unknown }
      if (typeof payload.fromPhone !== 'string' || !payload.fromPhone) throw new Error('conversation phone unavailable')
      const phone = payload.fromPhone
      if (canonicalConversationPhone(phone) !== canonicalConversationPhone(targetPhone)) throw new Error('conversation computation identity changed')
      const isChoice = row.actionType === CONVERSATION_CHOICE_ACTION
      const eligibleText = !isChoice && payload.messageType === 'text' && !isRestart(payload.textBody)
      if (!eligibleText && !await ordered(tx, row, phone)) { await retry(tx, row); return null }
      let session = await measureAttemptStage('conversation_session_lock', () => input.lockSession(tx, row.businessId, phone)) as Session | null
      if(isChoice && !session) {await finish(tx,row);return null}
      // The provider worker already committed CRM before classification. Reuse only its exact
      // journal/message/tenant/phone identity; synthetic or incomplete projections retain the old path.
      let conversationId = row.projectedConversationId && (!session || session.conversationId === row.projectedConversationId)
        ? row.projectedConversationId : null
      if (!conversationId) {
        // Serialize first creation on the existing conversation row, not a new queue.
        const conversations = await measureAttemptStage('conversation_conversation_upsert', () => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
          VALUES (${randomUUID()}, ${phone}, ${row.businessId}, clock_timestamp())
          ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt" RETURNING "id"
        `))
        const fallbackConversationId = conversations[0]?.id
        if (!fallbackConversationId) throw new Error('conversation unavailable')
        conversationId = fallbackConversationId
        await measureAttemptStage('conversation_inbound_project', () => input.projectInbound(tx, { businessId: row.businessId, conversationId: fallbackConversationId, phone, providerMessageId: row.providerMessageId,
          body: typeof payload.textBody === 'string' && payload.textBody.trim() ? payload.textBody.trim() : `[${String(payload.messageType ?? 'message')}]`, messageType: payload.messageType }, events))
      }

      if (row.botEnabled && session?.status === 'HUMAN_QUEUED' && !session.handoffClaimsPausedAt &&
          eligibleText && isCustomerText(payload.textBody,2000) && explicitReferralAction(payload.textBody) === 'resume') {
        // This cancellation belongs to the currently locked queue, not to an AI
        // interpretation, a former presentation or an operator-owned conversation.
        if (session.deploymentId !== policy.deploymentId || session.deploymentGeneration !== policy.generation) {
          await retry(tx,row);return null
        }
        if (!await ordered(tx,row,phone)) {await retry(tx,row);return null}
        const parsed = parseBotOptionsState(session.state)
        if (!parsed.ok || parsed.state.handoff !== 'QUEUED' || !['NONE','DRAFT'].includes(parsed.state.booking) ||
            parsed.state.deposit !== 'NONE') {await finish(tx,row);return null}
        const draft = readConversationDraft(session.state,policy,row.businessTimezone)
        if (draft.bookingReservation?.receipt || draft.sandboxReservation?.receipt) {await finish(tx,row);return null}
        const queued = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
          /* conversational-handoff-cancel-target */
          SELECT "id" FROM "BotHandoff" WHERE "businessId"=${row.businessId} AND "sessionId"=${session.sessionId}
            AND "status" IN ('QUEUED'::"BotHandoffStatus",'TAKEN'::"BotHandoffStatus") FOR UPDATE
        `)
        if (queued.length !== 1) throw new Error('ambiguous current handoff target')
        await prismaHandoffEffectExecutor(tx,{businessId:row.businessId,sessionId:session.sessionId,
          operationKey:'conversation-handoff-cancel:'+row.id,cancelScope:{handoffId:queued[0]!.id,
            revision:session.revision,handoffFenceEpoch:session.handoffFenceEpoch,deploymentId:policy.deploymentId,
            generation:policy.generation,configurationId:policy.configurationId,policyHash:canonicalJsonHash(policy),
            evidence:payload.textBody},effects:[{kind:'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER'}],pendingConversationUpdates:updates})
        draft.slot=null
        delete draft.referral;delete draft.dialogueContext;delete draft.questionContext
        delete draft.bookingReservation;delete draft.sandboxReservation;delete draft.timeClarification
        if (draft.pending === 'proposal') draft.pending='time'
        const state=projectConversationDraft(draft,policy),revision=session.revision+1n
        const transitionId='transition:'+session.sessionId+':'+revision
        const reply='Cancelé la derivación; tu pedido ya no está en cola. Conservé tu borrador, pero los horarios y propuestas anteriores deben verificarse de nuevo. ¿Cómo querés continuar?'
        const atomicText=input.writeView===persistView
        const update=await persistConversationTurnTx(tx,{businessId:row.businessId,sessionId:session.sessionId,
          expectedRevision:session.revision,revision,handoffFenceEpoch:session.handoffFenceEpoch,state,transitionId,
          deploymentId:policy.deploymentId,generation:policy.generation,providerEventId:row.providerEventId,
          actionType:'handoff.cancel',step:conversationStepForBotOptionsState(state),
          ...(atomicText?{finalizeText:{reply,toPhone:phone,dbNow:row.dbNow,inboxId:row.id,coveredIds:[row.providerEventId],
            dispatchToken:token,jobId:input.job.id,jobToken:input.job.claimToken}}:{})})
        if(update)updates.push(update)
        if(!atomicText) {
          await input.writeView(tx,{businessId:row.businessId,sessionId:session.sessionId,revision,transitionId,toPhone:phone,
            dbNow:row.dbNow,view:textView(reply)})
          await finish(tx,row)
        }
        return null
      }

      if (!row.botEnabled || (session && (session.status !== 'ACTIVE' || session.handoffClaimsPausedAt))) { await finish(tx, row); return null }
      if (session && (session.deploymentId !== policy.deploymentId || session.deploymentGeneration > policy.generation)) throw new Error('conversation session requires cutover')
      if (payload.contextWindowEvaluated !== true) {
        const window = await measureAttemptStage('conversation_context_window', () => applyLazyContextWindowTx(tx, { businessId: row.businessId, deploymentId: row.deploymentId,
          generation: row.generation, providerEventId: row.providerEventId, phone, admittedAt: row.admittedAt,
          providerOccurredAt: row.providerOccurredAt, isMedia: payload.messageType !== 'text', processingInboxId: row.id, currentJobId: input.job.id }, input.writeView))
        if (window.kind === 'WAIT') { await retry(tx, row); return null }
        if (window.kind === 'EXPIRED' || window.kind === 'REPLAY') { await finish(tx, row); return null }
      }
      if (!session) {
        const inserted = await measureAttemptStage('conversation_session_create', () => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          /* conversation-create-session */
          INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt", "draftTouchedAt", "draftExpiresAt")
          VALUES (${randomUUID()}, ${row.businessId}, ${conversationId}, ${row.deploymentId}, ${row.generation}, ${row.businessTimezone},
            ${JSON.stringify(createInitialBotOptionsState())}::jsonb, 0, clock_timestamp(), ${row.admittedAt}::timestamptz, ${row.admittedAt}::timestamptz + interval '24 hours') RETURNING "id"
        `))
        if (!inserted[0]) throw new Error('conversation session creation failed')
      }
      // A pre-existing session remains locked; only creation/lazy context can have changed it here.
      if (!session || payload.contextWindowEvaluated !== true) {
        session = await measureAttemptStage('conversation_session_lock', () => input.lockSession(tx, row.businessId, phone)) as Session | null
      }
      if (!session || session.status !== 'ACTIVE' || session.handoffClaimsPausedAt) throw new Error('conversation session fenced')
      const activeSession = session
      const choiceScope:ChoiceScope={businessId:row.businessId,conversationKey:activeSession.sessionId,policyKey:policy.configurationId,policyGeneration:policy.generation,revision:String(activeSession.revision)}
      let selectedChoice:ReturnType<typeof resolveConversationChoicePayload>|null=null
      if(isChoice) {
        try {
          if(row.expectedRevision!==activeSession.revision || activeSession.deploymentGeneration!==policy.generation) throw new Error('stale conversation choice revision')
          selectedChoice=resolveConversationChoicePayload(payload.conversationChoice,choiceScope,readConversationDraft(activeSession.state,policy,row.businessTimezone))
        } catch { await finish(tx,row);return null }
      }
      await measureAttemptStage('conversation_inbox_attach', () => tx.$executeRaw(Prisma.sql`
        /* conversation-attach */ UPDATE "BotActionInbox" SET "sessionId" = ${activeSession.sessionId}, "expectedRevision" = ${activeSession.revision}
        WHERE "id" = ${row.id} AND "businessId" = ${row.businessId} AND "status" = 'ADMITTED'::"BotInboxStatus"
      `))
      const parsed = parseBotOptionsState(activeSession.state)
      if (!parsed.ok) throw new Error('invalid conversation session state')
      const testReset = !isChoice && payload.messageType === 'text' && isBarberTestReset(payload.textBody, row.businessId)
      if (testReset && !await resetAllowedTx(tx, activeSession, row.businessTimezone)) {
        await input.writeView(tx, { businessId: row.businessId, sessionId: activeSession.sessionId, revision: activeSession.revision,
          transitionId: 'test-reset-blocked:' + row.id, toPhone: phone, dbNow: row.dbNow,
          view: textView('Todavía hay una operación o respuesta pendiente. No reinicié la conversación ni modifiqué tus turnos. Esperá a que termine y volvé a enviar /reset.') })
        await finish(tx, row); return null
      }
      let serverManagementSnapshot: CancellationSnapshot | undefined
      let runtimeManagementAllowed = false
      if (parsed.state.booking === 'CONFIRMED' && parsed.state.deposit === 'NONE' && parsed.state.handoff === 'NONE' && payload.messageType === 'text' && !isRestart(payload.textBody)) {
        const draft = readConversationDraft(activeSession.state, policy, row.businessTimezone)
        const requested = routeActions(String(payload.textBody ?? '')).pendingAction
        if (draft.bookingReservation?.receipt && (draft.appointmentManagement || requested === 'CANCEL' || requested === 'RESCHEDULE')) {
          try {
            serverManagementSnapshot = await loadOwnConfirmedRuntimeGroupSnapshot(tx, { businessId: row.businessId, sessionId: activeSession.sessionId, canonicalPhone: phone.replace(/[^0-9]/g, ''), expectedRevision: activeSession.revision })
            runtimeManagementAllowed = true
          } catch (error) { if (!(error instanceof GroupCancellationError)) throw error }
        }
      }
      if ((!['NONE', 'DRAFT'].includes(parsed.state.booking) || parsed.state.deposit !== 'NONE' || parsed.state.handoff !== 'NONE') && !runtimeManagementAllowed && !testReset) {
        let protectedReply = 'Tenés una operación anterior pendiente. El equipo debe resolverla antes de iniciar otra reserva; no modifiqué tu reserva ni tu pago.'
        let protectedDraft: ReturnType<typeof readConversationDraft> | undefined
        try { protectedDraft = readConversationDraft(activeSession.state, policy, row.businessTimezone) } catch { /* Preserve the protected session without trusting malformed sidecars. */ }
        if (parsed.state.booking === 'CANCELLED' && protectedDraft?.appointmentManagement?.outcome?.kind === 'CANCELLED') {
          protectedReply = 'El grupo de turnos fue cancelado. No inicié otra reserva.'
        } else if (parsed.state.booking === 'CONFIRMED' && parsed.state.deposit === 'NONE' && parsed.state.handoff === 'NONE' && protectedDraft?.bookingReservation?.receipt) {
          protectedReply = protectedDraft.appointmentManagement
            ? 'No pude verificar el estado actual de la gestión. El equipo debe revisarlo; no modifiqué tus turnos ni inicié otra reserva.'
            : runtimeBookingReceiptReply(protectedDraft.bookingReservation)
        }
        await measureAttemptStage('conversation_view_persist', () => input.writeView(tx, { businessId: row.businessId, sessionId: activeSession.sessionId, revision: activeSession.revision,
          transitionId: `transition:${activeSession.sessionId}:${activeSession.revision}:protected:${row.id}`, toPhone: phone, dbNow: row.dbNow,
          view: textView(protectedReply) }))
        await finish(tx, row)
        return null
      }
      if (activeSession.deploymentGeneration < policy.generation) {
        const revision = activeSession.revision + 1n
        const state = createInitialBotOptionsState()
        const changed = await measureAttemptStage('conversation_generation_reset', () => tx.$executeRaw(Prisma.sql`
          /* conversation-generation-reset */ UPDATE "BotSession" SET "state"=${JSON.stringify(state)}::jsonb,
            "deploymentGeneration"=${policy.generation}, "revision"=${revision}, "updatedAt"=clock_timestamp()
          WHERE "id"=${activeSession.sessionId} AND "businessId"=${row.businessId} AND "revision"=${activeSession.revision}
        `))
        if (changed !== 1) throw new Error('conversation generation reset lost revision')
        await measureAttemptStage('conversation_transition_insert', () => tx.$executeRaw(Prisma.sql`INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId") VALUES (${randomUUID()}, ${row.businessId}, ${activeSession.sessionId}, ${row.deploymentId}, ${row.generation}, ${activeSession.revision}, ${revision}, 'system.configuration_reset', 'APPLIED', ${row.providerEventId})`))
        session = { ...session, state, revision, deploymentGeneration: policy.generation }
      }
      const reset = !isChoice && payload.messageType === 'text' && isRestart(payload.textBody)
      const consolidation = eligibleText && !runtimeManagementAllowed ? await measureAttemptStage('conversation_order_read', () => selectConsolidationGroupTx(tx, { businessId: row.businessId,
        sessionId: session.sessionId, deploymentId: policy.deploymentId, generation: policy.generation,
        handoffFenceEpoch: session.handoffFenceEpoch, revision: session.revision, state: session.state,
        phone, currentEventId: row.providerEventId, isRestart })) : null
      if (eligibleText && !runtimeManagementAllowed && !consolidation) { await retry(tx, row, true); return null }
      const reconciled = reset ? { draft: initialDialogueState(row.businessId), reset: false } : reconcileConversationDraft(consolidation?.envelope.baseState ?? session.state, policy, row.businessTimezone)
      const draft = reconciled.draft
      return { row, session, payload, phone, draft, reset, testReset, consolidation, policyReset: reconciled.reset, selectedChoice, serverManagementSnapshot }
    })
    flushInboundConversationMessages(events)
    if (!snapshot) { for(const update of updates)publishConversationUpdated(update); markSettled(); return 'PROCESSED' }
    // This is a best-effort notification, not part of the durable computation or its latency.
    if (input.onPreparingReply && snapshot.payload.messageType === 'text' && !snapshot.reset &&
        snapshot.row.providerPhoneNumberId && snapshot.row.providerMessageId) {
      try {
        void Promise.resolve(input.onPreparingReply({ businessId: snapshot.row.businessId,
          providerPhoneNumberId: snapshot.row.providerPhoneNumberId, providerMessageId: snapshot.row.providerMessageId })).catch(() => {})
      } catch { /* Optional provider feedback cannot prevent a reply. */ }
    }
    // No transaction/client lock is retained while repositories compute the reply.
    const contextStarted = performance.now()
    const prepared = await measureAttemptStage('conversation_context_load', () => (input.dialogueFactory ?? defaultFactory)(input.client, policy.businessId, policy.serviceContent))
    if (prepared.context.businessId !== policy.businessId || prepared.context.timezone !== snapshot.row.businessTimezone) throw new Error('dialogue context mismatch')
    // Preserve port method receivers. Catalog includes repository pages already traced separately.
    const port: DialoguePort & DialoguePersonalityPort = {
      ...(prepared.port.personality ? { personality: () => prepared.port.personality!() } : {}),
      ...(prepared.port.managementRescheduleOffers ? { managementRescheduleOffers: (...args: Parameters<NonNullable<DialoguePort['managementRescheduleOffers']>>) => prepared.port.managementRescheduleOffers!(...args) } : {}),
      catalog: () => measureAttemptStage('conversation_catalog_load', () => prepared.port.catalog()),
      availability: (...args) => prepared.port.availability(...args),
      ...(prepared.port.availabilityBasket ? { availabilityBasket: (...args: Parameters<NonNullable<DialoguePort['availabilityBasket']>>) => prepared.port.availabilityBasket!(...args) } : {}),
      ...(prepared.port.prepareRuntimeBooking ? {prepareRuntimeBooking:(...args:Parameters<NonNullable<DialoguePort['prepareRuntimeBooking']>>)=>prepared.port.prepareRuntimeBooking!(...args)} : {}),
      ...(prepared.port.identity ? {identity:()=>prepared.port.identity!()} : {}),
      ...(prepared.port.professionalInformation ? {professionalInformation:(...args:Parameters<NonNullable<DialoguePort['professionalInformation']>>)=>prepared.port.professionalInformation!(...args)} : {}),
      ...(prepared.port.verifiedDateChoices ? {verifiedDateChoices:(...args:Parameters<NonNullable<DialoguePort['verifiedDateChoices']>>)=>prepared.port.verifiedDateChoices!(...args)} : {}),
      ...(prepared.port.information ? { information: (actions?: Parameters<NonNullable<DialoguePort['information']>>[0]) => prepared.port.information!(actions) } : {})
    }
    const computedStarted = performance.now()
    const useAi = input.conversationalAi && !snapshot.selectedChoice && !snapshot.reset && snapshot.payload.messageType === 'text'
    const computeChoice = async () => {
      try {return await respondConversationChoice(operationalContext,snapshot.draft,snapshot.selectedChoice!.operation,port)}
      catch(error) {
        if(!(error instanceof ConversationChoiceUnavailableError)) throw error
        return {state:snapshot.draft,reply:'Esa opción ya no está disponible. Escribime cómo querés continuar; conservé tu borrador.',proposal:null}
      }
    }
    const operationalContext = { ...prepared.context, ...('serverManagementSnapshot' in snapshot && snapshot.serverManagementSnapshot ? {serverManagementSnapshot:snapshot.serverManagementSnapshot} : {}), humanHandoff: true as const, serverRuntimeBookingScope: {businessId:policy.businessId,sessionId:snapshot.session.sessionId,deploymentId:policy.deploymentId,generation:policy.generation,revision:String(snapshot.session.revision+1n),configurationId:policy.configurationId,dispatchFenceEpoch:snapshot.row.fenceEpoch,handoffFenceEpoch:snapshot.session.handoffFenceEpoch} }
    const response = await measureAttemptStage('conversation_compute', async () => snapshot.testReset ? resetTestDialogue(snapshot.draft) : snapshot.reset ? { state: snapshot.draft, reply: 'Empecemos de nuevo. ¿Qué servicio necesitás?', proposal: null }
      : snapshot.selectedChoice ? await computeChoice()
      : snapshot.payload.messageType !== 'text' ? { state: snapshot.draft, reply: 'Por ahora necesito que me escribas tu consulta en texto. Conservé lo que ya me contaste.', proposal: null }
      : useAi ? await respondWithAiInterpreter(operationalContext, snapshot.draft, snapshot.consolidation?.text ?? String(snapshot.payload.textBody ?? ''), port, input.conversationalAi!.provider, { timeoutMs: input.conversationalAi!.timeoutMs })
      : await respond(operationalContext, snapshot.draft, snapshot.consolidation?.text ?? String(snapshot.payload.textBody ?? ''), port))
    const computedAt = performance.now()
    let committedTransitionId: string | null = null
    const result = await measureAttemptTransaction('conversation_final', body => observeQueueProducerTransaction(input.queueMilestones, operation => input.client.$transaction(operation, txOptions), body), async (tx: Prisma.TransactionClient) => {
      // Take the conversation mutex before any job/deployment/event/session row lock.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${policy.businessId}:WHATSAPP`}, 0))`)
      const identity = await tx.$queryRaw<Array<{ phone: string }>>(Prisma.sql`
        /* consolidation-inbox-identity */ SELECT e."payload"->>'fromPhone' AS "phone" FROM "BotActionInbox" i
        JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" AND e."businessId" = i."businessId"
        WHERE i."id" = ${input.job.aggregateId} AND i."businessId" = ${policy.businessId}
      `)
      if (!identity[0]?.phone) throw new Error('conversation identity unavailable')
      await lockConversationPhoneTx(tx, policy.businessId, identity[0].phone)
      const row = await readRow(tx)
      const currentPolicy = resolveConversationPolicy(row)
      if (row.status !== 'ADMITTED') { await measureAttemptStage('conversation_dispatch_complete', () => completeDispatchClaimTx(tx, token)); await measureAttemptStage('conversation_job_complete', () => completeClaimedBotJobTx(tx, input.job)); return 'PROCESSED' as const }
      const session = await measureAttemptStage('conversation_session_lock', () => input.lockSession(tx, row.businessId, snapshot.phone)) as Session | null
      if (!row.botEnabled || (session && (session.status !== 'ACTIVE' || session.handoffClaimsPausedAt))) { await finish(tx, row); return 'PROCESSED' as const }
      if (!session || JSON.stringify(currentPolicy) !== JSON.stringify(policy) || session.sessionId !== snapshot.session.sessionId ||
          session.deploymentId !== policy.deploymentId || session.deploymentGeneration !== policy.generation ||
          session.handoffFenceEpoch !== snapshot.session.handoffFenceEpoch || session.revision !== snapshot.session.revision ||
          (!snapshot.consolidation && !await ordered(tx, row, snapshot.phone))) { await retry(tx, row); return 'STALE_REVISION' as const }
      if (snapshot.testReset && !await resetAllowedTx(tx, session, row.businessTimezone)) {
        await input.writeView(tx, { businessId: row.businessId, sessionId: session.sessionId, revision: session.revision,
          transitionId: 'test-reset-blocked:' + row.id, toPhone: snapshot.phone, dbNow: row.dbNow,
          view: textView('Todavía hay una operación o respuesta pendiente. No reinicié la conversación ni modifiqué tus turnos. Esperá a que termine y volvé a enviar /reset.') })
        await finish(tx, row); return 'PROCESSED' as const
      }
      if(snapshot.selectedChoice) {
        try {
          if(row.actionType!==CONVERSATION_CHOICE_ACTION || row.expectedRevision!==session.revision) throw new Error('stale conversation choice')
          const current=resolveConversationChoicePayload((row.payload as {conversationChoice?:unknown}).conversationChoice,
            {businessId:row.businessId,conversationKey:session.sessionId,policyKey:policy.configurationId,policyGeneration:policy.generation,revision:String(session.revision)},
            readConversationDraft(session.state,policy,row.businessTimezone))
          if(JSON.stringify(current.operation)!==JSON.stringify(snapshot.selectedChoice.operation)) throw new Error('conversation choice changed')
        } catch {await finish(tx,row);return 'PROCESSED' as const}
      }
      if (snapshot.consolidation) {
        const fresh = await selectConsolidationGroupTx(tx, { businessId: row.businessId, sessionId: session.sessionId,
          deploymentId: policy.deploymentId, generation: policy.generation, handoffFenceEpoch: session.handoffFenceEpoch,
          revision: session.revision, state: session.state, phone: snapshot.phone, currentEventId: row.providerEventId, isRestart })
        if (!fresh || fresh.signature !== snapshot.consolidation.signature || fresh.previousTransitionId !== snapshot.consolidation.previousTransitionId ||
            (fresh.previousTransitionId && !await supersedeConsolidationOutboxTx(tx, row.businessId, session.sessionId, fresh.previousTransitionId))) {
          await retry(tx, row, true); return 'STALE_REVISION' as const
        }
      }
      const proposedHandoff = 'handoffCommand' in response ? response.handoffCommand : undefined
      // A failed AI interpretation may reconstruct literal operations through fallback.
      // That route is conversational help, never the current dispatch authorization.
      const rejectedHandoff = Boolean(proposedHandoff && useAi && (response as InterpretedDialogueResponse).interpretation.mode !== 'ai')
      const handoffCommand = rejectedHandoff ? undefined : proposedHandoff
      const command='bookingCommand' in response ? response.bookingCommand : undefined
      const managementCommand = 'managementCommand' in response ? response.managementCommand : undefined
      let finalResponse=response
      if (managementCommand) {
        if (command || handoffCommand) throw new Error('competing management effects')
        if (useAi && (response as InterpretedDialogueResponse).interpretation.mode !== 'ai') {
          finalResponse = { state: snapshot.draft, proposal: null, reply: 'No pude verificar ese consentimiento; no modifiqué tus turnos.' }
        } else {
          const fresh = await loadOwnConfirmedRuntimeGroupSnapshot(tx, { businessId: row.businessId, sessionId: session.sessionId, canonicalPhone: snapshot.phone.replace(/[^0-9]/g, ''), expectedRevision: session.revision })
          if (cancellationFingerprint(fresh) !== cancellationFingerprint(managementCommand.snapshot)) throw new GroupCancellationError('management snapshot changed; new consent required')
          const receipt = managementCommand.kind === 'CANCEL_APPOINTMENT_GROUP' ? await cancelGroupInTransaction(tx, managementCommand) : await rescheduleGroupInTransaction(tx, managementCommand)
          finalResponse = finalizeAppointmentManagement(response, receipt)
        }
      }
      if(command?.kind==='CONFIRM_BOOKING') {
        if(handoffCommand)throw new Error('competing runtime effects')
        if(useAi && (response as InterpretedDialogueResponse).interpretation.mode!=='ai') {
          const deniedState=structuredClone(response.state)
          delete deniedState.bookingReservation;delete deniedState.questionContext
          if(deniedState.dialogueContext)deniedState.dialogueContext.lastQuestion=null
          finalResponse={state:deniedState,proposal:null,reply:'No pude verificar ese consentimiento. Conservé tu propuesta; todavía no hay una reserva confirmada.'}
        } else {
          const result=await executePrismaConversationBooking(tx,{origin:{kind:'RUNTIME',businessId:row.businessId,sessionId:session.sessionId,
            canonicalPhone:snapshot.phone.replace(/[^0-9]/g,''),revision:session.revision,deploymentId:policy.deploymentId,generation:policy.generation,
            dispatchFenceEpoch:row.fenceEpoch,handoffFenceEpoch:session.handoffFenceEpoch,configurationId:policy.configurationId,
            operationKey:row.id,newBookingAllowed:true},presented:command.presented,currentDraft:snapshot.draft,
            consent:{confirmed:true,nonce:command.presented.nonce,fingerprint:command.presented.fingerprint}})
          finalResponse=finalizeRuntimeBooking(response,result)
        }
      }
      const state = snapshot.reset ? createInitialBotOptionsState() : projectConversationDraft(finalResponse.state, policy)
      const revision = session.revision + 1n
      const transitionId = `transition:${session.sessionId}:${revision}`
      const deliveryEnvelope:ConsolidationEnvelope|undefined=snapshot.consolidation?.envelope ?? (snapshot.selectedChoice ? {
        version:1,businessId:row.businessId,sessionId:session.sessionId,deploymentId:policy.deploymentId,generation:policy.generation,
        handoffFenceEpoch:session.handoffFenceEpoch,baseState:state,eventIds:[row.providerEventId],sealed:true,revision:String(revision)
      } : undefined)
      // Preserve injected view writers; the production TEXT path batches only its known renderer.
      const choiceScope:ChoiceScope={businessId:row.businessId,conversationKey:session.sessionId,policyKey:policy.configurationId,policyGeneration:policy.generation,revision:String(revision)}
      let question:ChoiceQuestion|undefined
      if(!handoffCommand && !command && !managementCommand && input.writeView===persistView && 'choicePresentation' in response && response.choicePresentation) {
        for(const choice of response.choicePresentation.choices) parseConversationChoiceOperation(choice.operation)
        // Bounded question issuance is all-or-nothing. An oversized configuration keeps the full textual reply.
        try {question=issueChoiceQuestion(choiceScope,response.state,response.choicePresentation)} catch {question=undefined}
      }
      const atomicText = input.writeView === persistView && !question
      const reply = rejectedHandoff ? 'No pude verificar ese consentimiento. Para enviar esta consulta al equipo, escribí «consultar al equipo». Conservé tu borrador.'
        : handoffCommand ? 'Tu consulta quedó en cola para el equipo. Conservé tu borrador; todavía no hay una reserva confirmada.' : (snapshot.policyReset ? 'La configuración cambió; empecemos con un borrador nuevo. ' : '') + finalResponse.reply
      const update = await measureAttemptStage('conversation_turn_persist', () => persistConversationTurnTx(tx, {
        businessId: row.businessId, sessionId: session.sessionId, expectedRevision: session.revision, revision,
        handoffFenceEpoch: session.handoffFenceEpoch, state, transitionId, deploymentId: row.deploymentId,
        generation: row.generation, providerEventId: row.providerEventId, consolidation: deliveryEnvelope, admittedAt: snapshot.consolidation?.admittedAt, actionType: snapshot.reset ? 'system.conversation_restart' : snapshot.selectedChoice ? CONVERSATION_CHOICE_ACTION : 'conversation.message',
        step: handoffCommand ? null : conversationStepForBotOptionsState(state),
        ...(atomicText ? { finalizeText: { reply, toPhone: snapshot.phone, dbNow: row.dbNow, inboxId: row.id,
          coveredIds: snapshot.consolidation?.envelope.eventIds ?? [row.providerEventId],
          dispatchToken: token, jobId: input.job.id, jobToken: input.job.claimToken } } : {})
      }))
      if (update) updates.push(update)
      if (handoffCommand) {
        // The ACTIVE CAS and outbox are still uncommitted. D1 queues this exact
        // persisted draft at r+1, producing r+2; failure must escape and roll back all.
        await enqueueConversationalHandoffTx(tx,{businessId:row.businessId,sessionId:session.sessionId,policy,
          expectedRevision:revision,handoffFenceEpoch:session.handoffFenceEpoch,
          operationKey:'conversation-handoff:'+row.id,
          command:{referral:handoffCommand.referral,consent:{revision,evidence:handoffCommand.evidence}},
          pendingConversationUpdates:updates})
      }
      if (question) {
        await measureAttemptStage('conversation_view_persist',()=>persistConversationChoiceViewTx(tx,{scope:choiceScope,draft:response.state,question,reply,transitionId,toPhone:snapshot.phone,dbNow:row.dbNow,consolidation:deliveryEnvelope}))
        await finish(tx,row,snapshot.consolidation?.envelope.eventIds)
      } else if (!atomicText) {
        await measureAttemptStage('conversation_view_persist', () => input.writeView(tx, { businessId: row.businessId, sessionId: session.sessionId, revision, transitionId,
          toPhone: snapshot.phone, consolidation: deliveryEnvelope, view: textView(reply), dbNow: row.dbNow }))
        await finish(tx, row, snapshot.consolidation?.envelope.eventIds)
      }
      committedTransitionId = transitionId
      return 'PROCESSED' as const
    })
    markSettled()
    if (useAi && input.conversationalAi?.onDiagnostic) {
      const diagnostic = (response as InterpretedDialogueResponse).interpretation
      const ms = (value: number) => Math.round(value * 10) / 10
      try {
        await input.conversationalAi.onDiagnostic({
          jobId: input.job.id, businessId: policy.businessId, providerEventId: snapshot.row.providerEventId,
          transitionId: committedTransitionId, result, contextMs: ms(computedStarted - contextStarted), computeMs: ms(computedAt - computedStarted),
          mode: diagnostic.mode, reason: diagnostic.reason, copyMode: diagnostic.copyMode, copyReason: diagnostic.copyReason,
          ...(diagnostic.replyValidation ? { replyValidation: diagnostic.replyValidation } : {}),
          aiCalls: diagnostic.aiCalls, replyRoute: diagnostic.replyRoute,
          ...(diagnostic.interpretationProviderError ? { interpretationProviderError: diagnostic.interpretationProviderError } : {}),
          ...(diagnostic.responseProviderError ? { responseProviderError: diagnostic.responseProviderError } : {}),
          ...(diagnostic.availability ? { availability: diagnostic.availability } : {}),
          interpretationMs: diagnostic.providerMs, validationMs: diagnostic.validationMs,
          engineMs: diagnostic.engineMs ?? 0, responseMs: diagnostic.responseMs ?? 0, usage: diagnostic.usage ?? null
        })
      } catch { /* Observability is fail-open after the durable transaction committed. */ }
    }
    for (const update of updates) publishConversationUpdated(update)
    return result
  })
}
