import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'

export type QueueMessage =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'selection'; readonly selectionId: string }
  | { readonly kind: 'unsupported' }

export interface NewBotQueueClaim {
  readonly eventId: string
  readonly businessId: string
  readonly schemaVersion: 1
  readonly vertical: string
  readonly provider: string
  readonly conversationId: string
  readonly sequence: bigint
  readonly message: QueueMessage
  readonly attemptCount: number
  readonly leaseToken: string
  readonly leaseExpiresAt: Date
}

export interface NewBotQueueIdentity {
  readonly eventId: string
  readonly businessId: string
  readonly provider: string
  readonly conversationId: string
  readonly leaseToken: string
}

export interface NewBotQueueRepository {
  claimBatch(input: { readonly batchSize: number; readonly leaseDurationMs: number }): Promise<NewBotQueueClaim[]>
  complete(input: NewBotQueueIdentity): Promise<boolean>
  retry(input: NewBotQueueIdentity & { readonly delayMs: number }): Promise<boolean>
  renew(input: NewBotQueueIdentity & { readonly leaseDurationMs: number }): Promise<boolean>
}

interface SqlTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

interface TransactionalSqlClient {
  $transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>
}

interface ClaimRow {
  id: unknown
  businessId: unknown
  schemaVersion: unknown
  vertical: unknown
  provider: unknown
  conversationId: unknown
  sequence: unknown
  message: unknown
  attemptCount: unknown
}

type PoisonReason =
  | 'INVALID_PERSISTED_CLAIM'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_PERSISTED_VERTICAL'
  | 'INVALID_PERSISTED_SEQUENCE'
  | 'INVALID_PERSISTED_ATTEMPT_COUNT'
  | 'ATTEMPT_LIMIT_REACHED'
  | 'INVALID_PERSISTED_MESSAGE'

type ParsedCandidate =
  | { readonly status: 'valid'; readonly claim: Omit<NewBotQueueClaim, 'attemptCount' | 'leaseToken' | 'leaseExpiresAt'>; readonly attemptCount: number }
  | { readonly status: 'poison'; readonly reason: PoisonReason }

const MAX_BATCH_SIZE = 100
const MAX_LEASE_MS = 5 * 60 * 1000
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 2_147_483_647

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

function boundedString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0 && value.length <= max
}

function validateIdentity(input: NewBotQueueIdentity): void {
  if (
    !input ||
    !boundedString(input.eventId) ||
    !boundedString(input.businessId, 128) ||
    !boundedString(input.provider, 40) ||
    !boundedString(input.conversationId) ||
    !boundedString(input.leaseToken, 64)
  ) throw new TypeError('Invalid new-bot queue ownership identity')
}

function parseMessage(value: unknown): QueueMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'text' && Object.keys(record).length === 2 && boundedString(record.text, 4096)) {
    return { kind: 'text', text: record.text }
  }
  if (record.kind === 'selection' && Object.keys(record).length === 2 && boundedString(record.selectionId)) {
    return { kind: 'selection', selectionId: record.selectionId }
  }
  if (record.kind === 'unsupported' && Object.keys(record).length === 1) return { kind: 'unsupported' }
  return null
}

