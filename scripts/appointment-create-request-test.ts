import assert from 'node:assert/strict'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_appointment_test'
process.env.DOTENV_CONFIG_PATH = 'C:/__appointment_offline_no_env__'
const [{ prisma }, { AppointmentService }] = await Promise.all([import('../src/config/prisma.js'), import('../src/services/appointment-service.js')])
const db = prisma as any
const restores: Array<() => void> = []
function patch(object: any, key: string, value: any) { const before = object[key]; object[key] = value; restores.push(() => { object[key] = before }) }
const actor: any = { id: 'actor', role: 'BUSINESS_ADMIN', businessId: 'b', name: 'Admin', canCreateBusinesses: false }
const professional = { id: 'p', businessId: 'b', isActive: true, availabilityMode: 'RECURRING' }
const svc = { id: 's', businessId: 'b', duration: 30, price: 30000, customerDurationMin: null, customerDurationMax: null }
let appointments: any[] = [], receipts = new Map<string, any>(), payments = 0, effects = 0, active = false, failReceipt = false, authorized = true
let availabilityChecks = 0
let historicalReads = 0
let overlaps = false
let professionalReads = 0
let serviceReads = 0
let customerReads = 0
let appointmentRereads = 0
let timezoneRereads = 0
let customerBusinessId = 'b'
try {
  patch(db.professional, 'findFirst', async () => { professionalReads++; return professional })
  patch(db.professional, 'findUnique', async () => ({ availabilityMode: 'RECURRING', business: { timezone: 'America/Argentina/Buenos_Aires' } }))
  patch(db.professional, 'findMany', async () => [{ id: 'p' }])
  patch(db.service, 'findFirst', async () => { serviceReads++; return svc })
  patch(db.service, 'findMany', async () => { serviceReads++; return [svc] })
  patch(db.customer, 'findFirst', async ({ where }: any) => {
    customerReads++
    return !where.businessId || where.businessId === customerBusinessId
      ? { id: 'c', businessId: customerBusinessId, phone: '5491100000000' }
      : null
  })
  patch(db.professionalService, 'count', async () => 1)
  patch(db.business, 'findUniqueOrThrow', async () => { timezoneRereads++; return { timezone: 'America/Argentina/Buenos_Aires' } })
  patch(db.customerBenefit, 'findMany', async () => [])
  patch(db.businessHours, 'findMany', async () => { availabilityChecks++; return [{ startTime: '00:00', endTime: '23:59' }] })
  patch(db.professionalHours, 'findMany', async () => [{ startTime: '00:00', endTime: '23:59' }])
  patch(db.scheduleBlock, 'findFirst', async () => null)
  patch(db.appointment, 'findFirst', async ({ where }: { where: { id: string } }) => {
    appointmentRereads++
    const appointment = authorized ? appointments.find((item) => item.id === where.id) : undefined
    return appointment ? { serviceItems: [], service: svc, ...appointment } : null
  })
  patch(db.appointment, 'findMany', async () => { historicalReads++; return [] })
  patch(db.appointment, 'create', async ({ data }: any) => {
    assert.equal(active, true)
    const appointment = { id: 'turn-' + (appointments.length + 1), ...data, serviceItems: data.serviceItems?.create ?? [] }
    appointments.push(appointment)
    return appointment
  })
  patch(db.appointmentServiceItem, 'createMany', async ({ data }: any) => {
    assert.equal(active, true, 'appointment items must commit with their appointment')
    const appointment = appointments.find(item => item.id === data[0]?.appointmentId)
    assert.ok(appointment)
    appointment.serviceItems = data
    return { count: data.length }
  })
  patch(db, '$queryRaw', async (sql: any) => {
    if (sql.text.includes('SELECT true AS authorized')) return [{ authorized: true }]
    if (sql.text.includes('FROM "Business"') && sql.text.includes('FOR UPDATE')) return [{ timezone: 'America/Argentina/Buenos_Aires' }]
    if (sql.text.includes('FROM "AppointmentMutationRequest"')) return receipts.has(sql.values[1]) ? [receipts.get(sql.values[1])] : []
    if (sql.text.includes('AS "overlaps"')) {
      assert.equal(active, true, 'the final availability check must use the transaction')
      if (sql.text.includes('AS "offersServices"')) {
        availabilityChecks++
        const hours = [{ startTime: '00:00', endTime: '23:59' }]
        return [{ offersServices: true, businessHours: hours, professionalHours: hours, scheduleBlock: false, overlaps }]
      }
      return [{ overlaps }]
    }
    if (sql.text.includes('FOR UPDATE OF a')) return authorized ? [{ id: appointments[0]?.id, professionalId: 'p' }] : []
    return []
  })
  patch(db, '$executeRaw', async (sql: any) => { if (sql.text.includes('INSERT INTO "AppointmentMutationRequest"')) { if (failReceipt) throw new Error('receipt failure'); const [businessId, requestId, operation, appointmentId, actorUserId, requestFingerprint, result] = sql.values; receipts.set(requestId, { businessId, requestId, operation, appointmentId, actorUserId, requestFingerprint, result: JSON.parse(result) }) } return 1 })
  patch(db, '$queryRawUnsafe', async () => { assert.equal(active, false, 'conversation effects must wait for outer commit'); effects++; return [] })
  patch(db, '$transaction', async (work: any, transactionOptions?: { timeout: number }) => {
    assert.equal(transactionOptions?.timeout, 30_000, 'Agenda creation must allow 30 seconds for the transaction')
    assert.equal(active, false, 'no independent nested transaction')
    const before = structuredClone({ appointments, receipts, payments })
    active = true
    try { return await work(db) } catch (error) { ({ appointments, receipts, payments } = before); throw error } finally { active = false }
  })
  const service = new AppointmentService()
  const input = { customerId: 'c', professionalId: 'p', serviceId: 's', startAt: '2026-11-24T12:00:00Z', force: true }
  const options: any = { skipDefaultMarketingPreference: true, mutationRequest: { requestId: 'create-with-payment', requestFingerprint: 'a'.repeat(64) }, afterCreateInTransaction: async ({ transaction }: any) => { assert.equal(transaction, db); assert.equal(active, true); payments++ } }
  const first = await service.create(input, actor, options)
  assert.equal(first.ok, true)
  assert.equal(availabilityChecks, 1, 'Agenda creation checks opening hours once')
  assert.equal(historicalReads, 0, 'Agenda creation must not load appointment history')
  assert.equal(professionalReads, 2, 'load the scoped professional once after taking Agenda locks')
  assert.equal(serviceReads, 1, 'reuse the services already checked under Agenda locks')
  assert.equal(customerReads, 1, 'read the customer once with its business under Agenda locks')
  assert.equal(appointmentRereads, 0, 'checking benefits must reuse the just-created appointment')
  assert.equal(timezoneRereads, 0, 'reuse the timezone from the locked business row')
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
  failReceipt = false
  overlaps = true
  const blocked = await service.create({ ...input, force: false }, actor, {
    ...options, mutationRequest: { ...options.mutationRequest, requestId: 'blocked-create' }
  })
  assert.ok(!blocked.ok)
  assert.equal(blocked.code, 'APPOINTMENT_AVAILABILITY_CONFLICT')
  assert.equal(blocked.forceable, true)
  assert.deepEqual(blocked.conflicts?.map(conflict => conflict.code), ['APPOINTMENT_OVERLAP'])
  assert.equal(appointments.length, 1)
  assert.equal(payments, 1)
  overlaps = false
  customerReads = 0
  customerBusinessId = 'other'
  const moved = await service.create(input, actor, {
    ...options, mutationRequest: { ...options.mutationRequest, requestId: 'moved-customer' }
  })
  assert.ok(!moved.ok)
  assert.equal(moved.statusCode, 404)
  assert.equal(appointments.length, 1)
  assert.equal(payments, 1)
  customerBusinessId = 'b'
  const withoutRequestId = await service.create(input, actor, { skipDefaultMarketingPreference: true })
  assert.equal(withoutRequestId.ok, true)
  assert.equal(appointments.length, 2)
  console.log('appointment create request: override replay, same transaction, actor/payload/current scope, rollback, effects once OK')
} finally { for (const restore of restores.reverse()) restore(); await prisma.$disconnect() }
