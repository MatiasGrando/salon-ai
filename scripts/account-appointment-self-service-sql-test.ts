import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Own fresh in-memory PostgreSQL only. Never load .env or an existing database.
process.env.DOTENV_CONFIG_PATH = '__offline_web_self_service_sql_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/not_a_database'
process.env.DATABASE_POOL_MAX = '1'
process.env.NODE_ENV = 'test'
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = ''

const fixture = await PGlite.create()
// Prisma keeps one SQL connection. Permit a short socket reconnect overlap after
// an intentionally raised database error; this is not a concurrency assertion.
const server = new PGLiteSocketServer({ db: fixture, host: '127.0.0.1', port: 0, maxConnections: 4 })
const evidenceDirectory = 'tmp/account-self-service-checks'
const migrationPath = 'prisma/migrations/20261018010000_add_web_appointment_self_service/migration.sql'
const results: Array<{ name: string; status: string; error?: string }> = []
let client: any
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
async function check(name: string, run: () => Promise<unknown>) {
  try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
}

// Same scalar-schema fixture pattern as the existing F8 PGlite contracts.
// This is NOT the full historical migration chain. Applicable financial functions,
// triggers and CHECK/FK constraints are installed separately from original SQL.
async function createScalarFixture(schema: string) {
  const enums = new Set<string>()
  for (const match of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    enums.add(match[1]!)
    const values = match[2]!.split('\n').flatMap(line => {
      const value = line.trim().match(/^(\w+)(?:\s|$)/)?.[1]
      return value ? [line.match(/@map\("([^"]+)"\)/)?.[1] ?? value] : []
    })
    await fixture.exec('CREATE TYPE ' + quote(match[1]!) + ' AS ENUM (' + values.map(literal).join(',') + ')')
  }
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const name = match[1]!, body = match[2]!
    if (name === 'WebAppointmentAction') continue
    const columns: string[] = [], available = new Set<string>(), unique: string[][] = []
    for (const line of body.split('\n')) {
      const field = line.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?(?:\s|$)/)
      if (!field || name === 'Appointment' && field[1] === 'createdByWeexAccountId') continue
      const scalar = ({ String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamp(3)',
        Json: 'jsonb', Decimal: 'numeric', BigInt: 'bigint', Float: 'double precision', Bytes: 'bytea' } as Record<string, string>)[field[2]!]
      const type = scalar ?? (enums.has(field[2]!) ? quote(field[2]!) : null)
      if (!type) continue
      const column = line.match(/@map\("([^"]+)"\)/)?.[1] ?? field[1]!
      available.add(column)
      const stringDefault = line.match(/@default\("((?:[^"\\]|\\.)*)"\)/)?.[1]
      const primitiveDefault = line.match(/@default\((true|false|-?\d+|[A-Z][A-Z_0-9]*)\)/)?.[1]
      let defaultSql = stringDefault !== undefined ? literal(JSON.parse('"' + stringDefault + '"'))
        : primitiveDefault ? /^(true|false|-?\d+)$/.test(primitiveDefault) ? primitiveDefault : literal(primitiveDefault)
        : /@default\(now\(\)\)|@default\(dbgenerated\("clock_timestamp\(\)"\)\)/.test(line) ? 'clock_timestamp()'
        : field[3] ? "'{}'" : null
      if (/\bcreatedAt\b|\bupdatedAt\b/.test(field[1]!) && !defaultSql) defaultSql = 'clock_timestamp()'
      columns.push(quote(column) + ' ' + type + (field[3] ? '[]' : '') + (!field[4] ? ' NOT NULL' : '') +
        (defaultSql ? ' DEFAULT ' + defaultSql : '') + (/\s@id(?:\s|$)/.test(line) ? ' PRIMARY KEY' : ''))
      if (/\s@unique(?:\s|\(|$)/.test(line)) unique.push([column])
    }
    for (const compound of body.matchAll(/@@(id|unique)\(\[([^\]]+)\]/g)) {
      const names = compound[2]!.split(',').map(value => value.trim())
      if (names.every(value => available.has(value))) {
        if (compound[1] === 'id') columns.push('PRIMARY KEY (' + names.map(quote).join(',') + ')')
        else unique.push(names)
      }
    }
    await fixture.exec('CREATE TABLE ' + quote(name) + ' (' + columns.join(',') + ')')
    for (const fields of unique) await fixture.exec('CREATE UNIQUE INDEX ' + quote(name + '_' + fields.join('_') + '_key') +
      ' ON ' + quote(name) + ' (' + fields.map(quote).join(',') + ')')
  }
}

