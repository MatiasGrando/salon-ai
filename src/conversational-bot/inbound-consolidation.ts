import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'

const MAX_EVENTS = 128
const MAX_TEXT = 2_000
const actionable = ['ADMITTED', 'CLAIMED', 'SELECTED', 'CONFLICT']
export type ConsolidationEnvelope = {
  version: 1; businessId: string; sessionId: string; deploymentId: string; generation: number
  handoffFenceEpoch: number; baseState: unknown; eventIds: string[]; sealed: boolean; revision?: string
}
type Candidate = { id: string; admittedAt: Date; payload: Prisma.JsonValue; actionType: string | null; scopeMatches: boolean }
type GroupInput = { businessId: string; sessionId: string; deploymentId: string; generation: number
  handoffFenceEpoch: number; revision: bigint; state: unknown; phone: string; currentEventId: string
  isRestart: (text: unknown) => boolean }

/** Meta identities are already international. Formatting must not change the mutex identity. */
export function canonicalConversationPhone(phone: string): string {
  const value = phone.trim()
  const digits = value.replace(/\D/g, '')
  if (!value) throw new Error('conversation identity unavailable')
  return digits || value // Non-provider synthetic fixtures have alphabetic identities.
}
export async function lockConversationInputTx(tx: Prisma.TransactionClient, businessId: string, phone: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${businessId}:WHATSAPP`}, 0))`)
  await lockConversationPhoneTx(tx, businessId, phone)
}
/** Call only after the standalone shared cutover gate and before any row lock. */
export async function lockConversationPhoneTx(tx: Prisma.TransactionClient, businessId: string, phone: string): Promise<void> {
  const identity = createHash('sha256').update(JSON.stringify([businessId, canonicalConversationPhone(phone)])).digest('hex')
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-conversation-input:${identity}`}, 0))`)
}
export function readConsolidationEnvelope(value: unknown): ConsolidationEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const e = value as Partial<ConsolidationEnvelope>
  if (e.version !== 1 || typeof e.businessId !== 'string' || typeof e.sessionId !== 'string' || typeof e.deploymentId !== 'string' ||
      !Number.isSafeInteger(e.generation) || !Number.isSafeInteger(e.handoffFenceEpoch) || typeof e.sealed !== 'boolean' ||
      !Array.isArray(e.eventIds) || !e.eventIds.length || e.eventIds.length > MAX_EVENTS ||
      (e.revision !== undefined && (typeof e.revision !== 'string' || !/^\d+$/.test(e.revision))) ||
      e.eventIds.some(id => typeof id !== 'string' || !id) || new Set(e.eventIds).size !== e.eventIds.length || e.baseState === undefined) return null
  return e as ConsolidationEnvelope
}
function textOf(row: Candidate, isRestart: (text: unknown) => boolean): string | null {
  const payload = row.payload as { messageType?: unknown; textBody?: unknown; interactiveReplyId?: unknown }
  if (row.scopeMatches === false || payload.messageType !== 'text' || typeof payload.textBody !== 'string' || payload.interactiveReplyId || isRestart(payload.textBody) ||
      (row.actionType && !['input.initial', 'conversation.message'].includes(row.actionType))) return null
  return payload.textBody
}
async function candidates(tx: Prisma.TransactionClient, input: { businessId: string; phone: string; previousIds: string[]; deploymentId: string; generation: number }): Promise<Candidate[]> {
  return tx.$queryRaw<Candidate[]>(Prisma.sql`
    /* consolidation-candidates */
    SELECT e."id", e."admittedAt", e."payload", i."actionType", (i."id" IS NULL OR (i."deploymentId" = ${input.deploymentId} AND i."deploymentGeneration" = ${input.generation})) AS "scopeMatches"
    FROM "BotProviderEvent" e
    LEFT JOIN "BotActionInbox" i ON i."providerEventId" = e."id" AND i."businessId" = e."businessId"
    WHERE e."businessId" = ${input.businessId} AND e."eventType" = 'MESSAGE'
      AND COALESCE(NULLIF(regexp_replace(e."payload"->>'fromPhone', '[^0-9]', '', 'g'), ''), btrim(e."payload"->>'fromPhone')) = ${canonicalConversationPhone(input.phone)}
      AND (i."status"::text IN (${Prisma.join(actionable)}) OR
        (i."id" IS NULL AND e."status"::text = 'ADMITTED') OR e."id" IN (${Prisma.join(input.previousIds.length ? input.previousIds : [''])}))
    ORDER BY e."admittedAt", e."id" LIMIT ${MAX_EVENTS * 2 + 1}
  `)
}
export async function selectConsolidationGroupTx(tx: Prisma.TransactionClient, input: GroupInput) {
  const previous = await tx.$queryRaw<Array<{ id: string; detail: Prisma.JsonValue }>>(Prisma.sql`
    /* consolidation-previous */
    SELECT t."id", t."detail" FROM "BotTransitionLog" t
    WHERE t."businessId" = ${input.businessId} AND t."sessionId" = ${input.sessionId}
      AND t."deploymentId" = ${input.deploymentId} AND t."deploymentGeneration" = ${input.generation}
      AND t."revisionTo" = ${input.revision} AND t."actionType" = 'conversation.message'
      AND EXISTS (SELECT 1 FROM "BotOutbox" o WHERE o."businessId" = t."businessId" AND o."transitionId" = t."id")
      AND NOT EXISTS (SELECT 1 FROM "BotOutbox" o WHERE o."businessId" = t."businessId" AND o."transitionId" = t."id"
        AND NOT (o."status"::text IN ('PENDING','CLAIMED','RETRY') OR (o."status"::text = 'SKIPPED' AND o."errorCode" = 'CONVERSATION_SUPERSEDED')))
  `)
  const saved = previous[0]?.detail as { consolidation?: unknown } | undefined
  const envelope = readConsolidationEnvelope(saved?.consolidation)
  const reusable = envelope && !envelope.sealed && envelope.businessId === input.businessId && envelope.sessionId === input.sessionId &&
    envelope.deploymentId === input.deploymentId && envelope.generation === input.generation && envelope.handoffFenceEpoch === input.handoffFenceEpoch ? envelope : null
  const rows = await candidates(tx, { ...input, previousIds: reusable?.eventIds ?? [] })
  const ids: string[] = [], texts: string[] = []
  let sealed = false, size = 0
  for (const row of rows) {
    const text = textOf(row, input.isRestart)
    if (text === null) { sealed = true; break }
    // A whole oversize event is its own group. No message or remainder is truncated.
    if (ids.length && (ids.length >= MAX_EVENTS || size + text.length + 1 > MAX_TEXT)) { sealed = true; break }
    ids.push(row.id); texts.push(text); size += text.length + 1
    if (size > MAX_TEXT) { sealed = true; break }
  }
  if (!ids.includes(input.currentEventId)) return null
  // Crossing a bound/barrier closes an old group; never replay a partial previous group.
  if (reusable && reusable.eventIds.some(id => !ids.includes(id))) return null
  const next: ConsolidationEnvelope = { version: 1, businessId: input.businessId, sessionId: input.sessionId,
    deploymentId: input.deploymentId, generation: input.generation, handoffFenceEpoch: input.handoffFenceEpoch,
    baseState: reusable?.baseState ?? input.state, eventIds: ids, sealed, revision: String(input.revision + 1n) }
  return { envelope: next, text: texts.join(' '), signature: JSON.stringify([ids, sealed]), previousTransitionId: reusable ? previous[0]!.id : null,
    admittedAt: rows.filter(row => ids.includes(row.id)).reduce((latest, row) => row.admittedAt > latest ? row.admittedAt : latest, rows[0]!.admittedAt) }
}
/** Never wait behind claimOutbox's reversed row/cutover order. Exact coverage is required before writing. */
export async function supersedeConsolidationOutboxTx(tx: Prisma.TransactionClient, businessId: string, sessionId: string, transitionId: string): Promise<boolean> {
  const all = await tx.$queryRaw<Array<{ id: string; status: string; errorCode?: string }>>(Prisma.sql`
    /* consolidation-outbox-members */ SELECT "id", "status"::text AS "status", "errorCode" FROM "BotOutbox"
    WHERE "businessId" = ${businessId} AND "sessionId" = ${sessionId} AND "transitionId" = ${transitionId} ORDER BY "id"
  `)
  if (!all.length || all.some(row => !['PENDING','CLAIMED','RETRY'].includes(row.status) && !(row.status === 'SKIPPED' && row.errorCode === 'CONVERSATION_SUPERSEDED'))) return false
  const locked = await tx.$queryRaw<Array<{ id: string; status: string; errorCode?: string }>>(Prisma.sql`
    /* consolidation-outbox-lock */ SELECT "id", "status"::text AS "status", "errorCode" FROM "BotOutbox"
    WHERE "businessId" = ${businessId} AND "sessionId" = ${sessionId} AND "transitionId" = ${transitionId}
    ORDER BY "id" FOR UPDATE SKIP LOCKED
  `)
  if (locked.length !== all.length || locked.some(row => !['PENDING','CLAIMED','RETRY'].includes(row.status) && !(row.status === 'SKIPPED' && row.errorCode === 'CONVERSATION_SUPERSEDED'))) return false
  const count = await tx.$executeRaw(Prisma.sql`
    /* consolidation-outbox-supersede */ UPDATE "BotOutbox" SET "status" = 'SKIPPED'::"BotOutboxStatus",
      "errorCode" = 'CONVERSATION_SUPERSEDED', "leaseToken" = NULL, "leasedUntil" = NULL
    WHERE "businessId" = ${businessId} AND "sessionId" = ${sessionId} AND "transitionId" = ${transitionId}
  `)
  if (count !== all.length) throw new Error('consolidation outbox coverage lost')
  return true
}
export async function guardConsolidatedOutboxTx(tx: Prisma.TransactionClient, item: { id: string; businessId: string; sessionId: string | null; payload: unknown; claimToken: string }): Promise<'ready' | 'superseded' | 'defer'> {
  const payload = item.payload as { to?: unknown; consolidation?: unknown }
  const envelope = readConsolidationEnvelope(payload.consolidation)
  if (!envelope) return 'ready'
  if (envelope.businessId !== item.businessId || envelope.sessionId !== item.sessionId || typeof payload.to !== 'string') throw new Error('consolidation identity mismatch')
  if (envelope.revision) {
    // Bounded groups are sequential durable turns, not independent delivery groups.
    const predecessor = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      /* consolidation-sender-predecessor */ SELECT "id" FROM "BotOutbox"
      WHERE "businessId" = ${item.businessId} AND "sessionId" = ${item.sessionId}
        AND "payload"->'consolidation'->>'revision' ~ '^[0-9]+$'
        AND CASE WHEN "payload"->'consolidation'->>'revision' ~ '^[0-9]+$'
          THEN ("payload"->'consolidation'->>'revision')::numeric < ${envelope.revision}::numeric ELSE FALSE END
        AND "status"::text IN ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN') LIMIT 1
    `)
    if (predecessor.length) return 'defer'
  }
  const sealedChoices = envelope.sealed ? await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
    /* conversation-choice-sender-scope */
    SELECT t."id" FROM "BotTransitionLog" t
    JOIN "BotSession" s ON s."id"=t."sessionId" AND s."businessId"=t."businessId"
    JOIN "BotOutbox" o ON o."transitionId"=t."id" AND o."sessionId"=t."sessionId" AND o."businessId"=t."businessId"
    WHERE o."id"=${item.id} AND t."businessId"=${item.businessId} AND t."sessionId"=${envelope.sessionId}
      AND t."deploymentId"=${envelope.deploymentId} AND t."deploymentGeneration"=${envelope.generation}
      AND t."revisionTo"=${envelope.revision ?? '0'}::bigint AND t."actionType"='conversation.choice'
      AND s."deploymentGeneration"=${envelope.generation} AND s."handoffFenceEpoch"=${envelope.handoffFenceEpoch}
      AND s."status"::text='ACTIVE' AND s."handoffClaimsPausedAt" IS NULL
  `) : []
  if (envelope.sealed && !sealedChoices.length) return 'ready'
  // Claim ownership must be checked under a nonblocking row lock: claimOutbox has the opposite lock order.
  const owned = await tx.$queryRaw<Array<{ id: string; transitionId: string }>>(Prisma.sql`
    /* consolidation-sender-owned */ SELECT "id", "transitionId" FROM "BotOutbox"
    WHERE "id" = ${item.id} AND "businessId" = ${item.businessId} AND "sessionId" = ${item.sessionId}
      AND "status"::text = 'CLAIMED' AND "leaseToken" = ${item.claimToken}
    FOR UPDATE SKIP LOCKED
  `)
  if (!owned[0]) return 'defer'
  const irreversible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    /* consolidation-sender-frozen */ SELECT "id" FROM "BotOutbox"
    WHERE "businessId" = ${item.businessId} AND "sessionId" = ${item.sessionId} AND "transitionId" = ${owned[0].transitionId}
      AND "status"::text IN ('SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ') LIMIT 1
  `)
  if (irreversible.length) return 'ready' // New input belongs to a later turn; finish all already frozen pieces.
  if (sealedChoices.length) {
    // The selection is already committed. Only its unsent response is obsolete; never replay the choice.
    const newer = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
      /* conversation-choice-sender-newer-text */
      SELECT e."id" FROM "BotTransitionLog" selected
      JOIN "BotProviderEvent" original ON original."id"=selected."providerEventId" AND original."businessId"=selected."businessId"
      JOIN "BotProviderEvent" e ON e."businessId"=original."businessId" AND (e."admittedAt",e."id")>(original."admittedAt",original."id")
      LEFT JOIN "BotActionInbox" i ON i."providerEventId"=e."id" AND i."businessId"=e."businessId"
      WHERE selected."id"=${sealedChoices[0]!.id} AND selected."businessId"=${item.businessId}
        AND selected."sessionId"=${envelope.sessionId} AND selected."actionType"='conversation.choice'
        AND e."eventType"::text='MESSAGE' AND e."payload"->>'fromPhone'=${payload.to as string}
        AND e."payload"->>'messageType'='text' AND length(trim(e."payload"->>'textBody'))>0
        AND COALESCE(e."payload"->>'interactiveReplyId','')=''
        AND (
          (i."id" IS NULL AND e."status"::text='ADMITTED') OR (
            i."deploymentId"=${envelope.deploymentId} AND i."deploymentGeneration"=${envelope.generation}
            AND (i."sessionId" IS NULL OR i."sessionId"=${envelope.sessionId})
            AND i."actionType" IN ('input.initial','conversation.message')
            AND (i."status"::text IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT') OR
              (i."status"::text='PROCESSED' AND EXISTS (
                SELECT 1 FROM "BotTransitionLog" later WHERE later."businessId"=i."businessId" AND later."sessionId"=${envelope.sessionId}
                  AND later."providerEventId"=e."id" AND later."deploymentId"=${envelope.deploymentId}
                  AND later."deploymentGeneration"=${envelope.generation} AND later."revisionTo">${envelope.revision ?? '0'}::bigint
                  AND later."actionType"='conversation.message'
              )))
          )
        ) LIMIT 1
    `)
    if (!newer.length) return 'ready'
    return await supersedeConsolidationOutboxTx(tx,item.businessId,envelope.sessionId,owned[0].transitionId) ? 'superseded' : 'defer'
  }
  const rows = await candidates(tx, { businessId: item.businessId, phone: payload.to, previousIds: envelope.eventIds, deploymentId: envelope.deploymentId, generation: envelope.generation })
  const prefix: string[] = []
  let textSize = 0
  for (const row of rows) {
    const text = textOf(row, value => /^(?:\/)?reiniciar(?: conversaci[oó]n)?$/i.test(String(value).trim()))
    if (text === null || (prefix.length && (prefix.length >= MAX_EVENTS || textSize + text.length + 1 > MAX_TEXT))) break
    prefix.push(row.id); textSize += text.length + 1
  }
  // A bounded replacement must retain the entire old group, including late commits sorted before it.
  // Otherwise send the existing group and leave the newcomer durable for the next turn.
  if (envelope.eventIds.some(id => !prefix.includes(id))) return 'ready'
  if (!prefix.some(id => !envelope.eventIds.includes(id))) return 'ready'
  return await supersedeConsolidationOutboxTx(tx, item.businessId, envelope.sessionId, owned[0].transitionId) ? 'superseded' : 'defer'
}
