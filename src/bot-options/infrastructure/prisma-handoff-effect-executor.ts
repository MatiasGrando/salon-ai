import { createOrLinkInstagramBotCustomer } from '../../services/conversation-customer-link-service.js'
import { resolveInstagramSessionSubjectTx, lockInstagramRuntimeActorTx, lockConversationSubjectTx, type InstagramConversationSubject } from '../../conversational-bot/conversation-subject.js'
import { resolveConversationPolicy, type PolicyRow } from '../../conversational-bot/runtime-policy.js'
import { canonicalJsonHash } from '../../conversational-bot/canonical-json.js'
import { explicitReferralAction } from '../../conversational-bot/conversational-referral.js'
import { isCustomerText } from '../../conversational-bot/customer-text.js'
import { parseBotOptionsState } from '../domain/state.js'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { normalizePhone, phoneSearchVariants } from '../../services/phone-normalization-service.js'
import { validateCustomerName } from '../domain/customer-name-validation.js'
import type { ConversationUpdatedEvent } from '../../services/crm-realtime-events.js'


type CurrentCancellationScope = {
  handoffId: string; revision: bigint; handoffFenceEpoch: number
  deploymentId: string; generation: number; configurationId: string
  policyHash: string; evidence: string
}

type HandoffEffectInput = {
  subject?: InstagramConversationSubject
  channel?: 'WHATSAPP'|'INSTAGRAM'
  /** Server-only; absent keeps the legacy hash and semantics unchanged. */
  cancelScope?: CurrentCancellationScope
  businessId: string
  sessionId: string
  operationKey: string
  /** Collected inside the transaction; the worker publishes only after commit. */
  pendingConversationUpdates?: Array<Omit<ConversationUpdatedEvent, 'type'>>
}

type QueuedCrmProjection = {
  v: 2
  conversationId: string
  queuedAt: string
  previousStep: string
  previousHandoffAt: string | null
  previousResolvedAt: string | null
}

