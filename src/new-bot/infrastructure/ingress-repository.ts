import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client.js'
import type { NewBotIngressRecord, NewBotIngressStore } from '../application/ingress.js'

interface SqlTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

interface TransactionalSqlClient {
  $transaction<T>(operation: (transaction: SqlTransaction) => Promise<T>): Promise<T>
}

export interface NewBotIngressRepository extends NewBotIngressStore {}

/**
 * Insert-once repository: a partition counter serializes admitted order for one
 * conversation, while the inbox unique key preserves tenant-scoped idempotency.
 */
export function createNewBotIngressRepository(client: TransactionalSqlClient): NewBotIngressRepository {
  return {
    async insert(record: NewBotIngressRecord): Promise<'accepted' | 'duplicate'> {
      return client.$transaction(async (transaction) => {
        const counterRows = await transaction.$queryRaw<Array<{ lastSequence: bigint | number | string }>>(Prisma.sql`
          INSERT INTO "NewBotConversationCounter" (
            "businessId", "provider", "conversationId", "lastSequence", "updatedAt"
          ) VALUES (${record.businessId}, ${record.provider}, ${record.conversationId}, 1, clock_timestamp())
          ON CONFLICT ("businessId", "provider", "conversationId") DO UPDATE
          SET "lastSequence" = "NewBotConversationCounter"."lastSequence" + 1,
              "updatedAt" = clock_timestamp()
          RETURNING "lastSequence"
        `)
        if (!Array.isArray(counterRows) || counterRows.length !== 1) {
          throw new Error('Invalid new-bot conversation counter result')
        }
        const sequence = BigInt(counterRows[0]!.lastSequence)
        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO "NewBotInboxEvent" (
            "id", "businessId", "schemaVersion", "vertical", "provider", "providerEventId",
            "conversationId", "message", "receivedAt", "sequence"
          ) VALUES (
            ${randomUUID()}, ${record.businessId}, 1, ${record.vertical}, ${record.provider},
            ${record.providerEventId}, ${record.conversationId}, ${JSON.stringify(record.message)}::jsonb,
            ${record.receivedAt}, ${sequence}
          )
          ON CONFLICT ("businessId", "provider", "providerEventId") DO NOTHING
          RETURNING "id"
        `)
        if (!Array.isArray(rows)) throw new Error('Invalid new-bot ingress persistence result')
        return rows.length === 1 ? 'accepted' : 'duplicate'
      })
    },
  }
}