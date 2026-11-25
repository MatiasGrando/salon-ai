import assert from 'node:assert/strict'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_appointment_test'
process.env.DOTENV_CONFIG_PATH = 'C:/__appointment_offline_no_env__'
const [{ prisma }, { AppointmentService }] = await Promise.all([import('../src/config/prisma.js'), import('../src/services/appointment-service.js')])
const db = prisma as any
const restores: Array<() => void> = []
function patch(object: any, key: string, value: any) { const before = object[key]; object[key] = value; restores.push(() => { object[key] = before }) }
const actor: any = { id: 'actor', role: 'BUSINESS_ADMIN', businessId: 'b', name: 'Admin', canCreateBusinesses: false }
const professional = { id: 'p', businessId: 'b', isActive: true }
const svc = { id: 's', businessId: 'b', duration: 30, price: 30000, customerDurationMin: null, customerDurationMax: null }
let appointments: any[] = [], receipts = new Map<string, any>(), payments = 0, effects = 0, active = false, failReceipt = false, authorized = true
try {
  patch(db.professional, 'findFirst', async () => professional)
  patch(db.professional, 'findMany', async () => [{ id: 'p' }])
  patch(db.service, 'findFirst', async () => svc)
  patch(db.service, 'findMany', async () => [svc])
  patch(db.customer, 'findFirst', async () => ({ id: 'c', businessId: 'b', phone: '5491100000000' }))
  patch(db.professionalService, 'count', async () => 1)
  patch(db.businessHours, 'findMany', async () => [{ startTime: '00:00', endTime: '23:59' }])
  patch(db.professionalHours, 'findMany', async () => [{ startTime: '00:00', endTime: '23:59' }])
  patch(db.scheduleBlock, 'findFirst', async () => null)
  patch(db.appointment, 'findFirst', async () => authorized ? appointments[0] ?? null : null)
  patch(db.appointment, 'findMany', async () => [])
  patch(db.appointment, 'create', async ({ data }: any) => { assert.equal(active, true); const appointment = { id: 'turn-' + (appointments.length + 1), ...data }; appointments.push(appointment); return appointment })
  patch(db, '$queryRaw', async (sql: any) => {
    if (sql.text.includes('SELECT true AS authorized')) return [{ authorized: true }]
    if (sql.text.includes('FROM "AppointmentMutationRequest"')) return receipts.has(sql.values[1]) ? [receipts.get(sql.values[1])] : []
    if (sql.text.includes('AS "overlaps"')) return [{ overlaps: false }]
    if (sql.text.includes('FOR UPDATE OF a')) return authorized ? [{ id: appointments[0]?.id, professionalId: 'p' }] : []
    return []
  })
  patch(db, '$executeRaw', async (sql: any) => { if (sql.text.includes('INSERT INTO "AppointmentMutationRequest"')) { if (failReceipt) throw new Error('receipt failure'); const [businessId, requestId, operation, appointmentId, actorUserId, requestFingerprint, result] = sql.values; receipts.set(requestId, { businessId, requestId, operation, appointmentId, actorUserId, requestFingerprint, result: JSON.parse(result) }) } return 1 })
  patch(db, '$queryRawUnsafe', async () => { assert.equal(active, false, 'conversation effects must wait for outer commit'); effects++; return [] })
  patch(db, '$transaction', async (work: any) => { assert.equal(active, false, 'no independent nested transaction'); const before = structuredClone({ appointments, receipts, payments }); active = true; try { return await work(db) } catch (error) { ({ appointments, receipts, payments } = before); throw error } finally { active = false } })
  const service = new AppointmentService()
  const input = { customerId: 'c', professionalId: 'p', serviceId: 's', startAt: '2026-11-24T12:00:00Z', force: true }
  const options: any = { skipDefaultMarketingPreference: true, mutationRequest: { requestId: 'create-with-payment', requestFingerprint: 'a'.repeat(64) }, afterCreateInTransaction: async ({ transaction }: any) => { assert.equal(transaction, db); assert.equal(active, true); payments++ } }
  const first = await service.create(input, actor, options)
  assert.equal(first.ok, true)
  const second = await service.create(input, actor, options)
  assert.equal(second.ok, true)
  assert.equal(appointments.length, 1, 'override retry must not create a second appointment')
  assert.equal(payments, 1, 'initial payment must use the same committed request receipt')
  assert.equal(effects, 1, 'conversation effect runs after commit and only once')
  assert.equal((second as any).appointment.replayed, true)
  await assert.rejects(() => service.create(input, { ...actor, id: 'different' }, options), (e: any) => e.code === 'APPOINTMENT_REQUEST_CONFLICT')
  await assert.rejects(() => service.create(input, actor, { ...options, mutationRequest: { ...options.mutationRequest, requestFingerprint: 'b'.repeat(64) } }), (e: any) => e.code === 'APPOINTMENT_REQUEST_CONFLICT')
  authorized = false
  const hidden = await service.create(input, actor, options)
  assert.equal(hidden.ok, false, 'replay revalidates current resource access')
  authorized = true; failReceipt = true
  await assert.rejects(() => service.create(input, actor, { ...options, mutationRequest: { ...options.mutationRequest, requestId: 'failed-create' } }), /receipt failure/)
  assert.equal(appointments.length, 1)
  assert.equal(payments, 1)
  assert.equal(effects, 1, 'rolled back creation must not emit post-commit effects')
  console.log('appointment create request: override replay, same transaction, actor/payload/current scope, rollback, effects once OK')
} finally { for (const restore of restores.reverse()) restore(); await prisma.$disconnect() }
