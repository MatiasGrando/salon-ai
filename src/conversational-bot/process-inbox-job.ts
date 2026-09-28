import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { initialDialogueState, respond, type DialogueContext, type DialoguePort } from './engine.js'
import { createPrismaDialoguePort } from './prisma-dialogue-port.js'
import { loadConversationPolicy, resolveConversationPolicy, type PolicyRow } from './runtime-policy.js'
import { reconcileConversationDraft, projectConversationDraft } from './session-state.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../bot-options/domain/state.js'
import { textView } from '../bot-options/domain/views.js'
import { conversationStepForBotOptionsState } from '../bot-options/domain/conversation-status.js'
import { projectBotOptionsConversationStepTx } from '../bot-options/infrastructure/prisma-conversation-status.js'
import { applyLazyContextWindowTx } from '../bot-options/application/lazy-context-window.js'
import { acquireDispatchClaim, assertDispatchClaimTx, completeDispatchClaimTx, withDispatchClaimCleanup } from '../bot-options/infrastructure/dispatch-claims.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, rescheduleClaimedBotJobTx, type ClaimedBotJob } from '../bot-options/infrastructure/postgres-worker.js'
import { flushInboundConversationMessages, publishConversationUpdated, type InboundConversationMessageProjection, type ConversationUpdatedEvent } from '../services/crm-realtime-events.js'
import type { persistView, projectInboundMessage, lockExistingInitialSession, isConversationRestartCommand } from '../bot-options/application/process-session-job.js'

type Client = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>
export type DialogueFactory = (client: Client, businessId: string) => Promise<{ context: DialogueContext; port: DialoguePort }>
const defaultFactory: DialogueFactory = (client, businessId) => {
  // Runtime receives the existing full Prisma client. No singleton or second connection.
  if (!('business' in client) || !('service' in client)) throw new Error('dialogue read delegates unavailable')
  return createPrismaDialoguePort(client as Parameters<typeof createPrismaDialoguePort>[0], businessId)
}
type Row = PolicyRow & { id: string; deploymentGeneration: number; fenceEpoch: number; payload: Prisma.JsonValue;
  providerEventId: string; providerMessageId: string | null; status: string; dbNow: Date; businessTimezone: string;
  admittedAt: Date; providerOccurredAt: Date | null; botEnabled: boolean }
type Session = NonNullable<Awaited<ReturnType<typeof lockExistingInitialSession>>> & { handoffFenceEpoch: number; handoffClaimsPausedAt: Date | null; deploymentId: string; deploymentGeneration: number }
const txOptions = { maxWait: 2_000, timeout: 10_000 } as const