function parseCandidate(row: ClaimRow): ParsedCandidate {
  if (
    !boundedString(row.id) || !boundedString(row.businessId, 128) ||
    !boundedString(row.provider, 40) || (row.provider !== 'whatsapp' && row.provider !== 'instagram') || !boundedString(row.conversationId)
  ) return { status: 'poison', reason: 'INVALID_PERSISTED_CLAIM' }
  if (row.schemaVersion !== 1) return { status: 'poison', reason: 'UNSUPPORTED_SCHEMA_VERSION' }
  if (!boundedString(row.vertical, 80)) return { status: 'poison', reason: 'INVALID_PERSISTED_VERTICAL' }

  let sequence: bigint
  try {
    if (typeof row.sequence !== 'bigint' && typeof row.sequence !== 'number' && typeof row.sequence !== 'string') {
      return { status: 'poison', reason: 'INVALID_PERSISTED_SEQUENCE' }
    }
    sequence = BigInt(row.sequence)
  } catch {
    return { status: 'poison', reason: 'INVALID_PERSISTED_SEQUENCE' }
  }
  if (sequence <= 0n) return { status: 'poison', reason: 'INVALID_PERSISTED_SEQUENCE' }
  if (!boundedInteger(row.attemptCount, 0, MAX_ATTEMPTS)) {
    return { status: 'poison', reason: 'INVALID_PERSISTED_ATTEMPT_COUNT' }
  }
  if (row.attemptCount >= MAX_ATTEMPTS) return { status: 'poison', reason: 'ATTEMPT_LIMIT_REACHED' }
  const message = parseMessage(row.message)
  if (!message) return { status: 'poison', reason: 'INVALID_PERSISTED_MESSAGE' }
  return {
    status: 'valid',
    claim: {
      eventId: row.id,
      businessId: row.businessId,
      schemaVersion: 1,
      vertical: row.vertical,
      provider: row.provider,
      conversationId: row.conversationId,
      sequence,
      message,
    },
    attemptCount: row.attemptCount,
  }
}

function parseLeaseExpiration(value: unknown): Date {
  const leaseExpiresAt = value instanceof Date ? value : new Date(value as string | number)
  if (!Number.isFinite(leaseExpiresAt.getTime())) throw new Error('Invalid database queue lease timestamp')
  return leaseExpiresAt
}

function mutationSucceeded(rows: unknown): boolean {
  if (!Array.isArray(rows)) throw new Error('Invalid new-bot queue mutation result')
  return rows.length === 1
}

