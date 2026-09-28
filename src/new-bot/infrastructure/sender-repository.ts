import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'

export type NewBotSenderResult =
  | { readonly kind: 'accepted'; readonly providerMessageId: string }
  | { readonly kind: 'not_accepted'; readonly retryable: boolean; readonly code: string; readonly retryDelayMs?: number }
  | { readonly kind: 'uncertain' }

export interface NewBotSenderPort {
  send(input: { readonly businessId: string; readonly provider: string; readonly recipientKey: string; readonly action: { readonly type: 'text'; readonly text: string } }, signal: AbortSignal): Promise<NewBotSenderResult>
}

export interface NewBotSendClaim {
  readonly id: string
  readonly businessId: string
  readonly provider: string
  readonly conversationId: string
  readonly recipientKey: string
  readonly action: { readonly type: 'text'; readonly text: string }
  readonly leaseToken: string
}

interface SqlTx { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> }
interface SqlClient { $transaction<T>(operation: (tx: SqlTx) => Promise<T>): Promise<T> }
const MAX_BATCH = 100
const MAX_LEASE_MS = 5 * 60_000
const MAX_RETRY_MS = 24 * 60 * 60_000
const SAFE_CODE = /^[A-Z0-9_:-]{1,80}$/
const VALID_STATUSES = new Set(['DELIVERED', 'READ', 'FAILED'])

function validString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}
function validAction(value: unknown): value is { type: 'text'; text: string } {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && (value as Record<string, unknown>).type === 'text' &&
    validString((value as Record<string, unknown>).text, 4096)
}
function oneRow(rows: unknown, description: string): boolean {
  if (!Array.isArray(rows)) throw new Error(`Invalid new-bot sender ${description} result`)
  return rows.length === 1
}
function assertClient(client: SqlClient): void {
  if (!client || typeof client.$transaction !== 'function') throw new TypeError('Invalid new-bot sender client')
}
async function lockCorrelation(tx: SqlTx, businessId: string, provider: string, providerMessageId: string): Promise<void> {
  const key = `${businessId.length}:${businessId}${provider.length}:${provider}${providerMessageId.length}:${providerMessageId}`
  const rows = await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Unable to lock new-bot provider correlation')
}

