import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [serviceSource, repositorySource, schema, migration] = await Promise.all([
  readFile(path.join(process.cwd(), 'src', 'services', 'cash-service.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'repositories', 'prisma-cash-repository.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8'),
  readFile(path.join(process.cwd(), 'prisma', 'migrations', '20260906120000_add_cash_financial_ledger', 'migration.sql'), 'utf8')
])

assert.match(serviceSource, /async backfillAppointmentAccounts\(/)
assert.match(serviceSource, /async resolveAppointmentAccount\(/)
assert.match(serviceSource, /buildAppointmentAccountBackfillPlan/)
assert.match(repositorySource, /ON CONFLICT \("id"\) DO NOTHING/)
assert.match(repositorySource, /ON CONFLICT \("appointmentId"\) DO NOTHING/)
assert.match(repositorySource, /'LEGACY_PAYMENT'::"CashEntryType"/)
assert.match(repositorySource, /'UNSPECIFIED'::"CashPaymentMethod"/)
assert.match(repositorySource, /'MIGRATION'::"CashEntryOrigin"/)
assert.match(repositorySource, /primary_service\."businessId" = appointment\."businessId"/)
assert.match(repositorySource, /NULL\s*\)\s*ON CONFLICT \("id"\) DO NOTHING/, 'legacy debe persistirse sin fecha inventada')
assert.match(schema, /effectiveAt\s+DateTime\?\s+@default\(dbgenerated\("clock_timestamp\(\)"\)\)/)
assert.match(migration, /"effectiveAt" TIMESTAMP\(3\) DEFAULT clock_timestamp\(\)/)
assert.match(migration, /WHEN 'LEGACY_PAYMENT'[\s\S]*"effectiveAt" IS NULL/)
assert.match(migration, /WHEN 'PAYMENT'[\s\S]*"effectiveAt" IS NOT NULL/)
assert.ok(migration.includes('AppointmentAccount_fixed_price_trigger'))

const { CashService, buildAppointmentAccountBackfillPlan } = await import('../src/services/cash-service.js')

const fixedSimple = buildAppointmentAccountBackfillPlan([evidence({ appointmentId: 'simple', quotedPrice: 12_000 })])
assert.deepEqual(fixedSimple, {
  ok: true,
  sourceKey: 'appointment:simple',
  pricingMode: 'FIXED',
  agreedAmount: 12_000,
  appointmentIds: ['simple'],
  legacyPayments: []
})

const visit = buildAppointmentAccountBackfillPlan([evidence({
  appointmentId: 'visit-appointment',
  origin: 'BOT',
  visitId: 'visit-1',
  visitBusinessId: 'business-a',
  visitTotalPrice: 30_000
})])
assert.equal(visit.ok, true)
if (visit.ok) {
  assert.equal(visit.sourceKey, 'visit:visit-1')
  assert.equal(visit.agreedAmount, 30_000)
}

const coordinated = buildAppointmentAccountBackfillPlan([
  evidence({ appointmentId: 'web-1', origin: 'WEB', coordinationGroupId: 'group-1', quotedPrice: 10_000 }),
  evidence({ appointmentId: 'web-2', origin: 'WEB', coordinationGroupId: 'group-1', quotedPrice: 20_000, estimated: true })
])
assert.deepEqual(coordinated, {
  ok: true,
  sourceKey: 'coordination:group-1',
  pricingMode: 'ESTIMATED',
  agreedAmount: 30_000,
  appointmentIds: ['web-1', 'web-2'],
  legacyPayments: []
})

assert.deepEqual(buildAppointmentAccountBackfillPlan([
  evidence({ appointmentId: 'bad-web', origin: 'WEB', coordinationGroupId: 'bad-group' }),
  evidence({ appointmentId: 'bad-manual', origin: 'MANUAL', coordinationGroupId: 'bad-group' })
]), {
  ok: false,
  code: 'INCONSISTENT_COORDINATION_GROUP',
  appointmentIds: ['bad-manual', 'bad-web']
})

assert.deepEqual(buildAppointmentAccountBackfillPlan([
  evidence({ appointmentId: 'foreign-service', tenantConsistent: false })
]), {
  ok: false,
  code: 'TENANT_MISMATCH',
  appointmentIds: ['foreign-service']
})

const legacy = buildAppointmentAccountBackfillPlan([evidence({
  appointmentId: 'legacy',
  origin: 'MANUAL',
  quotedPrice: 50_000,
  manualDepositPaid: true,
  manualDepositAmount: 5_000
})])
assert.equal(legacy.ok, true)
if (legacy.ok) assert.deepEqual(legacy.legacyPayments, [{ appointmentId: 'legacy', amount: 5_000 }])

await assertInMemoryBackfill()

const connectionString = process.env.TEST_DATABASE_URL?.trim()
if (!connectionString) {
  console.log('OK Appointment account backfill unit/static: simple, coordinada, BookingVisit, precio fijo, legacy sin fecha/medio inventados, idempotencia y tenant. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}

const databaseUrl = new URL(connectionString)
if (!/(^|[_-])test($|[_-])/i.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Refusing unsafe Appointment account backfill database')
}

const [{ createPrismaClient }, { Prisma }, repositoryModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/repositories/prisma-cash-repository.js')
])
const prisma = createPrismaClient({ connectionString, max: 6, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000 })
const pgService = new CashService(new repositoryModule.PrismaCashRepository(prisma))
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  businessA: `cash_bf_a_${suffix}`,
  businessB: `cash_bf_b_${suffix}`,
  professionalA: `cash_bf_pa_${suffix}`,
  professionalB: `cash_bf_pb_${suffix}`,
  customerA: `cash_bf_ca_${suffix}`,
  customerB: `cash_bf_cb_${suffix}`,
  fixedServiceA: `cash_bf_sfa_${suffix}`,
  estimatedServiceA: `cash_bf_sea_${suffix}`,
  fixedServiceB: `cash_bf_sfb_${suffix}`,
  simple: `cash_bf_simple_${suffix}`,
  web1: `cash_bf_web1_${suffix}`,
  web2: `cash_bf_web2_${suffix}`,
  legacy: `cash_bf_legacy_${suffix}`,
  badWeb: `cash_bf_badweb_${suffix}`,
  badManual: `cash_bf_badmanual_${suffix}`,
  foreign: `cash_bf_foreign_${suffix}`,
  configuration: `cash_bf_cfg_${suffix}`,
  deployment: `cash_bf_dep_${suffix}`,
  botSession: `cash_bf_session_${suffix}`,
  visit: `cash_bf_visit_${suffix}`,
  visitAppointment: `cash_bf_visit_appt_${suffix}`
}

try {
  await seedPg()
  const first = await pgService.backfillAppointmentAccounts({ businessId: ids.businessA, batchSize: 100 })
  assert.ok(first.accountsCreated >= 3)
  assert.equal(first.conflicts.some((conflict) => conflict.code === 'INCONSISTENT_COORDINATION_GROUP'), true)
  const simpleAccount = await pgService.resolveAppointmentAccount({ businessId: ids.businessA, appointmentId: ids.simple })
  assert.ok(simpleAccount)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`UPDATE "AppointmentAccount" SET "agreedAmount" = 1, "updatedAt" = clock_timestamp() WHERE "id" = ${simpleAccount!.id}`), /immutable/i)
  const webAccounts = await Promise.all([
    pgService.resolveAppointmentAccount({ businessId: ids.businessA, appointmentId: ids.web1 }),
    pgService.resolveAppointmentAccount({ businessId: ids.businessA, appointmentId: ids.web2 })
  ])
  assert.equal(webAccounts[0]?.id, webAccounts[1]?.id)
  const visitAccount = await pgService.resolveAppointmentAccount({ businessId: ids.businessA, appointmentId: ids.visitAppointment })
  assert.equal(visitAccount?.agreedAmount, 30_000)
  assert.equal(await pgService.resolveAppointmentAccount({ businessId: ids.businessB, appointmentId: ids.simple }), null)
  const legacyRows = await prisma.$queryRaw<Array<{ paymentMethod: string; effectiveAt: Date | null }>>(Prisma.sql`
    SELECT "paymentMethod"::text AS "paymentMethod", "effectiveAt" FROM "CashEntry"
    WHERE "businessId" = ${ids.businessA} AND "type" = 'LEGACY_PAYMENT'::"CashEntryType"
  `)
  assert.deepEqual(legacyRows, [{ paymentMethod: 'UNSPECIFIED', effectiveAt: null }])
  const replay = await pgService.backfillAppointmentAccounts({ businessId: ids.businessA, batchSize: 100 })
  assert.equal(replay.accountsCreated, 0)
  assert.equal(replay.linksCreated, 0)
  assert.equal(replay.legacyEntriesCreated, 0)
  console.log('OK Appointment account backfill PG: enlaces, agrupación, precio fijo, legacy, reanudación y tenant.')
} finally {
  await cleanupPg()
  await prisma.$disconnect()
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'business-a',
    appointmentId: 'appointment',
    origin: 'MANUAL' as const,
    coordinationGroupId: null,
    visitId: null,
    visitBusinessId: null,
    visitTotalPrice: null,
    quotedPrice: null,
    primaryPrice: 10_000,
    itemCount: 0,
    pricedItemCount: 0,
    itemTotal: null,
    estimated: false,
    tenantConsistent: true,
    manualDepositPaid: false,
    manualDepositAmount: null,
    ...overrides
  }
}

