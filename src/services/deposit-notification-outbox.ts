import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { renderDepositNotification, type DepositNotificationKind } from './deposit-notification-content.js'

type NotificationTx = Prisma.TransactionClient
const DIRECT_RECOVERY_PREFIX = 'direct:v1:'

type DirectNotificationRecovery = {
  kind: DepositNotificationKind
  depositId: string
  sourceId: string
}

/**
 * Durable, tenant-scoped bridge into the established provider outbox. The
 * payload contains only the destination required by the sender and approved
 * static content; evidence and reviewer data never cross this boundary.
 */
export async function enqueueDepositNotificationTx(
  tx: NotificationTx,
  input: {
    businessId: string
    depositId: string
    sourceId: string
    kind: DepositNotificationKind
    dbNow?: Date
    expectedProviderPhoneNumberId?: string
  }
): Promise<'ENQUEUED' | 'REPLAYED' | 'ROUTE_UNAVAILABLE'> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${input.businessId}:WHATSAPP`}, 0))
  `)
  const expectedProviderPhoneNumberId = optionalIdentifier(input.expectedProviderPhoneNumberId, 'expectedProviderPhoneNumberId')
  const routes = await tx.$queryRaw<Array<{ sessionId: string; toPhone: string; providerPhoneNumberId: string; dbNow: Date }>>(Prisma.sql`
    SELECT s."id" AS "sessionId", c."phone" AS "toPhone", credentials."phoneNumberId" AS "providerPhoneNumberId",
      clock_timestamp() AS "dbNow"
    FROM "BookingDeposit" deposit
    JOIN "Conversation" c ON c."id" = deposit."conversationId" AND c."businessId" = deposit."businessId"
    JOIN "BookingVisit" visit ON visit."id" = deposit."visitId" AND visit."businessId" = deposit."businessId"
    JOIN "BotSession" s
      ON s."businessId" = deposit."businessId"
     AND s."conversationId" = c."id"
    JOIN "BotChannelDeployment" deployment
      ON deployment."id" = s."deploymentId" AND deployment."businessId" = s."businessId"
    JOIN "BusinessWhatsAppConfig" credentials
      ON credentials."businessId" = deposit."businessId"
     AND credentials."connectionStatus" = 'CONNECTED'::"WhatsAppConnectionStatus"
     AND NULLIF(btrim(credentials."phoneNumberId"), '') IS NOT NULL
     AND NULLIF(btrim(credentials."accessToken"), '') IS NOT NULL
    WHERE deposit."id" = ${input.depositId} AND deposit."businessId" = ${input.businessId}
      AND deployment."channel" = 'WHATSAPP'::"BotChannel"
      AND deployment."engineKey" = 'deterministic-options'
      AND deployment."activeConfigurationId" IS NOT NULL
      AND deployment."legacyDispatchCoverageVersion" >= 1
      AND deployment."claimsPausedAt" IS NULL
      AND s."deploymentGeneration" = deployment."generation"
      AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
      AND (${expectedProviderPhoneNumberId}::text IS NULL OR credentials."phoneNumberId" = ${expectedProviderPhoneNumberId})
    ORDER BY
      (s."status" = 'ACTIVE'::"BotSessionStatus") DESC,
      (s."id" = visit."sessionId") DESC,
      s."updatedAt" DESC, s."id"
    LIMIT 1
  `)
  const route = routes[0]
  if (!route?.toPhone || !route.providerPhoneNumberId) return 'ROUTE_UNAVAILABLE'

  const idempotencyKey = `deposit-notification:${input.kind}:${input.sourceId}`
  const deliveryGroupId = `deposit-notification:${input.sourceId}`
  const item = renderDepositNotification(input.kind)
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" (
      "id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
      "idempotencyKey", "status", "availableAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${input.businessId}, ${route.sessionId}, ${idempotencyKey}, ${deliveryGroupId}, 0,
      ${item.type}, ${JSON.stringify({ to: route.toPhone, item, expectedProviderPhoneNumberId: route.providerPhoneNumberId })}::jsonb, ${idempotencyKey},
      'PENDING'::"BotOutboxStatus", ${input.dbNow ?? route.dbNow}, clock_timestamp()
    ) ON CONFLICT ("idempotencyKey") DO NOTHING
  `)
  return inserted === 1 ? 'ENQUEUED' : 'REPLAYED'
}

/**
 * Persists the notification itself when routable, otherwise persists only a
 * versioned, non-sensitive recovery identity in BotJob. Both paths are part of
 * the caller transaction.
 */
export async function enqueueDepositNotificationWithRecoveryTx(
  tx: NotificationTx,
  input: {
    businessId: string
    depositId: string
    sourceId: string
    kind: DepositNotificationKind
    dbNow?: Date
    expectedProviderPhoneNumberId?: string
  }
): Promise<'ENQUEUED' | 'REPLAYED' | 'RECOVERY_PENDING'> {
  assertIdentifier(input.businessId, 'businessId')
  assertIdentifier(input.depositId, 'depositId')
  assertIdentifier(input.sourceId, 'sourceId')
  const outcome = await enqueueDepositNotificationTx(tx, input)
  if (outcome !== 'ROUTE_UNAVAILABLE') return outcome

  const aggregateId = encodeDirectNotificationRecovery(input)
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" (
      "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration",
      "availableAt", "status", "updatedAt"
    )
    SELECT ${randomUUID()}, 'BRIDGE_DEPOSIT_NOTIFICATION', ${aggregateId}, deposit."businessId",
      session."deploymentId", session."deploymentGeneration", ${input.dbNow ?? new Date()}, 'READY'::"BotJobStatus", clock_timestamp()
    FROM "BookingDeposit" deposit
    JOIN "BookingVisit" visit ON visit."id" = deposit."visitId" AND visit."businessId" = deposit."businessId"
    JOIN "BotSession" session ON session."id" = visit."sessionId" AND session."businessId" = visit."businessId"
    WHERE deposit."id" = ${input.depositId} AND deposit."businessId" = ${input.businessId}
    ON CONFLICT ("kind", "aggregateId") DO NOTHING
  `)
  if (inserted !== 1) {
    const existing = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotJob"
      WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${aggregateId}
        AND "businessId" = ${input.businessId}
      LIMIT 1
    `)
    if (existing.length !== 1) throw new Error('deposit notification recovery job could not be created')
  }
  return 'RECOVERY_PENDING'
}

export async function enqueueDepositReviewBridgeJobTx(
  tx: NotificationTx,
  input: { businessId: string; reviewOutboxId: string; sessionId: string; dbNow: Date }
): Promise<void> {
  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" (
      "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration",
      "availableAt", "status", "updatedAt"
    )
    SELECT ${randomUUID()}, 'BRIDGE_DEPOSIT_NOTIFICATION', ${input.reviewOutboxId}, s."businessId",
      s."deploymentId", s."deploymentGeneration", ${input.dbNow}, 'READY'::"BotJobStatus", ${input.dbNow}
    FROM "BotSession" s
    WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
    ON CONFLICT ("kind", "aggregateId") DO NOTHING
  `)
  if (inserted !== 1) throw new Error('deposit review notification recovery job could not be created')
}

