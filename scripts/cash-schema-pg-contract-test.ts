import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const schema = await readFile(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
const appointmentService = await readFile(path.join(process.cwd(), 'src', 'services', 'appointment-service.ts'), 'utf8')
const bookingOperations = await readFile(path.join(process.cwd(), 'src', 'services', 'booking-operations.ts'), 'utf8')
const migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations')
const cashMigrationNames = (await readdir(migrationsRoot)).filter((name) => name.endsWith('_add_cash_financial_ledger'))

assert.equal(cashMigrationNames.length, 1, 'debe existir exactamente una migración nueva de persistencia de Caja')
const migration = await readFile(path.join(migrationsRoot, cashMigrationNames[0]!, 'migration.sql'), 'utf8')

for (const model of ['CashRegisterDay', 'CashSession', 'AppointmentAccount', 'AppointmentAccountLink', 'CashEntry']) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Prisma debe declarar ${model}`)
  assert.match(migration, new RegExp(`CREATE TABLE "${model}"`), `la migración debe crear ${model}`)
}

for (const enumName of ['AppointmentPricingMode', 'CashEntryType', 'CashDirection', 'CashPaymentMethod', 'CashEntryOrigin']) {
  assert.match(schema, new RegExp(`enum ${enumName} \\{`), `Prisma debe declarar ${enumName}`)
  assert.match(migration, new RegExp(`CREATE TYPE "${enumName}" AS ENUM`), `la migración debe crear ${enumName}`)
}

for (const requiredSql of [
  'CashEntry_amount_positive_check',
  'CashEntry_shape_check',
  'CashEntry_reversal_consistency_trigger',
  'CashEntry_append_only_trigger',
  'CashRegisterDay_one_open_per_business',
  'CashSession_one_open_per_business',
  'CashEntry_bookingDepositId_key',
  'CashEntry_reversesEntryId_key',
  'AppointmentAccountLink_businessId_appointmentId_fkey',
  'CashSession_businessId_responsibleUserId_fkey'
]) {
  assert.ok(migration.includes(requiredSql), `falta invariante SQL ${requiredSql}`)
}

assert.match(migration, /ALTER TABLE "Appointment" ADD COLUMN "businessId" TEXT/)
assert.match(migration, /UPDATE "Appointment" AS appointment[\s\S]+FROM "Professional" AS professional/)
assert.match(migration, /ALTER COLUMN "businessId" SET NOT NULL/)
assert.equal((appointmentService.match(/createAppointmentRecord\(transaction, \{\s*data: \{\s*businessId:/g) ?? []).length, 2, 'ambos writers Prisma de Appointment deben persistir businessId validado')
assert.match(bookingOperations, /INSERT INTO "Appointment" \(\s*"id", "businessId", "customerId"[\s\S]*?\$\{appointmentId\}, \$\{input\.businessId\}, \$\{customerId\}/, 'el writer SQL de Booking debe persistir input.businessId validado')
assert.match(schema, /cashSession\s+CashSession\?\s+@relation\(fields: \[businessId, registerDayId, cashSessionId\], references: \[businessId, registerDayId, id\]/)
assert.match(migration, /FOREIGN KEY \("businessId", "registerDayId", "cashSessionId"\) REFERENCES "CashSession"\("businessId", "registerDayId", "id"\)/)
assert.ok(migration.includes('"origin" IN (\'AGENDA\'::"CashEntryOrigin", \'CASH_REGISTER\'::"CashEntryOrigin")'), 'PAYMENT manual debe distinguir sus orígenes')
assert.ok(migration.includes('"bookingDepositId" IS NULL AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL'), 'PAYMENT manual debe exigir sesión y excluir seña')
assert.ok(migration.includes('"origin" IN (\'WEB_DEPOSIT\'::"CashEntryOrigin", \'BOT_DEPOSIT\'::"CashEntryOrigin")'), 'PAYMENT de seña debe distinguir sus orígenes')
assert.ok(migration.includes('"bookingDepositId" IS NOT NULL AND "paymentMethod" = \'TRANSFER\'::"CashPaymentMethod"'), 'PAYMENT web/bot debe exigir seña y transferencia')
assert.ok(migration.includes('"origin" = \'MIGRATION\'::"CashEntryOrigin"'), 'LEGACY_PAYMENT debe provenir de migración')
assert.ok(migration.includes('"closedAt" IS NOT NULL AND "expectedClosingCash" IS NOT NULL'), 'el cierre de jornada debe exigir todos sus controles')
assert.ok(migration.includes('"closedAt" IS NOT NULL AND "expectedCash" IS NOT NULL'), 'el cierre de sesión debe exigir todos sus controles')

const connectionString = process.env.TEST_DATABASE_URL?.trim()
if (!connectionString) {
  console.log('OK Caja schema static: modelos, enums, tenant FKs, CHECKs, únicos parciales, append-only e idempotencia declarados. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}

const databaseUrl = new URL(connectionString)
if (!/(^|[_-])test($|[_-])/i.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Refusing unsafe Caja contract database: TEST_DATABASE_URL debe apuntar a una base de prueba')
}

const [{ createPrismaClient }, { Prisma }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js')
])
const prisma = createPrismaClient({ connectionString, max: 4, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000 })
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  businessA: `cash_ba_${suffix}`,
  businessB: `cash_bb_${suffix}`,
  userA: `cash_ua_${suffix}`,
  userB: `cash_ub_${suffix}`,
  day: `cash_day_${suffix}`,
  otherDay: `cash_other_day_${suffix}`,
  session: `cash_session_${suffix}`,
  account: `cash_account_${suffix}`,
  payment: `cash_payment_${suffix}`,
  reversal: `cash_reversal_${suffix}`
}

try {
  await assertCatalog()
  await seed()
  await assertTenantForeignKeys()
  await assertChecks()
  await assertPartialUniques()
  await assertAppendOnlyAndReversalIdempotency()
  console.log('OK Caja schema PG: tenant, CHECKs, FKs compuestas, únicos parciales, append-only e idempotencia.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function assertCatalog() {
  const rows = await prisma.$queryRaw<Array<{ tables: bigint; compositeFks: bigint; partialIndexes: bigint; triggers: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM pg_class WHERE relname IN ('CashRegisterDay', 'CashSession', 'AppointmentAccount', 'AppointmentAccountLink', 'CashEntry') AND relkind = 'r') AS tables,
      (SELECT count(*) FROM pg_constraint WHERE conname IN ('AppointmentAccountLink_businessId_accountId_fkey', 'AppointmentAccountLink_businessId_appointmentId_fkey', 'CashSession_businessId_responsibleUserId_fkey', 'CashEntry_businessId_accountId_fkey', 'CashEntry_businessId_registerDayId_cashSessionId_fkey')) AS "compositeFks",
      (SELECT count(*) FROM pg_indexes WHERE indexname IN ('CashRegisterDay_one_open_per_business', 'CashSession_one_open_per_business') AND indexdef LIKE '%WHERE%') AS "partialIndexes",
      (SELECT count(*) FROM pg_trigger WHERE tgname IN ('CashEntry_append_only_trigger', 'CashEntry_reversal_consistency_trigger') AND NOT tgisinternal) AS triggers
  `)
  assert.deepEqual(rows[0], { tables: 5n, compositeFks: 5n, partialIndexes: 2n, triggers: 2n })
}

