import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { normalizePhone, phoneSearchVariants } from '../../services/phone-normalization-service.js'
import { validateCustomerName } from '../domain/customer-name-validation.js'

function handoffRequestHash(effect: Extract<BotOptionsEffect, { kind: 'REQUEST_HUMAN_HANDOFF' }>): string {
  const canonical = JSON.stringify({
    kind: effect.kind,
    reason: effect.reason,
    detail: effect.detail,
    context: effect.context
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * Executor mínimo de F5.5. La fila BotSession ya está bloqueada por
 * processSessionJob; se vuelve a seleccionar tenant-scoped para que este
 * adaptador también falle cerrado si se usa fuera de ese límite.
 *
 * BotOperation es la identidad durable de la solicitud. BotSession.status es
 * la marca de cola; tomar/cancelar/resolver siguen fuera de F5.5.
 */
export async function prismaHandoffEffectExecutor(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string
    sessionId: string
    operationKey: string
    effects: readonly BotOptionsEffect[]
  }
): Promise<void> {
  for (const effect of input.effects) {
    if (effect.kind === 'PERSIST_CUSTOMER_NAME') {
      await persistCustomerName(tx, input, effect)
    } else if (effect.kind === 'REQUEST_HUMAN_HANDOFF') {
      await persistHandoff(tx, input, effect)
    } else if (effect.kind === 'EMIT_OPERATIONAL_ALERT') {
      await persistOperationalAlert(tx, input, effect)
    } else {
      throw new Error(`effect executor unavailable: ${effect.kind}`)
    }
  }
}

async function persistHandoff(
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; operationKey: string },
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
    }>>(Prisma.sql`
      SELECT "businessId", "sessionId", "type", "status", "requestHash"
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
    if (operation.status !== 'COMPLETED' || sessions[0]!.status !== 'HUMAN_QUEUED') {
      throw new Error('handoff operation is not safely replayable')
    }
    return
  }

  if (sessions[0]!.status !== 'ACTIVE') {
    throw new Error(`cannot queue handoff from session status ${sessions[0]!.status}`)
  }
  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotSession"
    SET "status" = 'HUMAN_QUEUED'::"BotSessionStatus", "updatedAt" = clock_timestamp()
    WHERE "id" = ${input.sessionId} AND "businessId" = ${input.businessId}
      AND "status" = 'ACTIVE'::"BotSessionStatus"
  `)
  if (updated !== 1) throw new Error('handoff queue status race')

  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "updatedAt" = clock_timestamp()
    WHERE "operationKey" = ${effectOperationKey} AND "status" = 'STARTED'
  `)
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
