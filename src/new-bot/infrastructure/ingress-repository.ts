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
 * Insert-once repository: the database unique key decides tenant-scoped duplicates,
 * and the promise resolves only after the outer transaction has committed.
 */
export function createNewBotIngressRepository(client: TransactionalSqlClient): NewBotIngressRepository {
  return {
    async insert(record: NewBotIngressRecord): Promise<'accepted' | 'duplicate'> {
      return client.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO "NewBotInboxEvent" (
            "id", "businessId", "schemaVersion", "vertical", "provider", "providerEventId",
            "conversationId", "message", "receivedAt"
          ) VALUES (
            ${randomUUID()}, ${record.businessId}, 1, ${record.vertical}, ${record.provider},
            ${record.providerEventId}, ${record.conversationId}, ${JSON.stringify(record.message)}::jsonb,
            ${record.receivedAt}
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