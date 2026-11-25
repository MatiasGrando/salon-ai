import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createPrismaClient } from '../src/config/prisma-client.js'
import { Prisma } from '../src/generated/prisma/client.js'

const database = await PGlite.create()
const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', port: 0, maxConnections: 2 })
try {
  await server.start()
  const connection = new URL(`postgresql://postgres:offline@${server.getServerConn()}/postgres`)
  assert.equal(connection.hostname, '127.0.0.1')
  const options = { connectionString: connection.toString(), max: 1, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 5_000 }
  const client = createPrismaClient(options)
  const shortClient = createPrismaClient({ ...options, transactionOptions: { timeout: 50 } })
  const isExpired = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028' && error.meta?.timeout === 50
  const readAfterDelay = async (transaction: Prisma.TransactionClient, wait: number) => {
    await delay(wait)
    return transaction.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`
  }

  try {
    assert.deepEqual(await client.$transaction(transaction => readAfterDelay(transaction, 6_500)), [{ value: 1 }])
    await assert.rejects(client.$transaction(transaction => readAfterDelay(transaction, 150), { timeout: 50 }), isExpired)
    await assert.rejects(shortClient.$transaction(transaction => readAfterDelay(transaction, 150)), isExpired)
  } finally {
    await client.$disconnect()
    await shortClient.$disconnect()
  }
  console.log('Prisma transactions: work beyond the old 5-second default and respect explicit timeouts')
} finally {
  await server.stop()
  await database.close()
}