// Split only statement delimiters, retaining quoted function bodies verbatim.
function statements(sql: string) {
  const output: string[] = []
  let start = 0, dollar: string | null = null, single = false, double = false, comment = false
  for (let i = 0; i < sql.length; i++) {
    if (comment) { if (sql[i] === '\n') comment = false; continue }
    if (!single && !double && !dollar && sql.slice(i, i + 2) === '--') { comment = true; i++; continue }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null }; continue }
    if (!single && !double) {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0]
      if (delimiter) { dollar = delimiter; i += delimiter.length - 1; continue }
    }
    if (!double && sql[i] === "'") { if (single && sql[i + 1] === "'") { i++; continue }; single = !single }
    if (!single && sql[i] === '"') { if (double && sql[i + 1] === '"') { i++; continue }; double = !double }
    if (!single && !double && sql[i] === ';') { output.push(sql.slice(start, i + 1)); start = i + 1 }
  }
  if (sql.slice(start).trim()) output.push(sql.slice(start))
  return output.map(statement => statement.replace(/^\s*(?:--[^\n]*(?:\n|$)\s*)*/g, '').trim()).filter(Boolean)
}

async function installFinancialGuards() {
  const migrations = [
    '20260827110000_add_f8_deposit_terms_and_lines', '20260827130000_add_f8_append_only_deposit_proofs',
    '20260827140000_add_f8_proof_writer_guards', '20260827150000_add_f8_review_operations',
    '20260827160000_add_f8_8_rejection_operations', '20260827161000_fix_f8_resubmission_deadline_guard',
    '20260827170000_add_f8_proof_byte_retention_purge', '20260827200000_add_f9_appointment_management',
    '20260827210000_add_f9_cancellation_transition', '20260906120000_add_cash_financial_ledger',
    '20261009010000_allow_f8_pdf_deposit_proofs', '20261009210000_add_pending_deposit_staff_cancellation',
    '20261011010000_audit_confirmed_paid_reschedule'
  ]
  const installed: Array<{ migration: string; statements: number }> = []
  for (const migration of migrations) {
    let count = 0
    for (const sql of statements(await readFile('prisma/migrations/' + migration + '/migration.sql', 'utf8'))) {
      if (/^CREATE TABLE\b/.test(sql)) {
        const table = sql.match(/^CREATE TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/)?.[1]
        for (const check of sql.matchAll(/CONSTRAINT\s+"[^"]+"\s+CHECK\s*\(/g)) {
          let end = check.index! + check[0].length, depth = 1
          while (end < sql.length && depth) { if (sql[end] === '(') depth++; if (sql[end] === ')') depth--; end++ }
          assert.equal(depth, 0)
          await fixture.exec('ALTER TABLE ' + table + ' ADD ' + sql.slice(check.index!, end)); count++
        }
      }
      if (/^CREATE (?:OR REPLACE )?FUNCTION\b|^CREATE (?:CONSTRAINT )?TRIGGER\b|^DROP TRIGGER\b/i.test(sql) ||
        /^ALTER TABLE\b/.test(sql) && /ADD CONSTRAINT|DROP CONSTRAINT/.test(sql) && !/ADD COLUMN/.test(sql)) {
        await fixture.exec(sql); count++
      }
    }
    installed.push({ migration, statements: count })
  }
  return installed
}

