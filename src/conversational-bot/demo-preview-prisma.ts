import { issueChoiceQuestion, publicChoiceQuestion, parseConversationChoiceOperation, type ChoiceQuestion, type ChoiceScope } from './choices.js'
import { readPreviewChoiceState, storePreviewChoiceState, nextPreviewRevision, resolvePreviewChoice, PreviewChoiceError } from './preview-choice.js'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../services/agenda-locks.js'
import { executePrismaSandboxBooking, verifySimulatorBookingScope } from './prisma-sandbox-booking.js'
import { finalizeSandboxBooking } from './sandbox-booking.js'
import { parseDialogueState, ConversationChoiceUnavailableError } from './engine.js'
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
  capability?: { sandboxBooking: true },
  interactiveReplyId?: string
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
    return await processPreviewTurn(client, businessId, userId, phone, message, createPort, started, interpretationProvider, interpretationTimeoutMs, capability?.sandboxBooking === true, interactiveReplyId)
  } finally {
    release()
    if (pendingBySession.get(queueKey) === finished) pendingBySession.delete(queueKey)
  }
}

/** Local FIFO preserves request invocation order on this process; the snapshot check also covers other workers. */
const pendingBySession = new Map<string, Promise<void>>()
async function processPreviewTurn(
  client: any, businessId: string, userId: string, phone: string, message: string,
  createPort: PreviewDependencies['createPort'], started: number, interpretationProvider?: AiInterpretationProvider, interpretationTimeoutMs?: number, sandboxBooking = false, interactiveReplyId?: string
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
    const ledger = readPreviewChoiceState(snapshot?.supportBotState ?? null)
    // Preview uses its own virtual policy version, never pretends to be a WhatsApp deployment.
    const scope: ChoiceScope = { businessId, conversationKey: phone, policyKey: sandboxBooking ? 'preview-sandbox:v1' : 'preview:v1', policyGeneration: 1, revision: ledger.revision }
    const selection = interactiveReplyId ? resolvePreviewChoice(snapshot?.supportBotState, scope, interactiveReplyId) : null
    const inbound = selection?.label ?? message
    const loadedAt = performance.now()
    const prepared = await runConversationalPreview({
      load: async () => ledger.draft,
      save: async () => {},
      createPort: async id => { const created = await createPort(id); return { ...created, context: { ...created.context, sandboxBooking } } },
      ...(selection ? { choiceOperation: selection.operation } : {}),
      ...(interpretationProvider ? { interpretationProvider } : {}),
      ...(interpretationTimeoutMs !== undefined ? { interpretationTimeoutMs } : {})
    }, businessId, phone, inbound).catch((error: unknown) => {
      if (selection && error instanceof ConversationChoiceUnavailableError) throw new PreviewChoiceError()
      throw error
    })
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
      if (interactiveReplyId) resolvePreviewChoice(current?.supportBotState, scope, interactiveReplyId)
      const bookingResponse = command ? { state: prepared.state, reply: prepared.reply, proposal: null, bookingCommand: command } : null
      const bookingResult = bookingResponse ? await executePrismaSandboxBooking(tx, { businessId, userId, conversationId: conversation.id, expectedPhone: phone, response: bookingResponse }) : null
      // A verified existing receipt is not a new effect: preserve the answer to address/hours queries.
      const finalized = bookingResponse && bookingResult && (prepared.bookingCommand || bookingResult.kind !== 'COMMITTED') ? finalizeSandboxBooking(bookingResponse, bookingResult) : null
      const state = finalized ? parseDialogueState(finalized.state, businessId, command!.presented.terms.timezone) : prepared.state
      const reply = finalized?.reply ?? prepared.reply
      const revision = nextPreviewRevision(ledger.revision)
      let question: ChoiceQuestion | null = null
      // A finalized booking invalidates its confirmation choices. Oversized delivery degrades
      // to the already complete text, never truncates options/configuration or publishes a subset.
      if (!finalized && prepared.choicePresentation?.choices.length) {
        const choices = prepared.choicePresentation.choices
        // Presentation limits are a channel concern, not permission to conceal malformed operations.
        for (const choice of choices) parseConversationChoiceOperation(choice.operation)
        if (choices.every(choice => choice.label.length <= 200)) {
          try { question = issueChoiceQuestion({ ...scope, revision }, state, prepared.choicePresentation) }
          catch (error) {
            if (!(error instanceof Error) || error.message !== 'invalid conversation choice: question bounds') throw error
          }
        }
      }
      const presentation = question ? publicChoiceQuestion(question) : null
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'INBOUND', body: inbound,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview' } } })
      await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'OUTBOUND', body: reply,
        status: 'conversational_preview', metadata: { provider: 'conversational_preview', interpretation: prepared.interpretation, ...(presentation ? { presentation } : {}) } } })
      await tx.conversation.update({ where: { id: conversation.id }, data: {
        supportBotKey: PREVIEW_OWNER, supportBotState: storePreviewChoiceState(state, revision, question) as unknown as Prisma.InputJsonValue
      } })
      return { conflict: false as const, lockMs: rounded(lockedAt - lockStarted), state, reply, presentation }
    }, { timeout: 10_000, maxWait: 3_000 })
    if (committed.conflict) continue
    const done = performance.now()
    const { bookingCommand: _command, choicePresentation: _choices, ...publicPrepared } = prepared
    const receipt = committed.state.sandboxReservation?.receipt
    return { ...publicPrepared, state: committed.state, reply: committed.reply, presentation: committed.presentation, proposalReady: receipt ? false : prepared.proposalReady,
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
