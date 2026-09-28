import { Prisma } from '../generated/prisma/client.js'
import { createPrismaDialoguePort } from './prisma-dialogue-port.js'
import { runConversationalPreview, type PreviewDependencies } from './demo-preview.js'
import type { DialogueState } from './engine.js'

/** QA-only store. The isolated demo:preview namespace must never be used for a real provider phone. */
export async function runPrismaDemoPreview(
  client: any, businessId: string, userId: string, sessionId: string, message: string,
  createPort: PreviewDependencies['createPort'] = id => createPrismaDialoguePort(client, id)
) {
  const started = performance.now()
  const phone = `demo:preview:${userId}:${sessionId}`
  const conversation = await client.conversation.upsert({
    where: { businessId_phone: { businessId, phone } }, update: {}, create: { businessId, phone }
  })
  // Serialize preview turns across workers. The default interactive timeout is too short for
  // catalog/availability queries; this bounded QA-only budget is not a production bot SLA.
  return client.$transaction(async (tx: any) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${conversation.id} FOR UPDATE`)
    const lockedAt = performance.now()
    const result = await runConversationalPreview({
      async load() {
        const row = await tx.conversation.findUnique({ where: { id: conversation.id }, select: { supportBotState: true, supportBotKey: true } })
        if (row?.supportBotKey && row.supportBotKey !== 'conversational-preview') throw new Error('unexpected preview state owner')
        return row?.supportBotState ?? null
      },
      async save(_: string, inbound: string, reply: string, state: DialogueState) {
        await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'INBOUND', body: inbound,
          status: 'conversational_preview', metadata: { provider: 'conversational_preview' } } })
        await tx.message.create({ data: { conversationId: conversation.id, phone, direction: 'OUTBOUND', body: reply,
          status: 'conversational_preview', metadata: { provider: 'conversational_preview' } } })
        await tx.conversation.update({ where: { id: conversation.id }, data: {
          supportBotKey: 'conversational-preview', supportBotState: state as unknown as Prisma.InputJsonValue
        } })
      },
      createPort: id => createPort(id)
    }, businessId, phone, message)
    const done = performance.now()
    return { ...result, timings: { ...result.timings,
      lockMs: Math.round((lockedAt - started) * 10) / 10,
      totalMs: Math.round((done - started) * 10) / 10
    } }
  }, { timeout: 10_000, maxWait: 3_000 })
}
