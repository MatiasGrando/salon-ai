import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH = '__offline_self_service_actions_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/self_service_actions_test'
const api: any = await import('../src/services/web-appointment-self-service.js')
const { prisma } = await import('../src/config/prisma.js')
const { publicBookingRoutes } = await import('../src/routes/public-booking.js')
const now = new Date('2026-10-18T12:00:00Z'), date = '2026-10-21'
const headers = { cookie: 'weex_account_session=synthetic', origin: 'https://demo.weex.com.ar', 'sec-fetch-site': 'same-origin' }
const request: any = { headers, host: 'demo.weex.com.ar', protocol: 'https' }
let passed = 0, failed = 0
async function check(name: string, run: () => any) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
function fixture(group = false) {
  const writes: any[] = [], queries: any[] = [], journal = new Map<string, any>()
  const service = { id: 'cut', name: 'Cut', duration: 120, price: 99999, businessId: 'b', isActive: true }
  const professional = { id: 'p1', name: 'Professional one', businessId: 'b', isActive: true }
  const rows: any[] = [{ id: 'a1', businessId: 'b', customerId: 'customer', origin: 'WEB', status: 'CONFIRMED',
    createdByWeexAccountId: 'account', visitId: null, coordinationGroupId: group ? 'group' : null,
    version: 0, startAt: new Date('2026-10-20T13:00:00Z'), professionalId: 'p1', serviceId: 'cut', totalDurationMinutes: 30,
    quotedPrice: 15000, service, professional, serviceItems: [{ serviceId: 'cut', sortOrder: 0, durationMinutes: 30, price: 15000 }],
    bookingDeposit: null, googleCalendarEventId: null }]
  if (group) rows.push({ ...rows[0], id: 'a2', professionalId: 'p2', professional: { ...professional, id: 'p2', name: 'Professional two' },
    startAt: new Date('2026-10-20T13:30:00Z'), serviceId: 'color', service: { ...service, id: 'color', name: 'Color' },
    serviceItems: [{ serviceId: 'color', sortOrder: 0, durationMinutes: 60, price: 20000 }], totalDurationMinutes: 60, quotedPrice: 20000 })
  let session: any = { account: { id: 'account', name: 'Synthetic', email: 'synthetic@example.test', emailVerified: true,
    avatarUrl: null, phone: '5491140000000', phoneVerifiedAt: null }, expiresAt: new Date('2030-01-01') }
  let busy: any[] = [], grants: any[] = [], failUpdate = '', lockCallback: (() => void) | undefined, reminders: any[] = []
  const allProfessionals = [professional, { ...professional, id: 'p2', name: 'Professional two' }]
  const tx: any = {
    weexAccountSession: { findUnique: async () => session },
    guestBookingAccess: { findMany: async ({ where }: any) => grants.filter(g => where.tokenHash.in.includes(g.tokenHash)) },
    business: { findUnique: async () => ({ id: 'b', slug: 'demo', accountStatus: 'ACTIVE', landingEnabled: true, timezone: 'America/Argentina/Buenos_Aires' }) },
    businessBotOptionsSettings: { findUnique: async () => ({ timezone: 'America/Argentina/Buenos_Aires', bookingHorizonDays: 30,
      bookingLeadTimeHours: 0, rescheduleLeadMinutes: 60, cancellationLeadMinutes: 60 }) },
    professional: { findMany: async ({ where }: any) => allProfessionals.filter(p => !where.id?.in || where.id.in.includes(p.id)),
      findFirst: async ({ where }: any) => allProfessionals.find(p => p.id === where.id && p.businessId === where.businessId) },
    professionalService: { count: async ({ where }: any) => where.serviceId.in.length,
      findMany: async () => allProfessionals.flatMap(p => ['cut', 'color'].map(serviceId => ({ professionalId: p.id, serviceId }))) },
    service: { findMany: async ({ where }: any) => where.id.in.map((id: string) => ({ ...service, id })) },
    businessHours: { findMany: async () => [{ dayOfWeek: 3, startTime: '09:00', endTime: '18:00' }] },
    professionalHours: { findMany: async () => allProfessionals.map(p => ({ professionalId: p.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00' })) },
    scheduleBlock: { findMany: async () => [], findFirst: async () => null },
    appointment: {
      findFirst: async ({ where }: any) => rows.find(a => a.id === where.id && a.businessId === where.businessId) ?? null,
      findMany: async ({ where }: any) => rows.filter(a => (!where.id?.in || where.id.in.includes(a.id)) &&
        (!where.businessId || a.businessId === where.businessId) && (!where.coordinationGroupId || a.coordinationGroupId === where.coordinationGroupId)),
      update: async ({ where, data }: any) => {
        if (failUpdate === where.id) throw new Error('synthetic second member failure')
        const row = rows.find(a => a.id === where.id); writes.push({ id: where.id, data: structuredClone(data) })
        Object.assign(row, data, { version: row.version + (data.version?.increment ?? 0) }); return row
      }
    },
    webAppointmentAction: { findUnique: async ({ where }: any) => journal.get(where.operationId) ?? null,
      create: async ({ data }: any) => { journal.set(data.operationId, structuredClone(data)); return data } },
    reminderDelivery: { updateMany: async ({ where, data }: any) => {
      for (const row of reminders) if (where.appointmentId.in.includes(row.appointmentId) && where.status.in.includes(row.status)) Object.assign(row, data)
      return { count: reminders.length }
    } },
    $queryRaw: async (sql: any) => {
      const text = sql.strings.join('?'); queries.push(text)
      if (text.includes('web-self-service-now')) return [{ now }]
      if (text.includes('web-self-service-busy')) return busy
      if (text.includes('web-self-service-reminders')) return reminders
      if (text.includes('pg_advisory_xact_lock')) { lockCallback?.(); lockCallback = undefined; return [{ locked: 1 }] }
      if (text.includes('FOR UPDATE OF a')) return rows.map(a => ({ id: a.id, professionalId: a.professionalId }))
      if (text.includes('AS "overlaps"')) return [{ overlaps: busy.some(b => b.professionalId === sql.values[0]) }]
      return []
    }
  }
  const input = { request, businessId: 'b', appointmentId: 'a1' }
  async function management() { return api.webAppointmentManagement(tx, input) }
  async function options() { return api.webAppointmentRescheduleOptions(tx, { ...input, date }) }
  async function mutation(action: string, body: any, customRequest = request) {
    const snapshot = structuredClone(rows), auditSnapshot = new Map(journal)
    try { return await api.mutateWebAppointment(tx, { ...input, request: customRequest, action, body }) }
    catch (error) { rows.splice(0, rows.length, ...snapshot); journal.clear(); for (const [id, entry] of auditSnapshot) journal.set(id, entry); throw error }
  }
  async function rescheduleBody() {
    const managed = await management(), choices = await options()
    const option = choices.options.find((v: any) => v.time === '10:00')
    assert.ok(option, '10:00 option should be available')
    return { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision,
      date, professionalIds: rows.map(a => a.professionalId), optionId: option.id }
  }
  return { tx, rows, writes, queries, journal, input, management, options, mutation, rescheduleBody,
    setSession: (s: any) => { session = s }, setBusy: (v: any[]) => { busy = v },
    setGrants: (v: any[]) => { grants = v }, failUpdate: (v: string) => { failUpdate = v },
    onLock: (v: () => void) => { lockCallback = v } }
}
await check('GET returns complete group, snapshot price/duration and makes no writes or locks', async () => {
  const f = fixture(true), result = await f.management()
  assert.deepEqual(result.appointments.map((a: any) => [a.id, a.service.duration, a.service.price]), [['a1', 30, 15000], ['a2', 60, 20000]])
  assert.equal(result.selfService.mode, 'direct'); assert.equal(f.writes.length, 0)
  assert.ok(!f.queries.some(q => /FOR UPDATE|pg_advisory/.test(q)))
})
for (const attack of ['legacy', 'another-account', 'cross-business', 'partial-group']) await check('GET rejects ' + attack + ' without disclosing details', async () => {
  const f = fixture(attack === 'partial-group')
  if (attack === 'legacy') f.rows[0].createdByWeexAccountId = null
  if (attack === 'another-account') f.rows[0].createdByWeexAccountId = 'other'
  if (attack === 'cross-business') f.rows[0].businessId = 'foreign'
  if (attack === 'partial-group') f.rows[1].createdByWeexAccountId = 'other'
  await assert.rejects(f.management, (e: any) => e.statusCode === 404); assert.equal(f.writes.length, 0)
})
await check('guest authority requires exact valid grant for all members', async () => {
  const f = fixture(true), token = 'a'.repeat(64), tokenHash = createHash('sha256').update(token).digest('hex')
  f.setSession(null); f.input.request = { ...request, headers: { ...headers, cookie: `guest_booking_b_${tokenHash.slice(0, 16)}=${token}` } }
  const grant = { id: 'grant', tokenHash, businessId: 'b', appointmentIds: ['a1', 'a2'], expiresAt: new Date('2030-01-01'), createdAt: now }
  f.setGrants([grant]); assert.equal((await f.management()).selfService.mode, 'direct')
  f.setGrants([{ ...grant, appointmentIds: ['a1'] }]); await assert.rejects(f.management, (e: any) => e.statusCode === 404)
  f.setGrants([{ ...grant, expiresAt: new Date(0) }]); await assert.rejects(f.management, (e: any) => e.statusCode === 404)
  f.setGrants([]); await assert.rejects(f.management, (e: any) => e.statusCode === 404)
})
for (const financial of ['F8', 'review', 'pending']) await check(financial + ' stays contact-only, no financial mutation', async () => {
  const f = fixture(); f.rows[0].bookingDeposit = { id: 'd', source: 'WEB', status: financial === 'review' ? 'PROOF_RECEIVED' : financial === 'pending' ? 'PENDING_PROOF' : 'APPROVED', snapshotSealedAt: financial === 'F8' ? now : null }
  const managed = await f.management(); assert.equal(managed.selfService.mode, 'contact')
  await assert.rejects(() => f.mutation('CANCEL', { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true }), (e: any) => e.statusCode === 422)
  assert.equal(f.writes.length, 0)
})
await check('options use contracted duration, exclude own group and keep order', async () => {
  const f = fixture(true), result = await f.options(), first = result.options.find((o: any) => o.time === '10:00')
  assert.deepEqual(first.segments.map((s: any) => [s.appointmentId, s.durationMinutes, s.startAt]),
    [['a1', 30, '2026-10-21T13:00:00.000Z'], ['a2', 60, '2026-10-21T13:30:00.000Z']])
  assert.ok(f.queries.some(q => q.includes('web-self-service-busy') && q.includes('NOT IN')))
  assert.equal(f.writes.length, 0)
})
await check('reschedule changes only start/professional/version with real actor audit', async () => {
  const f = fixture(true), body = await f.rescheduleBody(), before = structuredClone(f.rows)
  const result = await f.mutation('RESCHEDULE', body)
  assert.equal(result.appointments[0].startAt, '2026-10-21T13:00:00.000Z')
  assert.ok(f.writes.every(w => Object.keys(w.data).sort().join(',') === 'professionalId,startAt,version'))
  assert.equal(f.journal.size, 1); assert.equal([...f.journal.values()][0].actorId, 'account')
  for (let i = 0; i < f.rows.length; i++) for (const key of ['serviceId', 'quotedPrice', 'totalDurationMinutes', 'bookingDeposit', 'serviceItems']) assert.deepEqual(f.rows[i][key], before[i][key])
  const businessLock = f.queries.findIndex(q => q.includes('pg_advisory')), rowLock = f.queries.findIndex(q => q.includes('FOR UPDATE OF a'))
  assert.ok(businessLock >= 0 && rowLock > businessLock)
})
await check('cancel preserves approved deposit and payments, keeps rows/history and audit', async () => {
  const f = fixture(true); f.rows[0].bookingDeposit = { id: 'd', source: 'WEB', status: 'APPROVED', amount: 5000, snapshotSealedAt: null, proofData: Buffer.from('fake') }
  const before = structuredClone(f.rows[0].bookingDeposit), managed = await f.management()
  await f.mutation('CANCEL', { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true })
  assert.deepEqual(structuredClone(f.rows[0].bookingDeposit), before); assert.ok(f.rows.every(a => a.status === 'CANCELLED'))
  assert.equal(f.rows.length, 2); assert.equal((await f.management()).selfService.canCancel, false)
  assert.ok(f.writes.every(w => Object.keys(w.data).sort().join(',') === 'status,version'))
})
await check('same operation retry is idempotent; changed payload conflicts', async () => {
  const f = fixture(), body = await f.rescheduleBody()
  await f.mutation('RESCHEDULE', body); const writes = f.writes.length
  const retry = await f.mutation('RESCHEDULE', body); assert.equal(retry.idempotent, true); assert.equal(f.writes.length, writes)
  await assert.rejects(() => f.mutation('RESCHEDULE', { ...body, date: '2026-10-22' }), (e: any) => e.statusCode === 409)
})
await check('a changed group revision and stale option cannot mutate', async () => {
  const f = fixture(true), body = await f.rescheduleBody(); f.rows[1].version++
  await assert.rejects(() => f.mutation('RESCHEDULE', body), (e: any) => e.statusCode === 409)
  assert.equal(f.writes.length, 0)
})
await check('late conflict revalidates fresh availability and preserves whole group', async () => {
  const f = fixture(true), body = await f.rescheduleBody(); f.setBusy([{ professionalId: 'p2', startAt: new Date('2026-10-21T13:00:00Z'), endAt: new Date('2026-10-21T15:00:00Z') }])
  await assert.rejects(() => f.mutation('RESCHEDULE', body), (e: any) => e.statusCode === 409)
  assert.equal(f.writes.length, 0)
})
await check('second member failure escapes, outer transaction rolls back whole group/audit', async () => {
  const f = fixture(true), body = await f.rescheduleBody(), before = structuredClone(f.rows); f.failUpdate('a2')
  await assert.rejects(() => f.mutation('RESCHEDULE', body), /synthetic/)
  assert.deepEqual(f.rows, before); assert.equal(f.journal.size, 0)
})
await check('session revocation during lock wait is rechecked before writes', async () => {
  const f = fixture(), body = await f.rescheduleBody(); f.onLock(() => f.setSession(null))
  await assert.rejects(() => f.mutation('RESCHEDULE', body), (e: any) => e.statusCode === 404); assert.equal(f.writes.length, 0)
})
for (const origin of [undefined, 'https://evil.test', 'https://demo.weex.com.ar:444', 'https://evil@demo.weex.com.ar']) await check('mutation rejects unsafe/missing Origin ' + origin, async () => {
  const f = fixture(), managed = await f.management()
  await assert.rejects(() => f.mutation('CANCEL', { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true },
    { ...request, headers: { ...headers, origin } }), (e: any) => e.statusCode === 403)
  assert.equal(f.writes.length, 0)
})
await check('cross-site metadata and missing explicit cancellation consent are rejected', async () => {
  const f = fixture(), managed = await f.management(), body = { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true }
  await assert.rejects(() => f.mutation('CANCEL', body, { ...request, headers: { ...headers, 'sec-fetch-site': 'cross-site' } }), (e: any) => e.statusCode === 403)
  await assert.rejects(() => f.mutation('CANCEL', { ...body, confirmed: false }), (e: any) => e.statusCode === 400)
})
await check('policy lead window and past appointments never mutate', async () => {
  const f = fixture(); f.rows[0].startAt = new Date(now.getTime() + 30 * 60000)
  const managed = await f.management(); assert.equal(managed.selfService.canReschedule, false)
  await assert.rejects(() => f.mutation('CANCEL', { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true }), (e: any) => e.statusCode === 422)
})
await check('in-flight reminder is locked and blocks mutation before any appointment write', async () => {
  const f = fixture(), managed = await f.management()
  const raw = f.tx.$queryRaw
  f.tx.$queryRaw = async (sql: any) => sql.strings.join('?').includes('web-self-service-reminders')
    ? [{ id: 'r', appointmentId: 'a1', status: 'PROCESSING' }] : raw(sql)
  await assert.rejects(() => f.mutation('CANCEL', { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.selfService.revision, confirmed: true }), (e: any) => e.statusCode === 409)
  assert.equal(f.writes.length, 0)
})
await check('pending reminders are row-locked and invalidated in the same transaction', async () => {
  const f = fixture(), body = await f.rescheduleBody(); let cancellation: any
  f.tx.reminderDelivery.updateMany = async (args: any) => { cancellation = args; return { count: 1 } }
  await f.mutation('RESCHEDULE', body)
  assert.ok(f.queries.some(q => q.includes('web-self-service-reminders') && q.includes('FOR UPDATE')))
  assert.deepEqual(cancellation.where.appointmentId.in, ['a1'])
  assert.deepEqual(cancellation.where.status.in, ['PENDING', 'FAILED']); assert.equal(cancellation.data.status, 'CANCELLED')
})
await check('new endpoints use no-store and invoke shared transactional writer', () => {
  const source = readFileSync('src/routes/public-booking.ts', 'utf8')
  for (const path of ['manage', 'reschedule-options']) assert.ok(source.includes('/appointments/:appointmentId/' + path))
  assert.match(source, /\['reschedule', 'cancel'\] as const/)
  assert.ok(source.includes("'/public/booking/:slug/appointments/:appointmentId/' + action"))
  assert.match(source, /mutateWebAppointment\(transaction/)
})
await check('real Fastify endpoints return no-store, enforce Origin and complete group change', async () => {
  const f = fixture(true), app = Fastify(), resets: Array<() => void> = []
  const db = prisma as any
  for (const [key, value] of Object.entries(f.tx)) {
    const prior = db[key]; db[key] = value; resets.push(() => { db[key] = prior })
  }
  const priorTransaction = db.$transaction
  db.$transaction = async (run: any) => run(f.tx)
  try {
    await app.register(publicBookingRoutes)
    const root = '/public/booking/demo/appointments/a1', httpHeaders = { ...headers, host: 'demo.weex.com.ar', origin: 'http://demo.weex.com.ar' }
    const managed = await app.inject({ url: root + '/manage', headers: httpHeaders })
    assert.equal(managed.statusCode, 200, managed.body); assert.equal(managed.headers['cache-control'], 'no-store')
    assert.equal(managed.json().appointments.length, 2)
    const available = await app.inject({ url: root + '/reschedule-options?date=' + date + '&professionalIds=p1,p2', headers: httpHeaders })
    assert.equal(available.statusCode, 200, available.body)
    const selected = available.json().options.find((o: any) => o.time === '10:00')
    const body = { operationId: '77b53ee1-5912-4ee2-a594-dc01713f9ba0', revision: managed.json().selfService.revision,
      date, professionalIds: ['p1', 'p2'], optionId: selected.id }
    const denied = await app.inject({ method: 'POST', url: root + '/reschedule', headers: { ...httpHeaders, origin: 'https://evil.test' }, payload: body })
    assert.equal(denied.statusCode, 403); assert.equal(f.writes.length, 0)
    const changed = await app.inject({ method: 'POST', url: root + '/reschedule', headers: httpHeaders, payload: body })
    assert.equal(changed.statusCode, 200, changed.body); assert.equal(changed.headers['cache-control'], 'no-store')
    assert.equal(changed.json().appointments[0].startAt, '2026-10-21T13:00:00.000Z')
    const cancelled = await app.inject({ method: 'POST', url: root + '/cancel', headers: httpHeaders,
      payload: { operationId: '6a283670-d989-478e-941e-9b5b12826766', revision: changed.json().selfService.revision, confirmed: true } })
    assert.equal(cancelled.statusCode, 200, cancelled.body)
    assert.ok(cancelled.json().appointments.every((a: any) => a.status === 'CANCELLED'))
    assert.equal(cancelled.json().selfService.canCancel, false)
  } finally {
    await app.close(); db.$transaction = priorTransaction; for (const reset of resets.reverse()) reset()
  }
})
console.log(`RESULT ${passed} PASS ${failed} FAIL`)
if (failed) process.exitCode = 1
