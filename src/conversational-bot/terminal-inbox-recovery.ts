import {conversationSubjectKey,type InstagramConversationSubject} from './conversation-subject.js'
import { Prisma } from '../generated/prisma/client.js'
import { createHash } from 'node:crypto'

type Scope = { businessId: string; deploymentId: string; generation: number; phone: string; subject?:InstagramConversationSubject; currentClaimToken?: string }
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>
function eventIdentity(scope:Scope) {
  return scope.subject?Prisma.sql`e.provider='INSTAGRAM' AND e.payload->>'channel'='INSTAGRAM' AND e.payload->>'instagramLeadId'=${scope.subject.instagramLeadId} AND e.payload->>'instagramAccountId'=${scope.subject.instagramAccountId} AND e.payload->>'senderId'=${scope.subject.externalUserId}`:Prisma.sql`COALESCE(NULLIF(regexp_replace(e."payload"->>'fromPhone','[^0-9]','','g'),''),btrim(e."payload"->>'fromPhone'))=${scope.phone}`
}

/** Under the conversation phone mutex: retire only demonstrably uncommitted exhausted input.
 * The original inbox/event/payload and POISON job/error remain durable audit; no replay or effect repair.
 * SELECTED/CONFLICT, uncertain effects and leases deliberately remain barriers.
 */
