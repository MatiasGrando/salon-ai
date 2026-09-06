import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const servicePath = path.join(process.cwd(), 'src', 'services', 'cash-service.ts')
const repositoryPath = path.join(process.cwd(), 'src', 'repositories', 'prisma-cash-repository.ts')
const [serviceSource, repositorySource] = await Promise.all([
  readFile(servicePath, 'utf8'),
  readFile(repositoryPath, 'utf8')
])

for (const operation of ['openRegisterDay', 'startNewSession', 'closeRegisterDay']) {
  assert.match(serviceSource, new RegExp(`async ${operation}\\(`), `CashService debe implementar ${operation}`)
}
assert.match(serviceSource, /resolveRegisterOpeningCash/)
assert.match(serviceSource, /summarizeCashRegister/)
assert.match(serviceSource, /assertIanaTimezone/)
assert.match(repositorySource, /pg_advisory_xact_lock\(hashtextextended/)
assert.match(
  repositorySource,
  /SELECT 1::integer AS "locked"\s+FROM pg_advisory_xact_lock\(hashtextextended/,
  'el advisory lock no debe exponer a Prisma la columna void de PostgreSQL'
)
assert.match(repositorySource, /clock_timestamp\(\) AS "dbNow"/)
assert.match(repositorySource, /"businessId" = \$\{businessId\}[\s\S]*"isActive" = true/)
assert.match(repositorySource, /WHERE day\."businessId" = \$\{businessId\}[\s\S]*day\."closedAt" IS NULL/)
assert.doesNotMatch(repositorySource, /::date/, 'la jornada abierta no debe cortarse por fecha calendario')
assert.doesNotMatch(
  `${serviceSource}\n${repositorySource}`,
  /INSERT INTO "CashEntry"[\s\S]{0,600}'ADJUSTMENT'|cashEntry\.create\([\s\S]{0,600}ADJUSTMENT/,
  'el control de efectivo no debe crear ajustes automáticos'
)

const { CashService } = await import('../src/services/cash-service.js')
await assertInMemoryLifecycle()
await assertInMemoryRaces()

const connectionString = process.env.TEST_DATABASE_URL?.trim()
if (!connectionString) {
  console.log('OK Caja sessions static: operaciones, lock tenant, reloj DB, transmedianoche y controles sin ajuste. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}

const databaseUrl = new URL(connectionString)
if (!/(^|[_-])test($|[_-])/i.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Refusing unsafe Caja sessions database: TEST_DATABASE_URL debe apuntar a una base de prueba')
}

const [{ createPrismaClient }, { Prisma }, serviceModule, repositoryModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/cash-service.js'),
  import('../src/repositories/prisma-cash-repository.js')
])
const prisma = createPrismaClient({
  connectionString,
  max: 8,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 3_000,
  transactionOptions: { maxWait: 10_000, timeout: 30_000 }
})
const service = new serviceModule.CashService(new repositoryModule.PrismaCashRepository(prisma))
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  businessA: `cash_session_a_${suffix}`,
  businessB: `cash_session_b_${suffix}`,
  businessRace: `cash_session_race_${suffix}`,
  userA: `cash_session_ua_${suffix}`,
  userA2: `cash_session_ua2_${suffix}`,
  inactiveA: `cash_session_inactive_${suffix}`,
  userB: `cash_session_ub_${suffix}`,
  raceUser: `cash_session_ur_${suffix}`
}

try {
  await seed()
  await assertResponsibleTenantScope()
  const firstDay = await assertOpenAndCrossMidnight()
  const secondDay = await assertNewSessionCloseAndCarry(firstDay)
  await assertNewSessionRace(secondDay)
  await assertConcurrentOpen()
  console.log('OK Caja sessions PG: abrir/cerrar/nueva, concurrencia, responsable tenant-safe, control sin ajuste, transmedianoche y arrastre.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name", "timezone") VALUES
      (${ids.businessA}, ${`CASH-SA-${suffix}`}, 'Caja sesiones A', 'America/Argentina/Buenos_Aires'),
      (${ids.businessB}, ${`CASH-SB-${suffix}`}, 'Caja sesiones B', 'UTC'),
      (${ids.businessRace}, ${`CASH-SR-${suffix}`}, 'Caja sesiones Race', 'UTC')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "User" ("id", "email", "name", "passwordHash", "businessId", "isActive", "updatedAt") VALUES
      (${ids.userA}, ${`cash-sa-${suffix}@example.test`}, 'María', 'contract', ${ids.businessA}, true, clock_timestamp()),
      (${ids.userA2}, ${`cash-sa2-${suffix}@example.test`}, 'Lucas', 'contract', ${ids.businessA}, true, clock_timestamp()),
      (${ids.inactiveA}, ${`cash-inactive-${suffix}@example.test`}, 'Inactivo', 'contract', ${ids.businessA}, false, clock_timestamp()),
      (${ids.userB}, ${`cash-sb-${suffix}@example.test`}, 'Ajeno', 'contract', ${ids.businessB}, true, clock_timestamp()),
      (${ids.raceUser}, ${`cash-sr-${suffix}@example.test`}, 'Race', 'contract', ${ids.businessRace}, true, clock_timestamp())
  `)
}

async function assertResponsibleTenantScope() {
  await assert.rejects(() => service.openRegisterDay({ businessId: ids.businessA, responsibleUserId: ids.userB, openingCash: 100 }), (error: unknown) => hasCode(error, 'RESPONSIBLE_NOT_FOUND'))
  await assert.rejects(() => service.openRegisterDay({ businessId: ids.businessA, responsibleUserId: ids.inactiveA, openingCash: 100 }), (error: unknown) => hasCode(error, 'RESPONSIBLE_NOT_FOUND'))
  await assert.rejects(() => service.openRegisterDay({ businessId: ids.businessA, responsibleUserId: ids.userA }), (error: unknown) => hasCode(error, 'OPENING_CASH_REQUIRED'))
}

async function assertOpenAndCrossMidnight() {
  const opened = await service.openRegisterDay({ businessId: ids.businessA, responsibleUserId: ids.userA, openingCash: 1_000 })
  assert.equal(opened.day.openingCash, 1_000)
  assert.equal(opened.session.responsibleUserId, ids.userA)
  await prisma.$executeRaw(Prisma.sql`UPDATE "CashRegisterDay" SET "openedAt" = clock_timestamp() - interval '25 hours' WHERE "id" = ${opened.day.id}`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "CashSession" SET "openedAt" = clock_timestamp() - interval '25 hours' WHERE "id" = ${opened.session.id}`)
  const switched = await service.startNewSession({
    businessId: ids.businessA,
    currentSessionId: opened.session.id,
    responsibleUserId: ids.userA2,
    countedCash: 900
  })
  assert.equal(switched.day.id, opened.day.id, 'la jornada debe sobrevivir al cruce de medianoche')
  assert.equal(switched.closedSession.expectedCash, 1_000)
  assert.equal(switched.closedSession.cashDifference, -100)
  assert.equal(switched.session.responsibleUserId, ids.userA2)
  assert.equal(await countEntries(ids.businessA), 0, 'el control no debe crear ajuste')
  return { day: opened.day, session: switched.session }
}

async function assertNewSessionCloseAndCarry(first: { day: { id: string }; session: { id: string } }) {
  await assert.rejects(() => service.closeRegisterDay({ businessId: ids.businessA, currentSessionId: first.day.id, countedCash: 1_000 }), (error: unknown) => hasCode(error, 'STALE_SESSION'))
  const closed = await service.closeRegisterDay({ businessId: ids.businessA, currentSessionId: first.session.id, countedCash: 950 })
  assert.equal(closed.day.expectedClosingCash, 1_000)
  assert.equal(closed.day.closingDifference, -50)
  assert.equal(closed.session.expectedCash, 1_000)
  assert.equal(await countEntries(ids.businessA), 0)

  const reopened = await service.openRegisterDay({ businessId: ids.businessA, responsibleUserId: ids.userA })
  assert.equal(reopened.day.openingCash, 1_000, 'la jornada siguiente hereda efectivo esperado, no contado')
  return reopened
}

async function assertNewSessionRace(opened: { day: { id: string }; session: { id: string } }) {
  const results = await Promise.allSettled([
    service.startNewSession({ businessId: ids.businessA, currentSessionId: opened.session.id, responsibleUserId: ids.userA, countedCash: 1_000 }),
    service.startNewSession({ businessId: ids.businessA, currentSessionId: opened.session.id, responsibleUserId: ids.userA2, countedCash: 1_000 })
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.ok(rejected && hasCode(rejected.reason, 'STALE_SESSION'))
  const active = await openSessionIds(ids.businessA)
  assert.equal(active.length, 1)
  await service.closeRegisterDay({ businessId: ids.businessA, currentSessionId: active[0]!, countedCash: 1_000 })
}

async function assertConcurrentOpen() {
  const results = await Promise.allSettled([
    service.openRegisterDay({ businessId: ids.businessRace, responsibleUserId: ids.raceUser, openingCash: 50 }),
    service.openRegisterDay({ businessId: ids.businessRace, responsibleUserId: ids.raceUser, openingCash: 75 })
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.ok(rejected && hasCode(rejected.reason, 'OPEN_DAY_EXISTS'))
  assert.equal((await openSessionIds(ids.businessRace)).length, 1)
}

function hasCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function countEntries(businessId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT count(*)::int AS count FROM "CashEntry" WHERE "businessId" = ${businessId}`)
  return rows[0]?.count ?? -1
}

async function openSessionIds(businessId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "CashSession" WHERE "businessId" = ${businessId} AND "closedAt" IS NULL ORDER BY "id"`)
  return rows.map((row) => row.id)
}

async function cleanup() {
  const businessIds = [ids.businessA, ids.businessB, ids.businessRace]
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashSession" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashRegisterDay" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
}

async function assertInMemoryLifecycle() {
  const memory = createMemoryRepository()
  const localService = new CashService(memory as never)
  await assert.rejects(
    () => localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'other-user', openingCash: 100 }),
    (error: unknown) => hasCode(error, 'RESPONSIBLE_NOT_FOUND')
  )
  await assert.rejects(
    () => localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'user-a' }),
    (error: unknown) => hasCode(error, 'OPENING_CASH_REQUIRED')
  )

  const opened = await localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'user-a', openingCash: 1_000 })
  memory.advanceHours(26)
  const switched = await localService.startNewSession({
    businessId: 'business-a',
    currentSessionId: opened.session.id,
    responsibleUserId: 'user-a2',
    countedCash: 800
  })
  assert.equal(switched.day.id, opened.day.id)
  assert.equal(switched.closedSession.expectedCash, 1_000)
  assert.equal(switched.closedSession.cashDifference, -200)
  assert.equal(switched.session.openedAt.getTime(), switched.closedSession.closedAt?.getTime())

  const closed = await localService.closeRegisterDay({
    businessId: 'business-a',
    currentSessionId: switched.session.id,
    countedCash: 900
  })
  assert.equal(closed.day.expectedClosingCash, 1_000)
  assert.equal(closed.day.countedClosingCash, 900)
  assert.equal(closed.day.closingDifference, -100)
  assert.equal(memory.entryWrites, 0)

  const reopened = await localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'user-a' })
  assert.equal(reopened.day.openingCash, 1_000)
  console.log('OK Caja sessions unit: apertura, cambio transmedianoche, cierre, controles sin ajuste y arrastre esperado.')
}

