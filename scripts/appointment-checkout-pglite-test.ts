import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { PrismaCashRepository } from '../src/repositories/prisma-cash-repository.js'
import { CashService, CashServiceError } from '../src/services/cash-service.js'

// Offline PostgreSQL execution of the production CashService, SQL, and migration.
// PGlite is one connection: replay and rollback are covered; cross-process lock
// contention remains a separate PostgreSQL integration check.
const db = new PGlite({ parsers: { 1114: value => new Date(value + 'Z') } })
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const enumNames = [...schema.matchAll(/^enum (\w+) \{/gm)].map(match => match[1]!)
for (const name of enumNames) {
  const body = schema.match(new RegExp('enum ' + name + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const values = body.split('\n').flatMap(line => line.match(/@map\("([^"]+)"\)/)?.[1] ?? line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
  await db.exec('CREATE TYPE "' + name + '" AS ENUM (' + values.map(value => "'" + value + "'").join(',') + ')')
}
const models = ['Business', 'User', 'Professional', 'Service', 'ProfessionalService', 'Appointment', 'AppointmentServiceItem', 'AppointmentAccount', 'AppointmentAccountLink', 'AppointmentTotalAdjustment', 'BookingVisit', 'BotOperation', 'BookingDeposit', 'AppointmentServiceCorrection', 'ProductSale', 'CashRegisterDay', 'CashSession', 'BusinessPaymentMethod', 'CashEntry', 'ProfessionalAccountEntry', 'BenefitUse']
for (const name of models) {
  const body = schema.match(new RegExp('model ' + name + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns = body.split('\n').flatMap(line => {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!field || /\[\]/.test(line)) return []
    const scalar = ({ String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamptz', Json: 'jsonb', Decimal: 'numeric', BigInt: 'bigint', Float: 'double precision', Bytes: 'bytea' } as Record<string, string>)[field[2]!]
    const type = scalar ?? (enumNames.includes(field[2]!) ? '"' + field[2] + '"' : null)
    const literal = line.match(/@default\((true|false|[0-9]+|[A-Z_]+|"[^"]*")\)/)?.[1]
    const defaultSql = literal ? (/^(true|false|[0-9]+)$/.test(literal) ? literal : "'" + literal.replace(/^"|"$/g, '').replace(/'/g, "''") + "'") : null
    return type ? ['"' + (line.match(/@map\("([^"]+)"\)/)?.[1] ?? field[1]) + '" ' + type + (field[1] === 'id' ? ' PRIMARY KEY' : '') + (['createdAt', 'updatedAt'].includes(field[1]!) ? ' DEFAULT clock_timestamp()' : defaultSql ? ' DEFAULT ' + defaultSql : '')] : []
  })
  await db.exec('CREATE TABLE "' + name + '" (' + columns.join(',') + ')')
}
await db.exec(`CREATE UNIQUE INDEX service_tenant ON "Service" ("businessId", id);
  CREATE UNIQUE INDEX appointment_tenant ON "Appointment" ("businessId", id);
  CREATE UNIQUE INDEX cash_entry_tenant ON "CashEntry" ("businessId", id);
  CREATE UNIQUE INDEX earning_appointment ON "ProfessionalAccountEntry" ("businessId", "appointmentId");`)
await db.exec(readFileSync(new URL('../prisma/migrations/20261124010000_add_appointment_mutation_requests/migration.sql', import.meta.url), 'utf8'))
// Execute the existing financial guards verbatim, not permissive replacements.
const totalAuditMigration = readFileSync(new URL('../prisma/migrations/20260919170000_add_appointment_total_adjustments/migration.sql', import.meta.url), 'utf8')
await db.exec(totalAuditMigration.slice(totalAuditMigration.indexOf('CREATE FUNCTION "cash_account_require_total_adjustment_audit"')))
const ledgerMigration = readFileSync(new URL('../prisma/migrations/20260906120000_add_cash_financial_ledger/migration.sql', import.meta.url), 'utf8')
await db.exec(ledgerMigration.slice(ledgerMigration.indexOf('CREATE FUNCTION "cash_entry_validate_reversal"'), ledgerMigration.lastIndexOf('COMMIT;')))

let failStatement: ((sql: string) => boolean) | undefined
let mutationStatements = 0
function adapter(pg: Pick<PGlite, 'query'>): Prisma.TransactionClient {
  let affectedRows = 0
  const query = async (sql: Prisma.Sql, readRows: boolean) => {
    if (/^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql.text)) mutationStatements += 1
    if (failStatement?.(sql.text)) throw new Error('injected payment rollback')
    const result = await pg.query(sql.text, sql.values.map(value => value instanceof Date ? value.toISOString() : value))
    if (readRows) {
      // Prisma's PostgreSQL adapter cannot deserialize a result column of type void (OID 2278).
      assert.ok(result.fields.every(field => field.dataTypeID !== 2278), '$queryRaw must select only types Prisma can deserialize')
    }
    affectedRows = result.affectedRows ?? result.rows.length
    return result.rows
  }
  return {
    $queryRaw: (sql: Prisma.Sql) => query(sql, true),
    $executeRaw: async (sql: Prisma.Sql) => { await query(sql, false); return affectedRows },
    appointmentServiceItem: {
      deleteMany: async ({ where }: { where: { appointmentId: string } }) => pg.query('DELETE FROM "AppointmentServiceItem" WHERE "appointmentId"=$1', [where.appointmentId]),
      create: async ({ data }: { data: { appointmentId: string; serviceId: string; sortOrder: number; durationMinutes: number; price: number } }) => pg.query('INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId","sortOrder","durationMinutes",price) VALUES ($1,$2,$3,$4,$5)', [data.appointmentId, data.serviceId, data.sortOrder, data.durationMinutes, data.price])
    }
  } as unknown as Prisma.TransactionClient
}
const runner = { $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.transaction(pg => work(adapter(pg))) }

const service = new CashService(new PrismaCashRepository(runner as never))
await db.exec(`INSERT INTO "Business" (id,name,timezone) VALUES ('b','Local','UTC'),('other','Other','UTC');
  INSERT INTO "User" (id,"businessId",name,role,"isActive","professionalId","agendaScope","canRecordAppointmentPayments","canCompleteAppointments") VALUES
    ('admin','b','Admin','BUSINESS_ADMIN',true,NULL,'ALL',false,false),
    ('staff','b','Staff','STAFF',true,'p','OWN',true,true),
    ('other-admin','other','Other','BUSINESS_ADMIN',true,NULL,'ALL',false,false);
  INSERT INTO "Professional" (id,"businessId",name,"commissionMode","commissionPercentage") VALUES ('p','b','One','PERCENTAGE',50), ('p2','b','Two','NONE',NULL);
  INSERT INTO "Service" (id,"businessId",name,duration,price,"priceMode","isActive") VALUES ('s','b','Servicio',30,30000,'FIXED',true);
  INSERT INTO "ProfessionalService" (id,"professionalId","serviceId") VALUES ('ps','p','s');
  INSERT INTO "CashRegisterDay" (id,"businessId","openedAt","openingCash") VALUES ('day','b',clock_timestamp() - interval '1 day',0);
  INSERT INTO "CashSession" (id,"businessId","registerDayId","openedAt","responsibleUserId","responsibleName") VALUES ('session','b','day',clock_timestamp() - interval '1 day','admin','Admin');
  INSERT INTO "BusinessPaymentMethod" (id,"businessId",name,kind,"isActive") VALUES ('cash','b','Efectivo','CASH',true),('card','b','Tarjeta','CARD',true);`)
async function seed(id: string, linked = true, professional = 'p') {
  await db.query(`INSERT INTO "Appointment" (id,"businessId","professionalId","serviceId",status,"startAt","quotedPrice","totalDurationMinutes",origin) VALUES ($1,'b',$2,'s','CONFIRMED','2026-01-01T12:00:00Z',30000,30,'MANUAL')`, [id, professional])
  if (linked) {
    await db.query(`INSERT INTO "AppointmentAccount" (id,"businessId","pricingMode","agreedAmount","originalAmount","minimumAmount","discountAmount") VALUES ($1,'b','FIXED',30000,30000,0,0)`, ['account-' + id])
    await db.query(`INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('b',$1,$2)`, [id, 'account-' + id])
  }
}
const code = (expected: string) => (error: any) => error.code === expected
const counts = async () => (await db.query(`SELECT (SELECT count(*)::int FROM "CashEntry") entries, (SELECT count(*)::int FROM "AppointmentMutationRequest") requests, (SELECT count(*)::int FROM "ProfessionalAccountEntry") earnings`)).rows[0]
const input = (id: string, key: string) => ({ businessId: 'b', appointmentId: id, actorUserId: 'admin', actorName: 'Admin', cashSessionId: 'session', origin: 'AGENDA' as const, requestId: key, expectedBalance: 30000, lines: [{ amount: 5000, method: 'CASH' as const, paymentMethodId: 'cash' }] })
try {
  await seed('visible', false)
  await seed('outside', false, 'p2')
  await db.exec(`UPDATE "Appointment" SET "coordinationGroupId"='manual-group' WHERE id IN ('visible','outside'); UPDATE "Appointment" SET "startAt"='2027-01-01T12:00:00Z' WHERE id='outside'`)
  mutationStatements = 0
  const summary = await service.getAppointmentFinanceSummary({ businessId: 'b', appointmentId: 'visible' })
  assert.equal(summary.accountId, null)
  assert.equal(summary.agreedAmount, 60000)
  assert.deepEqual(summary.appointmentIds, ['outside','visible'])
  assert.equal(mutationStatements, 0, 'viewing a coordinated visit must not initialize links/accounts/deposits')
  const own = await service.getAppointmentFinanceSummary({ businessId: 'b', appointmentId: 'visible', allowedProfessionalId: 'p' })
  assert.deepEqual(own.appointmentIds, ['visible'])
  assert.equal(own.balanceAmount, 60000)
  assert.equal((await db.query(`SELECT count(*)::int n FROM "AppointmentAccount"`)).rows[0]!.n, 0)
  assert.equal((await db.query(`SELECT count(*)::int n FROM "CashEntry"`)).rows[0]!.n, 0)
  await seed('partial')
  const partial = input('partial','partial-key')
  const first = await service.recordAppointmentPayment(partial)
  assert.equal(first.finance.balanceAmount, 25000)
  await db.exec(`UPDATE "CashSession" SET "closedAt"=clock_timestamp(); UPDATE "CashRegisterDay" SET "closedAt"=clock_timestamp()`)
  const replay = await service.recordAppointmentPayment(partial)
  assert.equal((replay as any).replayed, true)
  assert.deepEqual(replay.entries, first.entries)
  assert.deepEqual(await counts(), { entries: 1, requests: 1, earnings: 0 })
  mutationStatements = 0
  await assert.rejects(() => service.recordAppointmentPayment({ ...partial, lines: [{ amount: 6000, method: 'CASH' }] }), code('APPOINTMENT_REQUEST_CONFLICT'))
  await assert.rejects(() => service.recordAppointmentPayment({ ...partial, appointmentId: 'visible' }), code('APPOINTMENT_REQUEST_CONFLICT'))
  await assert.rejects(() => service.recordAppointmentPayment({ ...partial, actorUserId: 'staff' }), code('APPOINTMENT_REQUEST_CONFLICT'))
  await assert.rejects(() => service.recordAppointmentPayment({ ...partial, businessId: 'other', actorUserId: 'other-admin' }), code('APPOINTMENT_ACCOUNT_NOT_FOUND'))
  assert.equal(mutationStatements, 0, 'conflicting actor/tenant/payload attempts must not write')
  await db.exec(`UPDATE "CashRegisterDay" SET "closedAt"=NULL; UPDATE "CashSession" SET "closedAt"=NULL`)
  await assert.rejects(() => service.recordAppointmentPayment({ ...partial, requestId: 'stale-key' }), code('APPOINTMENT_BALANCE_CHANGED'))
  await seed('complete')
  const complete = { ...input('complete','complete-key'), completeAppointment: true, lines: [{ amount: 10000, method: 'CASH' as const, paymentMethodId: 'cash' }, { amount: 20000, method: 'CARD' as const, paymentMethodId: 'card' }] }
  const completed = await service.recordAppointmentPayment(complete)
  assert.equal(completed.completion?.status, 'COMPLETED')
  const completedCounts = await counts()
  await service.recordAppointmentPayment(complete)
  assert.deepEqual(await counts(), completedCounts, 'mixed replay must not repeat payment or professional compensation')
  assert.equal((await db.query(`SELECT count(*)::int n FROM "ProfessionalAccountEntry" WHERE "appointmentId"='complete'`)).rows[0]!.n, 1)
  await seed('rollback')
  const beforeFailure = await counts()
  failStatement = sql => sql.includes('INSERT INTO "AppointmentMutationRequest"')
  await assert.rejects(() => service.recordAppointmentPayment({ ...complete, appointmentId: 'rollback', requestId: 'rollback-key' }), /injected payment rollback/)
  failStatement = undefined
  assert.deepEqual(await counts(), beforeFailure)
  assert.equal((await db.query(`SELECT status FROM "Appointment" WHERE id='rollback'`)).rows[0]!.status, 'CONFIRMED')
  await seed('staff-turn')
  const staffPay = { ...input('staff-turn','staff-key'), actorUserId: 'staff', actorName: 'Staff', allowedProfessionalId: 'p' }
  await service.recordAppointmentPayment(staffPay)
  await db.exec(`UPDATE "User" SET "canRecordAppointmentPayments"=false WHERE id='staff'`)
  await assert.rejects(() => service.recordAppointmentPayment(staffPay), code('CASH_PERMISSION_REQUIRED'))
  await db.exec(`UPDATE "User" SET "canRecordAppointmentPayments"=true,"professionalId"='p2' WHERE id='staff'`)
  await assert.rejects(() => service.recordAppointmentPayment(staffPay), code('CASH_PERMISSION_REQUIRED'))
  await db.exec(`UPDATE "User" SET "professionalId"='p',"isActive"=false WHERE id='staff'`)
  await assert.rejects(() => service.recordAppointmentPayment(staffPay), code('CASH_PERMISSION_REQUIRED'))
  await assert.rejects(() => db.query(`INSERT INTO "AppointmentMutationRequest" ("businessId","requestId",operation,"appointmentId","actorUserId","requestFingerprint",result) VALUES ('other','cross-tenant','PAYMENT','partial','admin',$1,'{}')`, ['a'.repeat(64)]), /foreign key/)
  const protection = (await db.query(`SELECT relrowsecurity, relacl::text acl FROM pg_class WHERE relname='AppointmentMutationRequest'`)).rows[0]!
  assert.equal(protection.relrowsecurity, true)
  assert.doesNotMatch(String(protection.acl), /(?:\{|,)=[^/]*/, 'migration grants no PUBLIC privileges; table owner retains server access')
  await db.exec(`CREATE ROLE checkout_client NOLOGIN; GRANT USAGE ON SCHEMA public TO checkout_client; GRANT SELECT ON "AppointmentMutationRequest" TO checkout_client; SET ROLE checkout_client;`)
  assert.equal((await db.query(`SELECT count(*)::int n FROM "AppointmentMutationRequest"`)).rows[0]!.n, 0, 'RLS has no public policies even if a client receives SELECT')
  await db.exec('RESET ROLE')
  console.log('appointment checkout PGlite: production summary/payment SQL, full group/OWN, replay after close, mixed+complete once, rollback, current permissions, tenant FK and server-only RLS OK; cross-process contention not simulated')
} finally { await db.close() }