function handoffRequestHash(effect: Extract<BotOptionsEffect, { kind: 'REQUEST_HUMAN_HANDOFF' }>): string {
  const canonical = JSON.stringify({
    kind: effect.kind,
    reason: effect.reason,
    detail: effect.detail,
    context: effect.context
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function handoffCancellationHash(): string {
  return createHash('sha256').update(JSON.stringify({ kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' }), 'utf8').digest('hex')
}


function scopedCancellationHash(input: HandoffEffectInput): string {
  const scope = input.cancelScope
  const modern = input.operationKey.startsWith('conversation-handoff-cancel:')
  if (modern !== Boolean(scope)) throw new Error('handoff cancellation proof namespace mismatch')
  if (!scope) return handoffCancellationHash()
  const id = (value: unknown) => typeof value === 'string' && /^[^\s\u0000-\u001f]{1,128}$/.test(value)
  if (!id(scope.handoffId) || !id(scope.deploymentId) || !id(scope.configurationId) ||
      typeof scope.revision !== 'bigint' || scope.revision < 0n ||
      !Number.isSafeInteger(scope.handoffFenceEpoch) || scope.handoffFenceEpoch < 0 ||
      !Number.isSafeInteger(scope.generation) || scope.generation < 1 ||
      !/^[a-f0-9]{64}$/.test(scope.policyHash) || !isCustomerText(scope.evidence,2000) ||
      explicitReferralAction(scope.evidence) !== 'resume') throw new Error('invalid handoff cancellation proof')
  return canonicalJsonHash({kind:'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER',businessId:input.businessId,
    sessionId:input.sessionId,...scope,revision:String(scope.revision)})
}

/**
 * F10.1 materializes only QUEUED/CANCELLED. The caller already holds the
 * session transaction; this adapter locks it tenant-scoped again so direct use
 * fails closed, without ever opening a nested transaction.
 * processSessionJob; se vuelve a seleccionar tenant-scoped para que este
 * adaptador también falle cerrado si se usa fuera de ese límite.
 *
 * BotOperation is durable idempotency identity. Its resultRef is validated as
 * an immutable reference to the exact handoff, rather than a cross-cutting FK.
 */
export async function prismaHandoffEffectExecutor(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput & { effects: readonly BotOptionsEffect[] }
): Promise<void> {
  for (const effect of input.effects) {
    if (effect.kind === 'PERSIST_CUSTOMER_NAME') {
      await persistCustomerName(tx, input, effect)
    } else if (effect.kind === 'REQUEST_HUMAN_HANDOFF') {
      await persistHandoff(tx, input, effect)
    } else if (effect.kind === 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER') {
      await cancelHandoffByCustomer(tx, input)
    } else if (effect.kind === 'EMIT_OPERATIONAL_ALERT') {
      await persistOperationalAlert(tx, input, effect)
    } else {
      throw new Error(`effect executor unavailable: ${effect.kind}`)
    }
  }
}

async function persistHandoff(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput,
  effect: Extract<BotOptionsEffect, { kind: 'REQUEST_HUMAN_HANDOFF' }>
): Promise<void> {
  const effectOperationKey = `${input.operationKey}:${effect.kind}`
  const requestHash = handoffRequestHash(effect)
  const sessions = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status"
    FROM "BotSession"
    WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId}
    FOR UPDATE
  `)
  if (sessions.length !== 1) throw new Error('handoff session not found in tenant')

  const inserted = await tx.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${effectOperationKey}, ${effect.kind}, ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, clock_timestamp())
    ON CONFLICT ("operationKey") DO NOTHING
    RETURNING "operationKey"
  `)

  if (inserted.length === 0) {
    const existing = await tx.$queryRaw<Array<{
      businessId: string
      sessionId: string
      type: string
      status: string
      requestHash: string
      resultRef: string | null
    }>>(Prisma.sql`
      SELECT "businessId", "sessionId", "type", "status", "requestHash", "resultRef"
      FROM "BotOperation" WHERE "operationKey" = ${effectOperationKey}
      FOR UPDATE
    `)
    const operation = existing[0]
    if (
      !operation ||
      operation.businessId !== input.businessId ||
      operation.sessionId !== input.sessionId ||
      operation.type !== effect.kind ||
      operation.requestHash !== requestHash
    ) {
      throw new Error('handoff operation idempotency conflict')
    }
    if (operation.status !== 'COMPLETED' || !operation.resultRef) {
      throw new Error('handoff operation is not safely replayable')
    }
    const handoffs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotHandoff"
      WHERE "id" = ${operation.resultRef} AND "businessId" = ${input.businessId}
        AND "sessionId" = ${input.sessionId}
      FOR UPDATE
    `)
    if (handoffs.length !== 1) throw new Error('handoff operation result reference is invalid')
    return
  }

  if (sessions[0]!.status === 'HUMAN_QUEUED') {
    await recoverQueuedHandoff(tx, input, effectOperationKey, requestHash)
    return
  }
  if (sessions[0]!.status !== 'ACTIVE') {
    throw new Error(`cannot queue handoff from session status ${sessions[0]!.status}`)
  }
  const handoffId = randomUUID()
  const projection = await projectQueuedHandoff(tx, input)
  const handoffContext = projection ? { ...effect.context, _crmQueuedProjection: projection } : effect.context
  const created = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotHandoff" ("id", "businessId", "sessionId", "status", "reason", "detail", "context", "queuedAt", "updatedAt")
    VALUES (${handoffId}, ${input.businessId}, ${input.sessionId}, 'QUEUED'::"BotHandoffStatus", ${effect.reason}, ${effect.detail}, ${JSON.stringify(handoffContext)}::jsonb,
      ${projection ? new Date(projection.queuedAt) : Prisma.sql`clock_timestamp()`}, clock_timestamp())
  `)
  if (created !== 1) throw new Error('handoff queue insert failed')
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotSession"
    SET "status" = 'HUMAN_QUEUED'::"BotSessionStatus", "updatedAt" = clock_timestamp()
    WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId}
      AND "status" = 'ACTIVE'::"BotSessionStatus"
  `)
  if (updated !== 1) throw new Error('handoff queue status race')

  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${handoffId}, "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED'
  `)
  if (completed !== 1) throw new Error('handoff operation completion race')
}

/**
 * Repairs the projection for a queue created before CRM projection existed.
 * The queue itself remains the durable identity; this request only attaches an
 * idempotent operation and the cancellation snapshot, never a second handoff.
 */
async function recoverQueuedHandoff(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput,
  effectOperationKey: string,
  requestHash: string
): Promise<void> {
  const active = await tx.$queryRaw<Array<{ id: string; context: Prisma.JsonValue | null; queuedAt: Date; status: string }>>(Prisma.sql`
    SELECT "id", "context", "queuedAt", "status"::text AS "status"
    FROM "BotHandoff"
    WHERE "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
      AND "status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
    FOR UPDATE
  `)
  if (active.length !== 1 || active[0]!.status !== 'QUEUED') {
    throw new Error('queued handoff recovery requires exactly one tenant-scoped queue')
  }
  const handoff = active[0]!
  const projection = await projectQueuedHandoff(tx, input, { handoffId: handoff.id, queuedAt: handoff.queuedAt })
  if (projection) {
    const contextUpdated = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotHandoff"
      SET "context" = COALESCE("context", '{}'::jsonb)
          || jsonb_build_object('_crmQueuedProjection', ${JSON.stringify(projection)}::jsonb),
        "updatedAt" = clock_timestamp()
      WHERE "id" = ${handoff.id} AND "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
        AND "status" = 'QUEUED'::"BotHandoffStatus"
        AND ("context" IS NULL OR jsonb_typeof("context") = 'object')
    `)
    if (contextUpdated !== 1) throw new Error('queued handoff recovery cannot safely preserve context')
  }
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${handoff.id}, "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new Error('queued handoff recovery operation completion race')
}

async function cancelHandoffByCustomer(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput
): Promise<void> {
  const effectKind = 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER'
  const effectOperationKey = `${input.operationKey}:${effectKind}`
  const requestHash = scopedCancellationHash(input)
  const sessions = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status" FROM "BotSession"
    WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId} FOR UPDATE
  `)
  if (sessions.length !== 1) throw new Error('handoff session not found in tenant')
  const inserted = await tx.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${effectOperationKey}, ${effectKind}, ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, clock_timestamp())
    ON CONFLICT ("operationKey") DO NOTHING RETURNING "operationKey"
  `)
  if (!inserted.length) {
    const existing = await tx.$queryRaw<Array<{ businessId: string; sessionId: string; type: string; status: string; requestHash: string; resultRef: string | null }>>(Prisma.sql`
      SELECT "businessId", "sessionId", "type", "status", "requestHash", "resultRef"
      FROM "BotOperation" WHERE "operationKey" = ${effectOperationKey} FOR UPDATE
    `)
    const operation = existing[0]
    if (!operation || operation.businessId !== input.businessId || operation.sessionId !== input.sessionId
      || operation.type !== effectKind || operation.requestHash !== requestHash
      || operation.status !== 'COMPLETED' || !operation.resultRef) {
      throw new Error('handoff cancellation operation is not safely replayable')
    }
    const handoffs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotHandoff" WHERE "id" = ${operation.resultRef}
        AND "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
        AND "status" = 'CANCELLED'::"BotHandoffStatus" FOR UPDATE
    `)
    if (handoffs.length !== 1 || input.cancelScope && operation.resultRef !== input.cancelScope.handoffId) throw new Error('handoff cancellation result reference is invalid')
    return
  }

  const scope = input.cancelScope
  const current = scope ? (await tx.$queryRaw<Array<PolicyRow & {revision:string;state:Prisma.JsonValue;handoffFenceEpoch:number;
    handoffClaimsPausedAt:Date|null;deploymentId:string;deploymentGeneration:number;
    generation:number;configurationId:string;claimsPausedAt:Date|null}>>(Prisma.sql`
    /* conversational-handoff-cancel-scope */
    SELECT s."revision"::text AS "revision",s."state",s."handoffFenceEpoch",s."handoffClaimsPausedAt",
      s."deploymentId",s."deploymentGeneration",${input.channel==='INSTAGRAM'?Prisma.sql`d.channel::text AS channel,`:Prisma.empty}d."generation",d."activeConfigurationId" AS "configurationId",d."claimsPausedAt",d."businessId",d."engineKey",b."customerCode",
      cfg."businessId" AS "configurationBusinessId",cfg."status"::text AS "configurationStatus",cfg."definition"
    FROM "BotSession" s JOIN "BotChannelDeployment" d ON d."id"=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "Business" b ON b."id"=d."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg."id"=d."activeConfigurationId" AND cfg."businessId"=d."businessId"
    WHERE s."id"=${input.sessionId} AND s."businessId"=${input.businessId} FOR UPDATE OF s FOR SHARE OF d,cfg,b
  `))[0] : null
  if (scope) {
    const parsed = current ? parseBotOptionsState(current.state) : null
    const sidecar = current?.state as {conversationDraft?:{policy?:unknown}}
    const actualPolicy=current?resolveConversationPolicy(current):null
    if (!current || current.revision !== String(scope.revision) || current.handoffFenceEpoch !== scope.handoffFenceEpoch ||
        current.handoffClaimsPausedAt || current.claimsPausedAt || current.deploymentId !== scope.deploymentId ||
        current.deploymentGeneration !== scope.generation || current.generation !== scope.generation ||
        current.configurationId !== scope.configurationId || !actualPolicy || canonicalJsonHash(actualPolicy)!==scope.policyHash ||
        !sidecar.conversationDraft?.policy || canonicalJsonHash(sidecar.conversationDraft.policy) !== scope.policyHash ||
        !parsed?.ok || parsed.state.handoff !== 'QUEUED' || !['NONE','DRAFT'].includes(parsed.state.booking) ||
        parsed.state.deposit !== 'NONE') throw new Error('handoff cancellation scope or fence changed')
  }

  if (sessions[0]!.status !== 'HUMAN_QUEUED') throw new Error(`cannot cancel handoff from session status ${sessions[0]!.status}`)
  const active = await tx.$queryRaw<Array<{ id: string; status: string; context: Prisma.JsonValue | null }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status", "context" FROM "BotHandoff"
    WHERE "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
      AND "status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
    FOR UPDATE
  `)
  if (active.length !== 1 || active[0]!.status !== 'QUEUED' || scope && active[0]!.id !== scope.handoffId) throw new Error('handoff target is not safely cancellable')
  const cancelled = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotHandoff" SET "status" = 'CANCELLED'::"BotHandoffStatus", "cancelledAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
    WHERE "id" = ${active[0]!.id} AND "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
      AND "status" = 'QUEUED'::"BotHandoffStatus"
  `)
  if (cancelled !== 1) throw new Error('handoff cancellation race')
  const restored = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotSession" SET "status" = 'ACTIVE'::"BotSessionStatus", "updatedAt" = clock_timestamp()
    WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId}
      AND "status" = 'HUMAN_QUEUED'::"BotSessionStatus"
  `)
  if (restored !== 1) throw new Error('handoff cancellation session race')
  await restoreQueuedHandoffProjection(tx, input, active[0]!.id, active[0]!.context)
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${active[0]!.id}, "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new Error('handoff cancellation operation completion race')
}

/** Session is already locked; preserve F10's session -> conversation lock order. */
async function projectQueuedHandoff(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput,
  existingQueue?: { handoffId: string; queuedAt: Date }
): Promise<QueuedCrmProjection | null> {
  const instagram = input.channel==='INSTAGRAM'?await tx.$queryRaw<Array<{id:string;updatedAt:Date}>>(Prisma.sql`
    UPDATE "InstagramLead" lead SET "aiEnabled"=false,"botPausedAt"=COALESCE(lead."botPausedAt",clock_timestamp()),"updatedAt"=clock_timestamp()
    FROM "BotSession" session WHERE session.id=${input.sessionId} AND session."businessId"=${input.businessId}
      AND session.channel='INSTAGRAM' AND session."instagramLeadId"=lead.id AND lead."businessId"=session."businessId"
    RETURNING lead.id,lead."updatedAt"
  `):[]
  if(instagram.length){
    input.pendingConversationUpdates?.push({businessId:input.businessId,conversationId:'instagram:'+instagram[0]!.id,updatedAt:instagram[0]!.updatedAt.toISOString()})
    return null
  }
  const rows = await tx.$queryRaw<Array<{
    id: string; currentStep: string; aiEnabled: boolean; humanHandoffAtText: string | null
    humanHandoffResolvedAtText: string | null; dbNow: Date
  }>>(Prisma.sql`
    SELECT c."id", c."currentStep"::text AS "currentStep", c."aiEnabled",
      c."humanHandoffAt"::text AS "humanHandoffAtText", c."humanHandoffResolvedAt"::text AS "humanHandoffResolvedAtText",
      date_trunc('milliseconds', clock_timestamp()) AS "dbNow"
    FROM "BotSession" s JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
    FOR UPDATE OF c
  `)
  const row = rows[0]
  // No conversation means no CRM projection (historical/background sessions).
  // Never overwrite a manual owner or an already pending legacy handoff.
  if (!row || !row.aiEnabled || (row.currentStep === 'HUMAN_HANDOFF' && row.humanHandoffResolvedAtText === null)) return null
  const queuedAt = existingQueue?.queuedAt ?? row.dbNow
  const projection: QueuedCrmProjection = {
    v: 2, conversationId: row.id, queuedAt: queuedAt.toISOString(), previousStep: row.currentStep,
    previousHandoffAt: row.humanHandoffAtText,
    previousResolvedAt: row.humanHandoffResolvedAtText
  }
  const marker = existingQueue
    ? Prisma.sql`(SELECT h."queuedAt" FROM "BotHandoff" h WHERE h."id" = ${existingQueue.handoffId}
        AND h."businessId" = ${input.businessId} AND h."sessionId" = ${input.sessionId}
        AND h."status" = 'QUEUED'::"BotHandoffStatus")`
    : Prisma.sql`${queuedAt}`
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "Conversation" SET "currentStep" = 'HUMAN_HANDOFF'::"ConversationStep", "humanHandoffAt" = ${marker},
      "humanHandoffResolvedAt" = NULL, "updatedAt" = ${row.dbNow}
    WHERE "id" = ${row.id} AND "businessId" = ${input.businessId}
  `)
  if (updated !== 1) throw new Error('handoff CRM projection lost conversation')
  input.pendingConversationUpdates?.push({ businessId: input.businessId, conversationId: row.id, updatedAt: row.dbNow.toISOString() })
  return projection
}