export async function bridgeDepositReviewOutboxTx(
  tx: NotificationTx,
  input: { businessId: string; reviewOutboxId: string }
): Promise<'ENQUEUED' | 'REPLAYED' | 'ROUTE_UNAVAILABLE' | 'UNSUPPORTED'> {
  const rows = await tx.$queryRaw<Array<{ id: string; depositId: string; kind: string; status: string; dbNow: Date }>>(Prisma.sql`
    SELECT "id", "depositId", "kind", "status", clock_timestamp() AS "dbNow"
    FROM "BookingDepositReviewOutbox"
    WHERE "id" = ${input.reviewOutboxId} AND "businessId" = ${input.businessId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) return 'UNSUPPORTED'
  if (row.status === 'ENQUEUED') return 'REPLAYED'
  if (row.status !== 'PENDING_CONTENT') return 'UNSUPPORTED'
  const kind = reviewNotificationKind(row.kind)
  if (!kind) return 'UNSUPPORTED'
  const outcome = await enqueueDepositNotificationTx(tx, {
    businessId: input.businessId,
    depositId: row.depositId,
    sourceId: row.id,
    kind,
    dbNow: row.dbNow
  })
  if (outcome !== 'ROUTE_UNAVAILABLE') {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDepositReviewOutbox" SET "status" = 'ENQUEUED'
      WHERE "id" = ${row.id} AND "businessId" = ${input.businessId} AND "status" = 'PENDING_CONTENT'
    `)
  }
  return outcome
}

