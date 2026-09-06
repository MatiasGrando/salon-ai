import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'

const serviceSource = await readFile(path.join(process.cwd(), 'src', 'services', 'cash-service.ts'), 'utf8')
const repositorySource = await readFile(path.join(process.cwd(), 'src', 'repositories', 'prisma-cash-repository.ts'), 'utf8')
const reviewSource = await readFile(path.join(process.cwd(), 'src', 'services', 'deposit-review-operation.ts'), 'utf8')
const crmSource = await readFile(path.join(process.cwd(), 'src', 'routes', 'crm.ts'), 'utf8')

for (const operation of ['getAppointmentFinance', 'setEstimatedAppointmentTotal', 'setAppointmentDiscount', 'recordAppointmentPayment', 'projectApprovedDeposit', 'backfillApprovedDeposits']) {
  assert.match(serviceSource, new RegExp(`async ${operation}\\(`), `CashService debe implementar ${operation}`)
}
assert.match(repositorySource, /FOR UPDATE OF account/, 'el pago debe bloquear la cuenta financiera')
assert.match(repositorySource, /clock_timestamp\(\)/, 'la hora efectiva debe pertenecer a DB')
assert.match(repositorySource, /ON CONFLICT \("bookingDepositId"\) DO NOTHING/, 'una seña debe proyectarse una sola vez')
assert.match(repositorySource, /findApprovedDepositsForBackfill/)
const projectionSource = repositorySource.slice(repositorySource.indexOf('async projectApprovedDeposit('), repositorySource.indexOf('async insertCashOperation('))
assert.ok(projectionSource.indexOf('await this.lockBusiness(input.businessId)') < projectionSource.indexOf('FROM "BookingDeposit"'), 'la proyección debe tomar primero el advisory lock del negocio')
const existingProjectionGuard = repositorySource.indexOf('const existingProjection =')
const depositBalanceRead = repositorySource.indexOf('const prior = await this.listAccountEntries', existingProjectionGuard)
assert.ok(existingProjectionGuard >= 0, 'el reintento de una seña debe reconocer la proyección existente')
assert.ok(
  depositBalanceRead > existingProjectionGuard,
  'la idempotencia de la seña debe resolverse antes de recalcular saldo para que un replay no falle como sobrepago'
)
assert.equal((reviewSource.match(/await projectApprovedDepositPaymentInTransaction/g) ?? []).length, 1, 'la aprobación F8 debe proyectar una vez dentro de su transacción')
assert.equal((crmSource.match(/await projectApprovedDepositPaymentInTransaction/g) ?? []).length, 2, 'las dos aprobaciones WEB legacy deben proyectar una vez dentro de su transacción')
for (const source of [reviewSource, crmSource]) {
  assert.match(source, /const cashTransaction = createCashTransactionRepository\(tx\)[\s\S]*?cashTransaction\.lockBusiness\([\s\S]*?ensureAppointmentAccountForPayment\(\s*cashTransaction/, 'cada aprobador debe bloquear negocio antes de cuenta')
}
assert.equal((reviewSource.match(/cashTransaction\.lockBusiness\(/g) ?? []).length, 1)
assert.equal((crmSource.match(/cashTransaction\.lockBusiness\(/g) ?? []).length, 2)

const { CashService, CashServiceError } = await import('../src/services/cash-service.js')
await assertPaymentsInMemory()

const connectionString = process.env.TEST_DATABASE_URL?.trim()
if (!connectionString) {
  console.log('OK Caja payments unit/static: simple, mixto, sesión, estimativo, descuento nominal, sobrepago, seña única con/sin sesión. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}
const databaseUrl = new URL(connectionString)
if (!/(^|[_-])test($|[_-])/i.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Refusing unsafe Caja payments database: TEST_DATABASE_URL debe apuntar a una base de prueba')
}

const [{ createPrismaClient }, { Prisma }, repositoryModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/repositories/prisma-cash-repository.js')
])
const prisma = createPrismaClient({
  connectionString,
  max: 4,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 3_000,
  transactionOptions: { maxWait: 10_000, timeout: 30_000 }
})
const pgService = new CashService(new repositoryModule.PrismaCashRepository(prisma))
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `cash_pay_b_${suffix}`,
  user: `cash_pay_u_${suffix}`,
  professional: `cash_pay_p_${suffix}`,
  customer: `cash_pay_c_${suffix}`,
  fixedService: `cash_pay_sf_${suffix}`,
  estimatedService: `cash_pay_se_${suffix}`,
  mixed: `cash_pay_mixed_${suffix}`,
  race: `cash_pay_race_${suffix}`,
  estimated: `cash_pay_est_${suffix}`,
  depositWithSession: `cash_pay_dep_session_${suffix}`,
  depositWithoutSession: `cash_pay_dep_no_session_${suffix}`,
  depositRace: `cash_pay_dep_race_${suffix}`,
  depositNewSessionRace: `cash_pay_dep_new_session_${suffix}`,
  bookingDepositWithSession: `cash_pay_bd_session_${suffix}`,
  bookingDepositWithoutSession: `cash_pay_bd_no_session_${suffix}`,
  bookingDepositRace: `cash_pay_bd_race_${suffix}`,
  bookingDepositNewSessionRace: `cash_pay_bd_new_session_${suffix}`
}

try {
  await seedPaymentsPg()
  await assertPaymentsPg()
  console.log('OK Caja payments PG: simple/mixto, estimativo, descuento, carrera sin sobrepago y señas idempotentes con/sin sesión.')
} finally {
  await cleanupPaymentsPg()
  await prisma.$disconnect()
}

async function seedPaymentsPg() {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name", "timezone") VALUES (${ids.business}, ${`CASH-PAY-${suffix}`}, 'Caja pagos', 'UTC')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "User" ("id", "email", "name", "passwordHash", "businessId", "isActive", "updatedAt") VALUES (${ids.user}, ${`cash-pay-${suffix}@example.test`}, 'Operador', 'contract', ${ids.business}, true, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${ids.business}, 'Profesional')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone") VALUES (${ids.customer}, ${ids.business}, 'Cliente', ${`54${suffix}`})`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Service" ("id", "businessId", "name", "duration", "price", "priceMode") VALUES
      (${ids.fixedService}, ${ids.business}, 'Fijo', 30, 18000, 'FIXED'::"ServicePriceMode"),
      (${ids.estimatedService}, ${ids.business}, 'Desde', 30, 10000, 'STARTING_AT'::"ServicePriceMode")
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Appointment" ("id", "businessId", "customerId", "professionalId", "serviceId", "startAt", "origin", "quotedPrice", "totalDurationMinutes") VALUES
      (${ids.mixed}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.fixedService}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", 18000, 30),
      (${ids.race}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.estimatedService}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", 10000, 30),
      (${ids.estimated}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.estimatedService}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", NULL, 30),
      (${ids.depositWithSession}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.fixedService}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 18000, 30),
      (${ids.depositWithoutSession}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.fixedService}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 18000, 30),
      (${ids.depositRace}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.fixedService}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 18000, 30),
      (${ids.depositNewSessionRace}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.fixedService}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 18000, 30)
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES
      (${ids.bookingDepositWithSession}, ${ids.business}, ${ids.depositWithSession}, 'WEB'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 4000, 4000, 'APPROVED'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', clock_timestamp()),
      (${ids.bookingDepositWithoutSession}, ${ids.business}, ${ids.depositWithoutSession}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 5000, 5000, 'APPROVED'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', clock_timestamp()),
      (${ids.bookingDepositRace}, ${ids.business}, ${ids.depositRace}, 'WEB'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 3000, 3000, 'APPROVED'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', clock_timestamp()),
      (${ids.bookingDepositNewSessionRace}, ${ids.business}, ${ids.depositNewSessionRace}, 'WEB'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 3500, 3500, 'APPROVED'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', clock_timestamp())
  `)
}

async function assertPaymentsPg() {
  const opened = await pgService.openRegisterDay({ businessId: ids.business, responsibleUserId: ids.user, openingCash: 0 })
  const mixed = await pgService.recordAppointmentPayment({
    businessId: ids.business,
    appointmentId: ids.mixed,
    cashSessionId: opened.session.id,
    origin: 'AGENDA',
    lines: [{ amount: 10000, method: 'CASH' }, { amount: 8000, method: 'CARD' }]
  })
  assert.equal(mixed.entries.length, 2)
  assert.equal(mixed.finance.balanceAmount, 0)

  const race = await Promise.allSettled([
    pgService.recordAppointmentPayment({ businessId: ids.business, appointmentId: ids.race, cashSessionId: opened.session.id, origin: 'AGENDA', lines: [{ amount: 10000, method: 'TRANSFER' }] }),
    pgService.recordAppointmentPayment({ businessId: ids.business, appointmentId: ids.race, cashSessionId: opened.session.id, origin: 'CASH_REGISTER', lines: [{ amount: 10000, method: 'CARD' }] })
  ])
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.race })).paidAmount, 10000)

  await pgService.setEstimatedAppointmentTotal({ businessId: ids.business, appointmentId: ids.estimated, agreedAmount: 20000 })
  await pgService.setAppointmentDiscount({ businessId: ids.business, appointmentId: ids.estimated, discountAmount: 2000 })
  const estimatedFinance = await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.estimated })
  assert.deepEqual({
    agreedAmount: estimatedFinance.agreedAmount,
    discountAmount: estimatedFinance.discountAmount,
    finalAmount: estimatedFinance.finalAmount,
    paidAmount: estimatedFinance.paidAmount,
    balanceAmount: estimatedFinance.balanceAmount
  }, { agreedAmount: 20000, discountAmount: 2000, finalAmount: 18000, paidAmount: 0, balanceAmount: 18000 })

  await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.depositWithSession })
  const withSession = await pgService.projectApprovedDeposit({ businessId: ids.business, bookingDepositId: ids.bookingDepositWithSession, origin: 'WEB_DEPOSIT' })
  assert.deepEqual(withSession, { created: true, cashSessionId: opened.session.id })
  assert.deepEqual(await pgService.projectApprovedDeposit({ businessId: ids.business, bookingDepositId: ids.bookingDepositWithSession, origin: 'WEB_DEPOSIT' }), { created: false, cashSessionId: opened.session.id })

  await pgService.closeRegisterDay({ businessId: ids.business, currentSessionId: opened.session.id, countedCash: 10000 })
  await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.depositWithoutSession })
  const withoutSession = await pgService.projectApprovedDeposit({ businessId: ids.business, bookingDepositId: ids.bookingDepositWithoutSession, origin: 'BOT_DEPOSIT' })
  assert.deepEqual(withoutSession, { created: true, cashSessionId: null })
  const projected = await prisma.$queryRaw<Array<{ count: number; method: string }>>(Prisma.sql`
    SELECT count(*)::int AS count, min("paymentMethod"::text) AS method FROM "CashEntry"
    WHERE "businessId" = ${ids.business} AND "bookingDepositId" IN (${ids.bookingDepositWithSession}, ${ids.bookingDepositWithoutSession})
  `)
  assert.deepEqual(projected, [{ count: 2, method: 'TRANSFER' }])

  const raceDay = await pgService.openRegisterDay({ businessId: ids.business, responsibleUserId: ids.user })
  await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.depositRace })
  const sessionRace = await Promise.allSettled([
    pgService.projectApprovedDeposit({ businessId: ids.business, bookingDepositId: ids.bookingDepositRace, origin: 'WEB_DEPOSIT' }),
    pgService.closeRegisterDay({ businessId: ids.business, currentSessionId: raceDay.session.id, countedCash: 10000 })
  ])
  assert.equal(sessionRace.every((result) => result.status === 'fulfilled'), true, 'la proyección y el cierre deben serializar sin conflicto')
  const racedEntry = await prisma.$queryRaw<Array<{ cashSessionId: string | null; effectiveAt: Date; closedAt: Date | null }>>(Prisma.sql`
    SELECT entry."cashSessionId", entry."effectiveAt", session."closedAt"
    FROM "CashEntry" AS entry
    LEFT JOIN "CashSession" AS session
      ON session."businessId" = entry."businessId" AND session."id" = entry."cashSessionId"
    WHERE entry."businessId" = ${ids.business} AND entry."bookingDepositId" = ${ids.bookingDepositRace}
  `)
  assert.equal(racedEntry.length, 1)
  assert.equal(racedEntry[0]!.cashSessionId === null || racedEntry[0]!.effectiveAt <= racedEntry[0]!.closedAt!, true, 'una seña vinculada debe haber ocurrido antes del cierre serializado')

  const newSessionDay = await pgService.openRegisterDay({ businessId: ids.business, responsibleUserId: ids.user })
  await pgService.getAppointmentFinance({ businessId: ids.business, appointmentId: ids.depositNewSessionRace })
  const barrier = new Client({ connectionString })
  await barrier.connect()
  try {
    await barrier.query('BEGIN')
    await barrier.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cash-register:${ids.business}`])
    const switchPromise = pgService.startNewSession({
      businessId: ids.business,
      currentSessionId: newSessionDay.session.id,
      responsibleUserId: ids.user,
      countedCash: 10000
    })
    await waitForCashLockWaiters(barrier, 1)
    const projectionPromise = pgService.projectApprovedDeposit({
      businessId: ids.business,
      bookingDepositId: ids.bookingDepositNewSessionRace,
      origin: 'WEB_DEPOSIT'
    })
    await waitForCashLockWaiters(barrier, 2)
    await barrier.query('COMMIT')
    const [switched, projection] = await Promise.all([switchPromise, projectionPromise])
    assert.equal(projection.cashSessionId, switched.session.id, 'si Nueva sesión obtiene primero el lock, la seña debe atribuirse a la sesión nueva')
    assert.notEqual(projection.cashSessionId, newSessionDay.session.id)
    const attribution = await prisma.$queryRaw<Array<{ cashSessionId: string | null }>>(Prisma.sql`
      SELECT "cashSessionId" FROM "CashEntry"
      WHERE "businessId" = ${ids.business} AND "bookingDepositId" = ${ids.bookingDepositNewSessionRace}
    `)
    assert.deepEqual(attribution, [{ cashSessionId: switched.session.id }])
    await pgService.closeRegisterDay({ businessId: ids.business, currentSessionId: switched.session.id, countedCash: 10000 })
  } finally {
    await barrier.query('ROLLBACK').catch(() => undefined)
    await barrier.end()
  }
}

async function waitForCashLockWaiters(client: Client, expected: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ count: number }>(`
      SELECT count(DISTINCT waiter.pid)::int AS count
      FROM pg_locks AS holder
      JOIN pg_locks AS waiter
        ON waiter.locktype = holder.locktype
        AND waiter.classid = holder.classid
        AND waiter.objid = holder.objid
        AND waiter.objsubid = holder.objsubid
        AND waiter.pid <> holder.pid
      WHERE holder.pid = pg_backend_pid()
        AND holder.locktype = 'advisory'
        AND holder.granted = true
        AND waiter.granted = false
    `)
    if (result.rows[0]?.count === expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`no se observaron ${expected} esperas sobre el advisory lock de Caja`)
}

async function cleanupPaymentsPg() {
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashEntry" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentAccountLink" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentAccount" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashSession" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashRegisterDay" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "businessId" = ${ids.business}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`).catch(() => undefined)
}