async function seed() {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name") VALUES
      (${ids.businessA}, ${`CASH-A-${suffix}`}, 'Caja A'),
      (${ids.businessB}, ${`CASH-B-${suffix}`}, 'Caja B')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "User" ("id", "email", "name", "passwordHash", "businessId", "updatedAt") VALUES
      (${ids.userA}, ${`cash-a-${suffix}@example.test`}, 'Responsable A', 'contract', ${ids.businessA}, clock_timestamp()),
      (${ids.userB}, ${`cash-b-${suffix}@example.test`}, 'Responsable B', 'contract', ${ids.businessB}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashRegisterDay" ("id", "businessId", "openingCash") VALUES (${ids.day}, ${ids.businessA}, 1000)
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashRegisterDay" ("id", "businessId", "openedAt", "closedAt", "openingCash", "expectedClosingCash", "countedClosingCash", "closingDifference")
    VALUES (${ids.otherDay}, ${ids.businessA}, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour', 0, 0, 0, 0)
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashSession" ("id", "businessId", "registerDayId", "responsibleUserId", "responsibleName")
    VALUES (${ids.session}, ${ids.businessA}, ${ids.day}, ${ids.userA}, 'Responsable A')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AppointmentAccount" ("id", "businessId", "pricingMode", "agreedAmount", "updatedAt")
    VALUES (${ids.account}, ${ids.businessA}, 'FIXED'::"AppointmentPricingMode", 1000, clock_timestamp())
  `)
}

async function assertTenantForeignKeys() {
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashSession" ("id", "businessId", "registerDayId", "responsibleUserId", "responsibleName")
    VALUES (${`cash_wrong_${suffix}`}, ${ids.businessA}, ${ids.day}, ${ids.userB}, 'Ajeno')
  `), /foreign key|violates/i)
}

