import { createHash } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import { transitionConversation, type ConversationEvent, type ConversationIdentity, type ConversationData, type ConversationSnapshot, type ConversationTransitionProposal } from '../domain/session.js'
import type { NewBotQueueClaim } from './queue-repository.js'

export interface NewBotOutboundTextAction {
  readonly type: 'text'
  readonly text: string
}

/** Prepared data only: transitionConversation remains the authority for session snapshots. */
export interface NewBotPreparedResult {
  readonly event: ConversationEvent
  readonly transition: ConversationTransitionProposal
  readonly actions: readonly NewBotOutboundTextAction[]
}

interface SqlTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

interface TransactionalSqlClient {
  $transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>
}

interface InboxRow {
  id: unknown
  businessId: unknown
  schemaVersion: unknown
  vertical: unknown
  provider: unknown
  conversationId: unknown
  sequence: unknown
  message: unknown
  processingStatus: unknown
  leaseToken: unknown
  leaseExpiresAt: unknown
}

interface SessionRow {
  businessId: unknown
  provider: unknown
  conversationId: unknown
  vertical: unknown
  schemaVersion: unknown
  revision: unknown
  lastInboxSequence: unknown
  state: unknown
}

const PROVIDERS = new Set(['whatsapp', 'instagram'])
const MAX_ACTIONS = 10
const MAX_TEXT_LENGTH = 4096
const CLAIM_KEYS = [
  'eventId', 'businessId', 'schemaVersion', 'vertical', 'provider', 'conversationId',
  'sequence', 'message', 'attemptCount', 'leaseToken', 'leaseExpiresAt',
] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return null
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !keys.includes(key)) return null
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return null
  }
  return value
}

function boundedString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function parseQueueMessage(value: unknown): Record<string, string> | null {
  if (!isPlainRecord(value)) return null
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')
  if (!kind || !('value' in kind)) return null
  if (kind.value === 'text' && dataRecord(value, ['kind', 'text']) && boundedString(value.text, MAX_TEXT_LENGTH)) {
    return { kind: 'text', text: value.text }
  }
  if (kind.value === 'selection' && dataRecord(value, ['kind', 'selectionId']) && boundedString(value.selectionId, 256)) {
    return { kind: 'selection', selectionId: value.selectionId }
  }
  if (kind.value === 'unsupported' && dataRecord(value, ['kind'])) return { kind: 'unsupported' }
  return null
}

function isClaim(value: unknown): value is NewBotQueueClaim {
  if (!dataRecord(value, CLAIM_KEYS)) return false
  const claim = value as unknown as NewBotQueueClaim
  return boundedString(claim.eventId) && boundedString(claim.businessId, 128) &&
    claim.schemaVersion === 1 && boundedString(claim.vertical, 80) && PROVIDERS.has(claim.provider) &&
    boundedString(claim.conversationId, 256) && typeof claim.sequence === 'bigint' && claim.sequence > 0n &&
    parseQueueMessage(claim.message) !== null && Number.isSafeInteger(claim.attemptCount) && claim.attemptCount > 0 &&
    boundedString(claim.leaseToken, 64) && claim.leaseExpiresAt instanceof Date && Number.isFinite(claim.leaseExpiresAt.getTime())
}

function parseAction(value: unknown): NewBotOutboundTextAction | null {
  const action = dataRecord(value, ['type', 'text'])
  if (!action || action.type !== 'text' || !boundedString(action.text, MAX_TEXT_LENGTH)) return null
  return { type: 'text', text: action.text }
}