async function assertInMemoryRaces() {
  const memory = createMemoryRepository()
  const localService = new CashService(memory as never)
  const openResults = await Promise.allSettled([
    localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'user-a', openingCash: 100 }),
    localService.openRegisterDay({ businessId: 'business-a', responsibleUserId: 'user-a2', openingCash: 200 })
  ])
  assert.equal(openResults.filter((result) => result.status === 'fulfilled').length, 1)
  const openRejected = openResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.ok(openRejected && hasCode(openRejected.reason, 'OPEN_DAY_EXISTS'))
  const openedResult = openResults.find((result) => result.status === 'fulfilled')
  assert.ok(openedResult && openedResult.status === 'fulfilled')
  const opened = openedResult.value

  const switchResults = await Promise.allSettled([
    localService.startNewSession({ businessId: 'business-a', currentSessionId: opened.session.id, responsibleUserId: 'user-a', countedCash: opened.day.openingCash }),
    localService.startNewSession({ businessId: 'business-a', currentSessionId: opened.session.id, responsibleUserId: 'user-a2', countedCash: opened.day.openingCash })
  ])
  assert.equal(switchResults.filter((result) => result.status === 'fulfilled').length, 1)
  const switchRejected = switchResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.ok(switchRejected && hasCode(switchRejected.reason, 'STALE_SESSION'))
  console.log('OK Caja sessions unit races: una apertura ganadora y una sola Nueva sesión sobre el token vigente.')
}