async function restoreQueuedHandoffProjection(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput,
  handoffId: string,
  context: Prisma.JsonValue | null
) {
  if(input.channel==='INSTAGRAM') {
    const restored=await tx.$queryRaw<Array<{id:string;updatedAt:Date}>>(Prisma.sql`
      UPDATE "InstagramLead" lead SET "aiEnabled"=true,"botPausedAt"=NULL,"updatedAt"=clock_timestamp()
      FROM "BotSession" session WHERE session.id=${input.sessionId} AND session."businessId"=${input.businessId}
        AND session.channel='INSTAGRAM' AND session.status='ACTIVE' AND session."handoffClaimsPausedAt" IS NULL
        AND lead.id=session."instagramLeadId" AND lead."businessId"=session."businessId" AND lead."botPausedByUserId" IS NULL
      RETURNING lead.id,lead."updatedAt"`)
    if(restored.length!==1)throw new Error('Instagram customer resume cannot override human pause')
    input.pendingConversationUpdates?.push({businessId:input.businessId,conversationId:'instagram:'+restored[0]!.id,updatedAt:restored[0]!.updatedAt.toISOString()})
    return
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) return
  const value = context._crmQueuedProjection
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if ((value.v !== 1 && value.v !== 2) || typeof value.conversationId !== 'string' || typeof value.queuedAt !== 'string' || typeof value.previousStep !== 'string'
    || !(value.previousHandoffAt === null || typeof value.previousHandoffAt === 'string')
    || !(value.previousResolvedAt === null || typeof value.previousResolvedAt === 'string')) return
  // CAS only the fields owned by this queued projection. updatedAt is deliberately
  // excluded: ordinary customer messages update it while waiting. Never write aiEnabled.
  const previousHandoffAt = value.previousHandoffAt
    ? value.v === 2 ? Prisma.sql`CAST(${value.previousHandoffAt} AS timestamp(3))` : Prisma.sql`${new Date(value.previousHandoffAt)}`
    : Prisma.sql`NULL`
  const previousResolvedAt = value.previousResolvedAt
    ? value.v === 2 ? Prisma.sql`CAST(${value.previousResolvedAt} AS timestamp(3))` : Prisma.sql`${new Date(value.previousResolvedAt)}`
    : Prisma.sql`NULL`
  const rows = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`
    UPDATE "Conversation" c SET "currentStep" = ${value.previousStep}::"ConversationStep",
      "humanHandoffAt" = ${previousHandoffAt},
      "humanHandoffResolvedAt" = ${previousResolvedAt},
      "updatedAt" = clock_timestamp()
    WHERE c."id" = ${value.conversationId} AND c."businessId" = ${input.businessId}
      AND c."currentStep" = 'HUMAN_HANDOFF'::"ConversationStep" AND c."aiEnabled" = true
      AND c."humanHandoffAt" = (SELECT h."queuedAt" FROM "BotHandoff" h WHERE h."id" = ${handoffId}
        AND h."businessId" = ${input.businessId} AND h."sessionId" = ${input.sessionId})
      AND c."humanHandoffResolvedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "BotSession" s WHERE s."id" = ${input.sessionId}
        AND s."businessId" = c."businessId" AND s."conversationId" = c."id")
    RETURNING c."id", c."updatedAt"
  `)
  if (rows[0]) input.pendingConversationUpdates?.push({
    businessId: input.businessId, conversationId: rows[0].id, updatedAt: rows[0].updatedAt.toISOString()
  })
}

