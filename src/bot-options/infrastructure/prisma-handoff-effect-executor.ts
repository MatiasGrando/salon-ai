import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import type { BotOptionsEffect } from '../domain/effects.js'

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
  if (input.effects.length === 0) return
  if (input.effects.length !== 1 || input.effects[0]?.kind !== 'REQUEST_HUMAN_HANDOFF') {
    throw new Error(`effect executor unavailable: ${input.effects.map((effect) => effect.kind).join(',')}`)
  }

  const effect = input.effects[0]
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
