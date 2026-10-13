import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { runInNewContext } from 'node:vm'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

// All repositories are replaced before any request: no database or network access.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_staff_test'
const [{ prisma }, { appointmentRoutes }, { crmUiRoutes }, { canStaffAccessRoute }, { Prisma }, { findExistingCustomersByPhone }, { PGlite }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/appointment.js'),
  import('../src/routes/crm-ui.js'), import('../src/services/staff-permission-service.js'),
  import('../src/generated/prisma/client.js'), import('../src/services/customer-identity-service.js'), import('@electric-sql/pglite')
])
const db = prisma as any
const restore: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const original = object[key]
  object[key] = value
  restore.push(() => { object[key] = original })
}
const staff: any = {
  id: 'staff-a', role: 'STAFF', businessId: 'business-a', name: 'Staff',
  professionalId: 'professional-a', agendaScope: 'OWN', canCreateBusinesses: false,
  canCreateAppointments: true, canViewCustomers: false, canCreateCustomers: false,
  canEditCustomers: false, canForceAppointments: false, canRecordAppointmentPayments: false
}
const customer = { id: 'customer-a', businessId: 'business-a', name: 'Nombre existente', phone: '5491164312742' }
const professional = { id: 'professional-a', businessId: 'business-a', isActive: true }
const service = { id: 'service-a', businessId: 'business-a', duration: 30, price: 15000 }
let matches = [{ id: customer.id }]
let lookupQueries: any[] = []
let created: any[] = []
let marketingWrites = 0
let overlap = false
let customerAvailable = true
let failures = 0
let passes = 0
async function test(name: string, run: () => any) {
  matches = [{ id: customer.id }]; lookupQueries = []; created = []; marketingWrites = 0
  overlap = false; customerAvailable = true; staff.canCreateAppointments = true
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name, (error as Error).message) }
}
const app = Fastify()
const uiApp = Fastify()
try {
  replace(db.professional, 'findFirst', async ({ where }: any) => {
    if (where.id === 'professional-foreign') return null
    return { ...professional, id: where.id }
  })
  replace(db.professional, 'findMany', async () => [{ id: professional.id }])
  replace(db.service, 'findFirst', async () => service)
  replace(db.service, 'findMany', async () => [service])
  replace(db.customer, 'findFirst', async ({ where }: any) => customerAvailable && where.id === customer.id ? customer : null)
  for (const key of ['create', 'update', 'upsert', 'delete']) {
    replace(db.customer, key, async () => { throw new Error('Forbidden customer mutation: ' + key) })
  }
  replace(db.business, 'findUnique', async ({ where }: any) => {
    assert.equal(where.id, 'business-a')
    return { publicWhatsapp: '+54 9 11 4000-0000' }
  })
  replace(db.customerMarketingPreference, 'upsert', async () => { marketingWrites++; return {} })
  replace(db.professionalService, 'count', async () => 1)
  replace(db.businessHours, 'findMany', async () => [{ startTime: '00:00', endTime: '23:59' }])
  replace(db.professionalHours, 'findMany', async () => [{ startTime: '00:00', endTime: '23:59' }])
  replace(db.scheduleBlock, 'findFirst', async () => null)
  replace(db.appointment, 'findMany', async () => overlap ? [{ startAt: new Date('2026-10-13T14:00:00.000Z'), totalDurationMinutes: 30, status: 'CONFIRMED' }] : [])
  replace(db.appointment, 'create', async ({ data }: any) => {
    created.push(data)
    return { id: 'appointment-a', ...data }
  })
  replace(db, '$queryRaw', async (query: any, ...templateValues: any[]) => {
    const sql = query.sql ?? (Array.isArray(query) ? query.join('?') : '')
    const values = Array.isArray(query) ? templateValues : query.values
    if (sql.includes('FROM "Customer"')) {
      assert.match(sql, /"businessId" = /)
      assert.match(sql, /LIMIT 2/)
      assert.doesNotMatch(sql, /LIKE|ILIKE/)
      assert.equal(values[0], 'business-a')
      lookupQueries.push({ sql, values })
      return matches
    }
    if (sql.includes('AS "overlaps"')) return [{ overlaps: overlap }]
    return []
  })
  replace(db, '$transaction', async (run: any) => run(db))
  replace(db, '$queryRawUnsafe', async () => [])
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request: any, reply) => {
    request.auth = { user: staff }
    if (!canStaffAccessRoute(staff, request.method, request.url)) return reply.code(403).send({ message: 'Sin permiso' })
  })
  await app.register(appointmentRoutes)
  await uiApp.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
  const payload = { professionalId: professional.id, serviceId: service.id, startAt: '2026-10-13T14:00:00.000Z' }
  const request = (body: any = {}) => app.inject({ method: 'POST', url: '/appointments', payload: { ...payload, ...body } })

  await test('staff exact phone creates a turn on the existing identity, no customer or marketing writes', async () => {
    const response = await request({ customerPhone: '11-6431-2742', name: 'Do not rename', businessId: 'business-foreign' })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(created.length, 1)
    assert.equal(created[0].customerId, customer.id)
    assert.equal(created[0].businessId, 'business-a')
    assert.equal(marketingWrites, 0)
    assert.equal(customer.name, 'Nombre existente')
    assert.ok(lookupQueries[0].values.includes('5491164312742'))
  })
  await test('canonical international-prefix and formatted phone reuse the same customer', async () => {
    for (const phone of ['+54 9 11 6431-2742', '005491164312742', '(011) 15-6431-2742']) {
      assert.equal((await request({ customerPhone: phone })).statusCode, 200)
      assert.equal(created.at(-1).customerId, customer.id)
    }
    assert.equal(marketingWrites, 0)
  })
  await test('absent exact phone creates neither customer nor turn and gives an actionable error', async () => {
    matches = []
    const response = await request({ customerPhone: '1164312742' })
    assert.equal(response.statusCode, 404)
    assert.match(response.json().message, /cliente.*registrado.*número/i)
    assert.equal(created.length, 0)
  })
  await test('ambiguous exact identity is rejected without choosing a customer', async () => {
    matches = [{ id: customer.id }, { id: 'duplicate-a' }]
    const response = await request({ customerPhone: '1164312742' })
    assert.equal(response.statusCode, 409)
    assert.equal(created.length, 0)
  })
  await test('invalid or short phone does not query customer rows', async () => {
    for (const phone of ['', '123', { phone: '1164312742' }]) {
      assert.equal((await request({ customerPhone: phone })).statusCode, 400)
    }
    assert.equal(lookupQueries.length, 0)
    assert.equal(created.length, 0)
  })
  await test('conflicting ID and phone selectors are rejected', async () => {
    assert.equal((await request({ customerId: customer.id, customerPhone: '1164312742' })).statusCode, 400)
    assert.equal(lookupQueries.length, 0)
    assert.equal(created.length, 0)
  })
  await test('OWN professional and tenant deny access before looking up an exact identity', async () => {
    assert.equal((await request({ customerPhone: '1164312742', professionalId: 'professional-other' })).statusCode, 403)
    assert.equal((await request({ customerPhone: '1164312742', professionalId: 'professional-foreign' })).statusCode, 404)
    assert.equal(lookupQueries.length, 0)
    assert.equal(created.length, 0)
  })
  await test('agenda, exception, and payment permissions are retained', async () => {
    staff.canCreateAppointments = false
    assert.equal((await request({ customerPhone: '1164312742' })).statusCode, 403)
    staff.canCreateAppointments = true
    assert.equal((await request({ customerPhone: '1164312742', force: true })).statusCode, 403)
    assert.equal((await request({ customerPhone: '1164312742', payment: { lines: [{ amount: 10, method: 'CASH' }] } })).statusCode, 403)
    assert.equal(lookupQueries.length, 0)
  })
  await test('availability conflict and missing authorized customer prevent appointment creation', async () => {
    overlap = true
    const response = await request({ customerPhone: '1164312742' })
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'APPOINTMENT_AVAILABILITY_CONFLICT')
    overlap = false; customerAvailable = false
    assert.equal((await request({ customerPhone: '1164312742' })).statusCode, 404)
    assert.equal(created.length, 0)
  })
  await test('existing selected-ID flow remains compatible and customer directory stays denied', async () => {
    const response = await request({ customerId: customer.id })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(marketingWrites, 1, 'legacy selected-ID flow retains its prior behavior')
    assert.equal(canStaffAccessRoute(staff, 'GET', '/customers'), false)
    assert.equal(canStaffAccessRoute(staff, 'POST', '/customers'), false)
  })

  const ui = (await uiApp.inject('/crm')).body
  const saveSource = ui.slice(ui.indexOf('async function saveManualAppointment'), ui.indexOf('async function deleteManualAppointment'))
  async function saveFromUi(user: any, name = 'Nombre escrito', phone = '11-6431-2742', directoryAllowed = false) {
    const calls: Array<{ path: string; body: any }> = []
    const els: any = Object.fromEntries(Object.entries({
      appointmentStart: '2026-10-13T11:00', appointmentProfessional: professional.id, appointmentService: service.id,
      appointmentCustomer: '', appointmentCustomerName: name, appointmentCustomerPhone: phone,
      appointmentDepositAmount: '', appointmentNotes: '', appointmentAttentionColor: 'NONE'
    }).map(([key, value]) => [key, { value, focus() {} }]))
    els.appointmentFeedback = { textContent: '' }; els.appointmentDepositPaid = { checked: false }; els.appointmentSubmit = {}
    const state = { currentUser: user, customers: [], professionals: [], services: [service], selected: null, businessId: 'business-a' }
    const context: any = {
      els, state, event: { preventDefault() {} }, canCreateAppointments: () => true, canEditAppointments: () => false,
      editingAgendaAppointment: () => null, appointmentCustomerChanges: () => ({ name, changed: false }),
      appointmentServicesForProfessional: () => [service], readCreateAppointmentPayment: () => null,
      appointmentDetailsChanged: () => true, setButtonLoading: () => true, closeAppointmentDialog() {},
      loadAgenda: async () => {}, renderAppointmentFormOptions() {}, businessScopedPath: (p: string) => p,
      showCrmToast() {}, getJson: async (path: string, input: any) => {
        calls.push({ path, body: input?.body ? JSON.parse(input.body) : null })
        if (path === '/customers') {
          if (!directoryAllowed) throw new Error('Forbidden customer directory request')
          return input?.method === 'POST' ? { ...customer, wasExisting: true } : [customer]
        }
        return { conflicts: [] }
      }
    }
    await runInNewContext(saveSource + '; saveManualAppointment(event)', context)
    return { calls, feedback: els.appointmentFeedback.textContent }
  }
  await test('actual CRM save uses only Agenda endpoints with phone, even without a typed name', async () => {
    const nameInput = ui.match(/<input[^>]*id="appointment-customer-name"[^>]*>/)?.[0]
    assert.ok(nameInput)
    assert.doesNotMatch(nameInput, /\brequired\b/, 'browser validation must allow a blank name for an existing-phone booking')
    const result = await saveFromUi(staff, '')
    assert.equal(result.feedback, '')
    assert.deepEqual(result.calls.map(c => c.path), ['/appointments/check-availability', '/appointments'])
    assert.equal(result.calls[1].body.customerPhone, '11-6431-2742')
    assert.equal('customerId' in result.calls[1].body, false)
  })
  await test('new staff existing-phone form keeps the name read-only and the phone usable', async () => {
    const start = ui.indexOf('const protectsScheduledCustomer =')
    const source = ui.slice(start, ui.indexOf('updateAppointmentContactActions(appointment)', start))
    const searchRow = { hidden: false }, phoneRow = { hidden: true }
    const nameField = { readOnly: false }
    runInNewContext(source, {
      state: { currentUser: staff }, appointment: null, canViewAppointmentCustomerData: () => false,
      els: {
        appointmentCustomerSearch: { closest: () => searchRow },
        appointmentCustomerPhone: { closest: () => phoneRow }, appointmentCustomerName: nameField,
        appointmentFeedback: { textContent: '' }
      }
    })
    assert.equal(searchRow.hidden, true)
    assert.equal(phoneRow.hidden, false)
    assert.equal(nameField.readOnly, true)
  })
  await test('staff missing an exact phone gets integrated feedback, no customer request', async () => {
    const result = await saveFromUi(staff, 'Nombre escrito', '')
    assert.match(result.feedback, /número.*cliente.*registrado/i)
    assert.equal(result.calls.some(c => c.path === '/customers' || c.path === '/appointments'), false)
  })
  await test('staff create-customer capability without directory access still uses only Agenda', async () => {
    const result = await saveFromUi({ ...staff, canCreateCustomers: true })
    assert.equal(result.feedback, '')
    assert.deepEqual(result.calls.map(c => c.path), ['/appointments/check-availability', '/appointments'])
    assert.equal(result.calls[1].body.customerPhone, '11-6431-2742')
  })
  await test('full customer permissions keep the existing customer-selected workflow', async () => {
    const result = await saveFromUi({ ...staff, canCreateCustomers: true, canViewCustomers: true }, 'Nombre escrito', '1164312742', true)
    assert.equal(result.feedback, '')
    assert.deepEqual(result.calls.map(c => c.path), ['/appointments/check-availability', '/customers', '/customers', '/appointments'])
    assert.equal(result.calls.at(-1)!.body.customerId, customer.id)
    assert.equal('customerPhone' in result.calls.at(-1)!.body, false)
  })
  await test('staff without customer-view capability cannot query the modal directory', async () => {
    const source = ui.slice(ui.indexOf('async function loadAppointmentCustomerResults'), ui.indexOf('function scheduleAppointmentCustomerSearch'))
    let directoryRequests = 0
    await runInNewContext(source + '; loadAppointmentCustomerResults("Nombre")', {
      state: { businessId: 'business-a', appointmentCustomerSearchRequest: 0 }, canViewAppointmentCustomerData: () => false,
      els: { appointmentCustomerResults: {}, appointmentCustomerSearch: { setAttribute() {} } }, URLSearchParams,
      renderAppointmentCustomerResults() {}, getJson: async () => { directoryRequests++; return [] }
    })
    assert.equal(directoryRequests, 0)
    assert.match(ui, /customerSearchRow\.hidden = protectsScheduledCustomer \|\| !canViewAppointmentCustomerData\(\)/)
  })
  await test('actual exact-match SQL distinguishes legacy formatting, duplicates, other tenants and other numbers', async () => {
    const memory = new PGlite()
    const originalQuery = db.$queryRaw
    try {
      await memory.exec('CREATE TABLE "Customer" (id text PRIMARY KEY, "businessId" text, phone text, "normalizedPhone" text)')
      await memory.query('INSERT INTO "Customer" VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)', [
        'legacy-a', 'business-a', '+54 9 11 6431-2742', null,
        'tenant-b', 'business-b', '5491164312742', '5491164312742',
        'different-a', 'business-a', '5491164312743', '5491164312743'
      ])
      db.$queryRaw = async (strings: any, ...values: any[]) => {
        const query = Prisma.sql(strings, ...values)
        return (await memory.query(query.text, query.values)).rows
      }
      for (const phone of ['1164312742', '+54 9 11 6431-2742', '(011) 15-6431-2742']) {
        assert.deepEqual(await findExistingCustomersByPhone({ businessId: 'business-a', phone }), [{ id: 'legacy-a' }])
      }
      assert.deepEqual(await findExistingCustomersByPhone({ businessId: 'business-a', phone: '1164312749' }), [])
      await memory.query('INSERT INTO "Customer" VALUES ($1,$2,$3,$4)', ['duplicate-a', 'business-a', '1164312742', '5491164312742'])
      assert.equal((await findExistingCustomersByPhone({ businessId: 'business-a', phone: '1164312742' })).length, 2)
      await memory.query('INSERT INTO "Customer" VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [
        'foreign-phone-a', 'business-a', '+598 99 123 456', null,
        'same-local-a', 'business-a', '15-6431-2742', null
      ])
      assert.deepEqual(await findExistingCustomersByPhone({ businessId: 'business-a', phone: '+59899123456' }), [{ id: 'foreign-phone-a' }])
      assert.deepEqual(await findExistingCustomersByPhone({ businessId: 'business-a', phone: '2216431274' }), [], 'a different explicit area code must not match a local-only legacy number')
    } finally {
      db.$queryRaw = originalQuery
      await memory.close()
    }
  })
  assert.equal(failures, 0, `${failures} failed; ${passes} passed`)
  console.log(`Staff existing customer appointment: ${passes} checks passed`)
} finally {
  await app.close(); await uiApp.close()
  for (const reset of restore.reverse()) reset()
  await prisma.$disconnect()
}
