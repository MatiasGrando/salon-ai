import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { PrismaCashRepository } from '../src/repositories/prisma-cash-repository.js'
import { CashService, CashServiceError } from '../src/services/cash-service.js'

// Offline PostgreSQL execution of the production CashService and repository.
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
const models = ['Business', 'User', 'Professional', 'Service', 'ProfessionalService', 'Appointment', 'AppointmentServiceItem', 'AppointmentAccount', 'AppointmentAccountLink', 'AppointmentTotalAdjustment', 'ProductSale', 'CashRegisterDay', 'CashSession', 'BusinessPaymentMethod', 'CashEntry', 'ProfessionalAccountEntry']
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
await db.exec(readFileSync(new URL('../prisma/migrations/20261015010000_add_completed_service_corrections/migration.sql', import.meta.url), 'utf8'))
// Execute the existing financial guards verbatim, not permissive replacements.
const totalAuditMigration = readFileSync(new URL('../prisma/migrations/20260919170000_add_appointment_total_adjustments/migration.sql', import.meta.url), 'utf8')
await db.exec(totalAuditMigration.slice(totalAuditMigration.indexOf('CREATE FUNCTION "cash_account_require_total_adjustment_audit"')))
const ledgerMigration = readFileSync(new URL('../prisma/migrations/20260906120000_add_cash_financial_ledger/migration.sql', import.meta.url), 'utf8')
await db.exec(ledgerMigration.slice(ledgerMigration.indexOf('CREATE FUNCTION "cash_entry_validate_reversal"'), ledgerMigration.lastIndexOf('COMMIT;')))

let failStatement: ((sql: string) => boolean) | undefined
let mutationStatements = 0
function adapter(pg: Pick<PGlite, 'query'>): Prisma.TransactionClient {
  let affectedRows = 0
  const query = async (sql: Prisma.Sql) => {
    if (sql.text.includes('pg_advisory_xact_lock')) return [{ locked: 1 }]
    if (/^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql.text)) mutationStatements += 1
    if (failStatement?.(sql.text)) throw new Error('injected correction rollback')
    const result = await pg.query(sql.text, sql.values.map(value => value instanceof Date ? value.toISOString() : value))
    affectedRows = result.affectedRows ?? result.rows.length
    return result.rows
  }
  return {
    $queryRaw: query, $executeRaw: async (sql: Prisma.Sql) => { await query(sql); return affectedRows },
    appointmentServiceItem: {
      deleteMany: async ({ where }: { where: { appointmentId: string } }) => pg.query('DELETE FROM "AppointmentServiceItem" WHERE "appointmentId"=$1', [where.appointmentId]),
      create: async ({ data }: { data: { appointmentId: string; serviceId: string; sortOrder: number; durationMinutes: number; price: number } }) => pg.query('INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId","sortOrder","durationMinutes",price) VALUES ($1,$2,$3,$4,$5)', [data.appointmentId, data.serviceId, data.sortOrder, data.durationMinutes, data.price])
    }
  } as unknown as Prisma.TransactionClient
}
const runner = { $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.transaction(pg => work(adapter(pg))) }
const service = new CashService(new PrismaCashRepository(runner as never))
await db.exec(`INSERT INTO "Business" (id, name, timezone) VALUES ('b', 'Local', 'UTC'), ('other', 'Otro', 'UTC');
  INSERT INTO "User" (id, "businessId", name, role, "isActive") VALUES ('admin', 'b', 'Admin', 'BUSINESS_ADMIN', true), ('staff', 'b', 'Staff', 'STAFF', true), ('other-admin', 'other', 'Other', 'BUSINESS_ADMIN', true);
  INSERT INTO "User" (id, name, role, "isActive") VALUES ('super', 'Super', 'SUPER_ADMIN', true), ('account', 'Cuenta', 'ACCOUNT_ADMIN', true), ('other-account', 'Otra cuenta', 'ACCOUNT_ADMIN', true), ('inactive-super', 'Inactivo', 'SUPER_ADMIN', false);
  UPDATE "Business" SET "accountAdminId" = 'account' WHERE id = 'b';
  INSERT INTO "Professional" (id, "businessId", name, "commissionMode", "commissionPercentage") VALUES ('p', 'b', 'Profesional', 'PERCENTAGE', 50);
  INSERT INTO "Service" (id, "businessId", name, duration, price, "priceMode", "isActive") VALUES
    ('a', 'b', 'Servicio A', 40, 40000, 'FIXED', true), ('b', 'b', 'Servicio B', 20, 20000, 'FIXED', true),
    ('expensive', 'b', 'Servicio C', 60, 60000, 'FIXED', true), ('foreign', 'other', 'Ajeno', 20, 20000, 'FIXED', true),
    ('unassigned', 'b', 'Sin profesional', 20, 20000, 'FIXED', true), ('estimated', 'b', 'Desde', 20, 10000, 'STARTING_AT', true);
  INSERT INTO "ProfessionalService" (id, "professionalId", "serviceId", "commissionMode", "commissionPercentage") VALUES
    ('pa', 'p', 'a', NULL, NULL), ('pb', 'p', 'b', 'PERCENTAGE', 25), ('pc', 'p', 'expensive', NULL, NULL), ('pe', 'p', 'estimated', NULL, NULL);
  INSERT INTO "CashRegisterDay" (id, "businessId", "openedAt", "openingCash") VALUES ('day', 'b', clock_timestamp(), 0);
  INSERT INTO "CashSession" (id, "businessId", "registerDayId", "openedAt", "responsibleUserId", "responsibleName") VALUES ('session', 'b', 'day', clock_timestamp(), 'admin', 'Admin');
  INSERT INTO "BusinessPaymentMethod" (id, "businessId", name, kind, "isActive") VALUES ('cash', 'b', 'Efectivo', 'CASH', true);`)

