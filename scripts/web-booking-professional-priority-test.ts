import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { PGlite } from '@electric-sql/pglite'

process.env.DOTENV_CONFIG_PATH = '__offline_web_priority_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
process.env.NODE_ENV = 'test'
process.env.GOOGLE_CLIENT_ID = ''
process.env.WEEX_GOOGLE_CLIENT_ID = ''
const [{ prisma }, { businessRoutes }, { publicBookingRoutes }, { BusinessService }, { orderWebBookingProfessionals, webBookingWorkloadWindow }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/business.js'),
  import('../src/routes/public-booking.js'), import('../src/services/business-service.js'),
  import('../src/services/web-booking-professional-priority.js')
])
const db = prisma as any, pg = new PGlite(), app = Fastify(), admin = Fastify()
const restores: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const before = object[key]; object[key] = value; restores.push(() => { object[key] = before })
}
let passes = 0, failures = 0, role = 'BUSINESS_ADMIN', authenticated = true, writes = 0, workloadQueries = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const business: any = { id: 'business-a', name: 'Offline', slug: 'offline', timezone: 'America/Argentina/Buenos_Aires',
  accountStatus: 'ACTIVE', landingEnabled: true, webBookingPrioritizeLeastBooked: false,
  services: [{ id: 'cut', name: 'Cut', duration: 30, price: 100, isActive: true, isBookable: true,
    attentionMode: 'DIRECT_BOOKING', depositMode: 'NONE' }],
  professionals: [['p-a', 'Ana'], ['p-c', 'Bea'], ['p-b', 'Bea'], ['p-d', 'Zed']].map(([id, name]) => ({ id, name, avatarUrl: null })) }
