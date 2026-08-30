import { Prisma } from '../../generated/prisma/client.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../domain/state.js'
import { customerActivityAt, decideContextWindow, CONTEXT_WINDOW_MS } from '../domain/context-window.js'
import { mainMenuView } from '../domain/transition.js'
import type { persistView } from './process-session-job.js'

type WindowInput = {
  businessId: string; deploymentId: string; generation: number; providerEventId: string
  phone: string; admittedAt: Date; providerOccurredAt: Date | null; isMedia: boolean
  processingInboxId?: string
  currentJobId?: string
}
type WindowResult = { kind: 'CONTINUE'; evaluated: boolean } | { kind: 'EXPIRED' | 'REPLAY' } | { kind: 'WAIT'; retryAt: Date }

/** Called only for a MESSAGE in the journal worker transaction, before classification. */
export async function applyLazyContextWindowTx(tx: Prisma.TransactionClient, input: WindowInput, writeView: typeof persistView): Promise<WindowResult> {
  const rows = await tx.$queryRaw<Array<{
    id: string; revision: bigint; state: Prisma.JsonValue; status: string; deploymentGeneration: number
    draftTouchedAt: Date | null; draftExpiresAt: Date | null; dbNow: Date
    hasInbox: boolean; durableProtection: boolean
  }>>(Prisma.sql`
    /* lazy-context:session */
    SELECT s."id", s."revision", s."state", s."status"::text AS "status", s."deploymentGeneration",
      s."draftTouchedAt", s."draftExpiresAt", clock_timestamp() AS "dbNow",
      EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."businessId" = ${input.businessId}
        AND i."providerEventId" = ${input.providerEventId} AND i."id" <> ${input.processingInboxId ?? ''}) AS "hasInbox",
      (s."handoffClaimsPausedAt" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "BookingVisit" v WHERE v."businessId" = s."businessId" AND v."sessionId" = s."id"
          AND v."status" IN ('HELD'::"BookingVisitStatus", 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus")
      ) OR EXISTS (
        SELECT 1 FROM "BotHandoff" h WHERE h."businessId" = s."businessId" AND h."sessionId" = s."id"
          AND h."status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
      )) AS "durableProtection"
    FROM "BotSession" s JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."businessId" = ${input.businessId} AND s."deploymentId" = ${input.deploymentId}
      AND c."phone" = ${input.phone} AND s."status" <> 'CLOSED'::"BotSessionStatus"
    ORDER BY s."id" FOR UPDATE OF s
  `)
  if (rows.length === 0) return { kind: 'CONTINUE', evaluated: false }
  if (rows.length !== 1) throw new Error('ambiguous context window session')
  const session = rows[0]!
  if (session.hasInbox) return { kind: 'REPLAY' }
  if (session.deploymentGeneration !== input.generation) return { kind: 'CONTINUE', evaluated: false }
  const activityAt = customerActivityAt(input)
  const parsed = parseBotOptionsState(session.state)
  if (!parsed.ok) throw new Error('invalid context window session state')
  const decision = decideContextWindow({
    state: parsed.state, sessionStatus: session.status, touchedAt: session.draftTouchedAt,
    expiresAt: session.draftExpiresAt, activityAt, isMedia: input.isMedia
  })
  const touch = async () => {
    await tx.$executeRaw(Prisma.sql`
      /* lazy-context:touch */
      UPDATE "BotSession" SET "draftTouchedAt" = ${activityAt},
        "draftExpiresAt" = ${new Date(activityAt.getTime() + CONTEXT_WINDOW_MS)}
      WHERE "id" = ${session.id} AND "businessId" = ${input.businessId}
        AND ("draftTouchedAt" IS NULL OR "draftTouchedAt" < ${activityAt})
    `)
  }
  if (decision !== 'EXPIRE' || session.durableProtection) {
    if (decision !== 'UNCHANGED') await touch()
    return { kind: 'CONTINUE', evaluated: true }
  }

  // Lock reclaimable work before modifying it. A worker can hold its job and
  // wait for our session lock: SKIP LOCKED + count comparison avoids deadlock.
  const relatedJobs = Prisma.sql`
    j."businessId" = ${input.businessId}
    AND j."id" <> ${input.currentJobId ?? ''}
    AND j."kind" IN ('PROCESS_INBOX', 'PROCESS_SESSION', 'RECONCILE_PROMPT', 'RECOVER_CUTOVER')
    AND (EXISTS (SELECT 1 FROM "BotPrompt" p WHERE p."sessionId" = ${session.id} AND p."id" = j."aggregateId")
      OR EXISTS (
        SELECT 1 FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" AND e."businessId" = i."businessId"
        WHERE i."businessId" = ${input.businessId} AND i."id" = j."aggregateId"
          AND (i."sessionId" = ${session.id} OR (i."sessionId" IS NULL AND e."payload"->>'fromPhone' = ${input.phone}))
      ) OR EXISTS (
        SELECT 1 FROM "BotProviderEvent" e WHERE e."businessId" = ${input.businessId}
          AND e."id" = j."aggregateId" AND e."payload"->>'fromPhone' = ${input.phone}
      ))
  `
  const guards = await tx.$queryRaw<Array<{ busy: boolean; protectedDelivery: boolean }>>(Prisma.sql`
    /* lazy-context:guard */
    WITH jobs AS MATERIALIZED (
      SELECT j."id" FROM "BotJob" j WHERE ${relatedJobs} AND j."status" <> 'DONE'::"BotJobStatus"
    ), locked_jobs AS MATERIALIZED (
      SELECT j."id", j."status", j."leasedUntil" FROM "BotJob" j JOIN jobs x ON x."id" = j."id" ORDER BY j."id" FOR UPDATE OF j SKIP LOCKED
    ), outboxes AS MATERIALIZED (
      SELECT o."id" FROM "BotOutbox" o WHERE o."businessId" = ${input.businessId} AND o."sessionId" = ${session.id}
        AND o."status" NOT IN ('ACCEPTED', 'DELIVERED', 'READ', 'SKIPPED')
    ), locked_outboxes AS MATERIALIZED (
      SELECT o."id", o."status", o."deliveryGroupId", o."leasedUntil" FROM "BotOutbox" o JOIN outboxes x ON x."id" = o."id"
      ORDER BY o."id" FOR UPDATE OF o SKIP LOCKED
    )
    SELECT (
      (SELECT count(*) FROM jobs) <> (SELECT count(*) FROM locked_jobs)
      OR (SELECT count(*) FROM outboxes) <> (SELECT count(*) FROM locked_outboxes)
      OR EXISTS (SELECT 1 FROM locked_jobs WHERE "status" = 'LEASED'::"BotJobStatus"
        AND ("leasedUntil" IS NULL OR "leasedUntil" >= clock_timestamp()))
      OR EXISTS (SELECT 1 FROM locked_outboxes WHERE "status" = 'SENDING'
        OR ("status" = 'CLAIMED' AND ("leasedUntil" IS NULL OR "leasedUntil" >= clock_timestamp())))
    ) AS "busy", (
      EXISTS (SELECT 1 FROM locked_outboxes o WHERE o."status" = 'UNKNOWN' OR NOT EXISTS (
        SELECT 1 FROM "BotPrompt" p JOIN "BotOutbox" interactive ON interactive."id" = p."outboxMessageId"
        WHERE p."sessionId" = ${session.id} AND interactive."deliveryGroupId" = o."deliveryGroupId"
      ))
    ) AS "protectedDelivery"
  `)
  if (!guards[0]) throw new Error('missing context window guard')
  if (guards[0].busy) return { kind: 'WAIT', retryAt: new Date(session.dbNow.getTime() + 2_000) }
  if (guards[0].protectedDelivery) {
    await touch()
    return { kind: 'CONTINUE', evaluated: true }
  }

  // No financial/system job is included. Keep inbox/journal rows as evidence.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" j SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
      "lastError" = 'CONTEXT_EXPIRED', "updatedAt" = clock_timestamp()
    WHERE ${relatedJobs} AND (j."status" IN ('READY', 'RETRY', 'POISON')
      OR (j."status" = 'LEASED' AND j."leasedUntil" < clock_timestamp()))
  `)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotActionInbox" i SET "status" = 'STALE'::"BotInboxStatus", "error" = 'CONTEXT_EXPIRED'
    FROM "BotProviderEvent" e
    WHERE e."id" = i."providerEventId" AND e."businessId" = i."businessId" AND i."businessId" = ${input.businessId}
      AND i."id" <> ${input.processingInboxId ?? ''}
      AND (i."sessionId" = ${session.id} OR (i."sessionId" IS NULL AND e."payload"->>'fromPhone' = ${input.phone}))
      AND i."status" IN ('ADMITTED', 'CLAIMED', 'SELECTED', 'CONFLICT')
  `)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOutbox" SET "status" = 'SKIPPED'::"BotOutboxStatus", "errorCode" = 'CONTEXT_EXPIRED',
      "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
    WHERE "businessId" = ${input.businessId} AND "sessionId" = ${session.id}
      AND ("status" IN ('PENDING', 'RETRY', 'FAILED', 'POISON')
        OR ("status" = 'CLAIMED' AND "leasedUntil" < clock_timestamp()))
  `)
  const nextRevision = session.revision + 1n
  const reset = await tx.$executeRaw(Prisma.sql`
    /* lazy-context:reset */
    UPDATE "BotSession" SET "state" = ${JSON.stringify(createInitialBotOptionsState())}::jsonb,
      "revision" = ${nextRevision}, "draftTouchedAt" = ${activityAt},
      "draftExpiresAt" = ${new Date(activityAt.getTime() + CONTEXT_WINDOW_MS)}, "updatedAt" = clock_timestamp()
    WHERE "id" = ${session.id} AND "businessId" = ${input.businessId} AND "revision" = ${session.revision}
  `)
  if (reset !== 1) throw new Error('context window reset lost revision fence')
  const transitionId = `context-expired:${input.providerEventId}`
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration",
      "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId")
    VALUES (${transitionId}, ${input.businessId}, ${session.id}, ${input.deploymentId}, ${input.generation},
      ${session.revision}, ${nextRevision}, 'system.context_expired', 'APPLIED', ${input.providerEventId})
  `)
  const menu = mainMenuView()
  menu.interactiveBody = `Pasaron 24 horas sin actividad. Empezamos una nueva conversación; tus turnos y datos siguen guardados.\n\n${menu.interactiveBody}`
  await writeView(tx, { businessId: input.businessId, sessionId: session.id, revision: nextRevision,
    transitionId, toPhone: input.phone, view: menu, dbNow: session.dbNow })
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus"
    WHERE "id" = ${input.providerEventId} AND "businessId" = ${input.businessId}
  `)
  return { kind: 'EXPIRED' }
}