async function assertInMemoryBackfill() {
  const groups = new Map([
    ['simple', [evidence({ appointmentId: 'simple', quotedPrice: 100 })]],
    ['web-1', [
      evidence({ appointmentId: 'web-1', origin: 'WEB', coordinationGroupId: 'group', quotedPrice: 100 }),
      evidence({ appointmentId: 'web-2', origin: 'WEB', coordinationGroupId: 'group', quotedPrice: 200 })
    ]],
    ['web-2', [
      evidence({ appointmentId: 'web-1', origin: 'WEB', coordinationGroupId: 'group', quotedPrice: 100 }),
      evidence({ appointmentId: 'web-2', origin: 'WEB', coordinationGroupId: 'group', quotedPrice: 200 })
    ]],
    ['conflict-1', [
      evidence({ appointmentId: 'conflict-1', origin: 'WEB', coordinationGroupId: 'conflict', quotedPrice: 100 }),
      evidence({ appointmentId: 'conflict-2', origin: 'WEB', coordinationGroupId: 'conflict', quotedPrice: 200 })
    ]],
    ['conflict-2', [
      evidence({ appointmentId: 'conflict-1', origin: 'WEB', coordinationGroupId: 'conflict', quotedPrice: 100 }),
      evidence({ appointmentId: 'conflict-2', origin: 'WEB', coordinationGroupId: 'conflict', quotedPrice: 200 })
    ]],
    ['legacy', [evidence({ appointmentId: 'legacy', quotedPrice: 500, manualDepositPaid: true, manualDepositAmount: 50 })]]
  ])
  const accounts = new Map<string, { id: string; businessId: string; pricingMode: string; agreedAmount: number | null }>([
    ['preexisting', { id: 'preexisting', businessId: 'business-a', pricingMode: 'FIXED', agreedAmount: 999 }]
  ])
  const links = new Map<string, string>([['conflict-2', 'preexisting']])
  const legacyEntries = new Set<string>()
  const tx = {
    lockBusiness: async (businessId: string) => businessId === 'business-a' ? { businessId, timezone: null, dbNow: new Date(0) } : null,
    findUnlinkedAppointmentIds: async (businessId: string, afterId: string | null, limit: number) => businessId === 'business-a'
      ? [...groups.keys()].filter((id) => id > (afterId ?? '') && !links.has(id)).sort().slice(0, limit)
      : [],
    loadAppointmentBackfillGroup: async (_businessId: string, appointmentId: string) => groups.get(appointmentId) ?? [],
    ensureAppointmentAccount: async (input: { id: string; businessId: string; pricingMode: string; agreedAmount: number | null }) => {
      const created = !accounts.has(input.id)
      if (created) accounts.set(input.id, input)
      return { account: accounts.get(input.id)!, created }
    },
    ensureAppointmentAccountLink: async (input: { appointmentId: string; accountId: string }) => {
      const prior = links.get(input.appointmentId)
      if (prior && prior !== input.accountId) return { linked: false, created: false }
      links.set(input.appointmentId, input.accountId)
      return { linked: true, created: prior === undefined }
    },
    ensureLegacyPayment: async (input: { appointmentId: string }) => {
      const created = !legacyEntries.has(input.appointmentId)
      legacyEntries.add(input.appointmentId)
      return created
    },
    resolveAppointmentAccount: async (businessId: string, appointmentId: string) => {
      const account = accounts.get(links.get(appointmentId) ?? '')
      return account?.businessId === businessId ? account : null
    }
  }
  const fakeRepository = { transaction: <T>(work: (repository: typeof tx) => Promise<T>) => work(tx) }
  const localService = new CashService(fakeRepository as never)
  const first = await localService.backfillAppointmentAccounts({ businessId: 'business-a', batchSize: 20 })
  assert.deepEqual({ accounts: first.accountsCreated, links: first.linksCreated, legacy: first.legacyEntriesCreated }, { accounts: 3, links: 4, legacy: 1 })
  assert.equal(first.conflicts.some((conflict) => conflict.code === 'APPOINTMENT_LINK_CONFLICT'), true)
  assert.equal(links.has('conflict-1'), false, 'un grupo conflictivo no debe quedar parcialmente enlazado')
  const replay = await localService.backfillAppointmentAccounts({ businessId: 'business-a', batchSize: 20 })
  assert.deepEqual({ accounts: replay.accountsCreated, links: replay.linksCreated, legacy: replay.legacyEntriesCreated }, { accounts: 0, links: 0, legacy: 0 })
  assert.equal((await localService.resolveAppointmentAccount({ businessId: 'business-a', appointmentId: 'web-1' }))?.id, (await localService.resolveAppointmentAccount({ businessId: 'business-a', appointmentId: 'web-2' }))?.id)
  assert.equal(await localService.resolveAppointmentAccount({ businessId: 'business-b', appointmentId: 'simple' }), null)
}

