import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { prisma } from '../config/prisma.js'
import type { Conversation } from '../generated/prisma/client.js'

const DEFAULT_LEASE_MS = 90_000
const DEFAULT_WAIT_MS = 45_000
const RETRY_DELAY_MS = 75

export async function withConversationProcessingLease<TResult>(
  conversationId: string,
  process: (conversation: Conversation) => Promise<TResult>,
  options: {
    leaseMs?: number
    waitMs?: number
    onAcquired?: (durationMs: number) => unknown
  } = {}
) {
  const token = randomUUID()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS)
  const waitStartedAt = performance.now()
  let leasedConversation: Conversation | null = null

  while (true) {
    const now = new Date()
    const acquired = await prisma.conversation.updateManyAndReturn({
      where: {
        id: conversationId,
        OR: [
          { botProcessingToken: null },
          { botProcessingUntil: null },
          { botProcessingUntil: { lte: now } }
        ]
      },
      data: {
        botProcessingToken: token,
        botProcessingUntil: new Date(now.getTime() + leaseMs)
      }
    })

    leasedConversation = acquired[0] ?? null
    if (leasedConversation) {
      break
    }
    if (Date.now() >= deadline) {
      throw new Error('La conversación sigue siendo procesada por otro mensaje')
    }
    await wait(RETRY_DELAY_MS)
  }

  try {
    try {
      const timingResult = options.onAcquired?.(performance.now() - waitStartedAt)
      void Promise.resolve(timingResult).catch(() => undefined)
    } catch {
      // La observabilidad nunca debe impedir la liberación del lease.
    }
    return await process(leasedConversation)
  } finally {
    await prisma.conversation.updateMany({
      where: { id: conversationId, botProcessingToken: token },
      data: { botProcessingToken: null, botProcessingUntil: null }
    })
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
