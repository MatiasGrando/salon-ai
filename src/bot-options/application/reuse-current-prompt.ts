import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../../generated/prisma/client.js'
import type { BotOptionsViewModel } from '../domain/views.js'

type PersistedChoice = {
  actionType: string; entityType: string | null; entityId: string | null
  payload: Prisma.JsonValue | null; sortOrder: number
}

/** Compare semantics, not body text, generated tokens or object key order. */
export function samePromptOptions(choices: readonly PersistedChoice[], view: BotOptionsViewModel): boolean {
  return view.choices.length > 0 && isDeepStrictEqual(
    [...choices].sort((a, b) => a.sortOrder - b.sortOrder),
    view.choices.map((choice, sortOrder) => ({ actionType: choice.actionType,
      entityType: choice.entityRef?.type ?? null, entityId: choice.entityRef?.id ?? null,
      payload: choice.payload ?? null, sortOrder }))
  )
}

function sameConflictOptions(choices: readonly PersistedChoice[], view: BotOptionsViewModel): boolean {
  // The conflict screen is a durable subset of the current screen, decorated by
  // the reconciler. Its prompt.conflict transition proves provenance; never
  // recognize a conflict from visible text or loosen checks for ordinary menus.
  return choices.length > 1 && choices.every(choice => {
    if (!choice.payload || typeof choice.payload !== 'object' || Array.isArray(choice.payload) ||
      typeof choice.payload.conflictChoiceToken !== 'string') return false
    const { conflictChoiceToken: _token, ...payload } = choice.payload
    const normalized = { ...choice, payload: Object.keys(payload).length ? payload : null, sortOrder: 0 }
    return view.choices.some(candidate => samePromptOptions([normalized], { ...view, choices: [candidate] }))
  })
}

/**
 * Called only for unsolicited reprompts, AFTER locking BotSession FOR UPDATE.
 * Session/revision identifies the authoritative flow; choice semantics protect
 * against catalog/context changes within that revision. Normal transitions,
 * required notices and business effects must never call this helper.
 */
export async function reuseCurrentPromptTx(tx: Prisma.TransactionClient, input: {
  businessId: string; sessionId: string; revision: bigint; view: BotOptionsViewModel; toPhone: string; dbNow: Date
}): Promise<boolean> {
  if (input.view.choices.length === 0) return false
  const prompts = await tx.$queryRaw<Array<{
    promptId: string; status: string; deliveryStatus: string; conflictScreen: boolean; choices: PersistedChoice[]
  }>>(Prisma.sql`
    /* reprompt_current_prompt: caller holds the authoritative session lock */
    SELECT p."id" AS "promptId", p."status"::text AS "status", o."status"::text AS "deliveryStatus",
      EXISTS (SELECT 1 FROM "BotTransitionLog" l WHERE l."sessionId" = s."id" AND l."businessId" = s."businessId"
        AND l."revisionTo" = p."stateRevision" AND l."actionType" = 'prompt.conflict') AS "conflictScreen",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('actionType', c."actionType", 'entityType', c."entityType",
        'entityId', c."entityId", 'payload', c."payload", 'sortOrder', c."sortOrder") ORDER BY c."sortOrder"), '[]'::jsonb)
       FROM "BotPromptChoice" c WHERE c."promptId" = p."id") AS "choices"
    FROM "BotPrompt" p
    JOIN "BotSession" s ON s."id" = p."sessionId"
    JOIN "BotOutbox" o ON o."id" = p."outboxMessageId" AND o."businessId" = s."businessId" AND o."sessionId" = s."id"
    WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
      AND s."revision" = ${input.revision} AND p."stateRevision" = s."revision"
      AND o."status" NOT IN ('FAILED'::"BotOutboxStatus", 'POISON'::"BotOutboxStatus", 'SKIPPED'::"BotOutboxStatus")
      AND (p."status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
        OR (p."status" = 'RESOLVED'::"BotPromptStatus" AND EXISTS (
          SELECT 1 FROM "BotActionInbox" i WHERE i."promptId" = p."id" AND i."businessId" = s."businessId"
            AND i."sessionId" = s."id" AND i."status" IN ('SELECTED'::"BotInboxStatus", 'CONFLICT'::"BotInboxStatus")
        )))
    ORDER BY p."openedAt" DESC, p."id" DESC
    FOR UPDATE OF p
  `)
  const prompt = prompts.find(candidate => samePromptOptions(candidate.choices, input.view) ||
    (candidate.conflictScreen && sameConflictOptions(candidate.choices, input.view)))
  if (!prompt) return false
  // A pending screen already answers the burst. A selection in flight owns the
  // next response; do not distract the customer or cancel its stabilization.
  if (prompt.status !== 'OPEN' || !['ACCEPTED', 'DELIVERED', 'READ'].includes(prompt.deliveryStatus)) return true
  const transitionId = `reprompt-reminder:${prompt.promptId}`
  const item = { type: 'informative_text', body: 'Para continuar, elegí una opción del último menú que te envié 👆' }
  // One non-destructive reminder per prompt lifetime, including after delivery.
  // The existing global unique idempotencyKey enforces this across workers and
  // retries; no process-local timers, extra delay or prompt invalidation.
  await tx.$executeRaw(Prisma.sql`
    /* reprompt_reminder */
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
      "idempotencyKey", "status", "dependsOnSequence", "availableAt", "updatedAt")
    VALUES (${randomUUID()}, ${input.businessId}, ${input.sessionId}, ${transitionId}, ${randomUUID()}, 0, 'informative_text',
      ${JSON.stringify({ to: input.toPhone, item })}::jsonb, ${`${transitionId}:0`}, 'PENDING'::"BotOutboxStatus", NULL, ${input.dbNow}, clock_timestamp())
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `)
  return true
}
