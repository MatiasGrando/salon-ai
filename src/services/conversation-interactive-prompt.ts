import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'

const VERSIONED_REPLY_PREFIX = 'prompt:'

type InteractivePromptAdmission =
  | { accepted: true; token: string | null; replyId: string }
  | { accepted: false }

export type InteractivePromptResolution =
  | { status: 'selected'; replyId: string; inboundMessageIds: string[] }
  | {
      status: 'conflict'
      choices: Array<{ id: string; title: string }>
      inboundMessageIds: string[]
    }
  | { status: 'stale' }

export function createInteractivePromptToken() {
  return randomUUID().replaceAll('-', '')
}

export function versionInteractiveReplyId(replyId: string, token: string) {
  return `${VERSIONED_REPLY_PREFIX}${token}:${replyId}`
}

export function parseVersionedInteractiveReplyId(replyId: string | undefined) {
  if (!replyId?.startsWith(VERSIONED_REPLY_PREFIX)) return null
  const separator = replyId.indexOf(':', VERSIONED_REPLY_PREFIX.length)
  if (separator < 0) return null
  const token = replyId.slice(VERSIONED_REPLY_PREFIX.length, separator)
  const originalReplyId = replyId.slice(separator + 1)
  if (!/^[a-f0-9]{32}$/.test(token) || !originalReplyId) return null
  return { token, replyId: originalReplyId }
}

/** Registra y valida la pulsación bajo el mismo bloqueo usado al conciliarla. */
export async function admitConversationInteractivePromptReply<TResult>(input: {
  conversationId: string
  incomingReplyId: string
  persist: (
    transaction: Prisma.TransactionClient,
    admission: InteractivePromptAdmission
  ) => Promise<TResult>
}) {
  return prisma.$transaction(async (transaction) => {
    const activeToken = await lockConversationPrompt(transaction, input.conversationId)
    const versioned = parseVersionedInteractiveReplyId(input.incomingReplyId)
    const admission: InteractivePromptAdmission = versioned
      ? activeToken === versioned.token
        ? { accepted: true, token: versioned.token, replyId: versioned.replyId }
        : { accepted: false }
      : activeToken
        ? { accepted: false }
        : { accepted: true, token: null, replyId: input.incomingReplyId }
    const value = await input.persist(transaction, admission)
    return { admission, value }
  })
}

/** Cierra la pregunta y reúne todas las pulsaciones recibidas antes del cierre. */
export async function resolveConversationInteractivePrompt(
  conversationId: string,
  token: string
): Promise<InteractivePromptResolution> {
  return prisma.$transaction(async (transaction) => {
    const activeToken = await lockConversationPrompt(transaction, conversationId)
    if (activeToken !== token) return { status: 'stale' }

    const messages = await transaction.message.findMany({
      where: {
        conversationId,
        direction: 'INBOUND',
        status: { in: ['received', 'queued_bot'] }
      },
      select: { id: true, body: true, metadata: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    const promptMessages = messages.flatMap((message) => {
      const parsed = parseVersionedInteractiveReplyId(
        interactiveReplyIdFromMetadata(message.metadata)
      )
      return parsed?.token === token
        ? [{ messageId: message.id, replyId: parsed.replyId, title: message.body.trim() }]
        : []
    })
    if (!promptMessages.length) return { status: 'stale' }

    const choices = new Map<string, { id: string; title: string }>()
    for (const message of promptMessages) {
      if (!choices.has(message.replyId)) {
        choices.set(message.replyId, {
          id: message.replyId,
          title: message.title || 'Opción seleccionada'
        })
      }
    }

    await transaction.conversation.update({
      where: { id: conversationId },
      data: { activeInteractivePromptToken: null }
    })
    const inboundMessageIds = promptMessages.map((message) => message.messageId)
    await transaction.message.updateMany({
      where: { id: { in: inboundMessageIds }, status: 'received' },
      data: { status: 'queued_bot' }
    })
    if (choices.size > 1) {
      return { status: 'conflict', choices: [...choices.values()], inboundMessageIds }
    }
    return {
      status: 'selected',
      replyId: promptMessages[0]!.replyId,
      inboundMessageIds
    }
  })
}

export function interactivePromptConflictReply(choices: Array<{ id: string; title: string }>) {
  const titles = choices.map((choice) => `“${choice.title}”`)
  const readableChoices = titles.length === 2
    ? `${titles[0]} y ${titles[1]}`
    : `${titles.slice(0, -1).join(', ')} y ${titles.at(-1)}`
  return {
    reply: `Recibí más de una opción para la misma pregunta: ${readableChoices}. ¿Cuál preferís?`,
    replyButtons: choices
  }
}

async function lockConversationPrompt(
  transaction: Prisma.TransactionClient,
  conversationId: string
) {
  const rows = await transaction.$queryRaw<Array<{ activeInteractivePromptToken: string | null }>>(
    Prisma.sql`SELECT "activeInteractivePromptToken"
      FROM "Conversation"
      WHERE "id" = ${conversationId}
      FOR UPDATE`
  )
  return rows[0]?.activeInteractivePromptToken ?? null
}

function interactiveReplyIdFromMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return undefined
  const replyId = metadata.interactiveReplyId
  return typeof replyId === 'string' ? replyId : undefined
}
