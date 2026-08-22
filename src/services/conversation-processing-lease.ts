import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'

const DEFAULT_LEASE_MS = 90_000
const DEFAULT_WAIT_MS = 45_000
const RETRY_DELAY_MS = 75

export async function withConversationProcessingLease<TResult>(
  conversationId: string,
  process: () => Promise<TResult>,
  options: { leaseMs?: number; waitMs?: number } = {}
) {
  const token = randomUUID()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS)

  while (true) {
    const now = new Date()
    const acquired = await prisma.conversation.updateMany({
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

    if (acquired.count === 1) break
    if (Date.now() >= deadline) {
      throw new Error('La conversación sigue siendo procesada por otro mensaje')
    }
    await wait(RETRY_DELAY_MS)
  }

  try {
    return await process()
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