function createMemoryRepository() {
  type Day = {
    id: string; businessId: string; openedAt: Date; closedAt: Date | null; openingCash: number
    expectedClosingCash: number | null; countedClosingCash: number | null; closingDifference: number | null
  }
  type Session = {
    id: string; businessId: string; registerDayId: string; responsibleUserId: string; responsibleName: string
    openedAt: Date; closedAt: Date | null; expectedCash: number | null; countedCash: number | null; cashDifference: number | null
  }
  const days: Day[] = []
  const sessions: Session[] = []
  let now = new Date('2026-09-05T23:30:00.000Z')
  const responsible = new Map([
    ['user-a', { id: 'user-a', name: 'María' }],
    ['user-a2', { id: 'user-a2', name: 'Lucas' }]
  ])
  const transaction = {
    lockBusiness: async (businessId: string) => businessId === 'business-a'
      ? { businessId, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date(now) }
      : null,
    findResponsible: async (businessId: string, userId: string) => businessId === 'business-a' ? responsible.get(userId) ?? null : null,
    findOpenDay: async (businessId: string) => days.find((day) => day.businessId === businessId && day.closedAt === null) ?? null,
    findOpenSession: async (businessId: string, registerDayId: string) => sessions.find((session) => session.businessId === businessId && session.registerDayId === registerDayId && session.closedAt === null) ?? null,
    findPreviousExpectedCash: async (businessId: string) => [...days].reverse().find((day) => day.businessId === businessId && day.closedAt !== null)?.expectedClosingCash ?? null,
    listDayEntries: async () => [],
    createDay: async (input: { id: string; businessId: string; openedAt: Date; openingCash: number }) => {
      const day = { ...input, closedAt: null, expectedClosingCash: null, countedClosingCash: null, closingDifference: null }
      days.push(day)
      return day
    },
    createSession: async (input: { id: string; businessId: string; registerDayId: string; responsibleUserId: string; responsibleName: string; openedAt: Date }) => {
      const session = { ...input, closedAt: null, expectedCash: null, countedCash: null, cashDifference: null }
      sessions.push(session)
      return session
    },
    closeSession: async (input: { businessId: string; sessionId: string; closedAt: Date; expectedCash: number; countedCash: number; cashDifference: number }) => {
      const session = sessions.find((candidate) => candidate.businessId === input.businessId && candidate.id === input.sessionId)!
      Object.assign(session, input)
      return session
    },
    closeDay: async (input: { businessId: string; registerDayId: string; closedAt: Date; expectedClosingCash: number; countedClosingCash: number; closingDifference: number }) => {
      const day = days.find((candidate) => candidate.businessId === input.businessId && candidate.id === input.registerDayId)!
      Object.assign(day, input)
      return day
    }
  }
  let transactionTail = Promise.resolve()
  return {
    entryWrites: 0,
    advanceHours(hours: number) {
      now = new Date(now.getTime() + hours * 60 * 60_000)
    },
    transaction<T>(work: (value: typeof transaction) => Promise<T>) {
      const result = transactionTail.then(() => work(transaction))
      transactionTail = result.then(() => undefined, () => undefined)
      return result
    }
  }
}
