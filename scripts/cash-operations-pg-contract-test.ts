import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [serviceSource, repositorySource] = await Promise.all([
  readFile(path.join(process.cwd(), 'src', 'services', 'cash-service.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'repositories', 'prisma-cash-repository.ts'), 'utf8')
])

for (const operation of ['recordCashOperation', 'reverseCashEntry']) {
  assert.match(serviceSource, new RegExp(`async ${operation}\\(`), `CashService debe implementar ${operation}`)
}
assert.match(repositorySource, /async insertCashOperation\(/)
assert.match(repositorySource, /async lockCashEntry\(/)
assert.match(repositorySource, /async insertCashReversal\(/)
assert.match(repositorySource, /'REVERSAL'::"CashEntryType"/)
assert.match(repositorySource, /clock_timestamp\(\)/)

const { CashService, CashServiceError } = await import('../src/services/cash-service.js')
await assertOperationsInMemory()

const connectionString = process.env.TEST_DATABASE_URL?.trim()
if (!connectionString) {
  console.log('OK Caja operations unit/static: gasto, retiro, ingreso, ajuste, devolución, sesión y contrapartida. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}
const databaseUrl = new URL(connectionString)
if (!/(^|[_-])test($|[_-])/i.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Refusing unsafe Caja operations database: TEST_DATABASE_URL debe apuntar a una base de prueba')
}
const [{ createPrismaClient }, { Prisma }, repositoryModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/repositories/prisma-cash-repository.js')
])
const prisma = createPrismaClient({ connectionString, max: 4, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000 })
const pgService = new CashService(new repositoryModule.PrismaCashRepository(prisma))
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `cash_ops_b_${suffix}`, otherBusiness: `cash_ops_other_${suffix}`, user: `cash_ops_u_${suffix}` }
try {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name", "timezone") VALUES (${ids.business}, ${`CASH-OPS-${suffix}`}, 'Caja operaciones', 'UTC'), (${ids.otherBusiness}, ${`CASH-OPS-O-${suffix}`}, 'Caja ajena', 'UTC')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "User" ("id", "email", "name", "passwordHash", "businessId", "isActive", "updatedAt") VALUES (${ids.user}, ${`cash-ops-${suffix}@example.test`}, 'Operador', 'contract', ${ids.business}, true, clock_timestamp())`)
  const opened = await pgService.openRegisterDay({ businessId: ids.business, responsibleUserId: ids.user, openingCash: 1_000 })
  const expense = await pgService.recordCashOperation({ businessId: ids.business, cashSessionId: opened.session.id, type: 'EXPENSE', amount: 100, method: 'TRANSFER', description: 'Insumos' })
  await pgService.recordCashOperation({ businessId: ids.business, cashSessionId: opened.session.id, type: 'WITHDRAWAL', amount: 50, counterparty: 'María' })
  await pgService.recordCashOperation({ businessId: ids.business, cashSessionId: opened.session.id, type: 'CASH_IN', amount: 200, description: 'Cambio' })
  await pgService.recordCashOperation({ businessId: ids.business, cashSessionId: opened.session.id, type: 'ADJUSTMENT', delta: -25, observation: 'Control' })
  await pgService.recordCashOperation({ businessId: ids.business, cashSessionId: opened.session.id, type: 'REFUND', amount: 75, method: 'CARD', description: 'Devolución' })
  const reversed = await pgService.reverseCashEntry({ businessId: ids.business, cashSessionId: opened.session.id, entryId: expense.id })
  assert.equal(reversed.direction, 'INFLOW')
  await assert.rejects(() => pgService.reverseCashEntry({ businessId: ids.business, cashSessionId: opened.session.id, entryId: expense.id }), (error: unknown) => error instanceof CashServiceError && error.code === 'ENTRY_NOT_REVERSIBLE')
  await assert.rejects(() => pgService.reverseCashEntry({ businessId: ids.otherBusiness, cashSessionId: opened.session.id, entryId: expense.id }), (error: unknown) => error instanceof CashServiceError && ['CASH_CLOSED', 'ENTRY_NOT_FOUND'].includes(error.code))
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`UPDATE "CashEntry" SET "amount" = 1 WHERE "id" = ${expense.id}`), /append-only/i)
  const current = await pgService.getCurrentCashRegister({ businessId: ids.business })
  assert.equal(current.summary?.expectedCash, 1_125)
  console.log('OK Caja operations PG: cinco operaciones, resumen, tenant, append-only y contrapartida exacta.')
} finally {
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashEntry" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`).catch(() => undefined)
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashSession" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashRegisterDay" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "businessId" IN (${ids.business}, ${ids.otherBusiness})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${ids.business}, ${ids.otherBusiness})`).catch(() => undefined)
  await prisma.$disconnect()
}

async function assertOperationsInMemory() {
  const entries: Array<Record<string, unknown> & { id: string }> = []
  const tx = {
    lockBusiness: async (businessId: string) => businessId === 'business-a' ? { businessId, timezone: 'UTC', dbNow: new Date('2026-09-06T12:00:00Z') } : null,
    findOpenDay: async () => ({ id: 'day', businessId: 'business-a', openedAt: new Date(0), closedAt: null, openingCash: 0, expectedClosingCash: null, countedClosingCash: null, closingDifference: null }),
    findOpenSession: async () => ({ id: 'session', businessId: 'business-a', registerDayId: 'day', responsibleUserId: 'user', responsibleName: 'Operador', openedAt: new Date(0), closedAt: null, expectedCash: null, countedCash: null, cashDifference: null }),
    insertCashOperation: async (input: Record<string, unknown>) => {
      const entry = { id: `entry-${entries.length + 1}`, ...input }
      entries.push(entry)
      return entry
    },
    lockCashEntry: async (businessId: string, entryId: string) => businessId === 'business-a' ? entries.find((entry) => entry.id === entryId) ?? null : null,
    insertCashReversal: async (input: Record<string, unknown>) => {
      const source = input.source as Record<string, unknown> & { id: string }
      const original = entries.find((entry) => entry.id === source.id)
      if (!original || entries.some((entry) => entry.reversesEntryId === original.id)) throw new CashServiceError('ENTRY_NOT_REVERSIBLE')
      const entry = {
        id: input.id as string,
        type: 'REVERSAL',
        direction: source.direction === 'INFLOW' ? 'OUTFLOW' : 'INFLOW',
        amount: source.amount,
        method: source.method,
        reversesEntryId: source.id
      }
      entries.push(entry)
      return entry
    }
  }
  const service = new CashService({ transaction: <T>(work: (repository: typeof tx) => Promise<T>) => work(tx) } as never)

  const expense = await service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'EXPENSE', amount: 500, method: 'TRANSFER', description: 'Insumos' })
  assert.deepEqual(pick(expense, ['type', 'direction', 'method', 'description']), { type: 'EXPENSE', direction: 'OUTFLOW', method: 'TRANSFER', description: 'Insumos' })
  const withdrawal = await service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'WITHDRAWAL', amount: 300, counterparty: 'María' })
  assert.deepEqual(pick(withdrawal, ['type', 'direction', 'method', 'counterparty']), { type: 'WITHDRAWAL', direction: 'OUTFLOW', method: 'CASH', counterparty: 'María' })
  const cashIn = await service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'CASH_IN', amount: 200, description: 'Cambio inicial' })
  assert.equal(cashIn.direction, 'INFLOW')
  const adjustment = await service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'ADJUSTMENT', delta: -50, observation: 'Control manual' })
  assert.deepEqual(pick(adjustment, ['amount', 'direction', 'method']), { amount: 50, direction: 'OUTFLOW', method: 'CASH' })
  const refund = await service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'REFUND', amount: 100, method: 'CARD', description: 'Devolución general' })
  assert.equal(refund.method, 'CARD')
  await assert.rejects(() => service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'session', type: 'WITHDRAWAL', amount: 1, counterparty: ' ' }), (error: unknown) => error instanceof CashServiceError && error.code === 'COUNTERPARTY_REQUIRED')
  await assert.rejects(() => service.recordCashOperation({ businessId: 'business-a', cashSessionId: 'stale', type: 'CASH_IN', amount: 1, description: 'x' }), (error: unknown) => error instanceof CashServiceError && error.code === 'STALE_SESSION')
  const reversal = await service.reverseCashEntry({ businessId: 'business-a', cashSessionId: 'session', entryId: expense.id, observation: 'Corrección' })
  assert.deepEqual(pick(reversal, ['type', 'direction', 'amount', 'method', 'reversesEntryId']), { type: 'REVERSAL', direction: 'INFLOW', amount: 500, method: 'TRANSFER', reversesEntryId: expense.id })
  await assert.rejects(() => service.reverseCashEntry({ businessId: 'business-a', cashSessionId: 'session', entryId: expense.id }), (error: unknown) => error instanceof CashServiceError && error.code === 'ENTRY_NOT_REVERSIBLE')
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}