async function seedPg() {
  const group = `group_${suffix}`
  const badGroup = `bad_${suffix}`
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.businessA}, ${`BF-A-${suffix}`}, 'Backfill A'), (${ids.businessB}, ${`BF-B-${suffix}`}, 'Backfill B')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professionalA}, ${ids.businessA}, 'A'), (${ids.professionalB}, ${ids.businessB}, 'B')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone") VALUES (${ids.customerA}, ${ids.businessA}, 'A', ${`1${suffix}`}), (${ids.customerB}, ${ids.businessB}, 'B', ${`2${suffix}`})`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Service" ("id", "businessId", "name", "duration", "price", "priceMode") VALUES
      (${ids.fixedServiceA}, ${ids.businessA}, 'Fijo', 30, 10000, 'FIXED'::"ServicePriceMode"),
      (${ids.estimatedServiceA}, ${ids.businessA}, 'Desde', 30, 20000, 'STARTING_AT'::"ServicePriceMode"),
      (${ids.fixedServiceB}, ${ids.businessB}, 'Fijo B', 30, 10000, 'FIXED'::"ServicePriceMode")
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "definition", "updatedAt")
    VALUES (${ids.configuration}, ${ids.businessA}, ${`cash-backfill-${suffix}`}, 'Backfill', 'v1', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "updatedAt")
    VALUES (${ids.deployment}, ${ids.businessA}, 'deterministic-options', clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt")
    VALUES (${ids.botSession}, ${ids.businessA}, ${ids.deployment}, 0, 'UTC', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "scheduledStartAt", "totalDurationMinutes", "totalPrice", "updatedAt")
    VALUES (${ids.visit}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.botSession}, clock_timestamp(), 30, 30000, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Appointment" ("id", "businessId", "customerId", "professionalId", "serviceId", "startAt", "origin", "quotedPrice", "manualDepositPaid", "manualDepositAmount", "totalDurationMinutes", "coordinationGroupId") VALUES
      (${ids.simple}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", 10000, false, NULL, 30, NULL),
      (${ids.web1}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 10000, false, NULL, 30, ${group}),
      (${ids.web2}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.estimatedServiceA}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 20000, false, NULL, 30, ${group}),
      (${ids.legacy}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", 50000, true, 5000, 30, NULL),
      (${ids.badWeb}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 10000, false, NULL, 30, ${badGroup}),
      (${ids.badManual}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'MANUAL'::"AppointmentOrigin", 10000, false, NULL, 30, ${badGroup}),
      (${ids.foreign}, ${ids.businessB}, ${ids.customerB}, ${ids.professionalB}, ${ids.fixedServiceB}, clock_timestamp(), 'WEB'::"AppointmentOrigin", 10000, false, NULL, 30, ${group})
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Appointment" ("id", "businessId", "customerId", "professionalId", "serviceId", "startAt", "origin", "quotedPrice", "totalDurationMinutes", "visitId")
    VALUES (${ids.visitAppointment}, ${ids.businessA}, ${ids.customerA}, ${ids.professionalA}, ${ids.fixedServiceA}, clock_timestamp(), 'BOT'::"AppointmentOrigin", 10000, 30, ${ids.visit})
  `)
}

async function cleanupPg() {
  const businessIds = [ids.businessA, ids.businessB]
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashEntry" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRawUnsafe('ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger"').catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentAccountLink" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentAccount" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${Prisma.join(businessIds)})`).catch(() => undefined)
}
