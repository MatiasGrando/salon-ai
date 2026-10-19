import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Own fresh in-memory PostgreSQL only. Never load .env or an existing database.
process.env.DOTENV_CONFIG_PATH = '__offline_web_operation_latency_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/not_a_database'
process.env.DATABASE_POOL_MAX = '1'
process.env.NODE_ENV = 'test'
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = ''

const fixture = await PGlite.create()
// Prisma keeps one SQL connection. Permit a short socket reconnect overlap after
// an intentionally raised database error; this is not a concurrency assertion.
const server = new PGLiteSocketServer({ db: fixture, host: '127.0.0.1', port: 0, maxConnections: 4 })
const evidenceDirectory = 'tmp/web-appointment-operation-latency'
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
  const [{ prisma: originalPrisma }, management] = await Promise.all([
    import('../src/config/prisma.js'), import('../src/services/web-appointment-self-service.js')
  ])
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')
  const { PrismaClient } = await import('../src/generated/prisma/client.js')
  const { AsyncLocalStorage } = await import('node:async_hooks')
  const context = new AsyncLocalStorage<{ label: string }>()
  const sqlEvents: Array<{ label: string; sql: string; durationMs: number }> = []
  let rttMs = 0
  const pool = new Pool({ connectionString: target.toString(), max: 1 })
  pool.on('connect', sqlClient => {
    const query = sqlClient.query.bind(sqlClient)
    sqlClient.query = function(...args: any[]) {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? ''
      const label = context.getStore()?.label ?? 'transaction-boundary'
      const started = performance.now()
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        const wrapped = (...values: any[]) => {
          sqlEvents.push({ label, sql: sql.replace(/\s+/g, ' ').slice(0, 240), durationMs: performance.now() - started })
          callback(...values)
        }
        if (rttMs === 0) return (query as any)(...args.slice(0, -1), wrapped)
        setTimeout(() => (query as any)(...args.slice(0, -1), wrapped), rttMs)
        return undefined
      }
      return new Promise(resolve => setTimeout(resolve, rttMs)).then(() => (query as any)(...args)).finally(() => {
        sqlEvents.push({ label, sql: sql.replace(/\s+/g, ' ').slice(0, 240), durationMs: performance.now() - started })
      })
    } as any
  })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) })
  await originalPrisma.$disconnect()
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
  const inTx = <T>(work: (tx: any) => Promise<T>) => prisma.$transaction(work)
  const get = (appointmentId: string, request = accountRequest(), businessId = 'business-a') => inTx(tx => management.webAppointmentManagement(tx, { request, businessId, appointmentId }))
  const options = (appointmentId: string, request = accountRequest(), professionalIds?: string[]) => inTx(tx => management.webAppointmentRescheduleOptions(tx, {
    request, businessId: 'business-a', appointmentId, date: requestedDate, ...(professionalIds ? { professionalIds } : {})
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

  const calls: string[] = []
  function traced(tx: any) {
    let phase = 'hierarchy', loads = 0, validations = 0
    const models = new Map<string, any>()
    function invoke(receiver: any, name: string, args: any[]) {
      calls.push(name)
      if (name === 'appointment.findFirst') phase = ['authority-before-row-lock', 'authority-under-row-lock', 'authoritative-result'][loads++] ?? 'extra-authority-read'
      if (name === 'webAppointmentAction.findUnique') phase = 'idempotency'
      if (name === 'appointment.update') phase = 'write-appointments'
      if (name === 'reminderDelivery.updateMany') phase = 'write-reminders'
      if (name === 'webAppointmentAction.create') phase = 'write-audit'
      if (name === 'professional.findMany' && phase === 'reminders-guard') phase = 'availability-options'
      if (name === 'professional.findMany' && phase === 'write-audit') phase = 'response-professional-choices'
      if (name === '$queryRaw') {
        const text = args[0].strings.join('?')
        if (text.includes('FOR UPDATE OF a')) phase = 'row-lock'
        if (text.includes('web-self-service-reminders')) phase = 'reminders-guard'
        if (text.includes('pg_advisory_xact_lock') && (phase === 'availability-options' || phase.startsWith('exact-slot-') && args[0].values[0].includes(':business:'))) phase = 'exact-slot-' + (++validations)
      }
      const label = phase + '/' + name
      return context.run({ label }, async () => await Reflect.apply(name.startsWith('$') ? receiver[name] : receiver[name.split('.')[1]], receiver, args))
    }
    return new Proxy(tx, { get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key)
      if (key.startsWith('$') && typeof target[key] === 'function') return (...args: any[]) => invoke(target, key, args)
      if (!target[key] || typeof target[key] !== 'object') return target[key]
      if (!models.has(key)) models.set(key, new Proxy(target[key], { get(model, method) {
        if (typeof method !== 'string' || typeof model[method] !== 'function') return model[method]
        return (...args: any[]) => invoke(model, key + '.' + method, args)
      } }))
      return models.get(key)
    } })
  }
  const measurements: any[] = []
  const resetMeasurement = () => { sqlEvents.length = 0; calls.length = 0 }
  const metrics = (tag: string, started: number) => {
    const record = { tag, elapsedMs: performance.now() - started, rttMs, queryCount: sqlEvents.length,
      byPhase: Object.fromEntries([...new Set(sqlEvents.map(e => e.label.split('/')[0]))].map(phase => [phase, sqlEvents.filter(e => e.label.split('/')[0] === phase).length])) }
    measurements.push(record); console.log('MEASURE ' + JSON.stringify(record)); return record
  }
  await check('cancel removes redundant final authority reload and unused professional choices, preserving actual result/revision', async () => {
    await fixture.exec(`CREATE FUNCTION synthetic_returned_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id=ANY(ARRAY['paid-group-a','paid-group-b']) THEN NEW.version:=OLD.version+7; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER synthetic_returned_version BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION synthetic_returned_version();`)
    try {
      const managed = await get(ids[0]), money = await allFinancial(), before = await appointmentState()
      resetMeasurement(); const started = performance.now()
      const result = await prisma.$transaction(tx => management.mutateWebAppointment(traced(tx), { request: accountRequest(), businessId: 'business-a',
        appointmentId: ids[0], action: 'CANCEL', body: { revision: managed.selfService.revision, operationId: randomUUID(), confirmed: true } }))
      const measured = metrics('cancel-account-group', started), observedCalls = calls.slice()
      const fresh = await get(ids[0])
      assert.deepEqual(result.appointments, fresh.appointments)
      assert.equal(result.selfService.revision, fresh.selfService.revision, 'revision must reflect actual UPDATE-returned values, including database trigger version')
      assert.deepEqual((await appointmentState()).map(row => row.version), [7, 7])
      assert.deepEqual(await allFinancial(), money)
      assert.deepEqual(contract(await appointmentState()), contract(before))
      const audit = await prisma.webAppointmentAction.findFirstOrThrow({ where: { appointmentIds: { has: ids[0] } } })
      assert.deepEqual(audit.after, result.appointments, 'audit and response must use identical actual result')
      assert.equal(observedCalls.filter(name => name === 'appointment.findFirst').length, 2, 'keep two full authority reads, do not perform third full load after writing')
      assert.equal(measured.byPhase['response-professional-choices'] ?? 0, 0, 'cancelled response cannot use professional choices')
      assert.ok(measured.queryCount <= 53, 'must remove at least 8 of original 61 SQL queries, not merely increase timeout')
    } finally { await fixture.exec('DROP TRIGGER synthetic_returned_version ON "Appointment"; DROP FUNCTION synthetic_returned_version();') }
  })
  await check('guest cancellation also skips final grant reload and professional-choice queries', async () => {
    const id = 'guest-cancel', token = 'b'.repeat(64), request = guestRequest(token)
    await createAppointment(id, { createdByWeexAccountId: null, startAt: future(8) })
    await prisma.guestBookingAccess.create({ data: { id: 'guest-cancel-access', businessId: 'business-a', tokenHash: hash(token), appointmentIds: [id], expiresAt: future(2) } })
    const current = await get(id, request)
    resetMeasurement(); const started = performance.now()
    const result = await prisma.$transaction(tx => management.mutateWebAppointment(traced(tx), { request, businessId: 'business-a', appointmentId: id,
      action: 'CANCEL', body: { revision: current.selfService.revision, operationId: randomUUID(), confirmed: true } }))
    const measured = metrics('cancel-guest-single', started), observedCalls = calls.slice()
    assert.equal(result.appointments[0].status, 'CANCELLED')
    assert.equal(result.selfService.revision, (await get(id, request)).selfService.revision)
    assert.equal(observedCalls.filter(name => name === 'guestBookingAccess.findMany').length, 2, 'grant must be checked before and after locks, not redundantly after writes')
    assert.equal(measured.byPhase['response-professional-choices'] ?? 0, 0)
    assert.ok(measured.queryCount <= 42, 'must remove at least 8 of original 50 SQL queries')
  })
  const routeIds = ['latency-route-a', 'latency-route-b'], token = 'a'.repeat(64), request = guestRequest(token)
  await prisma.business.update({ where: { id: 'business-a' }, data: { landingEnabled: true } })
  for (const [index, id] of routeIds.entries()) await createAppointment(id, { coordinationGroupId: 'latency-route-group',
    createdByWeexAccountId: null, startAt: future(8, 16, index * 30), professionalId: index ? 'pro-b' : 'pro-a' })
  await prisma.guestBookingAccess.create({ data: { id: 'latency-route-access', businessId: 'business-a', tokenHash: hash(token), appointmentIds: routeIds, expiresAt: future(2) } })
  const available = await options(routeIds[0], request, ['pro-c', 'pro-b']), selected = available.options.find(o => o.time === '19:00')!
  assert.ok(selected)
  const rescheduleBody = { revision: available.selfService.revision, operationId: randomUUID(), date: requestedDate, professionalIds: ['pro-c', 'pro-b'], optionId: selected.id }
  const before = await appointmentState(routeIds), finances = await allFinancial(), priorReminders = await prisma.reminderDelivery.findMany()
  await check('real default 5s transaction fails with native P2028 under simulated SQL delay and rolls back the complete group', async () => {
    resetMeasurement(); rttMs = 150; const started = performance.now()
    let caught: any
    try { await prisma.$transaction(tx => management.mutateWebAppointment(traced(tx), { request, businessId: 'business-a', appointmentId: routeIds[0],
      action: 'RESCHEDULE', body: rescheduleBody })) } catch (error) { caught = error }
    metrics('default-budget-synthetic-delay', started); rttMs = 0
    assert.equal(caught?.code, 'P2028', 'uses real Prisma default timeout; never throws a fake P2028')
    assert.match(caught.message, /5000 ms/)
    assert.deepEqual(await appointmentState(routeIds), before); assert.deepEqual(await allFinancial(), finances)
    assert.deepEqual(await prisma.reminderDelivery.findMany(), priorReminders)
    assert.equal(await prisma.webAppointmentAction.count({ where: { operationId: rescheduleBody.operationId } }), 0)
  })
  const { default: Fastify } = await import('fastify')
  const { publicBookingRoutes } = await import('../src/routes/public-booking.js')
  const app = Fastify(), transactionOptions: any[] = [], diagnostics: any[] = [], db = originalPrisma as any
  const originalTransaction = db.$transaction, originalBusinessFindUnique = db.business.findUnique
  db.business.findUnique = prisma.business.findUnique.bind(prisma.business)
  db.$transaction = (run: any, options?: any) => {
    transactionOptions.push(options)
    return prisma.$transaction(tx => run(traced(tx)), options)
  }
  app.addHook('onRequest', async req => { req.log.error = (...args: any[]) => { diagnostics.push(args[0]) } })
  try {
    await app.register(publicBookingRoutes)
    let changed: any
    await check('real reschedule route uses only its explicit budget and completes the same delayed request with current IDs and snapshots', async () => {
      resetMeasurement(); rttMs = 150; const started = performance.now()
      const response = await app.inject({ method: 'POST', url: '/public/booking/business-a/appointments/' + routeIds[0] + '/reschedule',
        headers: { ...request.headers, origin: 'http://merchant.weex.com.ar' }, payload: rescheduleBody })
      metrics('route-explicit-budget-synthetic-delay', started); rttMs = 0
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(transactionOptions.at(-1), { maxWait: 5000, timeout: 15000 }, 'budget must be local to real management routes, not a global Prisma option')
      changed = response.json()
      assert.deepEqual(changed.appointments.map((a: any) => a.id), routeIds)
      assert.deepEqual(changed.appointments.map((a: any) => a.professional.id), ['pro-c', 'pro-b'])
      assert.deepEqual(changed.appointments, (await get(routeIds[0], request)).appointments)
      assert.equal(changed.selfService.revision, (await get(routeIds[0], request)).selfService.revision)
      assert.deepEqual(contract(await appointmentState(routeIds)), contract(before))
      assert.deepEqual(await allFinancial(), finances)
      const audit = await prisma.webAppointmentAction.findUniqueOrThrow({ where: { operationId: rescheduleBody.operationId } })
      assert.deepEqual(audit.after, changed.appointments)
      const retry = await app.inject({ method: 'POST', url: '/public/booking/business-a/appointments/' + routeIds[0] + '/reschedule',
        headers: { ...request.headers, origin: 'http://merchant.weex.com.ar' }, payload: rescheduleBody })
      assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().idempotent, true)
      assert.equal(await prisma.webAppointmentAction.count({ where: { operationId: rescheduleBody.operationId } }), 1)
    })
    await check('real cancel route has the same scoped budget and leaves all members/audit unchanged when final audit fails', async () => {
      rttMs = 0
      const current = await get(routeIds[0], request), rows = await appointmentState(routeIds), money = await allFinancial()
      const opId = randomUUID(), auditCount = await prisma.webAppointmentAction.count()
      await fixture.exec(`CREATE FUNCTION synthetic_latency_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW."operationId"='${opId}' THEN RAISE EXCEPTION 'controlled latency audit failure'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER synthetic_latency_audit_failure BEFORE INSERT ON "WebAppointmentAction" FOR EACH ROW EXECUTE FUNCTION synthetic_latency_audit_failure();`)
      try {
        const response = await app.inject({ method: 'POST', url: '/public/booking/business-a/appointments/' + routeIds[0] + '/cancel',
          headers: { ...request.headers, origin: 'http://merchant.weex.com.ar' }, payload: { revision: current.selfService.revision, operationId: opId, confirmed: true } })
        assert.equal(response.statusCode, 409)
        assert.deepEqual(transactionOptions.at(-1), { maxWait: 5000, timeout: 15000 })
        assert.deepEqual(await appointmentState(routeIds), rows); assert.deepEqual(await allFinancial(), money)
        assert.deepEqual(await prisma.reminderDelivery.findMany(), priorReminders)
        assert.equal(await prisma.webAppointmentAction.count(), auditCount)
      } finally { await fixture.exec('DROP TRIGGER synthetic_latency_audit_failure ON "WebAppointmentAction"; DROP FUNCTION synthetic_latency_audit_failure();') }
    })
    await check('operation errors log only technical duration/category, never exception SQL, payload, identity or cookie', async () => {
      const failed = diagnostics.filter(event => event?.event === 'web_appointment_management' && event.outcome === 'error')
      assert.ok(failed.length >= 1)
      for (const event of failed) {
        assert.deepEqual(Object.keys(event).sort(), ['action', 'businessId', 'errorCode', 'event', 'outcome', 'transactionDurationMs'])
        assert.equal(event.businessId, 'business-a', 'opaque business ID is needed to scope operational diagnosis')
        assert.ok(['cancel', 'reschedule'].includes(event.action))
        assert.ok(Number.isInteger(event.transactionDurationMs) && event.transactionDurationMs >= 0)
        assert.match(event.errorCode, /^[A-Z][A-Z0-9_]{0,31}$/)
        assert.doesNotMatch(JSON.stringify(event), /SELECT|UPDATE|INSERT|controlled|synthetic|cookie|operationId|revision|appointmentId/)
      }
    })
  } finally { rttMs = 0; db.$transaction = originalTransaction; db.business.findUnique = originalBusinessFindUnique; await app.close() }
  await writeFile(evidenceDirectory + '/results.json', JSON.stringify({ results, measurements, guards,
    limitations: ['Own fresh PGlite scalar fixture + original financial guards and real Prisma SQL; not full migration history or native multi-session contention.',
      'Artificial SQL delay is not production latency. Calls issued in Promise.all may overlap; do not sum per-query durations as wall time.',
      'Default timeout and local route override are real Prisma settings, no mocked P2028 or real customer/credential/network access.'] }, null, 2), 'utf8')
} finally { await client?.$disconnect(); await server.stop(); await fixture.close() }
console.log('web operation latency: ' + results.filter(r => r.status === 'PASS').length + ' PASS / ' + results.filter(r => r.status === 'FAIL').length + ' FAIL')
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1