try {
  await mkdir(evidenceDirectory, { recursive: true })
  const schema = await readFile('prisma/schema.prisma', 'utf8')
  await createScalarFixture(schema)
  await fixture.exec(`INSERT INTO "Business" (id,"customerCode",name) VALUES ('business-a','business-a','Synthetic pre-migration merchant')`)
  await fixture.exec(`INSERT INTO "Appointment" (id,"businessId","customerId","professionalId","serviceId","startAt","totalDurationMinutes",origin)
    VALUES ('pre-migration-legacy','business-a','customer-a','pro-a','cut',clock_timestamp()+interval '4 days',30,'WEB')`)
  const migration = await readFile(migrationPath, 'utf8')
  await fixture.exec(migration)
  const guards = await installFinancialGuards()
  await server.start()
  const target = new URL('postgresql://postgres:offline@' + server.getServerConn() + '/postgres')
  assert.equal(target.hostname, '127.0.0.1'); assert.ok(Number(target.port) > 0)
  process.env.DATABASE_URL = target.toString()
  const [{ prisma }, management, cashModule, cashRepository] = await Promise.all([
    import('../src/config/prisma.js'), import('../src/services/web-appointment-self-service.js'),
    import('../src/services/cash-service.js'), import('../src/repositories/prisma-cash-repository.js')
  ])
  client = prisma
  assert.equal(typeof management.webAppointmentManagement, 'function')
  assert.equal(typeof management.webAppointmentRescheduleOptions, 'function')
  assert.equal(typeof management.mutateWebAppointment, 'function')

  const future = (offset: number, hour = 13, minute = 0) => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, hour, minute))
  }
  const originalStart = future(4), requestedDate = future(6).toISOString().slice(0, 10)
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  const accountRequest = (token = 'synthetic-account-token') => ({
    headers: { cookie: 'weex_account_session=' + token, host: 'merchant.weex.com.ar', origin: 'https://merchant.weex.com.ar', 'sec-fetch-site': 'same-origin' },
    host: 'merchant.weex.com.ar', hostname: 'merchant.weex.com.ar', protocol: 'https'
  }) as any
  const guestRequest = (token: string) => ({ ...accountRequest('missing'), headers: {
    cookie: 'guest_booking_business-a_' + hash(token).slice(0, 16) + '=' + token,
    host: 'merchant.weex.com.ar', origin: 'https://merchant.weex.com.ar'
  } }) as any
  for (const id of ['business-a', 'business-b']) {
    const data = { id, customerCode: id, name: 'Synthetic ' + id, slug: id, timezone: 'UTC', accountStatus: 'ACTIVE' as const, allowGuestWebBooking: true }
    await prisma.business.upsert({ where: { id }, create: data, update: data })
  }
  await prisma.customer.create({ data: { id: 'customer-a', businessId: 'business-a', name: 'Synthetic customer', phone: '5491166553322', normalizedPhone: '5491166553322' } })
  for (const id of ['account-a', 'account-b']) await prisma.weexAccount.create({ data: {
    id, googleSub: id, email: id + '@example.invalid', name: id, phone: '5491166553322'
  } })
  for (const [accountId, token] of [['account-a', 'synthetic-account-token'], ['account-b', 'synthetic-other-token']]) {
    await prisma.weexAccountSession.create({ data: { accountId: accountId!, tokenHash: hash(token!), expiresAt: future(2) } })
  }
  await prisma.weexCustomerLink.create({ data: {
    businessId: 'business-a', customerId: 'customer-a', weexAccountId: 'account-b', phone: '5491166553322'
  } })
  for (const id of ['pro-a', 'pro-b', 'pro-c']) await prisma.professional.create({ data: { id, businessId: 'business-a', name: id } })
  await prisma.professional.create({ data: { id: 'foreign-professional', businessId: 'business-b', name: 'Foreign' } })
  for (const id of ['cut', 'color']) await prisma.service.create({ data: {
    id, businessId: 'business-a', name: id, duration: id === 'color' ? 45 : 30, price: id === 'color' ? 22000 : 18000
  } })
  for (const serviceId of ['cut', 'color']) for (const professionalId of ['pro-a', 'pro-b', 'pro-c']) {
    await prisma.professionalService.create({ data: { professionalId, serviceId } })
  }
  await prisma.businessBotOptionsSettings.create({ data: { businessId: 'business-a', timezone: 'UTC', bookingHorizonDays: 30 } })
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    await prisma.businessHours.create({ data: { businessId: 'business-a', dayOfWeek, startTime: '09:00', endTime: '20:00' } })
    for (const professionalId of ['pro-a', 'pro-b', 'pro-c']) await prisma.professionalHours.create({ data: { professionalId, dayOfWeek, startTime: '09:00', endTime: '20:00' } })
  }
  const createAppointment = async (id: string, extra: any = {}) => prisma.appointment.create({ data: {
    id, businessId: 'business-a', customerId: 'customer-a', professionalId: 'pro-a', serviceId: 'cut',
    startAt: originalStart, origin: 'WEB', quotedPrice: 15000, totalDurationMinutes: 30,
    createdByWeexAccountId: 'account-a', notes: 'Contracted snapshot: never recalculate', ...extra,
    serviceItems: { create: { serviceId: extra.serviceId ?? 'cut', sortOrder: 0, durationMinutes: 30, price: 15000 } }
  } })
  await createAppointment('owned-single', { startAt: future(4, 10) })
  await createAppointment('paid-group-a', { coordinationGroupId: 'paid-group', serviceId: 'color' })
  await createAppointment('paid-group-b', { coordinationGroupId: 'paid-group', professionalId: 'pro-b', startAt: future(4, 13, 30) })
  await prisma.bookingDeposit.create({ data: {
    id: 'legacy-paid', businessId: 'business-a', appointmentId: 'paid-group-a', source: 'WEB', mode: 'FIXED',
    configuredValue: 5000, amount: 5000, status: 'APPROVED', expiresAt: future(1), reviewedAt: new Date(),
    proofData: Buffer.from('Synthetic proof bytes, no real payment'), proofMimeType: 'application/pdf', proofFilename: 'synthetic.pdf'
  } })
  const ids = ['paid-group-a', 'paid-group-b']
  const inTx = <T>(work: (tx: any) => Promise<T>) => prisma.$transaction(work, { maxWait: 10000, timeout: 30000 })
  const get = (appointmentId: string, request = accountRequest(), businessId = 'business-a') => inTx(tx => management.webAppointmentManagement(tx, { request, businessId, appointmentId }))
  const options = (appointmentId: string, request = accountRequest(), professionalIds?: string[]) => inTx(tx => management.webAppointmentRescheduleOptions(tx, {
    request, businessId: 'business-a', appointmentId, date: requestedDate, ...(professionalIds ? { professionalIds } : {})
  }))
  const mutate = (appointmentId: string, action: 'RESCHEDULE' | 'CANCEL', body: any, request = accountRequest()) => inTx(tx => management.mutateWebAppointment(tx, {
    request, businessId: 'business-a', appointmentId, action, body
  }))
  const appointmentState = (appointmentIds = ids) => prisma.appointment.findMany({
    where: { id: { in: appointmentIds } }, include: { serviceItems: { orderBy: { sortOrder: 'asc' } }, bookingDeposit: true }, orderBy: { id: 'asc' }
  })
  const contract = (rows: any[]) => rows.map(({ startAt: _start, professionalId: _professional, status: _status, version: _version, ...row }) => row)
  const allFinancial = async () => ({
    accounts: await prisma.appointmentAccount.findMany({ orderBy: { id: 'asc' } }),
    links: await prisma.appointmentAccountLink.findMany({ orderBy: { appointmentId: 'asc' } }),
    entries: await prisma.cashEntry.findMany({ orderBy: { id: 'asc' } }),
    deposits: await prisma.bookingDeposit.findMany({ orderBy: { id: 'asc' } }),
    adjustments: await prisma.appointmentTotalAdjustment.findMany({ orderBy: { id: 'asc' } })
  })
  const cash = new cashModule.CashService(new cashRepository.PrismaCashRepository(prisma))
  const finance = () => cash.getAppointmentFinance({ businessId: 'business-a', appointmentId: 'paid-group-a' })

  // Scenarios are added against the frozen backend contract. They deliberately
  // use the real service, Prisma client and SQL transaction, not an ORM mock.
  await check('new migration applies verbatim and never backfills editable-phone ownership', async () => {
    assert.match(migration, /createdByWeexAccountId/)
    assert.doesNotMatch(migration, /UPDATE\s+"?Appointment"?/i)
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Appointment' AND column_name='createdByWeexAccountId'`)
    assert.equal(columns.length, 1)
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: 'pre-migration-legacy' } })).createdByWeexAccountId, null)
    await assert.rejects(prisma.appointment.update({ where: { id: 'owned-single' }, data: { createdByWeexAccountId: 'not-an-account' } }), /foreign key/i)
  })
  await check('real account identity authorizes; editable phone/imported link/other tenant never authorize', async () => {
    assert.equal((await get('owned-single')).selfService.mode, 'direct')
    const before = await appointmentState(['owned-single', 'pre-migration-legacy'])
    for (const [id, request, businessId] of [
      ['owned-single', accountRequest('synthetic-other-token'), 'business-a'],
      ['pre-migration-legacy', accountRequest(), 'business-a'],
      ['owned-single', accountRequest(), 'business-b']
    ] as const) {
      try { const result = await get(id, request, businessId); assert.equal(result.selfService.mode, 'contact') }
      catch (error) { assert.match(String(error), /author|perm|reserva|not.found|ownership|access/i) }
    }
    assert.deepEqual(await appointmentState(['owned-single', 'pre-migration-legacy']), before)
    assert.equal(await prisma.webAppointmentAction.count(), 0)
  })
  await check('options are read-only and retain each contracted segment duration instead of new catalogue price/duration', async () => {
    const before = await appointmentState(), money = await allFinancial()
    const result = await options('paid-group-a')
    assert.equal(result.selfService.mode, 'direct'); assert.ok(result.options.length > 0)
    assert.deepEqual(result.options[0].segments.map((segment: any) => segment.appointmentId), ids)
    assert.deepEqual(result.options[0].segments.map((segment: any) => segment.durationMinutes), [30, 30])
    assert.deepEqual(await appointmentState(), before); assert.deepEqual(await allFinancial(), money)
    assert.equal(await prisma.webAppointmentAction.count(), 0)
  })
  await check('legacy APPROVED deposit projects once to real Caja before any schedule change', async () => {
    const backfill = await cash.backfillAppointmentAccounts({ businessId: 'business-a' })
    assert.deepEqual(backfill.conflicts, [])
    assert.equal((await cash.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'legacy-paid', origin: 'WEB_DEPOSIT' })).created, true)
    assert.equal((await cash.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'legacy-paid', origin: 'WEB_DEPOSIT' })).created, false)
    assert.equal(await prisma.cashEntry.count(), 1)
    assert.equal((await prisma.cashEntry.findFirstOrThrow()).amount, 5000)
    const actual = await finance()
    assert.equal(actual.paidAmount, 5000); assert.equal(actual.serviceSubtotal, 30000)
    assert.equal(actual.entries.length, 1)
  })
  await check('reschedule whole paid group, change professional explicitly, preserve all prices/proofs/payments and replay safely', async () => {
    const before = await appointmentState(), money = await allFinancial(), beforeFinance = await finance()
    const offered = await options('paid-group-a', accountRequest(), ['pro-c', 'pro-b'])
    assert.ok(offered.options.length > 0)
    const selected = offered.options.find((option: any) => option.time === '14:00') ?? offered.options[0]
    const body = { revision: offered.selfService.revision, operationId: randomUUID(), date: requestedDate,
      professionalIds: ['pro-c', 'pro-b'], optionId: selected.id }
    await mutate('paid-group-a', 'RESCHEDULE', body)
    const after = await appointmentState()
    assert.deepEqual(contract(after), contract(before)); assert.deepEqual(await allFinancial(), money)
    assert.deepEqual(after.map(row => row.id), ids)
    assert.deepEqual(after.map(row => row.professionalId), ['pro-c', 'pro-b'])
    assert.deepEqual(after.map(row => row.startAt.toISOString()), selected.segments.map((segment: any) => new Date(segment.startAt).toISOString()))
    assert.equal(await prisma.webAppointmentAction.count(), 1)
    await mutate('paid-group-a', 'RESCHEDULE', body)
    assert.deepEqual(await appointmentState(), after); assert.equal(await prisma.webAppointmentAction.count(), 1)
    await assert.rejects(mutate('paid-group-a', 'CANCEL', { ...body, confirmed: true }))
    assert.deepEqual(await allFinancial(), money)
    assert.equal((await cash.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'legacy-paid', origin: 'WEB_DEPOSIT' })).created, false)
    assert.deepEqual(await finance(), beforeFinance, 'actual Caja reader still resolves the same paid account after changing schedule/professional')
    assert.deepEqual(await allFinancial(), money)
  })
  await check('cancel paid whole group preserves Caja, approved proof and histories with no automatic refund', async () => {
    const current = await get('paid-group-a'), before = await appointmentState(), money = await allFinancial(), beforeFinance = await finance()
    await mutate('paid-group-a', 'CANCEL', { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true })
    const after = await appointmentState()
    assert.deepEqual(after.map(row => row.status), ['CANCELLED', 'CANCELLED'])
    assert.deepEqual(contract(after), contract(before)); assert.deepEqual(await allFinancial(), money)
    assert.equal(await prisma.webAppointmentAction.count(), 2)
    assert.equal((await cash.projectApprovedDeposit({ businessId: 'business-a', bookingDepositId: 'legacy-paid', origin: 'WEB_DEPOSIT' })).created, false)
    assert.deepEqual(await finance(), beforeFinance, 'cancellation neither loses payment visibility nor writes a refund')
    assert.deepEqual(await allFinancial(), money)
    assert.equal((await get('paid-group-a')).selfService.mode, 'contact')
  })
  await check('wrong account, editable imported phone and wrong origin cannot use an otherwise valid mutation', async () => {
    const current = await get('owned-single'), before = await appointmentState(['owned-single']), money = await allFinancial()
    const body = { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true }
    await assert.rejects(mutate('owned-single', 'CANCEL', body, accountRequest('synthetic-other-token')), /acceso vigente/i)
    const crossOrigin = accountRequest(); crossOrigin.headers.origin = 'https://other.example.invalid'
    await assert.rejects(mutate('owned-single', 'CANCEL', body, crossOrigin), /desde la página/i)
    const old = { ...body, revision: '0'.repeat(64), operationId: randomUUID() }
    await assert.rejects(mutate('pre-migration-legacy', 'CANCEL', old), /acceso vigente/i)
    assert.deepEqual(await appointmentState(['owned-single']), before); assert.deepEqual(await allFinancial(), money)
  })
  await check('guest access is exact to group; expired, revoked and partial grants cannot mutate', async () => {
    await createAppointment('guest-a', { coordinationGroupId: 'guest-group', createdByWeexAccountId: null })
    await createAppointment('guest-b', { coordinationGroupId: 'guest-group', createdByWeexAccountId: null, professionalId: 'pro-b', startAt: future(4, 13, 30) })
    const token = 'a'.repeat(64), partial = 'b'.repeat(64)
    await prisma.guestBookingAccess.create({ data: { id: 'guest-full', tokenHash: hash(token), businessId: 'business-a', appointmentIds: ['guest-a', 'guest-b'], expiresAt: future(2) } })
    await prisma.guestBookingAccess.create({ data: { id: 'guest-partial', tokenHash: hash(partial), businessId: 'business-a', appointmentIds: ['guest-a'], expiresAt: future(2) } })
    const authorized = await get('guest-a', guestRequest(token)), before = await appointmentState(['guest-a', 'guest-b'])
    assert.equal(authorized.selfService.mode, 'direct')
    const body = { revision: authorized.selfService.revision, operationId: randomUUID(), confirmed: true }
    await assert.rejects(mutate('guest-a', 'CANCEL', body, guestRequest(partial)), /acceso vigente/i)
    await prisma.guestBookingAccess.update({ where: { id: 'guest-full' }, data: { expiresAt: new Date(0) } })
    await assert.rejects(mutate('guest-a', 'CANCEL', body, guestRequest(token)), /acceso vigente/i)
    await prisma.guestBookingAccess.update({ where: { id: 'guest-full' }, data: { expiresAt: future(2) } })
    await prisma.guestBookingAccess.delete({ where: { id: 'guest-full' } })
    await assert.rejects(mutate('guest-a', 'CANCEL', body, guestRequest(token)), /acceso vigente/i)
    assert.deepEqual(await appointmentState(['guest-a', 'guest-b']), before)
    await prisma.guestBookingAccess.create({ data: { id: 'guest-renewed', tokenHash: hash(token), businessId: 'business-a', appointmentIds: ['guest-a', 'guest-b'], expiresAt: future(2) } })
    await mutate('guest-a', 'CANCEL', { ...body, operationId: randomUUID() }, guestRequest(token))
    assert.deepEqual((await appointmentState(['guest-a', 'guest-b'])).map(row => row.status), ['CANCELLED', 'CANCELLED'])
    const audit = await prisma.webAppointmentAction.findFirstOrThrow({ where: { actorType: 'GUEST' } })
    assert.equal(audit.actorId, 'guest-renewed'); assert.deepEqual(audit.appointmentIds, ['guest-a', 'guest-b'])
  })
  await check('mixed account group cannot inherit ownership from anchor, contact details or a partial grant', async () => {
    await createAppointment('mixed-a', { coordinationGroupId: 'mixed-group' })
    await createAppointment('mixed-b', { coordinationGroupId: 'mixed-group', createdByWeexAccountId: 'account-b', professionalId: 'pro-b', startAt: future(4, 13, 30) })
    const before = await appointmentState(['mixed-a', 'mixed-b'])
    await assert.rejects(get('mixed-a'), /acceso vigente/i)
    await assert.rejects(mutate('mixed-a', 'CANCEL', { revision: '0'.repeat(64), operationId: randomUUID(), confirmed: true }), /acceso vigente/i)
    assert.deepEqual(await appointmentState(['mixed-a', 'mixed-b']), before)
  })
  await check('fresh conflict, stale revision and tampered professionals/options reject with zero partial changes', async () => {
    const offered = await options('owned-single'), before = await appointmentState(['owned-single']), money = await allFinancial()
    const selected = offered.options.find((option: any) => option.time === '15:00') ?? offered.options[0]
    assert.ok(selected)
    const body = { revision: offered.selfService.revision, operationId: randomUUID(), date: requestedDate, professionalIds: ['pro-a'], optionId: selected.id }
    await assert.rejects(mutate('owned-single', 'RESCHEDULE', { ...body, professionalIds: ['foreign-professional'] }))
    await assert.rejects(mutate('owned-single', 'RESCHEDULE', { ...body, optionId: '0'.repeat(64) }))
    await createAppointment('new-conflict', { startAt: new Date(selected.segments[0].startAt), createdByWeexAccountId: null })
    await assert.rejects(mutate('owned-single', 'RESCHEDULE', body), /cambiaron/i)
    await assert.rejects(mutate('owned-single', 'CANCEL', { revision: '0'.repeat(64), operationId: randomUUID(), confirmed: true }), /cambiaron/i)
    assert.deepEqual(await appointmentState(['owned-single']), before); assert.deepEqual(await allFinancial(), money)
  })
  await check('a real second-member SQL failure rolls back the first write and audit for reschedule and cancel', async () => {
    await createAppointment('rollback-a', { coordinationGroupId: 'rollback-group', startAt: future(4, 16) })
    await createAppointment('rollback-b', { coordinationGroupId: 'rollback-group', professionalId: 'pro-b', startAt: future(4, 16, 30) })
    const rollbackIds = ['rollback-a', 'rollback-b'], before = await appointmentState(rollbackIds), money = await allFinancial()
    const offered = await options('rollback-a'), selected = offered.options.find((option: any) => option.time === '11:00') ?? offered.options[0]
    assert.ok(selected)
    await fixture.exec(`CREATE FUNCTION synthetic_second_member_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id='rollback-b' AND (NEW."startAt"<>OLD."startAt" OR NEW.status<>OLD.status) THEN
          IF EXISTS (SELECT 1 FROM "Appointment" WHERE id='rollback-a' AND ("startAt"<>${literal(future(4, 16).toISOString())}::timestamp OR status='CANCELLED')) THEN
            RAISE EXCEPTION 'controlled last-member failure after first SQL write';
          END IF;
          RAISE EXCEPTION 'controlled last-member failure without first SQL write';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER synthetic_second_member_failure BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION synthetic_second_member_failure();`)
    const auditCount = await prisma.webAppointmentAction.count()
    try {
      await assert.rejects(mutate('rollback-a', 'RESCHEDULE', { revision: offered.selfService.revision, operationId: randomUUID(), date: requestedDate, professionalIds: ['pro-a', 'pro-b'], optionId: selected.id }), /after first SQL write/)
      assert.deepEqual(await appointmentState(rollbackIds), before); assert.deepEqual(await allFinancial(), money)
      await assert.rejects(mutate('rollback-a', 'CANCEL', { revision: offered.selfService.revision, operationId: randomUUID(), confirmed: true }), /after first SQL write/)
      assert.deepEqual(await appointmentState(rollbackIds), before); assert.deepEqual(await allFinancial(), money)
      assert.equal(await prisma.webAppointmentAction.count(), auditCount)
    } finally { await fixture.exec('DROP TRIGGER synthetic_second_member_failure ON "Appointment"; DROP FUNCTION synthetic_second_member_failure();') }
  })
  await check('pending, review and sealed financial markers are contact-only and preserve proof/payment state', async () => {
    for (const [suffix, status, sealed] of [['pending', 'PENDING_PROOF', false], ['review', 'PROOF_RECEIVED', false], ['sealed', 'APPROVED', true]] as const) {
      const id = 'unsupported-' + suffix
      await createAppointment(id, { startAt: future(5, 13) })
      await prisma.bookingDeposit.create({ data: { id: 'deposit-' + suffix, businessId: 'business-a', appointmentId: id, source: 'WEB', mode: 'FIXED',
        configuredValue: 5000, amount: 5000, status, expiresAt: future(1), snapshotSealedAt: sealed ? new Date() : null,
        proofData: Buffer.from('Synthetic retained proof'), proofMimeType: 'application/pdf', proofFilename: 'synthetic.pdf' } })
      const current = await get(id), before = await appointmentState([id]), money = await allFinancial()
      assert.equal(current.selfService.mode, 'contact')
      await assert.rejects(options(id), /comunicate con el local/i)
      await assert.rejects(mutate(id, 'CANCEL', { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true }), /gestión del local/i)
      assert.deepEqual(await appointmentState([id]), before); assert.deepEqual(await allFinancial(), money)
    }
  })
  await check('database audit and Caja immutability guards remain active, not replaced by mocks', async () => {
    const action = await prisma.webAppointmentAction.findFirstOrThrow()
    await assert.rejects(prisma.webAppointmentAction.update({ where: { operationId: action.operationId }, data: { actorId: 'tampered' } }), /append-only/i)
    const entry = await prisma.cashEntry.findFirstOrThrow()
    await assert.rejects(prisma.cashEntry.update({ where: { id: entry.id }, data: { amount: entry.amount + 1 } }), /append-only/i)
    const account = await prisma.appointmentAccount.findFirstOrThrow({ where: { pricingMode: 'FIXED' } })
    await assert.rejects(prisma.appointmentAccount.update({ where: { id: account.id }, data: { agreedAmount: (account.agreedAmount ?? 0) + 1 } }), /immutable/i)
  })
  await check('PROCESSING reminder blocks both mutations before any appointment, financial or audit write', async () => {
    await createAppointment('reminder-processing', { startAt: future(5, 18) })
    await prisma.reminderAutomation.create({ data: { id: 'processing-automation', businessId: 'business-a', name: 'Synthetic processing reminder' } })
    await prisma.reminderDelivery.create({ data: { id: 'processing-delivery', businessId: 'business-a', reminderAutomationId: 'processing-automation',
      appointmentId: 'reminder-processing', customerId: 'customer-a', scheduledFor: future(4), status: 'PROCESSING', messageSnapshot: 'Synthetic old schedule' } })
    const current = await get('reminder-processing'), offered = await options('reminder-processing'), before = await appointmentState(['reminder-processing'])
    const money = await allFinancial(), auditCount = await prisma.webAppointmentAction.count()
    const reminders = await prisma.reminderDelivery.findMany({ orderBy: { id: 'asc' } })
    await assert.rejects(mutate('reminder-processing', 'CANCEL', { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true }), /comunicación.*en curso/i)
    await assert.rejects(mutate('reminder-processing', 'RESCHEDULE', { revision: offered.selfService.revision, operationId: randomUUID(), date: requestedDate,
      professionalIds: ['pro-a'], optionId: offered.options[0].id }), /comunicación.*en curso/i)
    assert.deepEqual(await appointmentState(['reminder-processing']), before); assert.deepEqual(await allFinancial(), money)
    assert.deepEqual(await prisma.reminderDelivery.findMany({ orderBy: { id: 'asc' } }), reminders)
    assert.equal(await prisma.webAppointmentAction.count(), auditCount)
  })
  await check('pending/failed reminder invalidation shares the real transaction, including rollback after final audit failure', async () => {
    await createAppointment('reminder-ready', { startAt: future(5, 17) })
    for (const status of ['PENDING', 'FAILED', 'SENT']) {
      await prisma.reminderAutomation.create({ data: { id: 'automation-' + status, businessId: 'business-a', name: 'Synthetic ' + status } })
      await prisma.reminderDelivery.create({ data: { id: 'delivery-' + status, businessId: 'business-a', reminderAutomationId: 'automation-' + status,
        appointmentId: 'reminder-ready', customerId: 'customer-a', scheduledFor: future(4), status, messageSnapshot: 'Synthetic prior schedule' } })
    }
    const offered = await options('reminder-ready'), before = await appointmentState(['reminder-ready'])
    const reminders = await prisma.reminderDelivery.findMany({ where: { appointmentId: 'reminder-ready' }, orderBy: { id: 'asc' } })
    const body = { revision: offered.selfService.revision, operationId: randomUUID(), date: requestedDate, professionalIds: ['pro-a'], optionId: offered.options[0].id }
    await fixture.exec(`CREATE FUNCTION synthetic_final_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF 'reminder-ready'=ANY(NEW."appointmentIds") THEN
        IF EXISTS(SELECT 1 FROM "ReminderDelivery" WHERE id='delivery-PENDING' AND status='CANCELLED') THEN
          RAISE EXCEPTION 'controlled final audit failure after reminder invalidation';
        END IF;
        RAISE EXCEPTION 'controlled final audit failure without reminder invalidation';
      END IF; RETURN NEW; END; $$;
      CREATE TRIGGER synthetic_final_audit_failure BEFORE INSERT ON "WebAppointmentAction" FOR EACH ROW EXECUTE FUNCTION synthetic_final_audit_failure();`)
    try {
      await assert.rejects(mutate('reminder-ready', 'RESCHEDULE', body), /after reminder invalidation/)
      assert.deepEqual(await appointmentState(['reminder-ready']), before)
      assert.deepEqual(await prisma.reminderDelivery.findMany({ where: { appointmentId: 'reminder-ready' }, orderBy: { id: 'asc' } }), reminders)
      assert.equal(await prisma.webAppointmentAction.count({ where: { operationId: body.operationId } }), 0)
    } finally { await fixture.exec('DROP TRIGGER synthetic_final_audit_failure ON "WebAppointmentAction"; DROP FUNCTION synthetic_final_audit_failure();') }
    await mutate('reminder-ready', 'RESCHEDULE', body)
    const updated = await prisma.reminderDelivery.findMany({ where: { appointmentId: 'reminder-ready' }, orderBy: { id: 'asc' } })
    assert.deepEqual(updated.map(row => row.status), ['CANCELLED', 'CANCELLED', 'SENT'])
    assert.equal(updated.find(row => row.id === 'delivery-SENT')!.messageSnapshot, 'Synthetic prior schedule')
    await prisma.reminderDelivery.update({ where: { id: 'delivery-PENDING' }, data: { status: 'PENDING' } })
    const current = await get('reminder-ready')
    await mutate('reminder-ready', 'CANCEL', { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true })
    assert.equal((await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: 'delivery-PENDING' } })).status, 'CANCELLED')
  })
  await writeFile(evidenceDirectory + '/sql-results.json', JSON.stringify({
    results, guards, migrationPath, migrationSha256: createHash('sha256').update(migration).digest('hex'),
    schemaSha256: createHash('sha256').update(schema).digest('hex'),
    limitations: ['Fresh in-memory PGlite PostgreSQL with real Prisma over own loopback socket; not native PostgreSQL multi-session concurrency.',
      'Scalar schema fixture plus original financial guards and new migration; not the complete historical migration chain.',
      'No .env, existing database, network service, real account, payment, Google, WhatsApp or deployment.']
  }, null, 2), 'utf8')
} finally {
  await client?.$disconnect()
  await server.stop()
  await fixture.close()
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1
console.log('web appointment SQL: ' + results.filter(result => result.status === 'PASS').length + ' PASS / ' + results.filter(result => result.status === 'FAIL').length + ' FAIL')
