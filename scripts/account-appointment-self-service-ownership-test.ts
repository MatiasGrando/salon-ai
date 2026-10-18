import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.DOTENV_CONFIG_PATH = '__offline_self_service_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/self_service_test'
const { prisma } = await import('../src/config/prisma.js')
const { getWeexAuthFromRequest, getWeexAppointmentsForBusiness } = await import('../src/services/weex-account-service.js')
const source = readFileSync('src/routes/public-booking.ts', 'utf8')
const schema = readFileSync('prisma/schema.prisma', 'utf8')
let api: any = {}
try { api = await import('../src/services/web-appointment-self-service.js') } catch {}
let pass = 0, fail = 0
async function check(name: string, run: () => any) {
  try { await run(); pass++; console.log('PASS ' + name) }
  catch (error) { fail++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const db = prisma as any, restore: Array<() => void> = []
function mock(target: any, key: string, fn: any) {
  const prior = target[key]; target[key] = fn; restore.push(() => { target[key] = prior })
}
const session = { account: { id: 'account-a', email: 'synthetic@example.test', emailVerified: true,
  name: 'Synthetic', avatarUrl: null, phone: '5491140000000', phoneVerifiedAt: null }, expiresAt: new Date(Date.now() + 60000) }
const request: any = { headers: { cookie: 'weex_account_session=synthetic' } }
try {
  await check('creator identity is nullable FK, with no telephone backfill', () => {
    assert.match(schema, /createdByWeexAccountId\s+String\?/)
    assert.match(schema, /createdByWeexAccount\s+WeexAccount\?\s+@relation/)
    const sql = readFileSync('prisma/migrations/20261018010000_add_web_appointment_self_service/migration.sql', 'utf8')
    assert.match(sql, /REFERENCES "WeexAccount"/)
    assert.doesNotMatch(sql, /UPDATE\s+"Appointment"|normalizedPhone|WeexCustomerLink/i)
  })
  await check('new individual and group hooks use authenticated account, not submitted identity', () => {
    assert.ok((source.match(/persistWebBookingOwner\(/g) || []).length >= 2)
    assert.match(source, /accountId: weexAuth\.account\.id/)
    assert.doesNotMatch(source, /accountId: body\./)
  })
  await check('owner is attributed in caller transaction only for new WEB row', async () => {
    let call: any
    await api.persistWebBookingOwner({ appointment: { updateMany: async (arg: any) => { call = arg; return { count: 1 } } } },
      { businessId: 'business-a', appointmentId: 'a', accountId: 'account-a' })
    assert.deepEqual(call.where, { id: 'a', businessId: 'business-a', origin: 'WEB', createdByWeexAccountId: null })
    assert.deepEqual(call.data, { createdByWeexAccountId: 'account-a' })
  })
  await check('attribution failure aborts caller transaction', async () => {
    await assert.rejects(() => api.persistWebBookingOwner({ appointment: { updateMany: async () => ({ count: 0 }) } },
      { businessId: 'business-a', appointmentId: 'a', accountId: 'account-a' }), /OWNER/)
  })
  await check('transactional auth is read-only, expired session never deleted', async () => {
    let deletes = 0
    const tx: any = { weexAccountSession: { findUnique: async () => ({ ...session, expiresAt: new Date(0) }),
      delete: async () => { deletes++ } } }
    const auth = await (getWeexAuthFromRequest as any)(request, tx)
    assert.equal(auth, null); assert.equal(deletes, 0)
  })
  await check('transactional auth uses its own fresh session, not ambient client', async () => {
    const auth = await (getWeexAuthFromRequest as any)(request, { weexAccountSession: { findUnique: async () => session } })
    assert.equal(auth.account.id, 'account-a')
  })
  mock(db.weexCustomerLink, 'findMany', async () => [{ customerId: 'phone-linked', businessId: 'business-a' }])
  mock(db.business, 'findUnique', async () => ({ id: 'business-a', slug: 'test', name: 'Synthetic' }))
  mock(db.appointment, 'findMany', async (args: any) => {
    assert.ok(args.where.OR.some((v: any) => v.createdByWeexAccountId === 'account-a'), 'include directly owned appointments independently of phone links')
    return ['account-a', null, 'another-account'].map((owner, index) => ({ id: 'a' + index, businessId: 'business-a',
      createdByWeexAccountId: owner, startAt: new Date(Date.now() + 86400000), status: 'CONFIRMED', origin: 'WEB',
      visitId: null, bookingDeposit: null, quotedPrice: 15000, totalDurationMinutes: 30,
      service: { id: 's', name: 'Cut', duration: 30, price: 99999 }, customer: { id: 'phone-linked', name: 'Synthetic', phone: '1140000000' },
      professional: { id: 'p', name: 'Professional', business: { id: 'business-a', slug: 'test', name: 'Synthetic' } } }))
  })
  await check('phone-linked legacy and foreign account reservations cannot self-manage', async () => {
    const result = await getWeexAppointmentsForBusiness('account-a', 'test')
    assert.equal((result.appointments[0] as any).selfService.mode, 'direct')
    assert.equal((result.appointments[1] as any).selfService.mode, 'contact')
    assert.equal((result.appointments[2] as any).selfService.mode, 'contact')
  })
} finally { for (const reset of restore.reverse()) reset(); await prisma.$disconnect() }
console.log(`RESULT ${pass} PASS ${fail} FAIL`)
if (fail) process.exitCode = 1
