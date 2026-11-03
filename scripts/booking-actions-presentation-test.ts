import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Read-only route checks against a fresh local SQL fixture, never .env or real data.
process.env.DOTENV_CONFIG_PATH = '__offline_booking_actions_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/not_a_database'
process.env.DATABASE_POOL_MAX = '1'
process.env.NODE_ENV = 'test'
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
process.env.GOOGLE_CLIENT_ID = process.env.WEEX_GOOGLE_CLIENT_ID = ''
const fixture = await PGlite.create()
const server = new PGLiteSocketServer({ db: fixture, host: '127.0.0.1', port: 0, maxConnections: 4 })
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
const results: Array<{ name: string; status: string; error?: string }> = []
async function check(name: string, run: () => Promise<unknown>) {
  try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error) }); console.error('FAIL ' + name + ': ' + error) }
}
let client: any, app: any
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

try {
  // PGlite's wire timestamp uses its session zone; keep this fixture explicitly UTC.
  await fixture.exec("SET TIME ZONE 'UTC'")
  console.log('SETUP schema'); await createScalarFixture(await readFile('prisma/schema.prisma', 'utf8')); console.log('SETUP schema ready')
  await fixture.exec(await readFile('prisma/migrations/20261018010000_add_web_appointment_self_service/migration.sql', 'utf8'))
  await server.start(); console.log('SETUP socket ready')
  const target = new URL('postgresql://postgres:offline@' + server.getServerConn() + '/postgres')
  assert.equal(target.hostname, '127.0.0.1'); assert.ok(Number(target.port) > 0)
  process.env.DATABASE_URL = target.toString()
  const { prisma } = await import('../src/config/prisma.js')
  client = prisma
  console.log('SETUP Prisma ready'); const { publicBookingRoutes } = await import('../src/routes/public-booking.js'); console.log('SETUP routes ready')
  const future = (days: number) => new Date(Date.now() + days * 86400000)
  const token = 'synthetic-actions-account', otherToken = 'synthetic-actions-other', guestToken = 'b'.repeat(64)
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  for (const id of ['business-a', 'business-b']) await prisma.business.create({ data: {
    id, customerCode: id, slug: id, name: 'Synthetic merchant', timezone: 'UTC', landingEnabled: true, accountStatus: 'ACTIVE'
  } })
  await prisma.customer.create({ data: { id: 'customer', businessId: 'business-a', name: 'Synthetic', phone: '5491166553322' } })
  for (const [id, value] of [['account-a', token], ['account-b', otherToken]]) {
    await prisma.weexAccount.create({ data: { id, googleSub: id, name: id, email: id + '@example.invalid' } })
    await prisma.weexAccountSession.create({ data: { accountId: id!, tokenHash: hash(value!), expiresAt: future(2) } })
  }
  await prisma.professional.create({ data: { id: 'pro', businessId: 'business-a', name: 'Synthetic professional' } })
  await prisma.businessBotOptionsSettings.create({ data: { businessId: 'business-a', timezone: 'UTC' } })
  for (const id of ['cut', 'color']) {
    await prisma.service.create({ data: { id, businessId: 'business-a', name: id, duration: 90, price: 99000 } })
    await prisma.professionalService.create({ data: { serviceId: id, professionalId: 'pro' } })
  }
  const make = (id: string, data: any = {}) => prisma.appointment.create({ data: {
    id, businessId: 'business-a', customerId: 'customer', professionalId: 'pro', serviceId: 'cut',
    startAt: future(5), origin: 'WEB', status: 'CONFIRMED', totalDurationMinutes: 30, quotedPrice: 15000,
    createdByWeexAccountId: 'account-a', ...data,
    serviceItems: { create: { serviceId: data.serviceId || 'cut', sortOrder: 0, durationMinutes: 30, price: 15000 } }
  } })
  await make('single')
  await make('group-a', { coordinationGroupId: 'group' })
  await make('group-b', { coordinationGroupId: 'group', serviceId: 'color', startAt: new Date(future(5).getTime() + 1800000) })
  await make('guest', { createdByWeexAccountId: null })
  await make('late', { startAt: new Date(Date.now() + 30 * 60000) })
  await make('cancelled', { status: 'CANCELLED' })
  await prisma.guestBookingAccess.create({ data: { id: 'grant', businessId: 'business-a', tokenHash: hash(guestToken), appointmentIds: ['guest'], expiresAt: future(2) } })
  await prisma.bookingDeposit.create({ data: { id: 'deposit', businessId: 'business-a', appointmentId: 'group-a', source: 'WEB',
    mode: 'FIXED', configuredValue: 5000, amount: 5000, status: 'APPROVED', expiresAt: future(1), proofData: Buffer.from('Synthetic proof') } })
  // Instrument actual Prisma delegates: these wrappers call real SQL unchanged.
  let professionals = 0, links = 0
  const originalProfessional = prisma.professional.findMany.bind(prisma.professional)
  const originalLinks = prisma.professionalService.findMany.bind(prisma.professionalService)
  ;(prisma.professional as any).findMany = (...args: any[]) => { professionals++; return (originalProfessional as any)(...args) }
  ;(prisma.professionalService as any).findMany = (...args: any[]) => { links++; return (originalLinks as any)(...args) }
  app = Fastify(); await app.register(publicBookingRoutes)
  const headers = (value = token) => ({ cookie: 'weex_account_session=' + value })
  const guestHeaders = { cookie: 'guest_booking_business-a_' + hash(guestToken).slice(0, 16) + '=' + guestToken }
  const manage = (id = 'single', query = '', identity: Record<string, string> = headers(), slug = 'business-a') => app.inject({
    method: 'GET', url: '/public/booking/' + slug + '/appointments/' + id + '/manage' + query, headers: identity
  })
  console.log('SETUP seeded'); const before = await prisma.appointment.findMany({ orderBy: { id: 'asc' }, include: { serviceItems: true } })
  const money = await prisma.bookingDeposit.findMany()
  await check('actions opt-in keeps single/group identity, policy, revision, timezone and snapshots without two professional queries', async () => {
    for (const id of ['single', 'group-a']) {
      professionals = links = 0
      const full = await manage(id); assert.equal(full.statusCode, 200, full.body)
      assert.deepEqual([professionals, links], [1, 1], 'default GET must retain full wizard professional choices')
      const fullBody = full.json(); assert.ok(fullBody.selfService.professionalChoices.length > 0)
      professionals = links = 0
      const light = await manage(id, '?view=actions'); assert.equal(light.statusCode, 200, light.body)
      const actual = light.json()
      assert.deepEqual([professionals, links], [0, 0], 'actions must not query professionals/links')
      assert.deepEqual(actual, { ...fullBody, selfService: { ...fullBody.selfService, professionalChoices: [] } })
      assert.equal(light.headers['cache-control'], 'no-store')
      assert.equal(actual.selfService.timezone, 'UTC')
      assert.equal(actual.appointments[0].service.duration, 30); assert.equal(actual.appointments[0].service.price, 15000)
      assert.equal(actual.appointments.length, id === 'single' ? 1 : 2)
    }
  })
  await check('guest capability gets identical actions permissions while wrong identity/partial or expired grant still deny', async () => {
    professionals = links = 0
    const light = await manage('guest', '?view=actions', guestHeaders); assert.equal(light.statusCode, 200, light.body)
    assert.equal(light.json().selfService.canCancel, true); assert.deepEqual([professionals, links], [0, 0])
    for (const [id, identity, slug] of [
      ['single', headers(otherToken), 'business-a'], ['single', {}, 'business-a'],
      ['single', headers(), 'business-b'], ['group-a', guestHeaders, 'business-a']
    ] as const) assert.equal((await manage(id, '?view=actions', identity, slug)).statusCode, 404)
    await prisma.guestBookingAccess.update({ where: { id: 'grant' }, data: { appointmentIds: ['group-a'] } })
    assert.equal((await manage('group-a', '?view=actions', guestHeaders)).statusCode, 404, 'partial grant must not authorize a full group')
    await prisma.guestBookingAccess.update({ where: { id: 'grant' }, data: { appointmentIds: ['guest'], expiresAt: new Date(0) } })
    assert.equal((await manage('guest', '?view=actions', guestHeaders)).statusCode, 404)
  })
  await check('actions cannot bypass lead-time, cancelled-state or policy validation', async () => {
    for (const id of ['late', 'cancelled']) {
      const response = await manage(id, '?view=actions'); assert.equal(response.statusCode, 200)
      assert.equal(response.json().selfService.canCancel, false, id + ': ' + response.body); assert.equal(response.json().selfService.canReschedule, false, id + ': ' + response.body)
    }
    await prisma.businessBotOptionsSettings.update({ where: { businessId: 'business-a' }, data: { rescheduleLeadMinutes: -1 } })
    assert.equal((await manage('single', '?view=actions')).statusCode, 422)
    await prisma.businessBotOptionsSettings.update({ where: { businessId: 'business-a' }, data: { rescheduleLeadMinutes: 60 } })
  })
  await check('unsupported or repeated actions view is rejected instead of becoming alternate authority', async () => {
    for (const query of ['?view=other', '?view=', '?view=actions&view=actions']) {
      assert.equal((await manage('single', query)).statusCode, 400, query)
    }
    assert.equal((await manage('single', '?view=actions&preview=1')).statusCode, 200)
  })
  await check('catalog emits actual compatible image URLs only and preserves all other published service fields', async () => {
    const url = '/public/booking/business-a/catalog'
    const baseline = await app.inject({ method: 'GET', url }); assert.equal(baseline.statusCode, 200, baseline.body)
    const expected = baseline.json().services.find((row: any) => row.id === 'cut'); delete expected.imageUrl
    const valid = ['https://images.example.invalid/cut.webp?version=1', 'http://localhost:3000/cut.png',
      '/landing-assets/cut.png', 'data:image/png;base64,aGVsbG8=']
    const invalid = [null, '', '/media/service-image-synthetic.png', 'javascript:alert(1)', 'data:text/html;base64,aGVsbG8=', 'data:image/svg+xml;base64,aGVsbG8=',
      '//evil.example/image.png', 'file:///C:/private.png', 'https://user:secret@images.example.invalid/a.png', 'https://bad.example/\nfile.png']
    for (const value of [...valid, ...invalid]) {
      await prisma.service.update({ where: { id: 'cut' }, data: { imageUrl: value } })
      const response = await app.inject({ method: 'GET', url }); assert.equal(response.statusCode, 200, response.body)
      const actual = response.json().services.find((row: any) => row.id === 'cut')
      assert.equal(actual.imageUrl, valid.includes(value as string) ? value : null, 'image ' + String(value).slice(0, 96))
      delete actual.imageUrl; assert.deepEqual(actual, expected)
    }
  })
  await check('catalog preserves legacy raster types and 4 MiB boundary without accepting oversized/malformed payloads', async () => {
    const accepted = ['jpeg', 'webp', 'gif'].map(type => 'data:image/' + type + ';base64,aGVsbG8=')
    accepted.push('data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024).toString('base64'))
    const rejected = ['data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
      'data:image/png;base64,a=b=', 'data:image/png;base64,abcd===', 'data:image/png;base64,a']
    for (const [index, value] of [...accepted, ...rejected].entries()) {
      await prisma.service.update({ where: { id: 'cut' }, data: { imageUrl: value } })
      const response = await app.inject({ method: 'GET', url: '/public/booking/business-a/catalog' })
      assert.equal(response.statusCode, 200)
      assert.equal(response.json().services.find((row: any) => row.id === 'cut').imageUrl,
        index < accepted.length ? value : null, 'raster case ' + index)
    }
  })
  await check('read-only manage views keep appointment rows, deposits, proofs and operation audit unchanged', async () => {
    assert.deepEqual(await prisma.appointment.findMany({ orderBy: { id: 'asc' }, include: { serviceItems: true } }), before)
    assert.deepEqual(await prisma.bookingDeposit.findMany(), money)
    assert.equal(await prisma.webAppointmentAction.count(), 0)
  })
  await mkdir('tmp/booking-actions-presentation', { recursive: true })
  await writeFile('tmp/booking-actions-presentation/results.json', JSON.stringify({ results,
    limitations: ['Fresh PGlite scalar fixture and real Fastify/Prisma; no production data or native multi-session concurrency.'] }, null, 2), 'utf8')
} finally { await app?.close(); await client?.$disconnect(); await server.stop(); await fixture.close() }
console.log('booking actions presentation: ' + results.filter(row => row.status === 'PASS').length + ' PASS / ' + results.filter(row => row.status === 'FAIL').length + ' FAIL')
if (results.some(row => row.status === 'FAIL')) process.exitCode = 1