async function seed(id: string, options: { products?: number; discount?: number; shared?: boolean; status?: string } = {}) {
  const products = options.products ?? 0
  const discount = options.discount ?? 0
  await db.query(`INSERT INTO "Appointment" (id,"businessId","professionalId","serviceId",status,"startAt","quotedPrice","totalDurationMinutes","completedAt","completedByUserId","completedByName") VALUES ($1,'b','p','a',$2,'2026-10-14T12:00:00Z',40000,40,'2026-10-14T13:00:00Z','staff','Staff')`, [id, options.status ?? 'COMPLETED'])
  await db.query(`INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId","sortOrder","durationMinutes",price) VALUES ($1,'a',0,40,40000)`, [id])
  await db.query(`INSERT INTO "AppointmentAccount" (id,"businessId","pricingMode","agreedAmount","originalAmount","minimumAmount","discountAmount") VALUES ($1,'b','FIXED',$2,$2,0,$3)`, ['account-' + id, 40000 + products, discount])
  await db.query(`INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('b',$1,$2)`, [id, 'account-' + id])
  if (options.shared) await db.query(`INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('b','another',$1)`, ['account-' + id])
  if (products) await db.query(`INSERT INTO "ProductSale" (id,"businessId","appointmentId","actorName",status,"serviceSubtotal","productSubtotal","discountAmount",total) VALUES ($1,'b',$2,'Staff','COMPLETED',40000,$3,$4,$5)`, ['sale-' + id, id, products, discount, 40000 + products - discount])
  await db.query(`INSERT INTO "CashEntry" (id,"businessId","accountId","registerDayId","cashSessionId",type,direction,amount,"paymentMethod",origin,"effectiveAt") VALUES ($1,'b',$2,'day','session','PAYMENT','INFLOW',$3,'CASH','AGENDA','2026-10-14T13:00:00Z')`, ['payment-' + id, 'account-' + id, 40000 + products - discount])
  await db.query(`INSERT INTO "ProfessionalAccountEntry" (id,"businessId","professionalId","appointmentId",type,direction,amount,"baseAmount","ruleMode","rulePercentage","actorUserId","actorName","effectiveAt") VALUES ($1,'b','p',$2,'EARNING','CREDIT',20000,40000,'PERCENTAGE',50,'staff','Staff','2026-10-14T13:00:00Z')`, ['earning-' + id, id])
  await db.query(`INSERT INTO "ProfessionalAccountEntry" (id,"businessId","professionalId",type,direction,amount,"actorUserId","actorName","effectiveAt") VALUES ($1,'b','p','PAYMENT','DEBIT',20000,'staff','Staff','2026-10-14T14:00:00Z')`, ['settled-' + id])
}
const input = (appointmentId: string, extras = {}) => ({ businessId: 'b', appointmentId, serviceId: 'b', expectedServiceId: 'a', requestId: 'request-' + appointmentId, reason: 'Se cargó el servicio incorrecto', actorUserId: 'admin', actorName: 'Admin', cashSessionId: 'session', paymentMethodId: 'cash', expectedServicePrice: 20000, expectedAgreedAmount: 40000, expectedPaidAmount: 40000, expectedDiscountAmount: 0, expectedProductSubtotal: 0, ...extras })
const rows = async (table: string, column: string, id: string) => (await db.query<Record<string, any>>('SELECT * FROM "' + table + '" WHERE "' + column + '"=$1', [id])).rows
const rejectsCode = async (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => error instanceof CashServiceError && error.code === code)

