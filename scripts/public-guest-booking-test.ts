import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'

process.env.DOTENV_CONFIG_PATH = '__offline_guest_booking_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/guest_booking_test'
process.env.NODE_ENV = 'test'
process.env.WEEX_GOOGLE_CLIENT_ID = ''
process.env.GOOGLE_CLIENT_ID = ''
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
const [{ prisma }, { publicBookingRoutes }, { businessRoutes }, { BusinessService }, { AppointmentService },
  { BookingAvailabilitySearchEngine }, { bookingDepositService, BookingDepositService }, { PGlite }, { Prisma }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/public-booking.js'), import('../src/routes/business.js'),
  import('../src/services/business-service.js'), import('../src/services/appointment-service.js'),
  import('../src/services/booking-availability-search.js'), import('../src/services/booking-deposit-service.js'),
  import('@electric-sql/pglite'), import('../src/generated/prisma/client.js')
])
const db = prisma as any
const restores: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const before = object[key]; object[key] = value; restores.push(() => { object[key] = before })
}
let passes = 0, failures = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const services: any[] = ['cut', 'color'].map(id => ({
  id, name: id, businessId: 'business-a', duration: 30, price: 15000, isActive: true, isBookable: true,
  attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true, bookingOrderPriority: 1,
  depositMode: 'NONE', depositValue: null, depositHoldMinutes: 60, validationEnabled: false,
  professionalLinks: [{ professional: { id: 'pro-a', name: 'Professional' } }]
}))
const business: any = { id: 'business-a', slug: 'guest-test', name: 'Offline', landingEnabled: true,
  accountStatus: 'ACTIVE', allowGuestWebBooking: false, publicWhatsapp: '+5491140000000', services,
  professionals: [{ id: 'pro-a', name: 'Professional' }],
  paymentSettings: { transferEnabled: true, alias: 'synthetic.test' } }
const account = { id: 'account-a', name: 'Google synthetic', phone: '5491166553322', emailVerified: false }
let role = 'BUSINESS_ADMIN', customerWrites = 0, marketingWrites = 0, proofCalls = 0, bookings = 0
let failSecond = false, failGrant = false, businessWrites = 0
const appointments = new Map<string, any>(), deposits = new Map<string, any>(), grants = new Map<string, any>()
const realCreatePublicBooking = AppointmentService.prototype.createPublicBooking
const realConfirmPendingAppointments = AppointmentService.prototype.confirmPendingAppointments
const realCreateAppointment = AppointmentService.prototype.create
const app = Fastify(), admin = Fastify()
const payload = { serviceId: 'cut', professionalId: 'pro-a', date: '2026-10-20', time: '16:00',
  customerName: 'Submitted name', customerPhone: '15-6655-3322' }
const requestBooking = (extra: any = {}, headers: any = {}) => app.inject({ method: 'POST',
  url: '/public/booking/guest-test/book', headers, payload: { ...payload, ...extra } })
const groupBooking = (headers: any = {}) => app.inject({ method: 'POST', url: '/public/booking/guest-test/book-coordinated', headers,
  payload: { customerName: payload.customerName, customerPhone: payload.customerPhone,
    date: payload.date, itineraryId: 'itinerary-a', serviceSelections: services.map(s => ({ serviceId: s.id })) } })