const patch = (payload: any, id = business.id) => admin.inject({ method: 'PATCH', url: '/businesses/' + id, payload })
try {
  // This offline store exercises the real route and BusinessService.update, never a live database.
  await pg.exec(`CREATE TABLE "SettingsFixture" ("id" text PRIMARY KEY, "webBookingPrioritizeLeastBooked" boolean NOT NULL DEFAULT false);
    INSERT INTO "SettingsFixture" ("id") VALUES ('business-a')`)
  replace(db.business, 'findUnique', async () => ({ ...business }))
  replace(db.business, 'findFirst', async ({ where }: any) =>
    where.AND?.every((entry: any) => entry.id === business.id) || where.id === business.id ? { ...business } : null)
  replace(db.business, 'update', async ({ data }: any) => {
    writes++
    if (data.webBookingPrioritizeLeastBooked !== undefined) await pg.query(
      'UPDATE "SettingsFixture" SET "webBookingPrioritizeLeastBooked" = $1 WHERE "id" = $2',
      [data.webBookingPrioritizeLeastBooked, business.id])
    Object.assign(business, data); return { ...business }
  })
  for (const model of [db.service, db.professional, db.businessHours]) replace(model, 'count', async () => 1)
  replace(db.user, 'findFirst', async () => null)
  replace(db.businessOnboardingStatus, 'upsert', async ({ create }: any) => create)
  replace(BusinessService.prototype, 'findPublicBySlug', async () => ({ ...business }))
  replace(db.professionalService, 'findMany', async () => business.professionals.map((p: any) => ({ professionalId: p.id, serviceId: 'cut' })))
  replace(db.serviceCombinationRule, 'findMany', async () => [])
  replace(db, '$queryRaw', async () => { throw new Error('unexpected workload SQL') })
  admin.addHook('preHandler', async request => {
    if (authenticated) request.auth = { user: { id: 'admin-a', role, businessId: business.id, canCreateBusinesses: false } } as any
  })
  await admin.register(businessRoutes); await app.register(publicBookingRoutes)
  await check('real authorized PATCH persists true/false and omission preserves the option', async () => {
    const enabled = await patch({ webBookingPrioritizeLeastBooked: true })
    assert.equal(enabled.statusCode, 200, enabled.body)
    assert.equal(enabled.json().webBookingPrioritizeLeastBooked, true)
    assert.equal((await pg.query<any>('SELECT * FROM "SettingsFixture"')).rows[0].webBookingPrioritizeLeastBooked, true)
    assert.equal((await patch({ name: 'Offline updated' })).statusCode, 200)
    assert.equal(business.webBookingPrioritizeLeastBooked, true)
    assert.equal((await patch({ webBookingPrioritizeLeastBooked: false })).statusCode, 200)
    assert.equal((await pg.query<any>('SELECT * FROM "SettingsFixture"')).rows[0].webBookingPrioritizeLeastBooked, false)
  })
  await check('strict boolean and existing staff, tenant and anonymous authorization prevent writes', async () => {
    const before = writes
    for (const bad of ['true', 'false', 1, 0, null, {}, []]) assert.equal((await patch({ webBookingPrioritizeLeastBooked: bad })).statusCode, 400)
    role = 'STAFF'; assert.equal((await patch({ webBookingPrioritizeLeastBooked: true })).statusCode, 403)
    role = 'BUSINESS_ADMIN'; assert.equal((await patch({ webBookingPrioritizeLeastBooked: true }, 'business-b')).statusCode, 403)
    authenticated = false; assert.equal((await patch({ webBookingPrioritizeLeastBooked: true })).statusCode, 403)
    authenticated = true; assert.equal(writes, before)
  })
  await check('activation requires server IANA zone; same PATCH can configure it; OFF needs no zone', async () => {
    business.timezone = null
    assert.equal((await patch({ webBookingPrioritizeLeastBooked: true })).statusCode, 400)
    assert.equal((await patch({ timezone: 'not-a-zone', webBookingPrioritizeLeastBooked: true })).statusCode, 400)
    assert.equal((await patch({ timezone: 'America/Argentina/Buenos_Aires', webBookingPrioritizeLeastBooked: true })).statusCode, 200)
    assert.equal((await patch({ webBookingPrioritizeLeastBooked: false })).statusCode, 200)
  })
  await check('disabled and omitted flag preserve exact catalog order with zero workload SQL, even without zone', async () => {
    for (const flag of [false, undefined]) {
      business.webBookingPrioritizeLeastBooked = flag; business.timezone = null
      const response = await app.inject('/public/booking/offline/catalog')
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(response.json().professionals, business.professionals)
    }
    business.timezone = 'America/Argentina/Buenos_Aires'
  })
  await check('catalog ranks appointment counts privately using one real bounded PostgreSQL aggregate', async () => {
    await pg.exec(`CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
      CREATE TYPE "BookingDepositStatus" AS ENUM ('PENDING_PROOF','PENDING_RESUBMISSION','PROOF_RECEIVED','APPROVED','REJECTED','EXPIRED');
      CREATE TYPE "BookingVisitStatus" AS ENUM ('HELD','CONFIRMED','EXPIRED');
      CREATE TABLE "Professional" ("id" text PRIMARY KEY, "businessId" text NOT NULL);
      CREATE TABLE "Appointment" ("id" text PRIMARY KEY, "businessId" text, "professionalId" text, "serviceId" text,
        "startAt" timestamp, "status" "AppointmentStatus", "visitId" text);
      CREATE TABLE "BookingDeposit" ("id" text PRIMARY KEY, "appointmentId" text UNIQUE, "businessId" text, "status" "BookingDepositStatus", "expiresAt" timestamp);
      CREATE TABLE "BookingVisit" ("id" text PRIMARY KEY, "businessId" text, "status" "BookingVisitStatus", "holdExpiresAt" timestamp);`)
    for (const p of business.professionals) await pg.query('INSERT INTO "Professional" VALUES ($1,$2)', [p.id, business.id])
    const now = new Date('2026-10-28T12:00:00Z')
    replace(Date, 'now', () => now.getTime())
    async function appointment(id: string, professionalId: string, startAt: string, status = 'CONFIRMED', extra: any = {}) {
      await pg.query('INSERT INTO "Appointment" VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, extra.businessId || business.id, professionalId, extra.serviceId || 'cut', startAt, status, extra.visitId || null])
      if (extra.deposit) await pg.query('INSERT INTO "BookingDeposit" VALUES ($1,$2,$3,$4,$5)',
        ['d-' + id, id, extra.depositBusinessId || business.id, extra.deposit, extra.expiresAt || '2026-10-28T11:00:00Z'])
    }
    await appointment('history', 'p-a', '2026-10-23T03:00:00Z', 'COMPLETED', { serviceId: 'another-service' })
    await appointment('future', 'p-a', '2026-10-31T02:59:59.999Z')
    await appointment('without-deposit', 'p-b', '2026-10-28T15:00:00Z', 'PENDING')
    await appointment('proof-review', 'p-c', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'PROOF_RECEIVED' })
    await appointment('live-hold', 'p-a', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'PENDING_PROOF', expiresAt: '2026-10-28T12:00:00.001Z' })
    await appointment('foreign-deposit', 'p-a', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'PENDING_PROOF', depositBusinessId: 'business-b' })
    for (const status of ['CANCELLED', 'NO_SHOW']) await appointment(status, 'p-d', '2026-10-28T15:00:00Z', status)
    await appointment('before', 'p-d', '2026-10-23T02:59:59.999Z')
    await appointment('after', 'p-d', '2026-10-31T03:00:00Z')
    await appointment('other-tenant', 'p-d', '2026-10-28T15:00:00Z', 'CONFIRMED', { businessId: 'business-b' })
    await appointment('expired-deposit', 'p-d', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'PENDING_PROOF' })
    await appointment('expiry-equality', 'p-d', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'PENDING_PROOF', expiresAt: '2026-10-28T12:00:00Z' })
    await appointment('already-expired', 'p-d', '2026-10-28T15:00:00Z', 'PENDING', { deposit: 'EXPIRED' })
    await pg.exec(`INSERT INTO "BookingVisit" VALUES ('expired-visit','business-a','HELD','2026-10-28 11:00:00')`)
    await appointment('expired-visit', 'p-d', '2026-10-28T15:00:00Z', 'PENDING', { visitId: 'expired-visit' })
    const queries: any[] = []
    replace(db, '$queryRaw', async (query: any) => { workloadQueries++; queries.push(query); return (await pg.query(query.text, query.values)).rows })
    business.webBookingPrioritizeLeastBooked = true
    const response = await app.inject('/public/booking/offline/catalog?date=2099-01-01')
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().professionals.map((p: any) => p.id), ['p-d', 'p-b', 'p-c', 'p-a'])
    assert.equal(workloadQueries, 1)
    assert.ok(queries[0].values.includes(business.id))
    for (const professional of business.professionals) assert.ok(queries[0].values.includes(professional.id))
    assert.deepEqual(queries[0].values.filter((v: any) => v instanceof Date).map((v: Date) => v.toISOString()).slice(0, 2),
      ['2026-10-23T03:00:00.000Z', '2026-10-31T03:00:00.000Z'])
    for (const professional of response.json().professionals) assert.deepEqual(Object.keys(professional).sort(), ['avatarUrl', 'id', 'name'])
    assert.ok(!/appointmentCount|workload|expired-deposit|another-service/.test(response.body))
    business.professionals.reverse()
    const tied = await app.inject('/public/booking/offline/catalog')
    assert.deepEqual(tied.json().professionals.map((p: any) => p.id), ['p-d', 'p-b', 'p-c', 'p-a'])
    business.webBookingPrioritizeLeastBooked = false
    const disabled = await app.inject('/public/booking/offline/catalog')
    assert.deepEqual(disabled.json().professionals, business.professionals)
    assert.equal(workloadQueries, 2)
  })
  await check('missing/invalid enabled zone returns an integrated sanitized error without workload SQL', async () => {
    const before = workloadQueries
    business.webBookingPrioritizeLeastBooked = true
    for (const timezone of [null, 'not-a-zone']) {
      business.timezone = timezone
      const result = await app.inject('/public/booking/offline/catalog')
      assert.equal(result.statusCode, 409)
      assert.deepEqual(Object.keys(result.json()), ['message'])
      assert.match(result.json().message, /zona horaria/)
    }
    assert.equal(workloadQueries, before)
    business.timezone = 'America/Argentina/Buenos_Aires'
    const empty: any[] = []
    assert.equal(await orderWebBookingProfessionals(db, business, empty), empty)
    assert.equal(workloadQueries, before)
  })
  await check('real SQL respects server date, DST spring/fall, midnight gap/fold, and half-open boundaries', async () => {
    const windows = [
      ['America/Argentina/Buenos_Aires', '2026-10-28T00:30:00Z', '2026-10-22T03:00:00Z', '2026-10-30T03:00:00Z'],
      ['America/New_York', '2026-03-10T12:00:00Z', '2026-03-05T05:00:00Z', '2026-03-13T04:00:00Z'],
      ['America/New_York', '2026-11-03T12:00:00Z', '2026-10-29T04:00:00Z', '2026-11-06T05:00:00Z'],
      ['America/Sao_Paulo', '2018-11-09T12:00:00Z', '2018-11-04T03:00:00Z', '2018-11-12T02:00:00Z'],
      ['America/Havana', '2020-11-06T12:00:00Z', '2020-11-01T04:00:00Z', '2020-11-09T05:00:00Z']
    ]
    for (const [timezone, now, start, end] of windows) {
      const { from, to } = webBookingWorkloadWindow(new Date(now!), timezone)
      assert.equal(from.toISOString(), new Date(start!).toISOString(), timezone)
      assert.equal(to.toISOString(), new Date(end!).toISOString(), timezone)
      await pg.exec('DELETE FROM "BookingDeposit"; DELETE FROM "Appointment"; DELETE FROM "BookingVisit"')
      for (const [id, professionalId, instant] of [
        ['first', 'p-a', from], ['last', 'p-a', new Date(to.getTime() - 1)],
        ['too-early', 'p-b', new Date(from.getTime() - 1)], ['too-late', 'p-b', to]
      ]) await pg.query('INSERT INTO "Appointment" ("id","businessId","professionalId","startAt","status") VALUES ($1,$2,$3,$4,$5)',
        [id, business.id, professionalId, instant, 'CONFIRMED'])
      const client = { $queryRaw: async (q: any): Promise<any> => (await pg.query(q.text, q.values)).rows }
      const professionals = [{ id: 'p-a', name: 'Ana' }, { id: 'p-b', name: 'Bea' }]
      assert.deepEqual((await orderWebBookingProfessionals(client, { ...business, timezone }, professionals, new Date(now!))).map(p => p.id), ['p-b', 'p-a'])
    }
  })
  await check('additive migration defaults old/new businesses OFF and rejects null without altering their data', async () => {
    await pg.exec(`CREATE TABLE "Business" ("id" text PRIMARY KEY, "name" text); INSERT INTO "Business" VALUES ('old','Keep this')`)
    await pg.exec(readFileSync('prisma/migrations/20261028010000_web_booking_professional_priority/migration.sql', 'utf8'))
    await pg.exec(`INSERT INTO "Business" ("id","name") VALUES ('new','New')`)
    const rows = (await pg.query<any>('SELECT * FROM "Business" ORDER BY "id"')).rows
    assert.deepEqual(rows.map(r => r.webBookingPrioritizeLeastBooked), [false, false])
    assert.equal(rows.find(r => r.id === 'old').name, 'Keep this')
    await assert.rejects(pg.query('UPDATE "Business" SET "webBookingPrioritizeLeastBooked" = NULL'))
  })
} finally {
  await app.close(); await admin.close(); await pg.close()
  for (const restore of restores.reverse()) restore()
  await prisma.$disconnect()
}
console.log(`${passes} passed; ${failures} failed`)
if (failures) process.exitCode = 1