try {
  // A behavioral RED: incomplete correction code must reject a staff actor
  // before touching any finance row; this is independent of UI/regex checks.
  await seed('denied')
  mutationStatements = 0
  const denial = await service.correctCompletedAppointmentService(input('denied', { actorUserId: 'staff' })).catch(error => error)
  assert.equal(mutationStatements, 0, 'un staff debe rechazarse antes de intentar modificar cuenta, turno o caja')
  assert.equal(denial.code, 'BUSINESS_ADMIN_REQUIRED')
  await rejectsCode(() => service.correctCompletedAppointmentService(input('denied', { actorUserId: 'other-admin' })), 'BUSINESS_ADMIN_REQUIRED')
  assert.equal((await rows('Appointment', 'id', 'denied'))[0]!.serviceId, 'a')

  for (const actorUserId of ['super', 'account']) {
    const id = 'role-' + actorUserId
    await seed(id)
    const result = await service.correctCompletedAppointmentService(input(id, { actorUserId, actorName: actorUserId }))
    assert.equal(result.finance.finalAmount, 20000, actorUserId + ' corrige con el motor financiero real')
    assert.equal((await rows('AppointmentServiceCorrection', 'appointmentId', id))[0]!.actorUserId, actorUserId)
    assert.equal((await rows('AppointmentServiceCorrection', 'appointmentId', id))[0]!.actorName, actorUserId)
  }
  for (const actorUserId of ['other-account', 'inactive-super']) {
    mutationStatements = 0
    await rejectsCode(() => service.correctCompletedAppointmentService(input('denied', { actorUserId })), 'BUSINESS_ADMIN_REQUIRED')
    assert.equal(mutationStatements, 0, actorUserId + ' no intenta mutaciones')
  }
  await db.exec(`UPDATE "Business" SET "accountAdminId" = 'other-account' WHERE id = 'b'`)
  mutationStatements = 0
  await rejectsCode(() => service.correctCompletedAppointmentService(input('role-account', { actorUserId: 'account', actorName: 'account' })), 'BUSINESS_ADMIN_REQUIRED')
  assert.equal(mutationStatements, 0, 'revocar asignación bloquea incluso un replay antes de cualquier mutación')
  await db.exec(`UPDATE "Business" SET "accountAdminId" = 'account' WHERE id = 'b'`)

  await seed('lower', { products: 5000, discount: 2000 })
  const originalPayment = (await rows('CashEntry', 'id', 'payment-lower'))[0]
  const originalEarning = (await rows('ProfessionalAccountEntry', 'id', 'earning-lower'))[0]!
  const originalProfessionalPayment = (await rows('ProfessionalAccountEntry', 'id', 'settled-lower'))[0]
  const lowerInput = input('lower', { expectedAgreedAmount: 45000, expectedPaidAmount: 43000, expectedDiscountAmount: 2000, expectedProductSubtotal: 5000 })
  const lower = await service.correctCompletedAppointmentService(lowerInput)
  assert.equal(lower.finance.agreedAmount, 25000)
  assert.equal(lower.finance.finalAmount, 23000)
  assert.equal(lower.finance.paidAmount, 23000)
  assert.equal(lower.finance.balanceAmount, 0)
  assert.equal(lower.correction.refundAmount, 20000)
  assert.equal(lower.correction.compensation!.amount, 5000)
  const appointment = (await rows('Appointment', 'id', 'lower'))[0]!
  assert.equal(appointment.serviceId, 'b')
  assert.equal(appointment.status, 'COMPLETED')
  assert.equal(appointment.completedByUserId, 'staff')
  assert.equal(appointment.completedAt.toISOString(), '2026-10-14T13:00:00.000Z')
  assert.deepEqual((await rows('CashEntry', 'id', 'payment-lower'))[0], originalPayment)
  assert.deepEqual((await rows('ProfessionalAccountEntry', 'id', 'settled-lower'))[0], originalProfessionalPayment)
  const earning = (await rows('ProfessionalAccountEntry', 'id', 'earning-lower'))[0]!
  assert.equal(earning.amount, 5000)
  assert.equal(earning.baseAmount, 20000)
  for (const key of ['actorUserId', 'actorName', 'effectiveAt', 'createdAt']) assert.deepEqual(earning[key], originalEarning[key])
  const audit = (await rows('AppointmentServiceCorrection', 'appointmentId', 'lower'))[0]!
  assert.equal(audit.previousCompensation.amount, 20000)
  assert.equal(audit.newCompensation.amount, 5000)
  assert.equal(audit.refundCashEntryId, lower.correction.refundCashEntryId)
  assert.equal(lower.finance.serviceCorrections.length, 1)
  await rejectsCode(() => service.reverseCashEntry({ businessId: 'b', cashSessionId: 'session', entryId: lower.correction.refundCashEntryId! }), 'ENTRY_NOT_REVERSIBLE')
  const summary = await service.listAppointmentFinanceSummaries({ businessId: 'b', appointmentIds: ['lower'] })
  assert.equal(summary[0]!.paidAmount, 23000)
  assert.equal(summary[0]!.balanceAmount, 0)
  const replay = await service.correctCompletedAppointmentService(lowerInput)
  assert.equal(replay.correction.id, lower.correction.id)
  assert.equal((await rows('CashEntry', 'accountId', 'account-lower')).length, 2)
  await rejectsCode(() => service.correctCompletedAppointmentService({ ...lowerInput, reason: 'Otro motivo' }), 'SERVICE_CORRECTION_REQUEST_CONFLICT')
  await rejectsCode(() => service.correctCompletedAppointmentService(input('lower', { requestId: 'stale-request' })), 'SERVICE_CORRECTION_STALE')
  await assert.rejects(() => db.query(`UPDATE "AppointmentServiceCorrection" SET reason='otro' WHERE id=$1`, [audit.id]), /append.only/i)
  await assert.rejects(() => db.query(`DELETE FROM "AppointmentServiceCorrection" WHERE id=$1`, [audit.id]), /append.only/i)

  await seed('higher')
  const higher = await service.correctCompletedAppointmentService(input('higher', { serviceId: 'expensive', expectedServicePrice: 60000, cashSessionId: undefined, paymentMethodId: undefined }))
  assert.equal(higher.finance.balanceAmount, 20000)
  assert.equal(higher.correction.refundCashEntryId, null)
  assert.equal(higher.correction.compensation!.amount, 30000)

  await seed('shared', { shared: true })
  await rejectsCode(() => service.correctCompletedAppointmentService(input('shared')), 'SERVICE_CORRECTION_SHARED_ACCOUNT')
  await seed('rollback')
  await rejectsCode(() => service.correctCompletedAppointmentService(input('rollback', { expectedPaidAmount: 39999 })), 'SERVICE_CORRECTION_STALE')
  await rejectsCode(() => service.correctCompletedAppointmentService(input('rollback', { expectedServicePrice: 19999 })), 'SERVICE_CORRECTION_STALE')
  failStatement = sql => sql.includes('INSERT INTO "AppointmentServiceCorrection"')
  await assert.rejects(() => service.correctCompletedAppointmentService(input('rollback')), /injected correction rollback/)
  failStatement = undefined
  assert.equal((await rows('Appointment', 'id', 'rollback'))[0]!.serviceId, 'a')
  assert.equal((await rows('AppointmentAccount', 'id', 'account-rollback'))[0]!.agreedAmount, 40000)
  assert.equal((await rows('ProfessionalAccountEntry', 'id', 'earning-rollback'))[0]!.amount, 20000)
  assert.equal((await rows('CashEntry', 'accountId', 'account-rollback')).length, 1)
  assert.equal((await rows('AppointmentServiceCorrection', 'appointmentId', 'rollback')).length, 0)
  await seed('estimated-account')
  // Pricing mode is immutable in production. Seed an estimated historical
  // account by temporarily omitting its update trigger, then restore it.
  await db.exec(`ALTER TABLE "AppointmentAccount" DISABLE TRIGGER "AppointmentAccount_total_adjustment_audit_trigger"; UPDATE "AppointmentAccount" SET "pricingMode"='ESTIMATED',"minimumAmount"=40000 WHERE id='account-estimated-account'; ALTER TABLE "AppointmentAccount" ENABLE TRIGGER "AppointmentAccount_total_adjustment_audit_trigger"`)
  await rejectsCode(() => service.correctCompletedAppointmentService(input('estimated-account')), 'SERVICE_CORRECTION_FIXED_PRICE_REQUIRED')

  for (const [target, code] of [['foreign', 'PROFESSIONAL_SERVICE_MISMATCH'], ['unassigned', 'PROFESSIONAL_SERVICE_MISMATCH'], ['estimated', 'SERVICE_CORRECTION_FIXED_PRICE_REQUIRED']] as const) {
    await rejectsCode(() => service.correctCompletedAppointmentService(input('rollback', { serviceId: target })), code)
  }
  await db.exec(`UPDATE "CashSession" SET "closedAt"=clock_timestamp() WHERE id='session'; UPDATE "CashRegisterDay" SET "closedAt"=clock_timestamp() WHERE id='day'`)
  await rejectsCode(() => service.correctCompletedAppointmentService(input('rollback')), 'CASH_CLOSED')
  assert.equal((await rows('Appointment', 'id', 'rollback'))[0]!.serviceId, 'a')
  assert.equal((await rows('CashEntry', 'accountId', 'account-rollback')).length, 1)
  assert.equal((await rows('Service', 'id', 'a'))[0]!.price, 40000)
  assert.equal((await rows('Service', 'id', 'b'))[0]!.price, 20000)
  console.log('completed service correction offline PostgreSQL: PASS (financial rows, rules, products/discount, replay, tenant/role, closed cash, atomic rollback, append-only audit)')
} finally {
  await db.close()
}