const cookieHeader = (response: any) => String(response.headers['set-cookie'] || '').split(';')[0]
function fixtureAppointment(input: any) {
  const row = { id: 'appointment-' + (++bookings), businessId: business.id, customerId: 'customer-a',
    customer: { id: 'customer-a', name: 'PRIVATE prior name', phone: '5491166553322', email: 'private@example.test' },
    professionalId: 'pro-a', professional: { id: 'pro-a', name: 'Professional', businessId: business.id },
    serviceId: input.serviceId, service: services.find(s => s.id === input.serviceId), origin: 'WEB',
    startAt: new Date(input.startAt), status: input.status, quotedPrice: input.quotedPrice,
    coordinationGroupId: input.coordinationGroupId || null, totalDurationMinutes: 30, bookingDeposit: null }
  appointments.set(row.id, row); return row
}
try {
  replace(BusinessService.prototype, 'findPublicBySlug', async (slug: string) => ({ ...business,
    ...(slug === 'other-test' ? { id: 'business-b', slug } : {}) }))
  replace(BusinessService.prototype, 'update', async (_id: string, data: any) => { businessWrites++; Object.assign(business, data); return { ...business } })
  replace(db.business, 'findUnique', async () => business)
  replace(db.business, 'findFirst', async ({ where }: any) => where.id === 'business-b' ||
    where.AND?.some((w: any) => w.id === 'business-b') ? null : business)
  replace(db.weexAccountSession, 'findUnique', async () => ({ account, expiresAt: new Date(Date.now() + 60000) }))
  replace(db.weexAccount, 'findUnique', async () => account)
  replace(db.weexCustomerLink, 'upsert', async () => ({}))
  replace(db.customer, 'findMany', async () => [])
  replace(db.customer, 'findFirst', async () => ({ id: 'customer-a', businessId: business.id,
    phone: account.phone, normalizedPhone: account.phone, name: 'PRIVATE prior name' }))
  replace(db.customer, 'update', async ({ data }: any) => { customerWrites++; return { id: 'customer-a', businessId: business.id, ...data, name: 'PRIVATE prior name' } })
  replace(db.customerMarketingPreference, 'upsert', async () => { marketingWrites++; return {} })
  replace(db, '$queryRaw', async () => [])
  replace(db, '$transaction', async (run: any) => {
    const a = structuredClone([...appointments]), d = structuredClone([...deposits]), g = structuredClone([...grants])
    try { return await run(db) } catch (error) {
      appointments.clear(); deposits.clear(); grants.clear()
      for (const [k,v] of a) appointments.set(k,v); for (const [k,v] of d) deposits.set(k,v); for (const [k,v] of g) grants.set(k,v)
      throw error
    }
  })
  replace(db.service, 'findFirst', async ({ where }: any) => services.find(s => s.id === where.id))
  replace(db.serviceCombinationRule, 'findMany', async () => [])
  replace(db.professionalService, 'findMany', async () => services.map(s => ({ serviceId: s.id, professionalId: 'pro-a' })))
  replace(db.professional, 'findMany', async () => [{ id: 'pro-a', name: 'Professional' }])
  replace(db.appointment, 'findMany', async ({ where }: any) => [...appointments.values()].filter(row =>
    (!where.id?.in || where.id.in.includes(row.id)) && (!where.businessId || row.businessId === where.businessId) &&
    (!where.origin || row.origin === where.origin)))
  replace(db.bookingDeposit, 'create', async ({ data }: any) => { const row = { ...data, id: 'deposit-' + deposits.size,
    status: 'PENDING_PROOF', updatedAt: new Date(), proofData: Buffer.from('PRIVATE') }; deposits.set(row.id, row); return row })
  replace(db.bookingDeposit, 'findFirst', async ({ where }: any) => {
    const row = deposits.get(where.id)
    if (!row || row.businessId !== where.businessId || row.source !== 'WEB') return null
    return { ...row, appointment: appointments.get(row.appointmentId) }
  })
  replace(db, 'guestBookingAccess', {
    create: async ({ data }: any) => { if (failGrant) throw new Error('synthetic grant failure'); const row = { ...data,
      id: 'grant-' + grants.size, createdAt: new Date(Date.now() + grants.size) }; grants.set(data.tokenHash, row); return row },
    findUnique: async ({ where }: any) => grants.get(where.tokenHash) || null,
    findFirst: async ({ where }: any) => grants.get(where.tokenHash) || null,
    findMany: async ({ where }: any) => [...grants.values()].filter(g => (!where.tokenHash?.in || where.tokenHash.in.includes(g.tokenHash)) &&
      (!where.businessId || g.businessId === where.businessId) && (!where.expiresAt?.gt || g.expiresAt > where.expiresAt.gt))
  })
  replace(AppointmentService.prototype, 'createPublicBooking', async (input: any, options: any) => db.$transaction(async (tx: any) => {
    const row = fixtureAppointment(input)
    if (input.deposit) row.bookingDeposit = await tx.bookingDeposit.create({ data: {
      ...input.deposit, source: 'WEB', businessId: business.id, appointmentId: row.id
    } })
    await options?.afterCreateInTransaction?.({ transaction: tx, appointment: row, businessId: business.id })
    return { ok: true, appointment: row }
  }))
  replace(AppointmentService.prototype, 'create', async (input: any) => failSecond && input.serviceId === 'color'
    ? { ok: false, message: 'synthetic second conflict' } : { ok: true, appointment: fixtureAppointment(input) })
  replace(AppointmentService.prototype, 'cancel', async (id: string) => { appointments.get(id).status = 'CANCELLED'; return { ok: true } })
  replace(AppointmentService.prototype, 'confirmPendingAppointments', async (ids: string[], options: any) => db.$transaction(async (tx: any) => {
    for (const id of ids) appointments.get(id).status = 'CONFIRMED'
    await options?.afterConfirmInTransaction?.(tx)
    return true
  }))
  replace(BookingAvailabilitySearchEngine.prototype, 'search', async () => ({ options: [{ id: 'itinerary-a',
    segments: services.map((s,index) => ({ serviceId: s.id, professionalId: 'pro-a', startTime: index ? '16:30' : '16:00' })) }] }))
  replace(bookingDepositService, 'expireOverdue', async () => {})
  replace(bookingDepositService, 'submitWebProof', async ({ depositId }: any) => { proofCalls++; return { ok: true,
    deposit: { ...deposits.get(depositId), status: 'PROOF_RECEIVED', customer: { phone: 'PRIVATE' } } } })
  for (const model of [db.service, db.professional, db.businessHours]) replace(model, 'count', async () => 1)
  replace(db.user, 'findFirst', async () => null)
  replace(db.businessOnboardingStatus, 'upsert', async ({ create }: any) => ({ ...create, updatedAt: new Date() }))
  admin.addHook('preHandler', async request => { request.auth = { user: { id: 'admin-a', role, businessId: business.id, canCreateBusinesses: false } } as any })
  await admin.register(businessRoutes); await app.register(publicBookingRoutes)

  await check('SQL defaults false and token hash schema stays separate from financial terms', async () => {
    const sql = readFileSync('prisma/migrations/20261014020000_add_guest_web_booking/migration.sql', 'utf8')
    const pg = new PGlite()
    try {
      await pg.exec('CREATE TABLE "Business" ("id" TEXT PRIMARY KEY); INSERT INTO "Business" VALUES (\'business-a\')')
      await pg.exec(sql)
      assert.equal((await pg.query<any>('SELECT "allowGuestWebBooking" FROM "Business"')).rows[0].allowGuestWebBooking, false)
      await pg.query('INSERT INTO "GuestBookingAccess" ("id", "tokenHash", "businessId", "appointmentIds", "expiresAt") VALUES ($1,$2,$3,$4,$5)',
        ['grant-a', 'hash-only', 'business-a', ['new-appointment'], new Date()])
      assert.equal((await pg.query('SELECT * FROM "GuestBookingAccess"')).rows.length, 1)
      assert.ok(!/BookingDeposit.*ALTER|ALTER.*BookingDeposit/i.test(sql))
    } finally { await pg.close() }
  })
  await check('toggle strict boolean, omission preserves and tenant/staff cannot change it', async () => {
    const patch = (payload: any, id = business.id) => admin.inject({ method: 'PATCH', url: '/businesses/' + id, payload })
    for (const bad of ['true', 1, null, {}, []]) assert.equal((await patch({ allowGuestWebBooking: bad })).statusCode, 400)
    assert.equal((await patch({ allowGuestWebBooking: true })).statusCode, 200)
    assert.equal(business.allowGuestWebBooking, true)
    assert.equal((await patch({ name: 'Offline' })).statusCode, 200); assert.equal(business.allowGuestWebBooking, true)
    role = 'STAFF'; assert.equal((await patch({ allowGuestWebBooking: false })).statusCode, 403)
    role = 'BUSINESS_ADMIN'; assert.equal((await patch({ allowGuestWebBooking: false }, 'business-b')).statusCode, 403)
    assert.equal((await patch({ allowGuestWebBooking: false })).statusCode, 200)
    assert.equal(business.allowGuestWebBooking, false); assert.equal(businessWrites, 3)
  })
  await check('OFF blocks both anonymous routes before customer/booking/marketing side effects', async () => {
    business.allowGuestWebBooking = false
    const before = [customerWrites, bookings, marketingWrites]
    assert.equal((await requestBooking()).statusCode, 401)
    assert.equal((await groupBooking()).statusCode, 401)
    assert.deepEqual([customerWrites, bookings, marketingWrites], before)
  })
  await check('ON creates exactly one isolated guest capability and minimal DTO', async () => {
    business.allowGuestWebBooking = true
    const before = marketingWrites, response = await requestBooking()
    assert.equal(response.statusCode, 200, response.body)
    const cookie = cookieHeader(response); assert.match(cookie, /^guest_booking_business-a_[a-f0-9]{16}=[a-f0-9]{64}$/)
    assert.match(String(response.headers['set-cookie']), /HttpOnly.*SameSite=Strict/)
    assert.match(String(response.headers['set-cookie']), /Path=\/public\/booking\/guest-test/)
    assert.match(String(response.headers['set-cookie']), /Max-Age=604800/)
    const grant = grants.get(createHash('sha256').update(cookie.split('=')[1]).digest('hex'))
    assert.equal(response.json().bookingId, grant.id)
    assert.deepEqual(grant.appointmentIds, [response.json().appointment.id]); assert.equal(grant.depositId, null)
    assert.ok(!response.body.includes('PRIVATE')); assert.ok(!response.body.includes('tokenHash'))
    assert.equal(response.json().guest, true); assert.equal(marketingWrites, before)
    const status = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie } })
    assert.equal(status.statusCode, 200, status.body); assert.equal(status.json().appointments.length, 1)
    assert.ok(!status.body.includes('PRIVATE'))
  })
  await check('lookup rejects absent/malformed/expired/other-tenant and legacy WEB/BOT adoption', async () => {
    for (const cookie of ['', 'guest_booking_business-a=short', 'guest_booking_business-a=' + '0'.repeat(64)]) {
      assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie } })).statusCode, 401)
    }
    const response = await requestBooking(), cookie = cookieHeader(response)
    const grant = grants.get(createHash('sha256').update(cookie.split('=')[1]).digest('hex'))
    assert.equal((await app.inject({ url: '/public/booking/other-test/guest-booking', headers: { cookie } })).statusCode, 401)
    grant.expiresAt = new Date(0)
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie } })).statusCode, 401)
    grant.expiresAt = new Date(Date.now() + 60000)
    appointments.get(grant.appointmentIds[0]).origin = 'BOT'
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie } })).statusCode, 401)
  })
  await check('guest history always denied; Google matching phone allowed, other phone denied before lookup', async () => {
    const url = '/public/booking/guest-test/history?phone=%2B5491166553322'
    assert.equal((await app.inject(url)).statusCode, 401)
    assert.equal((await app.inject({ url, headers: { cookie: 'weex_account_session=synthetic' } })).statusCode, 200)
    assert.equal((await app.inject({ url: url.replace('66553322', '66553323'), headers: { cookie: 'weex_account_session=synthetic' } })).statusCode, 403)
  })
  await check('Google booking remains available with guest OFF and no guest cookie', async () => {
    business.allowGuestWebBooking = false
    const response = await requestBooking({}, { cookie: 'weex_account_session=synthetic' })
    assert.equal(response.statusCode, 200, response.body); assert.ok(!response.headers['set-cookie']); assert.equal(response.json().guest, undefined)
  })
  await check('single grant failure rolls appointment/deposit back and never emits cookie', async () => {
    business.allowGuestWebBooking = true; failGrant = true
    const before = [appointments.size, deposits.size, grants.size]
    const response = await requestBooking()
    assert.ok(response.statusCode >= 400); assert.deepEqual([appointments.size, deposits.size, grants.size], before)
    assert.ok(!response.headers['set-cookie']); failGrant = false
  })
  await check('coordinated failure grants nothing; success grants exact entire group only', async () => {
    failSecond = true
    const before = grants.size, response = await groupBooking()
    assert.equal(response.statusCode, 409); assert.equal(grants.size, before); assert.ok(!response.headers['set-cookie'])
    failSecond = false
    const success = await groupBooking(); assert.equal(success.statusCode, 200, success.body)
    const cookie = cookieHeader(success), grant = grants.get(createHash('sha256').update(cookie.split('=')[1]).digest('hex'))
    assert.equal(success.json().bookingId, grant.id)
    assert.deepEqual(grant.appointmentIds, success.json().appointments.map((a: any) => a.id))
    assert.equal(grant.appointmentIds.length, 2); assert.ok(!success.body.includes('PRIVATE'))
  })
  await check('coordinated grant failure cancels whole group, retains no deposit/cookie/access', async () => {
    services[0].depositMode = 'FIXED'; services[0].depositValue = 5000; failGrant = true
    const before = [deposits.size, grants.size]
    const response = await groupBooking()
    assert.equal(response.statusCode, 409, response.body); assert.deepEqual([deposits.size, grants.size], before)
    assert.ok(!response.headers['set-cookie']); assert.ok([...appointments.values()].slice(-2).every(a => a.status === 'CANCELLED'))
    failGrant = false
  })
  await check('proof scope remains exact after OFF; no phone adoption, private ledger or changed expiry', async () => {
    const response = await groupBooking(); assert.equal(response.statusCode, 200, response.body)
    const cookie = cookieHeader(response), depositId = response.json().deposit.id
    const expiry = deposits.get(depositId).expiresAt.getTime(); business.allowGuestWebBooking = false
    const proof = (id: string, headers: any) => app.inject({ method: 'POST',
      url: '/public/booking/guest-test/deposits/' + id + '/proof', headers, payload: { dataUrl: 'synthetic bytes', filename: 'proof.pdf' } })
    const denied = await proof(depositId, {}); assert.equal(denied.statusCode, 401)
    const before = proofCalls; assert.equal((await proof('different', { cookie })).statusCode, 404); assert.equal(proofCalls, before)
    const accepted = await proof(depositId, { cookie }); assert.equal(accepted.statusCode, 200, accepted.body)
    assert.ok(!accepted.body.includes('PRIVATE')); assert.ok(!accepted.body.includes('proofData'))
    assert.equal(deposits.get(depositId).expiresAt.getTime(), expiry)
  })
  await check('catalog exposes only guest flag, not access tokens', async () => {
    const response = await app.inject('/public/booking/guest-test/catalog')
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().business.allowGuestWebBooking, false)
    assert.ok(!response.body.includes('tokenHash'))
  })
  await check('guest deposit summary retains reserved duration instead of current catalog duration', async () => {
    business.allowGuestWebBooking = true
    const response = await groupBooking(); assert.equal(response.statusCode, 200, response.body)
    const ids = response.json().appointments.map((appointment: any) => appointment.id)
    appointments.get(ids[0]).startAt = new Date('2026-10-20T19:00:00.000Z')
    appointments.get(ids[0]).totalDurationMinutes = 120
    assert.equal(services[0].duration, 30)
    const tracking = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: cookieHeader(response) } })
    assert.equal(tracking.statusCode, 200, tracking.body)
    assert.equal(tracking.json().deposit.segments[0].startTime, '16:00')
    assert.equal(tracking.json().deposit.segments[0].endTime, '18:00')
  })
  await check('two independent cookies retain both exact bookings and selection does not grant authority', async () => {
    const first = await requestBooking(), second = await requestBooking({}, { cookie: cookieHeader(first) })
    assert.equal(first.statusCode, 200, first.body); assert.equal(second.statusCode, 200, second.body)
    const cookies = [cookieHeader(first), cookieHeader(second)]
    assert.notEqual(cookies[0].split('=')[0], cookies[1].split('=')[0], 'new reservation must not replace previous cookie')
    const before = [customerWrites, bookings, marketingWrites, deposits.size]
    const list = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: cookies.join('; ') } })
    assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 2)
    const firstGrant = grants.get(createHash('sha256').update(cookies[0].split('=')[1]).digest('hex'))
    const secondGrant = grants.get(createHash('sha256').update(cookies[1].split('=')[1]).digest('hex'))
    assert.equal(list.json().bookingId, secondGrant.id, 'newest grant is the default, not first cookie')
    const selected = await app.inject({ url: '/public/booking/guest-test/guest-booking?bookingId=' + firstGrant.id,
      headers: { cookie: cookies.join('; ') } })
    assert.equal(selected.statusCode, 200, selected.body); assert.equal(selected.json().bookingId, firstGrant.id)
    assert.deepEqual(selected.json().appointments.map((a: any) => a.id), firstGrant.appointmentIds)
    for (const headers of [{}, { cookie: cookies[1] }]) assert.equal((await app.inject({
      url: '/public/booking/guest-test/guest-booking?bookingId=' + firstGrant.id, headers })).statusCode, 401)
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking?bookingId=unknown',
      headers: { cookie: cookies.join('; ') } })).statusCode, 401)
    for (const privateValue of ['PRIVATE', 'tokenHash', cookies[0].split('=')[1], cookies[1].split('=')[1]]) assert.ok(!list.body.includes(privateValue))
    assert.deepEqual([customerWrites, bookings, marketingWrites, deposits.size], before, 'reading never mutates bookings or finance')
  })
  await check('legacy cookie coexists, duplicates deduplicate and malformed hash suffix cannot authorize', async () => {
    const first = await requestBooking(), second = await requestBooking()
    const token = cookieHeader(first).split('=')[1], legacy = 'guest_booking_business-a=' + token
    const secondCookie = cookieHeader(second)
    const list = await app.inject({ url: '/public/booking/guest-test/guest-booking',
      headers: { cookie: [legacy, cookieHeader(first), secondCookie].join('; ') } })
    assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 2)
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking',
      headers: { cookie: 'guest_booking_business-a_' + '0'.repeat(16) + '=' + token } })).statusCode, 401)
    const grant = grants.get(createHash('sha256').update(token).digest('hex'))
    const expiry = grant.expiresAt.getTime(); await requestBooking({}, { cookie: legacy })
    assert.equal(grant.expiresAt.getTime(), expiry, 'new booking must not renew previous access')
  })
  await check('invalid grants are excluded without hiding valid completed/cancelled/no-show reservations', async () => {
    const responses = await Promise.all(Array.from({ length: 7 }, () => requestBooking()))
    const cookies = responses.map(cookieHeader)
    const rows = cookies.map(cookie => grants.get(createHash('sha256').update(cookie.split('=')[1]).digest('hex')))
    for (const [index, status] of ['COMPLETED', 'CANCELLED', 'NO_SHOW'].entries()) appointments.get(rows[index].appointmentIds[0]).status = status
    rows[3].expiresAt = new Date(0); rows[4].businessId = 'business-b'
    appointments.get(rows[5].appointmentIds[0]).origin = 'BOT'; rows[6].appointmentIds.push('missing')
    const list = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: cookies.join('; ') } })
    assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 3)
    assert.deepEqual(list.json().bookings.flatMap((b: any) => b.appointments.map((a: any) => a.status)).sort(), ['CANCELLED', 'COMPLETED', 'NO_SHOW'])
    for (const row of rows.slice(3)) assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking?bookingId=' + row.id,
      headers: { cookie: cookies.join('; ') } })).statusCode, 401)
  })
  await check('earlier deposit proof remains scoped after a second booking and Google proof remains unchanged', async () => {
    const first = await groupBooking(), second = await requestBooking()
    const firstCookie = cookieHeader(first), cookies = [cookieHeader(second), firstCookie].join('; ')
    const id = first.json().deposit.id, expires = deposits.get(id).expiresAt.getTime()
    const proof = (depositId: string, cookie: string) => app.inject({ method: 'POST',
      url: '/public/booking/guest-test/deposits/' + depositId + '/proof', headers: { cookie }, payload: { dataUrl: 'synthetic', filename: 'proof.pdf' } })
    assert.equal((await proof(id, cookieHeader(second))).statusCode, 404)
    const received = await proof(id, cookies)
    assert.equal(received.statusCode, 200, received.body); assert.equal(received.json().deposit.status, 'PROOF_RECEIVED')
    assert.equal(deposits.get(id).expiresAt.getTime(), expires); assert.ok(!received.body.includes('PRIVATE'))
    assert.equal((await proof(id, 'weex_account_session=synthetic')).statusCode, 200)
    const grant = grants.get(createHash('sha256').update(firstCookie.split('=')[1]).digest('hex'))
    appointments.get(grant.appointmentIds[0]).status = 'CANCELLED'
    const before = proofCalls; assert.equal((await proof(id, cookies)).statusCode, 404); assert.equal(proofCalls, before)
  })
  await check('a deposit rebound outside its grant denies detail and proof without hiding another valid booking', async () => {
    const first = await groupBooking(), second = await requestBooking()
    assert.equal(first.statusCode, 200, first.body); assert.equal(second.statusCode, 200, second.body)
    const cookies = [cookieHeader(first), cookieHeader(second)].join('; ')
    const deposit = deposits.get(first.json().deposit.id), originalAppointmentId = deposit.appointmentId
    const before = [customerWrites, bookings, marketingWrites, proofCalls, deposits.size, deposit.status, deposit.expiresAt.getTime()]
    deposit.appointmentId = second.json().appointment.id
    try {
      const denied = await app.inject({ url: '/public/booking/guest-test/guest-booking?bookingId=' + first.json().bookingId,
        headers: { cookie: cookies } })
      assert.equal(denied.statusCode, 401); assert.ok(!denied.body.includes(first.json().appointments[0].id))
      const list = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: cookies } })
      assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 1)
      assert.equal(list.json().bookingId, second.json().bookingId)
      const proof = await app.inject({ method: 'POST', url: '/public/booking/guest-test/deposits/' + deposit.id + '/proof',
        headers: { cookie: cookies }, payload: { dataUrl: 'must never reach proof storage', filename: 'proof.pdf' } })
      assert.equal(proof.statusCode, 404)
      assert.deepEqual([customerWrites, bookings, marketingWrites, proofCalls, deposits.size, deposit.status, deposit.expiresAt.getTime()], before)
    } finally { deposit.appointmentId = originalAppointmentId }
  })
  await check('capacity rejects single and group before any mutation and retains all concurrent grants', async () => {
    const responses = await Promise.all(Array.from({ length: 21 }, () => requestBooking()))
    assert.ok(responses.every(r => r.statusCode === 200))
    const cookies = responses.map(cookieHeader).join('; '), before = [customerWrites, bookings, marketingWrites, deposits.size, grants.size]
    for (const response of [await requestBooking({}, { cookie: cookies }), await groupBooking({ cookie: cookies })]) {
      assert.equal(response.statusCode, 409, response.body); assert.ok(!response.headers['set-cookie'])
    }
    assert.deepEqual([customerWrites, bookings, marketingWrites, deposits.size, grants.size], before)
    const list = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: cookies } })
    assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 21, 'read threshold must not silently discard raced grants')
    for (const cookie of responses.slice(0, 2).map(cookieHeader)) grants.get(createHash('sha256').update(cookie.split('=')[1]).digest('hex')).expiresAt = new Date(0)
    assert.equal((await requestBooking({}, { cookie: cookies })).statusCode, 200, 'expired grants do not consume valid admission capacity')
  })
  await check('technical cookie/header bounds reject before mutation with no truncation or cookie replacement', async () => {
    const excessive = Array.from({ length: 41 }, (_, i) => {
      const token = i.toString(16).padStart(64, '0')
      return 'guest_booking_business-a_' + createHash('sha256').update(token).digest('hex').slice(0, 16) + '=' + token
    }).join('; ')
    for (const cookie of [excessive, 'other=' + 'x'.repeat(12 * 1024), 'other=' + 'x'.repeat(12 * 1024 - 110)]) {
      const before = [customerWrites, bookings, marketingWrites, deposits.size, grants.size]
      assert.equal((await requestBooking({}, { cookie })).statusCode, 400)
      assert.equal((await groupBooking({ cookie })).statusCode, 400)
      assert.deepEqual([customerWrites, bookings, marketingWrites, deposits.size, grants.size], before)
    }
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: excessive } })).statusCode, 400)
    assert.equal((await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie: 'other=' + 'x'.repeat(12 * 1024) } })).statusCode, 400)
  })
  await check('exactly forty valid concurrent grant cookies remain readable without silent truncation', async () => {
    const responses = await Promise.all(Array.from({ length: 40 }, () => requestBooking()))
    assert.ok(responses.every(response => response.statusCode === 200))
    const cookie = responses.map(cookieHeader).join('; ')
    const before = [customerWrites, bookings, marketingWrites, proofCalls, deposits.size, grants.size]
    const list = await app.inject({ url: '/public/booking/guest-test/guest-booking', headers: { cookie } })
    assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().bookings.length, 40)
    assert.deepEqual(list.json().bookings.map((booking: any) => booking.bookingId).sort(), responses.map(response => response.json().bookingId).sort())
    for (const response of [responses[0], responses[39]]) {
      const detail = await app.inject({ url: '/public/booking/guest-test/guest-booking?bookingId=' + response.json().bookingId, headers: { cookie } })
      assert.equal(detail.statusCode, 200, detail.body); assert.equal(detail.json().appointments[0].id, response.json().appointment.id)
    }
    assert.deepEqual([customerWrites, bookings, marketingWrites, proofCalls, deposits.size, grants.size], before)
  })
  await check('real WEB PDF parser accepts passive PDF for manual review, rejects unsafe/mismatch/size and replay', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create(); doc.addPage([200, 200])
    const bytes = Buffer.from(await doc.save({ useObjectStreams: false }))
    let claims = 0, state = 'PENDING_PROOF', stored: any
    const proofDb: any = { bookingDeposit: {
      findMany: async () => [],
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.source, 'WEB'); assert.equal(where.visitId, null)
        assert.equal(data.status, 'PROOF_RECEIVED'); assert.equal(where.status, 'PENDING_PROOF')
        if (state !== where.status) return { count: 0 }
        state = data.status; stored = data; claims++; return { count: 1 }
      },
      findUnique: async () => ({ id: 'pdf-deposit', ...stored, status: state })
    } }
    const real = new BookingDepositService(proofDb)
    const submit = (data: Buffer, mime = 'application/pdf') => real.submitWebProof({
      depositId: 'pdf-deposit', dataUrl: `data:${mime};base64,${data.toString('base64')}`, filename: 'comprobante.pdf' })
    for (const [data, mime] of [[Buffer.from('%PDF-1.7\nmalformed\n%%EOF'), 'application/pdf'],
      [Buffer.from(bytes.toString('latin1').replace('/Type /Catalog', '/Encrypt 6 0 R /Type /Catalog'), 'latin1'), 'application/pdf'],
      [Buffer.from(bytes.toString('latin1').replace('/Type /Catalog', '/JavaScript (bad) /Type /Catalog'), 'latin1'), 'application/pdf'],
      [Buffer.alloc(3 * 1024 * 1024 + 1), 'application/pdf'], [bytes, 'image/jpeg'], [bytes, 'application/zip']] as const) {
      const result = await submit(data, mime); assert.equal(result.ok, false); assert.equal(claims, 0)
    }
    const accepted = await submit(bytes)
    assert.equal(accepted.ok, true, JSON.stringify(accepted)); assert.equal(stored.proofMimeType, 'application/pdf')
    assert.equal(state, 'PROOF_RECEIVED', 'technical admission never approves payment')
    assert.equal((await submit(bytes)).ok, false, 'replay cannot change review or financial state')
    assert.equal(claims, 1)
  })
  await check('real booking services and SQL preserve atomic guest access, replay safety and marketing preferences', async () => {
    const pg = new PGlite()
    const originalTransaction = db.$transaction
    const originalFindMany = db.appointment.findMany
    const originalProfessional = db.professional.findUnique, originalServices = db.service.findMany, originalCustomer = db.customer.findUnique
    let serial = 0, queryClient: any = pg
    try {
      await pg.exec(`CREATE TABLE "Business" (id TEXT PRIMARY KEY);
        INSERT INTO "Business" VALUES ('business-a');
        CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING','CONFIRMED','CANCELLED','NO_SHOW');
        CREATE TYPE "BookingDepositStatus" AS ENUM ('PENDING_PROOF','PROOF_RECEIVED','APPROVED','EXPIRED');
        CREATE TYPE "BookingVisitStatus" AS ENUM ('HELD','CONFIRMED');
        CREATE TABLE "Professional" (id TEXT PRIMARY KEY, "businessId" TEXT);
        INSERT INTO "Professional" VALUES ('pro-a','business-a');
        CREATE TABLE "Appointment" (id TEXT PRIMARY KEY, "businessId" TEXT, "professionalId" TEXT,
          "startAt" TIMESTAMP, "totalDurationMinutes" INTEGER, status "AppointmentStatus", "visitId" TEXT);
        CREATE TABLE "BookingDeposit" (id TEXT PRIMARY KEY, "appointmentId" TEXT,
          status "BookingDepositStatus", "expiresAt" TIMESTAMP);
        CREATE TABLE "BookingVisit" (id TEXT, "businessId" TEXT, status "BookingVisitStatus", "holdExpiresAt" TIMESTAMP);`)
      await pg.exec(readFileSync('prisma/migrations/20261014020000_add_guest_web_booking/migration.sql', 'utf8'))
      let marketingTouches = 0
      const existingPreference = { status: 'OPTED_OUT', source: 'CUSTOMER' }
      const adapter: any = {
        customerMarketingPreference: { upsert: async ({ update }: any) => {
          marketingTouches++; assert.deepEqual(update, {}); return existingPreference
        } },
        professional: { findFirst: async () => ({ id: 'pro-a', businessId: business.id, isActive: true }),
          findMany: async () => [{ id: 'pro-a' }] },
        service: { findMany: async ({ where }: any) => services.filter(s => where.id.in.includes(s.id)) },
        professionalService: { count: async ({ where }: any) => where.serviceId.in.length },
        businessHours: { findMany: async () => [{ startTime: '00:00', endTime: '23:59' }] },
        professionalHours: { findMany: async () => [{ startTime: '00:00', endTime: '23:59' }] },
        scheduleBlock: { findFirst: async () => null },
        $queryRaw: async (query: any, ...values: any[]) => {
          const sql = Array.isArray(query) ? Prisma.sql(query as any, ...values) : query
          // Resource scoping and overlap SQL execute; lock waiting is not claimed by this single-connection test.
          if (sql.text.includes('pg_advisory_xact_lock')) return []
          return (await queryClient.query(sql.text, sql.values)).rows
        },
        guestBookingAccess: { create: async ({ data }: any) => {
          await queryClient.query('INSERT INTO "GuestBookingAccess" (id,"tokenHash","businessId","appointmentIds","depositId","expiresAt") VALUES ($1,$2,$3,$4,$5,$6)',
            ['sql-grant-' + serial, data.tokenHash, data.businessId, data.appointmentIds, data.depositId, data.expiresAt])
          return data
        } },
        appointment: {
          count: async ({ where }: any) => (await queryClient.query('SELECT count(*)::int n FROM "Appointment" WHERE id=ANY($1) AND status=$2', [where.id.in, where.status])).rows[0].n,
          updateMany: async ({ where, data }: any) => ({ count: (await queryClient.query('UPDATE "Appointment" SET status=$1 WHERE id=ANY($2) AND status=$3 RETURNING id', [data.status, where.id.in, where.status])).rows.length }),
          create: async ({ data }: any) => {
          const id = 'sql-appointment-' + (++serial)
          await queryClient.query('INSERT INTO "Appointment" (id,"businessId","professionalId","startAt","totalDurationMinutes",status) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, data.businessId, data.professionalId, data.startAt, data.totalDurationMinutes, data.status])
          let deposit = null
          if (data.bookingDeposit) {
            deposit = { ...data.bookingDeposit.create, id: 'sql-deposit-' + serial, status: 'PENDING_PROOF' }
            await queryClient.query('INSERT INTO "BookingDeposit" VALUES ($1,$2,$3,$4)', [deposit.id, id, deposit.status, deposit.expiresAt])
          }
          return { ...data, id, bookingDeposit: deposit }
        } }
      }
      db.$transaction = (run: any) => pg.transaction(async tx => { queryClient = tx; return run(adapter) })
      const engine = new AppointmentService(), input = { businessId: business.id, customerId: 'customer-a',
        customerPhone: '5491166553322', professionalId: 'pro-a', serviceId: 'cut', startAt: '2026-10-20T16:00:00',
        status: 'PENDING' as const, deposit: { mode: 'FIXED' as const, configuredValue: 5000, baseAmount: null,
          amount: 5000, expiresAt: new Date(Date.now() + 3600000) } }
      await assert.rejects(realCreatePublicBooking.call(engine, input, { afterCreateInTransaction: async () => { throw new Error('SQL grant unavailable') } }), /SQL grant unavailable/)
      for (const table of ['Appointment', 'BookingDeposit', 'GuestBookingAccess']) assert.equal((await pg.query<any>(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n, 0)
      const { persistGuestBookingAccess } = await import('../src/services/guest-booking-access.js')
      const success = await realCreatePublicBooking.call(engine, input, { afterCreateInTransaction: async ({ transaction, appointment }) => {
        await persistGuestBookingAccess(transaction, { tokenHash: 'sql-token', businessId: business.id,
          appointmentIds: [appointment.id], depositId: (appointment as any).bookingDeposit.id, expiresAt: new Date(Date.now() + 60000) })
      } })
      assert.equal(success.ok, true)
      const repeated = await realCreatePublicBooking.call(engine, input, { afterCreateInTransaction: async () => { throw new Error('must not grant replay') } })
      assert.equal(repeated.ok, false)
      for (const table of ['Appointment', 'BookingDeposit', 'GuestBookingAccess']) assert.equal((await pg.query<any>(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n, 1)
      await pg.exec('DELETE FROM "GuestBookingAccess"; DELETE FROM "BookingDeposit"; DELETE FROM "Appointment"')
      await pg.exec(`INSERT INTO "Appointment" VALUES ('segment-a','business-a','pro-a','2026-10-20 16:00',30,'PENDING',NULL),
        ('segment-b','business-a','pro-a','2026-10-20 16:30',30,'PENDING',NULL)`)
      db.appointment.findMany = async () => (await pg.query<any>('SELECT * FROM "Appointment" ORDER BY "startAt"')).rows.map(row => ({
        ...row, startAt: new Date(row.startAt), serviceId: 'cut', serviceItems: [], professional: { businessId: business.id }
      }))
      const ids = ['segment-a', 'segment-b']
      await assert.rejects(realConfirmPendingAppointments.call(engine, ids, { afterConfirmInTransaction: async () => { throw new Error('SQL coordinated grant unavailable') } }), /SQL coordinated grant unavailable/)
      assert.ok((await pg.query<any>('SELECT status FROM "Appointment"')).rows.every(row => row.status === 'PENDING'))
      assert.equal(await realConfirmPendingAppointments.call(engine, ids, { afterConfirmInTransaction: async transaction => {
        await persistGuestBookingAccess(transaction, { tokenHash: 'coordinated-token', businessId: business.id,
          appointmentIds: ids, depositId: null, expiresAt: new Date(Date.now() + 60000) })
      } }), true)
      assert.ok((await pg.query<any>('SELECT status FROM "Appointment"')).rows.every(row => row.status === 'CONFIRMED'))
      assert.deepEqual((await pg.query<any>('SELECT "appointmentIds" FROM "GuestBookingAccess"')).rows[0].appointmentIds, ids)
      db.professional.findUnique = async () => ({ id: 'pro-a', businessId: business.id, isActive: true })
      db.service.findMany = async () => [services[0]]
      db.customer.findUnique = async () => ({ id: 'customer-a', businessId: business.id, phone: '5491166553322' })
      for (const method of ['professionalOffersServices', 'isInsideBusinessHours', 'isInsideProfessionalHours']) (engine as any)[method] = async () => true
      for (const method of ['hasScheduleBlockOverlap', 'hasAppointmentOverlap']) (engine as any)[method] = async () => false
      const genericInput = { customerId: 'customer-a', professionalId: 'pro-a', serviceId: 'cut',
        startAt: '2026-10-20T17:00:00', status: 'PENDING' as const, origin: 'WEB' as const }
      assert.equal((await realCreateAppointment.call(engine, genericInput, undefined, { skipDefaultMarketingPreference: true })).ok, true)
      assert.equal(marketingTouches, 0, 'guest group must not create or mutate default marketing preference')
      assert.deepEqual(existingPreference, { status: 'OPTED_OUT', source: 'CUSTOMER' })
      assert.equal((await realCreateAppointment.call(engine, { ...genericInput, startAt: '2026-10-20T17:30:00' })).ok, true)
      assert.equal(marketingTouches, 1, 'non-guest generic booking retains existing preference behavior')
      assert.deepEqual(existingPreference, { status: 'OPTED_OUT', source: 'CUSTOMER' })
    } finally {
      db.$transaction = originalTransaction; db.appointment.findMany = originalFindMany
      db.professional.findUnique = originalProfessional; db.service.findMany = originalServices; db.customer.findUnique = originalCustomer
      await pg.close()
    }
  })
} finally {
  await app.close(); await admin.close()
  for (const restore of restores.reverse()) restore()
  await prisma.$disconnect()
}
console.log(`${passes} passed; ${failures} failed`)
if (failures) process.exitCode = 1