/** Durable per-conversation queue primitives; no worker loop or domain execution is started here. */
export function createNewBotQueueRepository(client: TransactionalSqlClient): NewBotQueueRepository {
  return {
    async claimBatch(input): Promise<NewBotQueueClaim[]> {
      if (!input || !boundedInteger(input.batchSize, 1, MAX_BATCH_SIZE) || !boundedInteger(input.leaseDurationMs, 100, MAX_LEASE_MS)) {
        throw new TypeError('Invalid new-bot queue claim bounds')
      }
      return client.$transaction(async (transaction) => {
        const candidates = await transaction.$queryRaw<ClaimRow[]>(Prisma.sql`
          SELECT event."id", event."businessId", event."schemaVersion", event."vertical",
                 event."provider", event."conversationId", event."sequence", event."message", event."attemptCount"
          FROM "NewBotInboxEvent" AS event
          WHERE event."processingStatus" IN ('PENDING', 'PROCESSING')
            AND (event."retryAt" IS NULL OR event."retryAt" <= clock_timestamp())
            AND (
              event."processingStatus" = 'PENDING' OR
              event."leaseExpiresAt" IS NULL OR event."leaseExpiresAt" <= clock_timestamp()
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "NewBotInboxEvent" AS predecessor
              WHERE predecessor."businessId" = event."businessId"
                AND predecessor."provider" = event."provider"
                AND predecessor."conversationId" = event."conversationId"
                AND predecessor."sequence" < event."sequence"
                AND predecessor."processingStatus" <> 'COMPLETED'
            )
          ORDER BY event."admittedAt", event."businessId", event."provider", event."conversationId", event."sequence"
          LIMIT ${input.batchSize}
          FOR UPDATE OF event SKIP LOCKED
        `)
        if (!Array.isArray(candidates)) throw new Error('Invalid new-bot queue candidate result')
        const claims: NewBotQueueClaim[] = []
        for (const candidate of candidates) {
          const parsed = parseCandidate(candidate)
          if (parsed.status === 'poison') {
            const blocked = await transaction.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
              UPDATE "NewBotInboxEvent"
              SET "processingStatus" = 'BLOCKED', "processingErrorCode" = ${parsed.reason},
                  "leaseToken" = NULL, "leaseExpiresAt" = NULL, "retryAt" = NULL
              WHERE "id" = ${candidate.id} AND "businessId" = ${candidate.businessId}
                AND "provider" = ${candidate.provider} AND "conversationId" = ${candidate.conversationId}
                AND "processingStatus" IN ('PENDING', 'PROCESSING')
              RETURNING "id"
            `)
            if (!Array.isArray(blocked) || blocked.length !== 1) throw new Error('Unable to persist blocked new-bot queue head')
            continue
          }

          const leaseToken = randomUUID()
          const updated = await transaction.$queryRaw<Array<{ id: unknown; leaseExpiresAt: unknown }>>(Prisma.sql`
            UPDATE "NewBotInboxEvent"
            SET "processingStatus" = 'PROCESSING',
                "attemptCount" = "attemptCount" + 1,
                "leaseToken" = ${leaseToken},
                "leaseExpiresAt" = clock_timestamp() + (${input.leaseDurationMs} * INTERVAL '1 millisecond'),
                "retryAt" = NULL, "processingErrorCode" = NULL
            WHERE "id" = ${candidate.id}
              AND "businessId" = ${candidate.businessId}
              AND "provider" = ${candidate.provider}
              AND "conversationId" = ${candidate.conversationId}
              AND "sequence" = ${candidate.sequence}
            RETURNING "id", "leaseExpiresAt"
          `)
          if (!Array.isArray(updated) || updated.length !== 1 || updated[0]!.id !== candidate.id) {
            throw new Error('Unable to persist new-bot queue lease')
          }
          claims.push({
            ...parsed.claim,
            attemptCount: parsed.attemptCount + 1,
            leaseToken,
            leaseExpiresAt: parseLeaseExpiration(updated[0]!.leaseExpiresAt),
          })
        }
        return claims
      })
    },

    async complete(input): Promise<boolean> {
      validateIdentity(input)
      const rows = await client.$transaction((transaction) => transaction.$queryRaw(Prisma.sql`
        UPDATE "NewBotInboxEvent"
        SET "processingStatus" = 'COMPLETED', "completedAt" = clock_timestamp(),
            "leaseToken" = NULL, "leaseExpiresAt" = NULL, "retryAt" = NULL, "processingErrorCode" = NULL
        WHERE "id" = ${input.eventId} AND "businessId" = ${input.businessId}
          AND "provider" = ${input.provider} AND "conversationId" = ${input.conversationId}
          AND "processingStatus" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken}
          AND "leaseExpiresAt" > clock_timestamp()
        RETURNING "id"
      `))
      return mutationSucceeded(rows)
    },

    async retry(input): Promise<boolean> {
      validateIdentity(input)
      if (!boundedInteger(input.delayMs, 0, MAX_RETRY_DELAY_MS)) throw new TypeError('Invalid new-bot queue retry delay')
      const rows = await client.$transaction((transaction) => transaction.$queryRaw(Prisma.sql`
        UPDATE "NewBotInboxEvent"
        SET "processingStatus" = 'PENDING', "retryAt" = clock_timestamp() + (${input.delayMs} * INTERVAL '1 millisecond'),
            "leaseToken" = NULL, "leaseExpiresAt" = NULL, "processingErrorCode" = NULL
        WHERE "id" = ${input.eventId} AND "businessId" = ${input.businessId}
          AND "provider" = ${input.provider} AND "conversationId" = ${input.conversationId}
          AND "processingStatus" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken}
          AND "leaseExpiresAt" > clock_timestamp()
        RETURNING "id"
      `))
      return mutationSucceeded(rows)
    },

    async renew(input): Promise<boolean> {
      validateIdentity(input)
      if (!boundedInteger(input.leaseDurationMs, 100, MAX_LEASE_MS)) throw new TypeError('Invalid new-bot queue lease duration')
      const rows = await client.$transaction((transaction) => transaction.$queryRaw(Prisma.sql`
        UPDATE "NewBotInboxEvent"
        SET "leaseExpiresAt" = clock_timestamp() + (${input.leaseDurationMs} * INTERVAL '1 millisecond')
        WHERE "id" = ${input.eventId} AND "businessId" = ${input.businessId}
          AND "provider" = ${input.provider} AND "conversationId" = ${input.conversationId}
          AND "processingStatus" = 'PROCESSING' AND "leaseToken" = ${input.leaseToken}
          AND "leaseExpiresAt" > clock_timestamp()
        RETURNING "id"
      `))
      return mutationSucceeded(rows)
    },
  }
}