/** Uses the existing inbox/job/outbox. Only deterministic preparation runs outside locks. */
export async function processConversationInbox(input: {
  client: Client; job: ClaimedBotJob; dialogueFactory?: DialogueFactory;
  writeView: typeof persistView; projectInbound: typeof projectInboundMessage;
  lockSession: typeof lockExistingInitialSession; isRestart: typeof isConversationRestartCommand
}): Promise<'PROCESSED' | 'STALE_REVISION' | null> {
  const policy = await loadConversationPolicy(input.client, { businessId: input.job.businessId, deploymentId: input.job.deploymentId, generation: input.job.deploymentGeneration })
  if (!policy) return null
  const targets = await input.client.$queryRaw<Array<{ fenceEpoch: number }>>(Prisma.sql`
    /* conversation-target */ SELECT "dispatchFenceEpoch" AS "fenceEpoch" FROM "BotChannelDeployment"
    WHERE "id" = ${policy.deploymentId} AND "businessId" = ${policy.businessId} AND "generation" = ${policy.generation}
  `)
  if (!targets[0]) throw new Error('conversational target unavailable')
  const token = await acquireDispatchClaim({ client: input.client, businessId: policy.businessId, sessionId: null,
    resourceId: input.job.id, generation: policy.generation, fenceEpoch: targets[0].fenceEpoch, kind: 'PROCESS' })
  if (!token) throw new Error('conversation dispatch gate closed')
  return withDispatchClaimCleanup(input.client, token, async markSettled => {
    const events: InboundConversationMessageProjection[] = []
    const updates: Array<Omit<ConversationUpdatedEvent, 'type'>> = []
    const readRow = async (tx: Prisma.TransactionClient): Promise<Row> => {
      await assertClaimedBotJobTx(tx, input.job)
      await assertDispatchClaimTx({ tx, businessId: policy.businessId, claimToken: token })
      await tx.$queryRaw(Prisma.sql`/* conversation-feature-lock */ SELECT "botEnabled" FROM "BusinessFeatureSettings" WHERE "businessId" = ${policy.businessId} FOR SHARE`)
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        /* conversation-inbox-lock */
        SELECT i."id", i."businessId", i."deploymentId", i."deploymentGeneration", i."payload", i."providerEventId",
          i."providerMessageId", i."status"::text AS "status", clock_timestamp() AS "dbNow", e."admittedAt", e."providerOccurredAt",
          settings."timezone" AS "businessTimezone", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch", d."engineKey",
          cfg."id" AS "configurationId", cfg."businessId" AS "configurationBusinessId", cfg."status" AS "configurationStatus", cfg."definition", b."customerCode",
          (b."botEnabled" AND COALESCE(f."botEnabled", true)) AS "botEnabled"
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
      `)
      if (rows.length !== 1) throw new Error('conversation inbox no longer current')
      return rows[0]!
    }
    const ordered = async (tx: Prisma.TransactionClient, row: Row, phone: string) => {
      const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
        /* conversation-order */ SELECT EXISTS (
          SELECT 1 FROM "BotProviderEvent" e WHERE e."businessId" = ${row.businessId}
            AND e."eventType" = 'MESSAGE'::"BotProviderEventType" AND e."payload"->>'fromPhone' = ${phone}
            AND (e."admittedAt", e."id") < (${row.admittedAt}, ${row.providerEventId})
            AND (EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId" = e."id" AND i."businessId" = e."businessId"
              AND i."status" IN ('ADMITTED', 'CLAIMED', 'SELECTED', 'CONFLICT'))
              OR (e."status" = 'ADMITTED' AND NOT EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId" = e."id")))
        ) AS "blocked"
      `)
      if (!rows[0]) throw new Error('conversation order guard unavailable')
      return !rows[0].blocked
    }
    const finish = async (tx: Prisma.TransactionClient, row: Row) => {
      const count = await tx.$executeRaw(Prisma.sql`
        /* conversation-settle */ UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "error" = NULL
        WHERE "id" = ${row.id} AND "businessId" = ${row.businessId} AND "status" = 'ADMITTED'::"BotInboxStatus"
      `)
      if (count !== 1) throw new Error('conversation inbox settlement lost')
      await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus" WHERE "id" = ${row.providerEventId} AND "businessId" = ${row.businessId}`)
      await completeDispatchClaimTx(tx, token)
      await completeClaimedBotJobTx(tx, input.job)
    }
    const retry = async (tx: Prisma.TransactionClient, row: Row) => {
      await completeDispatchClaimTx(tx, token)
      await rescheduleClaimedBotJobTx(tx, input.job, new Date(row.dbNow.getTime() + 500), { refundClaimAttempt: true })
    }
    const snapshot = await input.client.$transaction(async tx => {
      const row = await readRow(tx)
      const currentPolicy = resolveConversationPolicy(row)
      if (JSON.stringify(currentPolicy) !== JSON.stringify(policy)) { await retry(tx, row); return null }
      if (row.status !== 'ADMITTED') { await completeDispatchClaimTx(tx, token); await completeClaimedBotJobTx(tx, input.job); return null }
      const payload = row.payload as { fromPhone?: unknown; textBody?: unknown; messageType?: unknown; contextWindowEvaluated?: unknown }
      if (typeof payload.fromPhone !== 'string' || !payload.fromPhone) throw new Error('conversation phone unavailable')
      const phone = payload.fromPhone
      if (!await ordered(tx, row, phone)) { await retry(tx, row); return null }
      // Serialize first creation on the existing conversation row, not a new queue.
      const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
        VALUES (${randomUUID()}, ${phone}, ${row.businessId}, clock_timestamp())
        ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt" RETURNING "id"
      `)
      const conversationId = conversations[0]?.id
      if (!conversationId) throw new Error('conversation unavailable')
      let session = await input.lockSession(tx, row.businessId, phone) as Session | null
      await input.projectInbound(tx, { businessId: row.businessId, conversationId, phone, providerMessageId: row.providerMessageId,
        body: typeof payload.textBody === 'string' && payload.textBody.trim() ? payload.textBody.trim() : `[${String(payload.messageType ?? 'message')}]`, messageType: payload.messageType }, events)
      if (!row.botEnabled || (session && (session.status !== 'ACTIVE' || session.handoffClaimsPausedAt))) { await finish(tx, row); return null }
      if (session && (session.deploymentId !== policy.deploymentId || session.deploymentGeneration > policy.generation)) throw new Error('conversation session requires cutover')
      if (payload.contextWindowEvaluated !== true) {
        const window = await applyLazyContextWindowTx(tx, { businessId: row.businessId, deploymentId: row.deploymentId,
          generation: row.generation, providerEventId: row.providerEventId, phone, admittedAt: row.admittedAt,
          providerOccurredAt: row.providerOccurredAt, isMedia: payload.messageType !== 'text', processingInboxId: row.id, currentJobId: input.job.id }, input.writeView)
        if (window.kind === 'WAIT') { await retry(tx, row); return null }
        if (window.kind === 'EXPIRED' || window.kind === 'REPLAY') { await finish(tx, row); return null }
      }
      if (!session) {
        const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          /* conversation-create-session */
          INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt", "draftTouchedAt", "draftExpiresAt")
          VALUES (${randomUUID()}, ${row.businessId}, ${conversationId}, ${row.deploymentId}, ${row.generation}, ${row.businessTimezone},
            ${JSON.stringify(createInitialBotOptionsState())}::jsonb, 0, clock_timestamp(), ${row.admittedAt}, ${row.admittedAt} + interval '24 hours') RETURNING "id"
        `)
        if (!inserted[0]) throw new Error('conversation session creation failed')
      }
      session = await input.lockSession(tx, row.businessId, phone) as Session | null
      if (!session || session.status !== 'ACTIVE' || session.handoffClaimsPausedAt) throw new Error('conversation session fenced')
      await tx.$executeRaw(Prisma.sql`
        /* conversation-attach */ UPDATE "BotActionInbox" SET "sessionId" = ${session.sessionId}, "expectedRevision" = ${session.revision}
        WHERE "id" = ${row.id} AND "businessId" = ${row.businessId} AND "status" = 'ADMITTED'::"BotInboxStatus"
      `)
      const parsed = parseBotOptionsState(session.state)
      if (!parsed.ok) throw new Error('invalid conversation session state')
      if (!['NONE', 'DRAFT'].includes(parsed.state.booking) || parsed.state.deposit !== 'NONE' || parsed.state.handoff !== 'NONE') {
        await input.writeView(tx, { businessId: row.businessId, sessionId: session.sessionId, revision: session.revision,
          transitionId: `transition:${session.sessionId}:${session.revision}:protected:${row.id}`, toPhone: phone, dbNow: row.dbNow,
          view: textView('Tenés una operación anterior pendiente. El equipo debe resolverla antes de iniciar otra reserva; no modifiqué tu reserva ni tu pago.') })
        await finish(tx, row)
        return null
      }
      if (session.deploymentGeneration < policy.generation) {
        const revision = session.revision + 1n
        const state = createInitialBotOptionsState()
        const changed = await tx.$executeRaw(Prisma.sql`
          /* conversation-generation-reset */ UPDATE "BotSession" SET "state"=${JSON.stringify(state)}::jsonb,
            "deploymentGeneration"=${policy.generation}, "revision"=${revision}, "updatedAt"=clock_timestamp()
          WHERE "id"=${session.sessionId} AND "businessId"=${row.businessId} AND "revision"=${session.revision}
        `)
        if (changed !== 1) throw new Error('conversation generation reset lost revision')
        await tx.$executeRaw(Prisma.sql`INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId") VALUES (${randomUUID()}, ${row.businessId}, ${session.sessionId}, ${row.deploymentId}, ${row.generation}, ${session.revision}, ${revision}, 'system.configuration_reset', 'APPLIED', ${row.providerEventId})`)
        session = { ...session, state, revision, deploymentGeneration: policy.generation }
      }
      const reset = payload.messageType === 'text' && input.isRestart(payload.textBody)
      const reconciled = reset ? { draft: initialDialogueState(row.businessId), reset: false } : reconcileConversationDraft(session.state, policy, row.businessTimezone)
      const draft = reconciled.draft
      return { row, session, payload, phone, draft, reset, policyReset: reconciled.reset }
    }, txOptions)
    flushInboundConversationMessages(events)
    if (!snapshot) { markSettled(); return 'PROCESSED' }
    // No transaction/client lock is retained while repositories compute the reply.
    const prepared = await (input.dialogueFactory ?? defaultFactory)(input.client, policy.businessId)
    if (prepared.context.businessId !== policy.businessId || prepared.context.timezone !== snapshot.row.businessTimezone) throw new Error('dialogue context mismatch')
    const response = snapshot.reset ? { state: snapshot.draft, reply: 'Empecemos de nuevo. ¿Qué servicio necesitás?', proposal: null }
      : snapshot.payload.messageType !== 'text' ? { state: snapshot.draft, reply: 'Por ahora necesito que me escribas tu consulta en texto. Conservé lo que ya me contaste.', proposal: null }
      : await respond(prepared.context, snapshot.draft, String(snapshot.payload.textBody ?? ''), prepared.port)
    const result = await input.client.$transaction(async tx => {
      const row = await readRow(tx)
      const currentPolicy = resolveConversationPolicy(row)
      if (row.status !== 'ADMITTED') { await completeDispatchClaimTx(tx, token); await completeClaimedBotJobTx(tx, input.job); return 'PROCESSED' as const }
      const session = await input.lockSession(tx, row.businessId, snapshot.phone) as Session | null
      if (!row.botEnabled || (session && (session.status !== 'ACTIVE' || session.handoffClaimsPausedAt))) { await finish(tx, row); return 'PROCESSED' as const }
      if (!session || JSON.stringify(currentPolicy) !== JSON.stringify(policy) || session.sessionId !== snapshot.session.sessionId ||
          session.deploymentId !== policy.deploymentId || session.deploymentGeneration !== policy.generation ||
          session.handoffFenceEpoch !== snapshot.session.handoffFenceEpoch || session.revision !== snapshot.session.revision ||
          !await ordered(tx, row, snapshot.phone)) { await retry(tx, row); return 'STALE_REVISION' as const }
      const state = snapshot.reset ? createInitialBotOptionsState() : projectConversationDraft(response.state, policy)
      const revision = session.revision + 1n
      const changed = await tx.$executeRaw(Prisma.sql`
        /* conversation-save */ UPDATE "BotSession" SET "state" = ${JSON.stringify(state)}::jsonb, "revision" = ${revision}, "updatedAt" = clock_timestamp()
        WHERE "id" = ${session.sessionId} AND "businessId" = ${row.businessId} AND "revision" = ${session.revision}
          AND "status" = 'ACTIVE'::"BotSessionStatus" AND "handoffClaimsPausedAt" IS NULL AND "handoffFenceEpoch" = ${session.handoffFenceEpoch}
      `)
      if (changed !== 1) throw new Error('conversation revision lost')
      const transitionId = `transition:${session.sessionId}:${revision}`
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId")
        VALUES (${transitionId}, ${row.businessId}, ${session.sessionId}, ${row.deploymentId}, ${row.generation}, ${session.revision}, ${revision},
          ${snapshot.reset ? 'system.conversation_restart' : 'conversation.message'}, 'APPLIED', ${row.providerEventId})
      `)
      const step = conversationStepForBotOptionsState(state)
      const update = step ? await projectBotOptionsConversationStepTx(tx, { businessId: row.businessId, sessionId: session.sessionId, step }) : null
      if (update) updates.push(update)
      await input.writeView(tx, { businessId: row.businessId, sessionId: session.sessionId, revision, transitionId,
        toPhone: snapshot.phone, view: textView((snapshot.policyReset ? 'La configuración cambió; empecemos con un borrador nuevo. ' : '') + response.reply), dbNow: row.dbNow })
      await finish(tx, row)
      return 'PROCESSED' as const
    }, txOptions)
    markSettled()
    for (const update of updates) publishConversationUpdated(update)
    return result
  })
}
