import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { createPrismaDialoguePort } from './prisma-dialogue-port.js'
import { runConversationalPreview, type PreviewDependencies } from './demo-preview.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

const PREVIEW_OWNER = 'conversational-preview'
const MAX_PREVIEW_ATTEMPTS = 4
const rounded = (value: number) => Math.round(value * 10) / 10

type PreviewSnapshot = { supportBotKey: string | null; supportBotState: unknown } | null
function verifyOwner(snapshot: PreviewSnapshot) {
  if (snapshot?.supportBotKey && snapshot.supportBotKey !== PREVIEW_OWNER) throw new Error('unexpected preview state owner')
}
function sameSnapshot(left: PreviewSnapshot, right: PreviewSnapshot) {
  return (left?.supportBotKey ?? null) === (right?.supportBotKey ?? null) &&
    isDeepStrictEqual(left?.supportBotState ?? null, right?.supportBotState ?? null)
}

/** QA-only store. Prepare outside the row lock, then compare/commit one turn atomically. */
export async function runPrismaDemoPreview(
  client: any, businessId: string, userId: string, sessionId: string, message: string,
  createPort: PreviewDependencies['createPort'] = id => createPrismaDialoguePort(client, id),
  interpretationProvider?: AiInterpretationProvider
) {
  const phone = `demo:preview:${userId}:${sessionId}`
  const started = performance.now()
  const queueKey = `${businessId}:${phone}`
  const preceding = pendingBySession.get(queueKey) ?? Promise.resolve()
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  pendingBySession.set(queueKey, finished)
  await preceding
  try {
    return await processPreviewTurn(client, businessId, phone, message, createPort, started, interpretationProvider)
  } finally {
    release()
    if (pendingBySession.get(queueKey) === finished) pendingBySession.delete(queueKey)
  }
}

/** Local FIFO preserves request invocation order on this process; the snapshot check also covers other workers. */
const pendingBySession = new Map<string, Promise<void>>()
async function processPreviewTurn(
  client: any, businessId: string, phone: string, message: string,
  createPort: PreviewDependencies['createPort'], started: number, interpretationProvider?: AiInterpretationProvider
) {
  const key = { businessId_phone: { businessId, phone } }
  for (let attempt = 0; attempt < MAX_PREVIEW_ATTEMPTS; attempt++) {
    const loadingAt = performance.now()
    const existing = await client.conversation.findUnique({ where: key,
      select: { id: true, supportBotKey: true, supportBotState: true } })
    const snapshot: PreviewSnapshot = existing && {
      supportBotKey: existing.supportBotKey, supportBotState: existing.supportBotState
    }
    verifyOwner(snapshot)
    const loadedAt = performance.now()
    const prepared = await runConversationalPreview({
      load: async () => snapshot?.supportBotState ?? null,
      save: async () => {},
      createPort,
      interpretationProvider
    }, businessId, phone, message)
    // A failing provider/engine never opens a write transaction or creates an empty QA chat.
    const committingAt = performance.now()
    const committed = await client.$transaction(async (tx: any) => {
      const lockStarted = performance.now()
      const conversation = await tx.conversation.upsert({
        where: key, update: {}, create: { businessId, phone }
      })
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${conversation.id} FOR UPDATE`)
      const lockedAt = performance.now()
      const current = await tx.conversation.findUnique({ where: { id: conversation.id },
        select: { supportBotKey: true, supportBotState: true } })
      verifyOwner(current)
      if (!sameSnapshot(snapshot, current)) return { conflict: true as const }
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'INBOUND', body: message,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview' } } })
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'OUTBOUND', body: prepared.reply,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview', interpretation: prepared.interpretation } } })
      await tx.conversation.update({ where: { id: conversation.id }, data: {
        supportBotKey: PREVIEW_OWNER, supportBotState: prepared.state as unknown as Prisma.InputJsonValue
      } })
      return { conflict: false as const, lockMs: rounded(lockedAt - lockStarted) }
    }, { timeout: 10_000, maxWait: 3_000 })
    if (committed.conflict) continue
    const done = performance.now()
    return { ...prepared, timings: { ...prepared.timings,
      loadMs: rounded(loadedAt - loadingAt),
      persistMs: rounded(done - committingAt),
      lockMs: committed.lockMs,
      totalMs: rounded(done - started)
    } }
  }
  throw new Error('preview state changed too frequently; retry this message')
}