function parsePrepared(value: unknown): NewBotPreparedResult | null {
  const result = dataRecord(value, ['event', 'transition', 'actions'])
  if (!result || !Array.isArray(result.actions) || Object.getPrototypeOf(result.actions) !== Array.prototype || result.actions.length > MAX_ACTIONS) return null
  const arrayKeys = Reflect.ownKeys(result.actions)
  if (arrayKeys.length !== result.actions.length + 1 || !arrayKeys.includes('length')) return null
  const actions: NewBotOutboundTextAction[] = []
  for (let index = 0; index < result.actions.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(result.actions, String(index))
    if (!descriptor || !('value' in descriptor)) return null
    const action = parseAction(descriptor.value)
    if (!action) return null
    actions.push(action)
  }
  return {
    event: result.event as ConversationEvent,
    transition: result.transition as ConversationTransitionProposal,
    actions,
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || Object.getPrototypeOf(left) !== Array.prototype ||
        Object.getPrototypeOf(right) !== Array.prototype || left.length !== right.length) return false
    if (Reflect.ownKeys(left).length !== left.length + 1 || Reflect.ownKeys(right).length !== right.length + 1) return false
    for (let index = 0; index < left.length; index++) {
      const a = Object.getOwnPropertyDescriptor(left, String(index))
      const b = Object.getOwnPropertyDescriptor(right, String(index))
      if (!a || !('value' in a) || !b || !('value' in b) || !sameJson(a.value, b.value)) return false
    }
    return true
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const leftKeys = Reflect.ownKeys(left)
  const rightKeys = Reflect.ownKeys(right)
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => typeof key !== 'string')) return false
  const sorted = (leftKeys as string[]).sort()
  const other = (rightKeys as string[]).sort()
  for (let index = 0; index < sorted.length; index++) {
    const key = sorted[index]!
    if (key !== other[index]) return false
    const a = Object.getOwnPropertyDescriptor(left, key)
    const b = Object.getOwnPropertyDescriptor(right, key)
    if (!a || !('value' in a) || !b || !('value' in b) || !sameJson(a.value, b.value)) return false
  }
  return true
}
function parseDbDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isFinite(date.getTime()) ? date : null
}