export async function reconcileExhaustedConversationInboxTx(tx: Reader, scope: Scope): Promise<void> {
  const resourceId = 'conversation-compute:' + createHash('sha256').update(JSON.stringify(scope.subject?[scope.businessId,'INSTAGRAM',conversationSubjectKey(scope.subject)]:[scope.businessId,scope.phone])).digest('hex')
  await tx.$queryRaw(Prisma.sql`
    /* conversation-terminal-inbox-reconcile */
    WITH terminal AS MATERIALIZED (
      SELECT i."id", i."providerEventId", i."businessId" FROM "BotActionInbox" i
      JOIN "BotProviderEvent" e ON e."id"=i."providerEventId" AND e."businessId"=i."businessId"
      JOIN "BotJob" j ON j."aggregateId"=i."id" AND j."businessId"=i."businessId"
        AND j."kind"='PROCESS_INBOX' AND j."deploymentId"=i."deploymentId" AND j."deploymentGeneration"=i."deploymentGeneration"
      WHERE i."businessId"=${scope.businessId} AND i."deploymentId"=${scope.deploymentId} AND i."deploymentGeneration"=${scope.generation}
        AND ${eventIdentity(scope)}
        AND e."eventType"::text='MESSAGE' AND e."status"::text='ADMITTED'
        AND e."payload"->>'messageType'='text' AND COALESCE(e."payload"->>'interactiveReplyId','')=''
        AND i."actionType" IN ('input.initial','conversation.message') AND i."status"::text='ADMITTED'
        AND i."operationKey" IS NULL AND i."claimToken" IS NULL AND i."claimedUntil" IS NULL
        AND j."status"::text='POISON' AND j."maxAttempts">0 AND j."attempts">=j."maxAttempts"
        AND j."leaseToken" IS NULL AND j."leasedUntil" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "BotActionInbox" sibling WHERE sibling."businessId"=i."businessId"
          AND sibling."providerEventId"=e."id" AND sibling."id"<>i."id" AND sibling."status"::text IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT'))
        AND NOT EXISTS (SELECT 1 FROM "BotDispatchClaim" dispatch WHERE dispatch."businessId"=i."businessId"
          AND dispatch."resourceId" IN (i."id", e."id", ${resourceId})
          AND (dispatch."status"::text IN ('SENDING','UNKNOWN') OR dispatch."status"::text='CLAIMED' AND dispatch."claimedUntil">clock_timestamp() AND dispatch."claimToken" IS DISTINCT FROM ${scope.currentClaimToken ?? null}))
        AND NOT EXISTS (SELECT 1 FROM "BotJob" other WHERE other."aggregateId"=i."id" AND other."businessId"=i."businessId"
          AND other."id"<>j."id" AND (other."status"::text IN ('READY','RETRY','LEASED') OR other."leaseToken" IS NOT NULL OR other."leasedUntil" IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM "BotTransitionLog" t WHERE t."businessId"=i."businessId"
          AND (t."providerEventId"=e."id" OR t."detail"->'consolidation'->'eventIds' ? e."id"))
        AND NOT EXISTS (
          SELECT 1 FROM "BotSession" s LEFT JOIN "Conversation" c ON c."id"=s."conversationId" AND c."businessId"=s."businessId"
          WHERE s."businessId"=i."businessId" AND (s."id"=i."sessionId" OR
            ${scope.subject?Prisma.sql`s.channel='INSTAGRAM' AND s."instagramLeadId"=${scope.subject.instagramLeadId} AND s."instagramAccountId"=${scope.subject.instagramAccountId}`:Prisma.sql`COALESCE(NULLIF(regexp_replace(c."phone",'[^0-9]','','g'),''),btrim(c."phone"))=${scope.phone}`})
            AND (EXISTS (SELECT 1 FROM "BotOperation" op WHERE op."businessId"=s."businessId" AND op."sessionId"=s."id"
                AND op."status" IS DISTINCT FROM 'COMPLETED'
                -- Handoff TAKE abort atomically reopens its gate and appends this audit. Its
                -- resultRef identifies the handoff, not an uncertain payment/booking effect.
                AND NOT COALESCE((op."status"='ABORTED' AND op."type"='HANDOFF_TAKE' AND s."handoffClaimsPausedAt" IS NULL
                  AND EXISTS (SELECT 1 FROM "BotHandoffAudit" audit WHERE audit."businessId"=op."businessId"
                    AND audit."sessionId"=op."sessionId" AND audit."handoffId"=op."resultRef" AND audit."operationKey"=op."operationKey"
                    AND audit."action" IN ('TAKE_TIMEOUT_REOPENED','TAKE_RECOVERY_ABORTED'))),FALSE))
              OR EXISTS (SELECT 1 FROM "BotOutbox" o WHERE o."businessId"=s."businessId" AND o."sessionId"=s."id"
                AND o."status"::text IN ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN'))
              OR EXISTS (SELECT 1 FROM "BotDispatchClaim" dispatch WHERE dispatch."businessId"=s."businessId" AND dispatch."sessionId"=s."id"
                AND (dispatch."status"::text IN ('SENDING','UNKNOWN') OR dispatch."status"::text='CLAIMED' AND dispatch."claimedUntil">clock_timestamp() AND dispatch."claimToken" IS DISTINCT FROM ${scope.currentClaimToken ?? null})))
        )
      FOR UPDATE OF i, j SKIP LOCKED
    ), retired AS (
      UPDATE "BotActionInbox" i SET "status"='FAILED'::"BotInboxStatus",
        "error"=concat_ws(E'\n', i."error", 'PROCESS_INBOX_EXHAUSTED_WITHOUT_EFFECTS')
      FROM terminal t WHERE i."id"=t."id" AND i."businessId"=t."businessId" AND i."status"::text='ADMITTED'
      RETURNING i."providerEventId", i."businessId"
    )
    UPDATE "BotProviderEvent" e SET "status"='REJECTED'::"BotProviderEventStatus"
    FROM retired r WHERE e."id"=r."providerEventId" AND e."businessId"=r."businessId" AND e."status"::text='ADMITTED'
    RETURNING e."id"
  `)
}
export async function hasEarlierConversationInputTx(tx: Reader, scope: Scope & { admittedAt: Date; providerEventId: string }): Promise<boolean> {
  await reconcileExhaustedConversationInboxTx(tx, scope)
  const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
    /* conversation-order */ SELECT EXISTS (
      SELECT 1 FROM "BotProviderEvent" e WHERE e."businessId"=${scope.businessId}
        AND e."eventType"::text='MESSAGE'
        AND ${eventIdentity(scope)}
        AND (e."admittedAt",e."id")<(${scope.admittedAt},${scope.providerEventId})
        AND (EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId"=e."id" AND i."businessId"=e."businessId"
          AND i."status"::text IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT')) OR
          (e."status"::text='ADMITTED' AND NOT EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."providerEventId"=e."id")))
    ) AS "blocked"
  `)
  if (rows.length!==1 || typeof rows[0]?.blocked!=='boolean') throw new Error('conversation order guard unavailable')
  return rows[0].blocked
}