async function assertPaymentsInMemory() {
  const account = { id: 'account-a', businessId: 'business-a', pricingMode: 'FIXED' as const, agreedAmount: 18_000, discountAmount: 0 }
  const entries: Array<{ type: 'PAYMENT'; direction: 'INFLOW'; amount: number; method: 'CASH' | 'TRANSFER' | 'CARD' }> = []
  let estimatedAccount = { ...account, id: 'estimated', pricingMode: 'ESTIMATED' as const, agreedAmount: null as number | null }
  const deposits = new Set<string>()
  const approvedDeposits = [
    { id: 'approved-a', origin: 'WEB_DEPOSIT' as const },
    { id: 'approved-b', origin: 'BOT_DEPOSIT' as const },
    { id: 'approved-conflict', origin: 'WEB_DEPOSIT' as const }
  ]
  const tx = {
    lockBusiness: async (businessId: string) => businessId === 'business-a' ? { businessId, timezone: null, dbNow: new Date('2026-01-01T12:00:00Z') } : null,
    findOpenDay: async () => ({ id: 'day', businessId: 'business-a', openedAt: new Date(0), closedAt: null, openingCash: 0, expectedClosingCash: null, countedClosingCash: null, closingDifference: null }),
    findOpenSession: async (_businessId: string, dayId: string) => ({ id: 'session', businessId: 'business-a', registerDayId: dayId, responsibleUserId: 'user', responsibleName: 'User', openedAt: new Date(0), closedAt: null, expectedCash: null, countedCash: null, cashDifference: null }),
    lockAppointmentAccount: async (businessId: string, appointmentId: string) => businessId !== 'business-a'
      ? null
      : appointmentId === 'estimated' ? estimatedAccount : account,
    listAccountEntries: async (_businessId: string, accountId: string) => accountId === 'estimated' ? [] : [...entries],
    updateEstimatedTotal: async (_businessId: string, _accountId: string, agreedAmount: number) => {
      estimatedAccount = { ...estimatedAccount, agreedAmount }
      return estimatedAccount
    },
    updateDiscount: async (_businessId: string, accountId: string, discountAmount: number) => {
      if (accountId === 'estimated') estimatedAccount = { ...estimatedAccount, discountAmount }
      return { ...(accountId === 'estimated' ? estimatedAccount : account), discountAmount }
    },
    insertManualPayments: async (input: { lines: Array<{ amount: number; method: 'CASH' | 'TRANSFER' | 'CARD' }> }) => {
      const created = input.lines.map((line, index) => ({ id: `entry-${entries.length + index}`, ...line }))
      entries.push(...input.lines.map((line) => ({ type: 'PAYMENT' as const, direction: 'INFLOW' as const, ...line })))
      return created
    },
    projectApprovedDeposit: async (input: { bookingDepositId: string }) => {
      if (input.bookingDepositId === 'approved-conflict') throw new Error('APPROVED_DEPOSIT_OVERPAYMENT')
      const created = !deposits.has(input.bookingDepositId)
      deposits.add(input.bookingDepositId)
      return { created, cashSessionId: input.bookingDepositId === 'without-session' ? null : 'session' }
    },
    findApprovedDepositsForBackfill: async (_businessId: string, afterDepositId: string | null, batchSize: number) => approvedDeposits.filter((deposit) => !afterDepositId || deposit.id > afterDepositId).slice(0, batchSize)
  }
  const service = new CashService({ transaction: <T>(work: (repository: typeof tx) => Promise<T>) => work(tx) } as never)

  const mixed = await service.recordAppointmentPayment({
    businessId: 'business-a', appointmentId: 'simple', cashSessionId: 'session', origin: 'AGENDA',
    lines: [{ amount: 10_000, method: 'CASH' }, { amount: 8_000, method: 'CARD' }]
  })
  assert.deepEqual(mixed.finance, { agreedAmount: 18_000, discountAmount: 0, finalAmount: 18_000, paidAmount: 18_000, balanceAmount: 0 })
  assert.equal(mixed.entries.length, 2)
  await assert.rejects(() => service.setAppointmentDiscount({ businessId: 'business-a', appointmentId: 'simple', discountAmount: 1 }), /OVERPAYMENT/)
  await assert.rejects(() => service.recordAppointmentPayment({ businessId: 'business-a', appointmentId: 'simple', cashSessionId: 'session', origin: 'AGENDA', lines: [{ amount: 1, method: 'CASH' }] }), (error: unknown) => error instanceof CashServiceError && error.code === 'OVERPAYMENT')
  await assert.rejects(() => service.recordAppointmentPayment({ businessId: 'business-a', appointmentId: 'simple', cashSessionId: 'stale', origin: 'AGENDA', lines: [{ amount: 1, method: 'CASH' }] }), (error: unknown) => error instanceof CashServiceError && error.code === 'STALE_SESSION')
  await assert.rejects(() => service.recordAppointmentPayment({ businessId: 'business-a', appointmentId: 'simple', cashSessionId: 'session', origin: 'AGENDA', lines: [{ amount: 1.5, method: 'CASH' as const }] }), /INVALID_ENTRY_AMOUNT/)

  const fixedBefore = { ...account }
  await assert.rejects(() => service.setEstimatedAppointmentTotal({ businessId: 'business-a', appointmentId: 'simple', agreedAmount: 20_000 }), (error: unknown) => error instanceof CashServiceError && error.code === 'FIXED_PRICE_IMMUTABLE')
  assert.deepEqual(account, fixedBefore)
  const estimated = await service.setEstimatedAppointmentTotal({ businessId: 'business-a', appointmentId: 'estimated', agreedAmount: 20_000 })
  assert.equal(estimated.agreedAmount, 20_000)
  const discounted = await service.setAppointmentDiscount({ businessId: 'business-a', appointmentId: 'estimated', discountAmount: 2_000 })
  assert.equal(discounted.discountAmount, 2_000)
  await assert.rejects(() => service.setAppointmentDiscount({ businessId: 'business-a', appointmentId: 'estimated', discountAmount: 1.5 }), /INVALID_MONEY_AMOUNT/)
  const simple = await service.recordAppointmentPayment({
    businessId: 'business-a', appointmentId: 'estimated', cashSessionId: 'session', origin: 'CASH_REGISTER',
    lines: [{ amount: 18_000, method: 'TRANSFER' }]
  })
  assert.equal(simple.entries.length, 1)
  assert.equal(simple.finance.balanceAmount, 0)

  const projected = await service.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'with-session', origin: 'BOT_DEPOSIT' })
  assert.deepEqual(projected, { created: true, cashSessionId: 'session' })
  assert.equal((await service.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'with-session', origin: 'BOT_DEPOSIT' })).created, false)
  assert.deepEqual(await service.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'without-session', origin: 'WEB_DEPOSIT' }), { created: true, cashSessionId: null })
  const firstBackfill = await service.backfillApprovedDeposits({ businessId: 'business-a', batchSize: 1 })
  assert.deepEqual(firstBackfill, { scanned: 1, created: 1, replayed: 0, conflicts: [], nextCursor: 'approved-a' })
  const replayedBackfill = await service.backfillApprovedDeposits({ businessId: 'business-a', batchSize: 2 })
  assert.deepEqual(replayedBackfill, { scanned: 2, created: 1, replayed: 1, conflicts: [], nextCursor: 'approved-b' })
  const conflictBackfill = await service.backfillApprovedDeposits({ businessId: 'business-a', batchSize: 2, afterDepositId: 'approved-b' })
  assert.deepEqual(conflictBackfill, { scanned: 1, created: 0, replayed: 0, conflicts: [{ depositId: 'approved-conflict', code: 'APPROVED_DEPOSIT_OVERPAYMENT' }], nextCursor: null })
  await assert.rejects(() => service.backfillApprovedDeposits({ businessId: 'business-a', batchSize: 0 }), /INVALID_BACKFILL_BATCH_SIZE/)
}