export async function bridgeDirectDepositNotificationTx(
  tx: NotificationTx,
  input: { businessId: string; aggregateId: string }
): Promise<'ENQUEUED' | 'REPLAYED' | 'ROUTE_UNAVAILABLE' | 'UNSUPPORTED'> {
  const recovery = parseDirectNotificationRecovery(input.aggregateId)
  if (!recovery) return 'UNSUPPORTED'
  const expectedProviderPhoneNumberId = await recoveryProviderPhoneNumberId(tx, input.businessId, recovery)
  if (requiresAuthoritativeProviderIdentity(recovery.kind) && !expectedProviderPhoneNumberId) return 'ROUTE_UNAVAILABLE'
  return enqueueDepositNotificationTx(tx, {
    businessId: input.businessId,
    ...recovery,
    ...(expectedProviderPhoneNumberId ? { expectedProviderPhoneNumberId } : {})
  })
}

export function encodeDirectNotificationRecovery(input: DirectNotificationRecovery): string {
  assertIdentifier(input.depositId, 'depositId')
  assertIdentifier(input.sourceId, 'sourceId')
  if (!isDepositNotificationKind(input.kind)) throw new Error('unsupported deposit notification recovery kind')
  const encoded = Buffer.from(JSON.stringify({ v: 1, kind: input.kind, depositId: input.depositId, sourceId: input.sourceId }), 'utf8').toString('base64url')
  return `${DIRECT_RECOVERY_PREFIX}${encoded}`
}

export function parseDirectNotificationRecovery(value: string): DirectNotificationRecovery | null {
  if (!value.startsWith(DIRECT_RECOVERY_PREFIX)) return null
  try {
    const encoded = value.slice(DIRECT_RECOVERY_PREFIX.length)
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'depositId,kind,sourceId,v') return null
    if (record.v !== 1 || !isDepositNotificationKind(record.kind)) return null
    if (!validIdentifier(record.depositId) || !validIdentifier(record.sourceId)) return null
    const canonical = encodeDirectNotificationRecovery({ kind: record.kind, depositId: record.depositId, sourceId: record.sourceId })
    return canonical === value ? { kind: record.kind, depositId: record.depositId, sourceId: record.sourceId } : null
  } catch {
    return null
  }
}

export function isDirectNotificationRecoveryAggregate(value: string): boolean {
  return value.startsWith('direct:')
}

async function recoveryProviderPhoneNumberId(tx: NotificationTx, businessId: string, recovery: DirectNotificationRecovery): Promise<string | undefined> {
  if (recovery.kind === 'INVALID_PROOF' || recovery.kind === 'PROOF_UNAVAILABLE') {
    const row = (await tx.$queryRaw<Array<{ phoneNumberId: string | null }>>(Prisma.sql`
      SELECT "phoneNumberId" FROM "BotProviderEvent"
      WHERE "id" = ${recovery.sourceId} AND "businessId" = ${businessId}
      LIMIT 1
    `))[0]
    return row?.phoneNumberId ?? undefined
  }
  if (recovery.kind === 'PROOF_RECEIVED' || recovery.kind === 'LATE_PROOF') {
    const row = (await tx.$queryRaw<Array<{ phoneNumberId: string | null }>>(Prisma.sql`
      SELECT event."phoneNumberId"
      FROM "BookingDepositProof" proof
      JOIN "BotProviderEvent" event
        ON event."id" = proof."providerEventId" AND event."businessId" = proof."businessId"
      WHERE proof."id" = ${recovery.sourceId} AND proof."depositId" = ${recovery.depositId}
        AND proof."businessId" = ${businessId}
      LIMIT 1
    `))[0]
    return row?.phoneNumberId ?? undefined
  }
  return undefined
}

function requiresAuthoritativeProviderIdentity(kind: DepositNotificationKind) {
  return kind === 'INVALID_PROOF' || kind === 'PROOF_UNAVAILABLE'
}

function isDepositNotificationKind(value: unknown): value is DepositNotificationKind {
  return typeof value === 'string' && [
    'PROOF_RECEIVED', 'LATE_PROOF', 'INVALID_PROOF', 'PROOF_UNAVAILABLE', 'EXPIRED',
    'APPROVED', 'RESUBMISSION', 'FINAL_REJECTION'
  ].includes(value)
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512
}

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (!validIdentifier(value)) throw new Error(`${name} is invalid`)
}

function optionalIdentifier(value: string | undefined, name: string): string | null {
  if (value === undefined) return null
  assertIdentifier(value, name)
  return value
}

function reviewNotificationKind(kind: string): DepositNotificationKind | null {
  if (kind === 'DEPOSIT_APPROVED') return 'APPROVED'
  if (kind === 'DEPOSIT_RESUBMISSION_REQUESTED') return 'RESUBMISSION'
  if (kind === 'DEPOSIT_REJECTED_FINAL') return 'FINAL_REJECTION'
  return null
}