function parseRevision(value: unknown): number | null {
  let revision: bigint
  try {
    revision = typeof value === 'bigint' ? value : BigInt(value as string | number)
  } catch {
    return null
  }
  if (revision < 0n || revision > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(revision)
}

function abortError(): Error {
  const error = new Error('New-bot commit aborted')
  error.name = 'AbortError'
  return error
}

function mutationRows(value: unknown, expected: number): boolean {
  if (!Array.isArray(value)) throw new Error('Invalid new-bot commit mutation result')
  return value.length === expected
}

function isValidInboxRow(row: InboxRow, claim: NewBotQueueClaim, claimMessage: Record<string, string>): boolean {
  const message = parseQueueMessage(row.message)
  let sequence: bigint
  try { sequence = BigInt(row.sequence as string | number | bigint) } catch { return false }
  return row.id === claim.eventId && row.businessId === claim.businessId && row.provider === claim.provider &&
    row.conversationId === claim.conversationId && sequence === claim.sequence &&
    row.schemaVersion === 1 && row.schemaVersion === claim.schemaVersion &&
    row.vertical === claim.vertical && PROVIDERS.has(String(row.provider)) &&
    row.processingStatus === 'PROCESSING' && row.leaseToken === claim.leaseToken &&
    message !== null && sameJson(message, claimMessage)
}

/** Atomically writes one validated session transition, typed outbound actions, and inbox completion. */
export function createNewBotCommitter(client: TransactionalSqlClient): (
  claim: Readonly<NewBotQueueClaim>, result: NewBotPreparedResult, signal: AbortSignal,
) => Promise<boolean> {
  if (!client || typeof client.$transaction !== 'function') throw new TypeError('Invalid new-bot committer client')
  return async (claimInput, preparedInput, signal) => {
    if (!signal || typeof signal.aborted !== 'boolean') throw new TypeError('Invalid new-bot commit signal')
    if (signal.aborted) return false
    if (!isClaim(claimInput)) throw new TypeError('Invalid new-bot commit claim')
    const prepared = parsePrepared(preparedInput)
    if (!prepared) throw new TypeError('Invalid new-bot prepared result')
    const claim = claimInput
    const claimMessage = parseQueueMessage(claim.message)!
    const identity: ConversationIdentity = {
      businessId: claim.businessId,
      provider: claim.provider,
      conversationId: claim.conversationId,
      vertical: claim.vertical,
    }

    return client.$transaction(async (transaction) => {
      if (signal.aborted) throw abortError()
      const lockedRows = await transaction.$queryRaw<InboxRow[]>(Prisma.sql`
        SELECT "id", "businessId", "schemaVersion", "vertical", "provider", "conversationId",
               "sequence", "message", "processingStatus", "leaseToken", "leaseExpiresAt"
        FROM "NewBotInboxEvent"
        WHERE "id" = ${claim.eventId}
        FOR UPDATE
      `)
      if (!Array.isArray(lockedRows)) throw new Error('Invalid new-bot commit inbox lock result')
      if (lockedRows.length !== 1) return false
      const inbox = lockedRows[0]!
      // The lock may have waited. Read database time only after it is held, not from the claim timestamp.
      const nowRows = await transaction.$queryRaw<Array<{ now: unknown }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`)
      if (!Array.isArray(nowRows) || nowRows.length !== 1) throw new Error('Invalid new-bot commit clock result')
      const databaseNow = parseDbDate(nowRows[0]!.now)
      const leaseExpiresAt = parseDbDate(inbox.leaseExpiresAt)
      if (!databaseNow || !leaseExpiresAt) throw new Error('Invalid persisted new-bot commit lease')
      if (signal.aborted) throw abortError()
      if (!isValidInboxRow(inbox, claim, claimMessage) || leaseExpiresAt.getTime() <= databaseNow.getTime()) return false
      const eventRecord = dataRecord(prepared.event, [
        'schemaVersion', 'businessId', 'provider', 'conversationId', 'vertical', 'expectedRevision', 'type', 'payload',
      ])
      if (!eventRecord || eventRecord.type !== 'inbound-message' ||
          !sameJson(eventRecord.payload, claimMessage)) return false

      const sessions = await transaction.$queryRaw<SessionRow[]>(Prisma.sql`
        SELECT "businessId", "provider", "conversationId", "vertical", "schemaVersion", "revision", "lastInboxSequence", "state"
        FROM "NewBotConversationSession"
        WHERE "businessId" = ${claim.businessId} AND "provider" = ${claim.provider}
          AND "conversationId" = ${claim.conversationId}
        FOR UPDATE
      `)
      if (!Array.isArray(sessions) || sessions.length > 1) throw new Error('Invalid new-bot session lock result')
      const current = sessions[0]
      let currentSnapshot: ConversationSnapshot
      if (current) {
        const revision = parseRevision(current.revision)
        let lastInboxSequence: bigint
        try { lastInboxSequence = BigInt(current.lastInboxSequence as string | number | bigint) } catch { return false }
        if (current.businessId !== identity.businessId || current.provider !== identity.provider ||
            current.conversationId !== identity.conversationId || current.vertical !== identity.vertical ||
            current.schemaVersion !== 1 || revision === null || lastInboxSequence >= claim.sequence) return false
        currentSnapshot = {
          schemaVersion: 1 as const, ...identity, revision, state: current.state as ConversationData,
        }
      } else {
        currentSnapshot = { schemaVersion: 1 as const, ...identity, revision: 0, state: null }
      }
      const transition = transitionConversation(identity, currentSnapshot, prepared.event, prepared.transition)
      if (transition.status !== 'accepted') return false
      // Effects have no explicit typed outbox mapping yet; never silently discard them.
      if (transition.effects.length !== 0) return false
      if (signal.aborted) throw abortError()

      let sessionRows: unknown
      if (current) {
        sessionRows = await transaction.$queryRaw<Array<{ businessId: unknown }>>(Prisma.sql`
          UPDATE "NewBotConversationSession"
          SET "vertical" = ${identity.vertical}, "schemaVersion" = 1, "revision" = ${transition.snapshot.revision},
              "state" = ${JSON.stringify(transition.snapshot.state)}::jsonb,
              "lastInboxEventId" = ${claim.eventId}, "lastInboxSequence" = ${claim.sequence},
              "updatedAt" = clock_timestamp()
          WHERE "businessId" = ${claim.businessId} AND "provider" = ${claim.provider}
            AND "conversationId" = ${claim.conversationId} AND "vertical" = ${identity.vertical}
            AND "schemaVersion" = 1 AND "revision" = ${currentSnapshot.revision}
          RETURNING "businessId"
        `)
      } else {
        sessionRows = await transaction.$queryRaw<Array<{ businessId: unknown }>>(Prisma.sql`
          INSERT INTO "NewBotConversationSession" (
            "businessId", "provider", "conversationId", "vertical", "schemaVersion", "revision", "state",
            "lastInboxEventId", "lastInboxSequence", "updatedAt"
          ) VALUES (
            ${claim.businessId}, ${claim.provider}, ${claim.conversationId}, ${identity.vertical}, 1,
            ${transition.snapshot.revision}, ${JSON.stringify(transition.snapshot.state)}::jsonb,
            ${claim.eventId}, ${claim.sequence}, clock_timestamp()
          ) ON CONFLICT ("businessId", "provider", "conversationId") DO NOTHING
          RETURNING "businessId"
        `)
      }
      if (!mutationRows(sessionRows, 1)) return false

      for (let ordinal = 0; ordinal < prepared.actions.length; ordinal++) {
        if (signal.aborted) throw abortError()
        const action = prepared.actions[ordinal]!
        const id = createHash('sha256').update(`${claim.eventId}\0${ordinal}`).digest('hex')
        const outboxRows = await transaction.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
          INSERT INTO "NewBotOutboxEvent" (
            "id", "eventId", "businessId", "provider", "conversationId", "sequence", "ordinal",
            "recipientKey", "action", "processingStatus", "createdAt"
          ) VALUES (
            ${id}, ${claim.eventId}, ${claim.businessId}, ${inbox.provider as string}, ${inbox.conversationId as string},
            ${claim.sequence}, ${ordinal}, ${inbox.conversationId as string}, ${JSON.stringify(action)}::jsonb,
            'PENDING', clock_timestamp()
          ) RETURNING "id"
        `)
        if (!mutationRows(outboxRows, 1)) throw new Error('Unable to persist new-bot outbox action')
      }
      if (signal.aborted) throw abortError()
      const completed = await transaction.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
        UPDATE "NewBotInboxEvent"
        SET "processingStatus" = 'COMPLETED', "completedAt" = clock_timestamp(),
            "leaseToken" = NULL, "leaseExpiresAt" = NULL, "retryAt" = NULL, "processingErrorCode" = NULL
        WHERE "id" = ${claim.eventId} AND "businessId" = ${claim.businessId}
          AND "provider" = ${claim.provider} AND "conversationId" = ${claim.conversationId}
          AND "sequence" = ${claim.sequence} AND "schemaVersion" = ${claim.schemaVersion}
          AND "vertical" = ${claim.vertical} AND "processingStatus" = 'PROCESSING'
          AND "leaseToken" = ${claim.leaseToken} AND "leaseExpiresAt" > clock_timestamp()
        RETURNING "id"
      `)
      if (!mutationRows(completed, 1)) throw new Error('New-bot commit lease expired before completion fence')
      if (signal.aborted) throw abortError()
      return true
    })
  }
}
/** Trusted partition read seam for future preparation; no fallback to globally unique conversation IDs. */
export function createNewBotSessionReader(client: TransactionalSqlClient): (identity: ConversationIdentity) => Promise<{
  readonly schemaVersion: 1
  readonly businessId: string
  readonly provider: string
  readonly conversationId: string
  readonly vertical: string
  readonly revision: number
  readonly state: unknown
} | null> {
  if (!client || typeof client.$transaction !== 'function') throw new TypeError('Invalid new-bot session reader client')
  return async (input) => {
    const identity = dataRecord(input, ['businessId', 'provider', 'conversationId', 'vertical'])
    if (!identity || !boundedString(identity.businessId, 128) || !PROVIDERS.has(String(identity.provider)) ||
        !boundedString(identity.conversationId, 256) || !boundedString(identity.vertical, 80)) {
      throw new TypeError('Invalid trusted new-bot session partition')
    }
    return client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<SessionRow[]>(Prisma.sql`
        SELECT "businessId", "provider", "conversationId", "vertical", "schemaVersion", "revision", "lastInboxSequence", "state"
        FROM "NewBotConversationSession"
        WHERE "businessId" = ${identity.businessId} AND "provider" = ${identity.provider}
          AND "conversationId" = ${identity.conversationId} AND "vertical" = ${identity.vertical}
      `)
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid new-bot session read result')
      if (rows.length === 0) return null
      const row = rows[0]!
      const revision = parseRevision(row.revision)
      if (row.schemaVersion !== 1 || row.vertical !== identity.vertical || revision === null) {
        throw new Error('Invalid persisted new-bot session')
      }
      return {
        schemaVersion: 1,
        businessId: identity.businessId as string,
        provider: identity.provider as string,
        conversationId: identity.conversationId as string,
        vertical: identity.vertical as string,
        revision,
        state: row.state,
      }
    })
  }
}