async function persistCustomerName(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput,
  effect: Extract<BotOptionsEffect, { kind: 'PERSIST_CUSTOMER_NAME' }>
): Promise<void> {
  const validated = validateCustomerName(effect.name)
  if (!validated.ok) throw new Error('refusing invalid customer name effect')
  const instagram=input.subject?await resolveInstagramSessionSubjectTx(tx,{businessId:input.businessId,sessionId:input.sessionId,expected:input.subject}):null
  if(instagram){
    const actor=await lockInstagramRuntimeActorTx(tx,{businessId:input.businessId,sessionId:input.sessionId,subject:instagram})
    if(!actor)throw new Error('Instagram customer name authority unavailable')
    await lockConversationSubjectTx(tx,input.businessId,instagram)
    const key=input.operationKey+':'+effect.kind
    const hash=createHash('sha256').update(JSON.stringify({name:validated.normalized,subject:{channel:instagram.channel,instagramLeadId:instagram.instagramLeadId,instagramAccountId:instagram.instagramAccountId,externalUserId:instagram.externalUserId}}),'utf8').digest('hex')
    const inserted=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`INSERT INTO "BotOperation" (id,"operationKey",type,"businessId","sessionId",status,"requestHash","updatedAt") VALUES (${randomUUID()},${key},${effect.kind},${input.businessId},${input.sessionId},'STARTED',${hash},clock_timestamp()) ON CONFLICT ("operationKey") DO NOTHING RETURNING id`)
    if(!inserted.length){
      const replay=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "BotOperation" WHERE "operationKey"=${key} AND "businessId"=${input.businessId} AND "sessionId"=${input.sessionId} AND type=${effect.kind} AND "requestHash"=${hash} AND status='COMPLETED' AND "resultRef"=${actor.customerId} FOR UPDATE`)
      if(replay.length!==1)throw new Error('Instagram customer name replay mismatch')
      return
    }
    const linked=await createOrLinkInstagramBotCustomer({businessId:input.businessId,leadId:instagram.instagramLeadId,name:validated.normalized,client:tx})
    const changed=await tx.$executeRaw(Prisma.sql`UPDATE "Customer" SET name=${validated.normalized} WHERE id=${linked.customer.id} AND "businessId"=${input.businessId}`)
    if(changed!==1)throw new Error('Instagram customer name lost ownership')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET status='COMPLETED',"resultRef"=${linked.customer.id},"updatedAt"=clock_timestamp() WHERE "operationKey"=${key} AND status='STARTED' AND "requestHash"=${hash}`)
    return
  }

  const identity = await tx.$queryRaw<Array<{ phone: string }>>(Prisma.sql`
    SELECT c."phone" FROM "BotSession" s JOIN "Conversation" c
      ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId} FOR UPDATE OF s
  `)
  const rawPhone = identity[0]?.phone
  const canonicalPhone = rawPhone ? normalizePhone(rawPhone) : null
  if (!rawPhone || !canonicalPhone) throw new Error('customer name identity unavailable in tenant')
  const lockKey = `${input.businessId}:${canonicalPhone}`
  await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${lockKey}))`)
  const variants = [...new Set([rawPhone.trim(), canonicalPhone, `+${canonicalPhone}`, ...phoneSearchVariants(rawPhone)])]
  const requestHash = createHash('sha256').update(JSON.stringify({ name: validated.normalized, canonicalPhone }), 'utf8').digest('hex')
  const effectOperationKey = `${input.operationKey}:${effect.kind}`
  const inserted = await tx.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${effectOperationKey}, ${effect.kind}, ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, clock_timestamp())
    ON CONFLICT ("operationKey") DO NOTHING RETURNING "operationKey"
  `)
  if (!inserted.length) {
    const replay = await tx.$queryRaw<Array<{ businessId: string; sessionId: string; requestHash: string; status: string }>>(Prisma.sql`
      SELECT "businessId", "sessionId", "requestHash", "status" FROM "BotOperation" WHERE "operationKey" = ${effectOperationKey} FOR UPDATE
    `)
    const row = replay[0]
    if (!row || row.businessId !== input.businessId || row.sessionId !== input.sessionId || row.requestHash !== requestHash || row.status !== 'COMPLETED') {
      throw new Error('customer name operation is not safely replayable')
    }
    return
  }
  let customers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Customer" WHERE "businessId" = ${input.businessId}
      AND ("normalizedPhone" = ${canonicalPhone} OR "phone" IN (${Prisma.join(variants)}))
    ORDER BY CASE WHEN "normalizedPhone" = ${canonicalPhone} THEN 0 ELSE 1 END, "createdAt", "id" LIMIT 1 FOR UPDATE
  `)
  if (!customers.length) {
    const digits = variants.map((value) => value.replace(/\D/g, '')).filter(Boolean)
    if (digits.length) customers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Customer" WHERE "businessId" = ${input.businessId}
        AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digits)})
      ORDER BY "createdAt", "id" LIMIT 1 FOR UPDATE
    `)
  }
  let customerId = customers[0]?.id
  if (customerId) {
    await tx.$executeRaw(Prisma.sql`UPDATE "Customer" SET "name" = ${validated.normalized}, "phone" = ${canonicalPhone}, "normalizedPhone" = ${canonicalPhone} WHERE "id" = ${customerId} AND "businessId" = ${input.businessId}`)
  } else {
    customerId = randomUUID()
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${input.businessId}, ${validated.normalized}, ${canonicalPhone}, ${canonicalPhone})`)
  }
  await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${customerId}, "updatedAt" = clock_timestamp() WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED'`)
}

