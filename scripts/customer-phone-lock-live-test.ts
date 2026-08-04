import assert from 'node:assert/strict'
import { prisma } from '../src/config/prisma.js'

try {
  const rows = await prisma.$transaction(async (transaction) => {
    return transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${'codex-customer-lock-regression'}))
    `
  })
  assert.deepEqual(rows, [{ locked: 1 }])
  console.log('Customer phone lock live test: OK (Prisma recibe locked=1, sin columnas void)')
} finally {
  await prisma.$disconnect()
}
