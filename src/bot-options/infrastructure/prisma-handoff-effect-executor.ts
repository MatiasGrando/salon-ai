import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { normalizePhone, phoneSearchVariants } from '../../services/phone-normalization-service.js'
import { validateCustomerName } from '../domain/customer-name-validation.js'
import type { ConversationUpdatedEvent } from '../../services/crm-realtime-events.js'

type HandoffEffectInput = {
  businessId: string
  sessionId: string
  operationKey: string
  /** Collected inside the transaction; the worker publishes only after commit. */
  pendingConversationUpdates?: Array<Omit<ConversationUpdatedEvent, 'type'>>
}

type QueuedCrmProjection = {
  v: 1
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

async function cancelHandoffByCustomer(
  tx: Prisma.TransactionClient,
  input: HandoffEffectInput
): Promise<void> {
  const effectKind = 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER'
  const effectOperationKey = `${input.operationKey}:${effectKind}`
  const requestHash = handoffCancellationHash()
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
    if (handoffs.length !== 1) throw new Error('handoff cancellation result reference is invalid')
    return
  }
  if (sessions[0]!.status !== 'HUMAN_QUEUED') throw new Error(`cannot cancel handoff from session status ${sessions[0]!.status}`)
  const active = await tx.$queryRaw<Array<{ id: string; status: string; context: Prisma.JsonValue | null }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status", "context" FROM "BotHandoff"
    WHERE "businessId" = ${input.businessId} AND "sessionId" = ${input.sessionId}
      AND "status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
    FOR UPDATE
  `)
  if (active.length !== 1 || active[0]!.status !== 'QUEUED') throw new Error('handoff is not safely cancellable')
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
  await restoreQueuedHandoffProjection(tx, input, active[0]!.context)
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${active[0]!.id}, "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new Error('handoff cancellation operation completion race')
}

/** Session is already locked; preserve F10's session -> conversation lock order. */
async function projectQueuedHandoff(tx: Prisma.TransactionClient, input: HandoffEffectInput): Promise<QueuedCrmProjection | null> {
  const rows = await tx.$queryRaw<Array<{
    id: string; currentStep: string; aiEnabled: boolean; humanHandoffAt: Date | null
    humanHandoffResolvedAt: Date | null; dbNow: Date
  }>>(Prisma.sql`
    SELECT c."id", c."currentStep"::text AS "currentStep", c."aiEnabled", c."humanHandoffAt", c."humanHandoffResolvedAt",
      date_trunc('milliseconds', clock_timestamp()) AS "dbNow"
    FROM "BotSession" s JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
    FOR UPDATE OF c
  `)
  const row = rows[0]
  // No conversation means no CRM projection (historical/background sessions).
  // Never overwrite a manual owner or an already pending legacy handoff.
  if (!row || !row.aiEnabled || (row.currentStep === 'HUMAN_HANDOFF' && row.humanHandoffResolvedAt === null)) return null
  const projection: QueuedCrmProjection = {
    v: 1, conversationId: row.id, queuedAt: row.dbNow.toISOString(), previousStep: row.currentStep,
    previousHandoffAt: row.humanHandoffAt?.toISOString() ?? null,
    previousResolvedAt: row.humanHandoffResolvedAt?.toISOString() ?? null
  }
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "Conversation" SET "currentStep" = 'HUMAN_HANDOFF'::"ConversationStep", "humanHandoffAt" = ${row.dbNow},
      "humanHandoffResolvedAt" = NULL, "updatedAt" = ${row.dbNow}
    WHERE "id" = ${row.id} AND "businessId" = ${input.businessId}
  `)
  if (updated !== 1) throw new Error('handoff CRM projection lost conversation')
  input.pendingConversationUpdates?.push({ businessId: input.businessId, conversationId: row.id, updatedAt: projection.queuedAt })
  return projection
}

async function restoreQueuedHandoffProjection(tx: Prisma.TransactionClient, input: HandoffEffectInput, context: Prisma.JsonValue | null) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return
  const value = context._crmQueuedProjection
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (value.v !== 1 || typeof value.conversationId !== 'string' || typeof value.queuedAt !== 'string' || typeof value.previousStep !== 'string'
    || !(value.previousHandoffAt === null || typeof value.previousHandoffAt === 'string')
    || !(value.previousResolvedAt === null || typeof value.previousResolvedAt === 'string')) return
  // CAS only the fields owned by this queued projection. updatedAt is deliberately
  // excluded: ordinary customer messages update it while waiting. Never write aiEnabled.
  const rows = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`
    UPDATE "Conversation" c SET "currentStep" = ${value.previousStep}::"ConversationStep",
      "humanHandoffAt" = ${value.previousHandoffAt ? new Date(value.previousHandoffAt) : null},
      "humanHandoffResolvedAt" = ${value.previousResolvedAt ? new Date(value.previousResolvedAt) : null},
      "updatedAt" = clock_timestamp()
    WHERE c."id" = ${value.conversationId} AND c."businessId" = ${input.businessId}
      AND c."currentStep" = 'HUMAN_HANDOFF'::"ConversationStep" AND c."aiEnabled" = true
      AND c."humanHandoffAt" = ${new Date(value.queuedAt)} AND c."humanHandoffResolvedAt" IS NULL
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
  input: { businessId: string; sessionId: string; operationKey: string },
  effect: Extract<BotOptionsEffect, { kind: 'PERSIST_CUSTOMER_NAME' }>
): Promise<void> {
  const validated = validateCustomerName(effect.name)
  if (!validated.ok) throw new Error('refusing invalid customer name effect')
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