async function persistOperationalAlert(
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; operationKey: string },
  effect: Extract<BotOptionsEffect, { kind: 'EMIT_OPERATIONAL_ALERT' }>
): Promise<void> {
  const key = `${input.operationKey}:${effect.kind}:${effect.alertKind}`
  const hash = createHash('sha256').update(JSON.stringify(effect), 'utf8').digest('hex')
  const inserted = await tx.$queryRaw<Array<{ operationKey: string }>>(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "lastError", "updatedAt")
    VALUES (${randomUUID()}, ${key}, ${`${effect.kind}:${effect.alertKind}`}, ${input.businessId}, ${input.sessionId}, 'COMPLETED', ${hash}, ${effect.detail}, clock_timestamp())
    ON CONFLICT ("operationKey") DO NOTHING RETURNING "operationKey"
  `)
  if (inserted.length) return
  const replay = await tx.$queryRaw<Array<{ businessId: string; sessionId: string; requestHash: string; status: string }>>(Prisma.sql`
    SELECT "businessId", "sessionId", "requestHash", "status" FROM "BotOperation" WHERE "operationKey" = ${key} FOR UPDATE
  `)
  const row = replay[0]
  if (!row || row.businessId !== input.businessId || row.sessionId !== input.sessionId || row.requestHash !== hash || row.status !== 'COMPLETED') {
    throw new Error('operational alert is not safely replayable')
  }
}