/** Durable, opt-in sender state machine. It never starts a loop or performs transport I/O. */
export function createNewBotSenderRepository(client: SqlClient) {
  assertClient(client)
  return {
    async claimBatch(input: { readonly batchSize: number; readonly leaseDurationMs: number }): Promise<NewBotSendClaim[]> {
      if (!Number.isSafeInteger(input?.batchSize) || input.batchSize < 1 || input.batchSize > MAX_BATCH ||
          !Number.isSafeInteger(input?.leaseDurationMs) || input.leaseDurationMs < 100 || input.leaseDurationMs > MAX_LEASE_MS) {
        throw new TypeError('Invalid new-bot sender claim bounds')
      }
      return client.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          UPDATE "NewBotOutboxEvent" SET "processingStatus"='UNKNOWN', "claimToken"=NULL, "claimExpiresAt"=NULL,
            "lastErrorCode"='DISPATCH_LEASE_EXPIRED'
          WHERE "processingStatus"='DISPATCHING' AND "claimExpiresAt" <= clock_timestamp()
        `)
        const candidates = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT o."id", o."businessId", o."provider", o."conversationId", o."recipientKey", o."action"
          FROM "NewBotOutboxEvent" o
          WHERE ((o."processingStatus"='PENDING' AND (o."retryAt" IS NULL OR o."retryAt" <= clock_timestamp())) OR
                 (o."processingStatus"='CLAIMED' AND o."claimExpiresAt" <= clock_timestamp()))
            AND NOT EXISTS (
              SELECT 1 FROM "NewBotOutboxEvent" p
              WHERE p."businessId"=o."businessId" AND p."provider"=o."provider" AND p."conversationId"=o."conversationId"
                AND (p."sequence",p."ordinal") < (o."sequence",o."ordinal")
                AND p."processingStatus" NOT IN ('ACCEPTED','FAILED')
            )
          ORDER BY o."createdAt", o."businessId", o."provider", o."conversationId", o."sequence", o."ordinal"
          LIMIT ${input.batchSize} FOR UPDATE OF o SKIP LOCKED
        `)
        if (!Array.isArray(candidates)) throw new Error('Invalid new-bot sender candidates')
        const claims: NewBotSendClaim[] = []
        for (const row of candidates) {
          if (!validString(row.id) || !validString(row.businessId, 128) || !validString(row.provider, 40) ||
              !validString(row.conversationId) || !validString(row.recipientKey) || !validAction(row.action)) {
            const blocked = await tx.$queryRaw(Prisma.sql`
              UPDATE "NewBotOutboxEvent" SET "processingStatus"='BLOCKED', "claimToken"=NULL, "claimExpiresAt"=NULL,
                "lastErrorCode"='INVALID_PERSISTED_OUTBOX'
              WHERE "id"=${row.id as string} AND "processingStatus" IN ('PENDING','CLAIMED') RETURNING "id"
            `)
            if (!Array.isArray(blocked) || blocked.length !== 1) throw new Error('Unable to isolate corrupt new-bot outbox head')
            continue
          }
          const token = randomUUID()
          const updated = await tx.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
            UPDATE "NewBotOutboxEvent" SET "processingStatus"='CLAIMED', "claimToken"=${token},
              "claimExpiresAt"=clock_timestamp()+(${input.leaseDurationMs} * INTERVAL '1 millisecond'), "retryAt"=NULL
            WHERE "id"=${row.id} AND "processingStatus" IN ('PENDING','CLAIMED') RETURNING "id"
          `)
          if (!oneRow(updated, 'claim')) throw new Error('Unable to persist new-bot sender claim')
          claims.push({
            id: row.id, businessId: row.businessId, provider: row.provider, conversationId: row.conversationId,
            recipientKey: row.recipientKey, action: row.action, leaseToken: token,
          })
        }
        return claims
      })
    },

    async markDispatching(claim: NewBotSendClaim): Promise<boolean> {
      if (!validString(claim?.id) || !validString(claim.businessId, 128) || !validString(claim.provider, 40) || !validString(claim.leaseToken, 64)) throw new TypeError('Invalid sender ownership')
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw(Prisma.sql`
          UPDATE "NewBotOutboxEvent" SET "processingStatus"='DISPATCHING', "dispatchStartedAt"=clock_timestamp(),
            "attemptCount"="attemptCount"+1, "claimExpiresAt"=clock_timestamp()+(${MAX_LEASE_MS} * INTERVAL '1 millisecond')
          WHERE "id"=${claim.id} AND "businessId"=${claim.businessId} AND "provider"=${claim.provider}
            AND "processingStatus"='CLAIMED' AND "claimToken"=${claim.leaseToken} AND "claimExpiresAt">clock_timestamp()
          RETURNING "id"
        `)
        return oneRow(rows, 'dispatch fence')
      })
    },

    async settle(claim: NewBotSendClaim, result: NewBotSenderResult): Promise<boolean> {
      if (!validString(claim?.id) || !validString(claim.businessId, 128) || !validString(claim.provider, 40) || !validString(claim.leaseToken, 64)) throw new TypeError('Invalid sender ownership')
      if (!result || !['accepted','not_accepted','uncertain'].includes(result.kind)) throw new TypeError('Invalid sender result')
      if (result.kind === 'accepted' && !validString(result.providerMessageId, 256)) throw new TypeError('Invalid provider message ID')
      if (result.kind === 'not_accepted' && (!SAFE_CODE.test(result.code) || typeof result.retryable !== 'boolean' ||
          (result.retryDelayMs !== undefined && (!Number.isSafeInteger(result.retryDelayMs) || result.retryDelayMs < 0 || result.retryDelayMs > MAX_RETRY_MS)))) throw new TypeError('Invalid known sender rejection')
      return client.$transaction(async (tx) => {
        if (result.kind === 'accepted') {
          await lockCorrelation(tx, claim.businessId, claim.provider, result.providerMessageId)
          const rows = await tx.$queryRaw(Prisma.sql`
            UPDATE "NewBotOutboxEvent" SET "processingStatus"='ACCEPTED', "providerAcceptedAt"=clock_timestamp(),
              "providerMessageId"=${result.providerMessageId}, "claimToken"=NULL, "claimExpiresAt"=NULL, "lastErrorCode"=NULL
            WHERE "id"=${claim.id} AND "businessId"=${claim.businessId} AND "provider"=${claim.provider}
              AND "processingStatus"='DISPATCHING' AND "claimToken"=${claim.leaseToken} RETURNING "id"
          `)
          if (!oneRow(rows, 'accepted settlement')) return false
          await this.applyPendingReceipts(tx, claim.businessId, claim.provider, result.providerMessageId, claim.recipientKey)
          return true
        }
        if (result.kind === 'uncertain') {
          const rows = await tx.$queryRaw(Prisma.sql`
            UPDATE "NewBotOutboxEvent" SET "processingStatus"='UNKNOWN', "claimToken"=NULL, "claimExpiresAt"=NULL,
              "lastErrorCode"='TRANSPORT_RESULT_UNCERTAIN'
            WHERE "id"=${claim.id} AND "businessId"=${claim.businessId} AND "provider"=${claim.provider}
              AND "processingStatus"='DISPATCHING' AND "claimToken"=${claim.leaseToken} RETURNING "id"
          `)
          return oneRow(rows, 'uncertain settlement')
        }
        const retryAt = result.retryable
          ? Prisma.sql`clock_timestamp()+(${result.retryDelayMs ?? 1000} * INTERVAL '1 millisecond')`
          : Prisma.sql`NULL`
        const status = result.retryable ? 'PENDING' : 'FAILED'
        const rows = await tx.$queryRaw(Prisma.sql`
          UPDATE "NewBotOutboxEvent" SET "processingStatus"=${status}, "retryAt"=${retryAt},
            "claimToken"=NULL, "claimExpiresAt"=NULL, "lastErrorCode"=${result.code}
          WHERE "id"=${claim.id} AND "businessId"=${claim.businessId} AND "provider"=${claim.provider}
            AND "processingStatus"='DISPATCHING' AND "claimToken"=${claim.leaseToken} RETURNING "id"
        `)
        return oneRow(rows, 'rejection settlement')
      })
    },

    async recordReceipt(input: { readonly trustedContext: { readonly businessId: string; readonly provider: string; readonly recipientKey: string }; readonly receipt: { readonly idempotencyKey: string; readonly providerMessageId: string; readonly status: 'DELIVERED'|'READ'|'FAILED'; readonly safeReasonCode?: string } }): Promise<{ matched: boolean; inserted: boolean }> {
      const trusted = input?.trustedContext
      const receipt = input?.receipt
      if (!trusted || !receipt || !validString(receipt.idempotencyKey, 160) || !validString(trusted.businessId, 128) || !validString(trusted.provider, 40) ||
          !validString(trusted.recipientKey) || !validString(receipt.providerMessageId, 256) || !VALID_STATUSES.has(receipt.status) ||
          (receipt.safeReasonCode !== undefined && !SAFE_CODE.test(receipt.safeReasonCode))) throw new TypeError('Invalid normalized new-bot receipt')
      return client.$transaction(async (tx) => {
        await lockCorrelation(tx, trusted.businessId, trusted.provider, receipt.providerMessageId)
        const matches = await tx.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
          SELECT "id" FROM "NewBotOutboxEvent" WHERE "businessId"=${trusted.businessId} AND "provider"=${trusted.provider}
            AND "recipientKey"=${trusted.recipientKey} AND "providerMessageId"=${receipt.providerMessageId} FOR UPDATE
        `)
        if (!Array.isArray(matches) || matches.length > 1) throw new Error('Invalid new-bot receipt match')
        const outboxId = matches[0]?.id ?? null
        const inserted = await tx.$queryRaw<Array<{ idempotencyKey: unknown }>>(Prisma.sql`
          INSERT INTO "NewBotOutboxReceipt" ("idempotencyKey","businessId","provider","recipientKey","providerMessageId","status","safeReasonCode","outboxEventId")
          VALUES (${receipt.idempotencyKey},${trusted.businessId},${trusted.provider},${trusted.recipientKey},${receipt.providerMessageId},${receipt.status},${receipt.safeReasonCode ?? null},${outboxId})
          ON CONFLICT ("businessId","provider","idempotencyKey") DO NOTHING RETURNING "idempotencyKey"
        `)
        if (!Array.isArray(inserted)) throw new Error('Invalid new-bot receipt insert result')
        let effectiveOutboxId = outboxId
        let effectiveStatus: typeof receipt.status = receipt.status
        if (inserted.length === 0) {
          const prior = await tx.$queryRaw<Array<{ status: unknown; outboxEventId: unknown; recipientKey: unknown }>>(Prisma.sql`
            SELECT "status","outboxEventId","recipientKey" FROM "NewBotOutboxReceipt"
            WHERE "businessId"=${trusted.businessId} AND "provider"=${trusted.provider}
              AND "idempotencyKey"=${receipt.idempotencyKey} AND "providerMessageId"=${receipt.providerMessageId} FOR UPDATE
          `)
          if (!Array.isArray(prior) || prior.length > 1) throw new Error('Invalid duplicate new-bot receipt lookup')
          if (prior.length === 1 && prior[0]!.recipientKey === trusted.recipientKey) {
            effectiveOutboxId = prior[0]!.outboxEventId ?? outboxId
            if (VALID_STATUSES.has(String(prior[0]!.status))) effectiveStatus = prior[0]!.status as typeof receipt.status
            if (effectiveOutboxId && prior[0]!.outboxEventId == null) await tx.$queryRaw(Prisma.sql`
              UPDATE "NewBotOutboxReceipt" SET "outboxEventId"=${effectiveOutboxId}
              WHERE "businessId"=${trusted.businessId} AND "provider"=${trusted.provider} AND "idempotencyKey"=${receipt.idempotencyKey}`)
          } else effectiveOutboxId = null
        }
        if (effectiveOutboxId) await this.applyStatus(tx, effectiveOutboxId, effectiveStatus)
        return { matched: !!effectiveOutboxId, inserted: inserted.length === 1 }
      })
    },

    async reconcile(input: { readonly businessId: string; readonly outboxId: string; readonly operatorId: string; readonly reason: string; readonly requestKey: string; readonly action: 'BIND_ACCEPTED'|'RETRY'; readonly providerMessageId?: string; readonly duplicateRiskAcknowledged?: boolean }): Promise<boolean> {
      if (!validString(input?.businessId,128) || !validString(input.outboxId) || !validString(input.operatorId,128) ||
          !validString(input.reason,500) || !validString(input.requestKey,160) || !['BIND_ACCEPTED','RETRY'].includes(input.action)) throw new TypeError('Invalid manual new-bot reconciliation')
      if (input.action === 'BIND_ACCEPTED' && !validString(input.providerMessageId,256)) throw new TypeError('Manual binding requires a provider message ID')
      if (input.action === 'RETRY' && input.duplicateRiskAcknowledged !== true) throw new TypeError('Explicit duplicate-risk acknowledgement required')
      return client.$transaction(async (tx) => {
        if (input.action === 'BIND_ACCEPTED') {
          const preliminary = await tx.$queryRaw<Array<{ provider: unknown }>>(Prisma.sql`
            SELECT "provider" FROM "NewBotOutboxEvent" WHERE "id"=${input.outboxId}
              AND "businessId"=${input.businessId} AND "processingStatus"='UNKNOWN'
          `)
          if (!Array.isArray(preliminary) || preliminary.length !== 1) return false
          await lockCorrelation(tx, input.businessId, String(preliminary[0]!.provider), input.providerMessageId!)
        }
        const current = await tx.$queryRaw<Array<{ provider: unknown; recipientKey: unknown }>>(Prisma.sql`
          SELECT "provider","recipientKey" FROM "NewBotOutboxEvent" WHERE "id"=${input.outboxId}
            AND "businessId"=${input.businessId} AND "processingStatus"='UNKNOWN' FOR UPDATE
        `)
        if (!Array.isArray(current) || current.length !== 1) return false
        const audit = await tx.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
          INSERT INTO "NewBotOutboxReconciliation" ("id","businessId","outboxEventId","requestKey","operatorId","reason","action","providerMessageId","duplicateRiskAcknowledged")
          VALUES (${randomUUID()},${input.businessId},${input.outboxId},${input.requestKey},${input.operatorId},${input.reason},${input.action},${input.providerMessageId ?? null},${input.duplicateRiskAcknowledged ?? false})
          ON CONFLICT ("businessId","outboxEventId","requestKey") DO NOTHING RETURNING "id"
        `)
        if (!oneRow(audit, 'reconciliation audit')) return false
        if (input.action === 'RETRY') {
          return oneRow(await tx.$queryRaw(Prisma.sql`
            UPDATE "NewBotOutboxEvent" SET "processingStatus"='PENDING',"retryAt"=clock_timestamp(),"lastErrorCode"='MANUAL_RETRY',"dispatchStartedAt"=NULL
            WHERE "id"=${input.outboxId} AND "businessId"=${input.businessId} AND "processingStatus"='UNKNOWN' RETURNING "id"
          `), 'manual retry')
        }
        const accepted = await tx.$queryRaw(Prisma.sql`
          UPDATE "NewBotOutboxEvent" SET "processingStatus"='ACCEPTED',"providerAcceptedAt"=clock_timestamp(),
            "providerMessageId"=${input.providerMessageId},"lastErrorCode"=NULL
          WHERE "id"=${input.outboxId} AND "businessId"=${input.businessId} AND "processingStatus"='UNKNOWN' RETURNING "id"
        `)
        if (!oneRow(accepted, 'manual binding')) return false
        await this.applyPendingReceipts(tx, input.businessId, String(current[0]!.provider), input.providerMessageId!, String(current[0]!.recipientKey))
        return true
      })
    },

    async applyPendingReceipts(tx: SqlTx, businessId: string, provider: string, providerMessageId: string, recipientKey: string): Promise<void> {
      const linked = await tx.$queryRaw<Array<{ status: unknown }>>(Prisma.sql`
        UPDATE "NewBotOutboxReceipt" r SET "outboxEventId"=o."id"
        FROM "NewBotOutboxEvent" o WHERE o."businessId"=${businessId} AND o."provider"=${provider}
          AND o."providerMessageId"=${providerMessageId} AND o."recipientKey"=${recipientKey}
          AND r."businessId"=o."businessId" AND r."provider"=o."provider" AND r."providerMessageId"=o."providerMessageId"
          AND r."recipientKey"=o."recipientKey" AND r."outboxEventId" IS NULL RETURNING r."status"
      `)
      if (!Array.isArray(linked)) throw new Error('Invalid pending new-bot receipt linkage')
      for (const row of linked) if (VALID_STATUSES.has(String(row.status))) await this.applyStatus(tx, undefined, String(row.status), businessId, provider, providerMessageId, recipientKey)
    },

    async applyStatus(tx: SqlTx, outboxId: unknown, status: string, businessId?: string, provider?: string, providerMessageId?: string, recipientKey?: string): Promise<void> {
      if (!VALID_STATUSES.has(status)) return
      await tx.$queryRaw(Prisma.sql`
        UPDATE "NewBotOutboxEvent" SET "deliveryStatus"=CASE
          WHEN "deliveryStatus"='READ' THEN 'READ'
          WHEN "deliveryStatus"='DELIVERED' AND ${status}='FAILED' THEN 'DELIVERED'
          WHEN ${status}='READ' THEN 'READ'
          WHEN ${status}='DELIVERED' THEN 'DELIVERED'
          WHEN "deliveryStatus"='PENDING' AND ${status}='FAILED' THEN 'FAILED'
          ELSE "deliveryStatus" END,
          "deliveredAt"=CASE WHEN ${status} IN ('DELIVERED','READ') THEN COALESCE("deliveredAt",clock_timestamp()) ELSE "deliveredAt" END
        WHERE (${outboxId ?? null}::text IS NOT NULL AND "id"=${outboxId ?? ''}) OR
          (${businessId ?? null}::text IS NOT NULL AND "businessId"=${businessId ?? ''} AND "provider"=${provider ?? ''}
           AND "providerMessageId"=${providerMessageId ?? ''} AND "recipientKey"=${recipientKey ?? ''})
      `)
    },
  }
}

/** Manual bounded runner; overlapping ticks share one promise and unresolved ports retain their slots. */
export function createNewBotSenderRunner(repository: ReturnType<typeof createNewBotSenderRepository>, port: NewBotSenderPort, concurrency: number, sendTimeoutMs = 30_000) {
  if (!repository || !port || typeof port.send !== 'function' || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_BATCH ||
      !Number.isSafeInteger(sendTimeoutMs) || sendTimeoutMs < 1 || sendTimeoutMs >= MAX_LEASE_MS) {
    throw new TypeError('Invalid new-bot sender runner configuration')
  }
  let active = 0
  let tick: Promise<Array<{ id: string; state: 'accepted'|'not_accepted'|'uncertain'|'lost' }>> | null = null
  return {
    runOnce(input: { readonly leaseDurationMs: number; readonly signal: AbortSignal }): Promise<Array<{ id: string; state: 'accepted'|'not_accepted'|'uncertain'|'lost' }>> {
      if (!input?.signal || typeof input.signal.aborted !== 'boolean') return Promise.reject(new TypeError('Invalid sender signal'))
      if (input.signal.aborted) return Promise.resolve([])
      if (tick) return tick
      const freeSlots = concurrency - active
      if (freeSlots <= 0) return Promise.resolve([])
      const operation = (async () => {
        const claims = input.signal.aborted ? [] : await repository.claimBatch({ batchSize: freeSlots, leaseDurationMs: input.leaseDurationMs })
        const tasks = claims.map(async (claim) => {
          active++
          let released = false
          let retainSlot = false
          let rawSettled = false
          const release = () => { if (!released) { released = true; active-- } }
          try {
            if (!await repository.markDispatching(claim)) return { id: claim.id, state: 'lost' as const }
            if (input.signal.aborted) {
              await repository.settle(claim, { kind: 'uncertain' })
              return { id: claim.id, state: 'uncertain' as const }
            }
            const controller = new AbortController()
            let timer: ReturnType<typeof setTimeout> | undefined
            let onAbort: (() => void) | undefined
            const raw = Promise.resolve().then(() => port.send({ businessId: claim.businessId, provider: claim.provider, recipientKey: claim.recipientKey, action: claim.action }, controller.signal))
            retainSlot = true
            void raw.then(() => { rawSettled = true; release() }, () => { rawSettled = true; release() })
            const deadline = new Promise<NewBotSenderResult>((resolve) => {
              const finish = () => { controller.abort(); resolve({ kind: 'uncertain' }) }
              timer = setTimeout(finish, sendTimeoutMs)
              onAbort = finish
              input.signal.addEventListener('abort', onAbort, { once: true })
              if (input.signal.aborted) finish()
            })
            let result: NewBotSenderResult
            try { result = await Promise.race([raw.catch(() => ({ kind: 'uncertain' as const })), deadline]) }
            finally { if (timer) clearTimeout(timer); if (onAbort) input.signal.removeEventListener('abort', onAbort) }
            const settled = await repository.settle(claim, result)
            return { id: claim.id, state: settled ? result.kind === 'accepted' ? 'accepted' as const : result.kind : 'lost' as const }
          } catch {
            return { id: claim.id, state: 'uncertain' as const }
          } finally {
            // After a durable dispatch, an uncooperative raw transport retains its physical slot.
            if (!retainSlot || rawSettled) release()
          }
        })
        return Promise.all(tasks)
      })()
      tick = operation
      void operation.finally(() => { if (tick === operation) tick = null }).catch(() => undefined)
      return operation
    },
    get activeCount(): number { return active },
  }
}