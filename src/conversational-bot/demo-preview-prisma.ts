import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'
import { executePrismaSandboxBooking, verifySimulatorBookingScope } from './prisma-sandbox-booking.js'
import { finalizeSandboxBooking } from './sandbox-booking.js'
import { parseDialogueState } from './engine.js'
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
  interpretationProvider?: AiInterpretationProvider,
  interpretationTimeoutMs?: number,
  capability?: { sandboxBooking: true }
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
    return await processPreviewTurn(client, businessId, userId, phone, message, createPort, started, interpretationProvider, interpretationTimeoutMs, capability?.sandboxBooking === true)
  } finally {
    release()
    if (pendingBySession.get(queueKey) === finished) pendingBySession.delete(queueKey)
  }
}

/** Local FIFO preserves request invocation order on this process; the snapshot check also covers other workers. */
const pendingBySession = new Map<string, Promise<void>>()
async function processPreviewTurn(
  client: any, businessId: string, userId: string, phone: string, message: string,
  createPort: PreviewDependencies['createPort'], started: number, interpretationProvider?: AiInterpretationProvider, interpretationTimeoutMs?: number, sandboxBooking = false
) {
  if (sandboxBooking && !await verifySimulatorBookingScope(client, businessId, userId)) throw new SimulatorBookingScopeError()
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
      createPort: async id => { const created = await createPort(id); return { ...created, context: { ...created.context, sandboxBooking } } },
      ...(interpretationProvider ? { interpretationProvider } : {}),
      ...(interpretationTimeoutMs !== undefined ? { interpretationTimeoutMs } : {})
    }, businessId, phone, message)
    // A failing provider/engine never opens a write transaction or creates an empty QA chat.
    const committingAt = performance.now()
    const committed = await client.$transaction(async (tx: any) => {
      const lockStarted = performance.now()
      const receipt = prepared.state.sandboxReservation?.receipt
      const command = prepared.bookingCommand ?? (sandboxBooking && receipt ? { kind: 'CONFIRM_SANDBOX_BOOKING' as const, presented: prepared.state.sandboxReservation!.presented } : undefined)
      if (command) await acquireAgendaHierarchy(tx, { businessId, professionalIds: [command.presented.terms.professionalId] })
      if (sandboxBooking && !await verifySimulatorBookingScope(tx, businessId, userId, true)) throw new SimulatorBookingScopeError()
      const conversation = await tx.conversation.upsert({
        where: key, update: {}, create: { businessId, phone }
      })
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${conversation.id} FOR UPDATE`)
      const lockedAt = performance.now()
      const current = await tx.conversation.findUnique({ where: { id: conversation.id },
        select: { supportBotKey: true, supportBotState: true } })
      verifyOwner(current)
      if (!sameSnapshot(snapshot, current)) return { conflict: true as const }
      const bookingResponse = command ? { state: prepared.state, reply: prepared.reply, proposal: null, bookingCommand: command } : null
      const bookingResult = bookingResponse ? await executePrismaSandboxBooking(tx, { businessId, userId, conversationId: conversation.id, expectedPhone: phone, response: bookingResponse }) : null
      // A verified existing receipt is not a new effect: preserve the answer to address/hours queries.
      const finalized = bookingResponse && bookingResult && (prepared.bookingCommand || bookingResult.kind !== 'COMMITTED') ? finalizeSandboxBooking(bookingResponse, bookingResult) : null
      const state = finalized ? parseDialogueState(finalized.state, businessId, command!.presented.terms.timezone) : prepared.state
      const reply = finalized?.reply ?? prepared.reply
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'INBOUND', body: message,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview' } } })
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'OUTBOUND', body: reply,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview', interpretation: prepared.interpretation } } })
      await tx.conversation.update({ where: { id: conversation.id }, data: {
        supportBotKey: PREVIEW_OWNER, supportBotState: state as unknown as Prisma.InputJsonValue
      } })
      return { conflict: false as const, lockMs: rounded(lockedAt - lockStarted), state, reply }
    }, { timeout: 10_000, maxWait: 3_000 })
    if (committed.conflict) continue
    const done = performance.now()
    const { bookingCommand: _command, ...publicPrepared } = prepared
    const receipt = committed.state.sandboxReservation?.receipt
    return { ...publicPrepared, state: committed.state, reply: committed.reply, proposalReady: receipt ? false : prepared.proposalReady,
      ...(sandboxBooking ? { bookingConfirmed: Boolean(receipt), bookingReceipt: receipt ? { appointmentId: receipt.appointmentId } : null } : {}), timings: { ...prepared.timings,
      loadMs: rounded(loadedAt - loadingAt),
      persistMs: rounded(done - committingAt),
      lockMs: committed.lockMs,
      totalMs: rounded(done - started)
    } }
  }
  throw new Error('preview state changed too frequently; retry this message')
}

export class SimulatorBookingScopeError extends Error {
  constructor() { super('simulator booking scope rejected'); this.name = 'SimulatorBookingScopeError' }
}