async function assertChecks() {
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_manual_closed_${suffix}`}, ${ids.businessA}, ${ids.account}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 10, 'CASH'::"CashPaymentMethod", 'AGENDA'::"CashEntryOrigin")
  `), /CashEntry_shape_check|check constraint/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_deposit_missing_${suffix}`}, ${ids.businessA}, ${ids.account}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 10, 'TRANSFER'::"CashPaymentMethod", 'WEB_DEPOSIT'::"CashEntryOrigin")
  `), /CashEntry_shape_check|check constraint/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_legacy_origin_${suffix}`}, ${ids.businessA}, ${ids.account}, 'LEGACY_PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 10, 'UNSPECIFIED'::"CashPaymentMethod", 'AGENDA'::"CashEntryOrigin")
  `), /CashEntry_shape_check|check constraint/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_wrong_day_${suffix}`}, ${ids.businessA}, ${ids.account}, ${ids.otherDay}, ${ids.session}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 10, 'CASH'::"CashPaymentMethod", 'AGENDA'::"CashEntryOrigin")
  `), /CashEntry_businessId_registerDayId_cashSessionId_fkey|foreign key/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_zero_${suffix}`}, ${ids.businessA}, ${ids.account}, ${ids.day}, ${ids.session}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 0, 'CASH'::"CashPaymentMethod", 'AGENDA'::"CashEntryOrigin")
  `), /CashEntry_amount_positive_check|check constraint/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${`cash_withdraw_${suffix}`}, ${ids.businessA}, ${ids.day}, ${ids.session}, 'WITHDRAWAL'::"CashEntryType", 'OUTFLOW'::"CashDirection", 10, 'TRANSFER'::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin")
  `), /CashEntry_shape_check|check constraint/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    UPDATE "CashSession" SET "closedAt" = clock_timestamp() WHERE "id" = ${ids.session}
  `), /CashSession_control_check|check constraint/i)
}

async function assertPartialUniques() {
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashRegisterDay" ("id", "businessId", "openingCash") VALUES (${`cash_day_2_${suffix}`}, ${ids.businessA}, 0)
  `), /CashRegisterDay_one_open_per_business|unique/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashSession" ("id", "businessId", "registerDayId", "responsibleUserId", "responsibleName")
    VALUES (${`cash_session_2_${suffix}`}, ${ids.businessA}, ${ids.day}, ${ids.userA}, 'Responsable A')
  `), /CashSession_one_open_per_business|unique/i)
}

async function assertAppendOnlyAndReversalIdempotency() {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin")
    VALUES (${ids.payment}, ${ids.businessA}, ${ids.account}, ${ids.day}, ${ids.session}, 'PAYMENT'::"CashEntryType", 'INFLOW'::"CashDirection", 100, 'CASH'::"CashPaymentMethod", 'AGENDA'::"CashEntryOrigin")
  `)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`UPDATE "CashEntry" SET "amount" = 50 WHERE "id" = ${ids.payment}`), /append-only/i)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`DELETE FROM "CashEntry" WHERE "id" = ${ids.payment}`), /append-only/i)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin", "reversesEntryId")
    VALUES (${ids.reversal}, ${ids.businessA}, ${ids.account}, ${ids.day}, ${ids.session}, 'REVERSAL'::"CashEntryType", 'OUTFLOW'::"CashDirection", 100, 'CASH'::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin", ${ids.payment})
  `)
  await assert.rejects(() => prisma.$executeRaw(Prisma.sql`
    INSERT INTO "CashEntry" ("id", "businessId", "accountId", "registerDayId", "cashSessionId", "type", "direction", "amount", "paymentMethod", "origin", "reversesEntryId")
    VALUES (${`cash_reversal_2_${suffix}`}, ${ids.businessA}, ${ids.account}, ${ids.day}, ${ids.session}, 'REVERSAL'::"CashEntryType", 'OUTFLOW'::"CashDirection", 100, 'CASH'::"CashPaymentMethod", 'CASH_REGISTER'::"CashEntryOrigin", ${ids.payment})
  `), /CashEntry_reversesEntryId_key|unique/i)
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger"`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashEntry" WHERE "businessId" IN (${ids.businessA}, ${ids.businessB})`).catch(() => undefined)
  await prisma.$executeRawUnsafe(`ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger"`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashSession" WHERE "businessId" IN (${ids.businessA}, ${ids.businessB})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "CashRegisterDay" WHERE "businessId" IN (${ids.businessA}, ${ids.businessB})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentAccount" WHERE "businessId" IN (${ids.businessA}, ${ids.businessB})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "id" IN (${ids.userA}, ${ids.userB})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${ids.businessA}, ${ids.businessB})`).catch(() => undefined)
}
