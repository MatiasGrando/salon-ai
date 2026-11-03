import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import Fastify from 'fastify'

// This suite uses synthetic repositories and an in-memory PostgreSQL instance only.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/agenda_favorite_test'
process.env.DOTENV_CONFIG_PATH = '__offline_agenda_favorite_no_env__'
process.env.NODE_ENV = 'test'
const [{ prisma }, { serviceRoutes }, { authGuard }, { crmUiRoutes }, { DISABLED_POLLING_MARKER }, { PGlite }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/service.js'), import('../src/plugins/auth-guard.js'),
  import('../src/routes/crm-ui.js'), import('../src/observability/egress-baseline/types.js'), import('@electric-sql/pglite')
])
const db = prisma as any
const restores: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const original = object[key]; object[key] = value; restores.push(() => { object[key] = original })
}
let passes = 0, failures = 0, mutations = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const base: any = {
  id: 'cut', name: 'Corte', businessId: 'business-a', description: null, duration: 30, price: 15000,
  isBookable: true, isActive: true, archivedAt: null, catalogCategoryId: null, parentServiceId: null,
  sortOrder: 7, bookingOrderPriority: 12, agendaFavorite: false, variantSelectionMode: 'ONE_OF',
  priceMode: 'FIXED', attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, estimateOptions: [],
  estimateAllowsBooking: true, validationEnabled: false, depositMode: 'NONE', depositValue: null,
  depositHoldMinutes: 60, customerDurationMin: null, customerDurationMax: null, _count: { variants: 0 }
}
const records = new Map<string, any>([['cut', { ...base }], ['other', { ...base, id: 'other', businessId: 'business-b' }]])
let role = 'BUSINESS_ADMIN'
const app = Fastify(), uiApp = Fastify()
const headers = { cookie: 'salon_ai_session=synthetic' }
const payload = { name: 'Corte', duration: 30, price: 15000, businessId: 'business-a' }
const request = (method: 'POST' | 'PATCH', extra: any = {}, id = 'cut') => app.inject({
  method, url: method === 'POST' ? '/services' : '/services/' + id, headers, payload: { ...payload, ...extra }
})
try {
  const secondSessionHash = createHash('sha256').update('another-synthetic-account').digest('hex')
  replace(db.userSession, 'findUnique', async ({ where }: any) => ({ expiresAt: new Date(Date.now() + 60000), user: {
    id: where.tokenHash === secondSessionHash ? 'editor-b' : 'editor', role, isActive: true, businessId: 'business-a', canCreateBusinesses: false,
    business: { accountStatus: 'ACTIVE' }
  } }))
  replace(db.business, 'findFirst', async () => null)
  replace(db.business, 'findUnique', async () => null)
  replace(db.business, 'count', async ({ where }: any) => where.AND[1].id.in.every((id: string) => id === 'business-a') ? 1 : 0)
  replace(db.service, 'findFirst', async ({ where, select }: any) => {
    const row = records.get(where.id)
    if (!row || (where.business?.id && where.business.id !== row.businessId) || (where.businessId && where.businessId !== row.businessId)) return null
    return select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row }
  })
  replace(db.service, 'findUnique', async ({ where }: any) => records.get(where.id) || null)
  replace(db.service, 'findMany', async ({ where, orderBy }: any) => {
    assert.deepEqual(orderBy, [{ sortOrder: 'asc' }, { name: 'asc' }], 'favorites must not replace catalog ordering')
    return [...records.values()].filter(row => row.businessId === where.businessId)
  })
  replace(db.service, 'create', async ({ data }: any) => {
    mutations++; const row = { ...base, ...data, id: 'created', agendaFavorite: data.agendaFavorite ?? false }
    records.set(row.id, row); return row
  })
  replace(db.service, 'update', async ({ where, data }: any) => {
    // Prisma's JsonNull sentinel is stored/read as database NULL, not a JSON object.
    const persisted = { ...data, estimateOptions: Array.isArray(data.estimateOptions) ? data.estimateOptions : null }
    mutations++; const row = { ...records.get(where.id), ...persisted }; records.set(where.id, row); return row
  })
  for (const repository of [db.service, db.professional, db.businessHours]) replace(repository, 'count', async () => 0)
  replace(db.user, 'findFirst', async () => null)
  replace(db.professional, 'findMany', async () => [])
  replace(db.serviceAddon, 'deleteMany', async () => ({}))
  replace(db.serviceCombinationRule, 'deleteMany', async () => ({}))
  replace(db.professionalService, 'findMany', async () => [])
  replace(db, '$queryRaw', async () => [])
  replace(db, '$transaction', async (run: any) => run(db))
  await authGuard(app); await app.register(serviceRoutes)
  await uiApp.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })

  await check('POST persists true and preserves independent priority/catalog order', async () => {
    const response = await request('POST', { agendaFavorite: true, bookingOrderPriority: 4, sortOrder: 8 })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().agendaFavorite, true)
    assert.equal(response.json().bookingOrderPriority, 4); assert.equal(response.json().sortOrder, 8)
  })
  await check('old POST payload defaults false', async () => {
    assert.equal((await request('POST')).json().agendaFavorite, false)
  })
  await check('PATCH can enable and disable, omitted favorite preserves persisted value', async () => {
    for (const value of [true, false, true]) {
      const response = await request('PATCH', { agendaFavorite: value })
      assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().agendaFavorite, value)
    }
    assert.equal((await request('PATCH')).json().agendaFavorite, true)
    assert.equal(records.get('cut').sortOrder, 7); assert.equal(records.get('cut').bookingOrderPriority, 12)
  })
  await check('both mutations reject nonboolean favorite without writing', async () => {
    for (const method of ['POST', 'PATCH'] as const) for (const value of ['true', 'false', 1, 0, null, [], {}]) {
      const before = mutations, response = await request(method, { agendaFavorite: value })
      assert.equal(response.statusCode, 400, response.body); assert.equal(mutations, before)
    }
  })
  await check('nonbookable groups cannot retain operational favorites', async () => {
    assert.equal((await request('POST', { isBookable: false, agendaFavorite: true })).json().agendaFavorite, false)
    assert.equal((await request('PATCH', { isBookable: false, agendaFavorite: true })).json().agendaFavorite, false)
    assert.equal((await request('PATCH', { isBookable: true })).json().agendaFavorite, false)
  })
  await check('a variant does not inherit a family favorite and remains independently editable', async () => {
    records.set('family', { ...base, id: 'family', isBookable: false, agendaFavorite: true })
    const created = await request('POST', { parentServiceId: 'family' })
    assert.equal(created.statusCode, 200, created.body); assert.equal(created.json().agendaFavorite, false)
    assert.equal((await request('PATCH', { agendaFavorite: true }, 'created')).json().agendaFavorite, true)
    assert.equal(records.get('family').agendaFavorite, true, 'writing a variant must not modify its parent')
  })
  await check('another authorized account in the same business reads the saved favorite', async () => {
    await request('PATCH', { agendaFavorite: true })
    const response = await app.inject({ url: '/services', headers: { cookie: 'salon_ai_session=another-synthetic-account' } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().find((service: any) => service.id === 'cut').agendaFavorite, true)
    assert.equal(response.json().some((service: any) => service.id === 'other'), false)
  })
  await check('STAFF cannot change favorites and tenant boundaries remain enforced', async () => {
    const before = mutations; role = 'STAFF'
    for (const method of ['POST', 'PATCH'] as const) assert.equal((await request(method, { agendaFavorite: true })).statusCode, 403)
    role = 'BUSINESS_ADMIN'
    assert.equal((await request('POST', { businessId: 'business-b', agendaFavorite: true })).statusCode, 403)
    assert.equal((await request('PATCH', { agendaFavorite: true }, 'other')).statusCode, 404)
    assert.equal(mutations, before)
  })
  await check('migration supplies false to existing/new rows and independently persists per business', async () => {
    const memory = new PGlite()
    try {
      await memory.exec('CREATE TABLE "Service" (id text PRIMARY KEY, "businessId" text); INSERT INTO "Service" VALUES (\'old\',\'business-a\')')
      await memory.exec(readFileSync('prisma/migrations/20261014010000_add_service_agenda_favorite/migration.sql', 'utf8'))
      await memory.exec('INSERT INTO "Service" (id, "businessId") VALUES (\'new\',\'business-b\'); UPDATE "Service" SET "agendaFavorite" = true WHERE id = \'old\'')
      assert.deepEqual((await memory.query('SELECT id,"agendaFavorite" FROM "Service" ORDER BY id')).rows, [{ id: 'new', agendaFavorite: false }, { id: 'old', agendaFavorite: true }])
      await assert.rejects(memory.exec('UPDATE "Service" SET "agendaFavorite" = NULL WHERE id = \'new\''))
    } finally { await memory.close() }
  })

  const html = (await uiApp.inject('/crm')).body
  function source(name: string) {
    const marker = new RegExp('(?:async )?function ' + name + '\\(').exec(html)
    assert.ok(marker, name + ' must exist in rendered CRM')
    const start = marker.index, end = html.indexOf('\n    ', start + marker[0].length)
    // Top-level functions end just before the following equally indented declaration.
    const tail = html.slice(start).search(/\n    (?:(?:async )?function |const |let |els\.)/)
    return html.slice(start, tail < 0 ? end : start + tail)
  }
  function element() { return { value: '', checked: false, disabled: false, hidden: false, textContent: '', innerHTML: '', style: {}, classList: { toggle() {} }, querySelectorAll: () => [], focus() {}, scrollIntoView() {} } }
  function context() {
    const els: any = new Proxy({}, { get: (target: any, key: string) => target[key] ??= element() })
    els.serviceDuration.value = '30'; els.serviceName.value = 'Corte'; els.servicePrice.value = '15000'
    els.servicePriceMode.value = 'FIXED'; els.serviceBookingOrderPriority.value = '20'; els.serviceItemType.value = 'SERVICE'
    els.serviceAttentionMode.value = 'DIRECT_BOOKING'; els.serviceDepositMode.value = 'FIXED'; els.serviceDepositHoldMinutes.value = '60'
    const calls: any[] = []
    const state: any = { businessId: 'business-a', serviceAssociationConfig: {}, serviceEstimateOptions: [], serviceImageUrl: null, services: [], professionals: [] }
    const stubs = Object.fromEntries(['renderServiceCatalogControls', 'renderServiceEstimateOptions', 'updateServiceTypeFields', 'updateServiceDepositFields', 'updateServiceValidationFields', 'updateServiceCustomerDurationFields', 'updateServiceAttentionHelp', 'updateServicePriceModeHelp', 'setServiceImage', 'setSection', 'resetServiceForm'].map(name => [name, () => {}]))
    return { els, state, calls, ...stubs, event: { preventDefault() {} }, document: { getElementById: () => element() },
      hasServicePrice: (s: any) => s.price != null, setButtonLoading: () => true, reloadServiceCatalog: async () => {},
      getJson: async (path: string, init: any) => { calls.push({ path, body: JSON.parse(init.body) }) },
      escapeHtml: (s: string) => s, activeProfessionals: () => state.professionals.filter((p: any) => p.isActive !== false),
      filterAssignedServices: (p: any, services: any[]) => services.filter(s => p?.services?.some((assigned: any) => assigned.id === s.id)),
      editingAgendaAppointment: () => ({ id: 'turn', professionalId: 'p1' }), appointmentVisitSegments: () => [], appointmentServiceIds: () => [],
      appointmentVisitSuggestedStart: () => new Date(), toDatetimeLocalValue: () => '2026-10-14T10:00' }
  }
  await check('favorite checkbox is in existing organization section with business-wide explanation', () => {
    const section = html.slice(html.indexOf('id="service-organization-section"'), html.indexOf('id="service-aliases"'))
    assert.match(section, /id="service-agenda-favorite"[^>]*type="checkbox"|type="checkbox"[^>]*id="service-agenda-favorite"/)
    assert.match(section, /Favorito para Agenda/); assert.match(section, /todo el negocio/)
  })
  await check('favorite-only layout guard uses relative compact size, not global field width', () => {
    const guard = html.match(/#service-form #service-agenda-favorite\s*\{([^}]+)\}/)?.[1]
    assert.ok(guard, 'favorite needs its own sizing guard against mobile input width100%')
    assert.match(guard, /width:\s*1em/); assert.match(guard, /height:\s*1em/)
    assert.match(guard, /flex:\s*0 0 1em/); assert.match(guard, /margin:\s*0/)
    assert.match(guard, /font:\s*inherit/)
  })
  await check('actual save handler submits boolean favorite and cannot favorite groups', async () => {
    for (const [itemType, checked, expected] of [['SERVICE', true, true], ['SERVICE', false, false], ['GROUP', true, false], ['VARIANT', true, true]] as const) {
      const c = context(); c.els.serviceItemType.value = itemType; c.els.serviceAgendaFavorite.checked = checked
      if (itemType === 'VARIANT') c.els.serviceParent.value = 'family'
      await runInNewContext(source('saveService') + '; saveService(event)', c)
      assert.equal(c.calls.length, 1, c.els.serviceFeedback.textContent); assert.equal(c.calls[0].body.agendaFavorite, expected)
    }
  })
  await check('invalid form data preserves favorite and displays integrated feedback without submitting', async () => {
    const c = context(); c.els.serviceName.value = ''; c.els.serviceAgendaFavorite.checked = true
    await runInNewContext(source('saveService') + '; saveService(event)', c)
    assert.equal(c.calls.length, 0); assert.equal(c.els.serviceAgendaFavorite.checked, true)
    assert.match(c.els.serviceFeedback.textContent, /nombre/i)
  })
  await check('actual editor restores favorite and reset clears it', () => {
    const c = context(); c.state.services = [{ ...base, agendaFavorite: true }]
    runInNewContext(source('getServiceItemType') + source('editService') + '; editService("cut")', c)
    assert.equal(c.els.serviceAgendaFavorite.checked, true)
    runInNewContext(source('resetServiceForm') + '; resetServiceForm()', c)
    assert.equal(c.els.serviceAgendaFavorite.checked, false)
  })
  await check('switching to GROUP disables and clears favorite instead of hiding persisted state', () => {
    const c = context(); c.els.serviceItemType.value = 'GROUP'; c.els.serviceAgendaFavorite.checked = true
    runInNewContext(source('updateServiceTypeFields') + '; updateServiceTypeFields()', c)
    assert.equal(c.els.serviceAgendaFavorite.disabled, true); assert.equal(c.els.serviceAgendaFavorite.checked, false)
    c.els.serviceItemType.value = 'SERVICE'
    runInNewContext(source('updateServiceTypeFields') + '; updateServiceTypeFields()', c)
    assert.equal(c.els.serviceAgendaFavorite.disabled, false)
  })
  const services = [
    { ...base, id: 'first' }, { ...base, id: 'star-a', agendaFavorite: true }, { ...base, id: 'star-b', agendaFavorite: true },
    { ...base, id: 'inactive', isActive: false, agendaFavorite: true }, { ...base, id: 'family', isBookable: false, agendaFavorite: true },
    { ...base, id: 'unassigned', agendaFavorite: true }, { ...base, id: 'second' }
  ]
  const selectionSources = ['bookableServices', 'serviceCanContinueToBooking', 'serviceCatalogLabel', 'orderAgendaServices', 'appointmentServicesForProfessional', 'renderAppointmentServiceOptions'].map(source).join('\n')
  await check('Agenda sorts a stable copy, filters active assignments and preserves explicit selection', () => {
    const c = context(); c.state.services = services.map(s => ({ ...s })); const original = JSON.stringify(c.state.services)
    c.state.professionals = [{ id: 'p1', services: services.filter(s => s.id !== 'unassigned').map(s => ({ id: s.id })) }]
    c.els.appointmentProfessional.value = 'p1'
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("first")', c)
    assert.equal(c.els.appointmentService.value, 'first')
    assert.deepEqual([...c.els.appointmentService.innerHTML.matchAll(/value="([^"]*)"/g)].map(m => m[1]), ['star-a', 'star-b', 'first', 'second'])
    assert.equal(JSON.stringify(c.state.services), original)
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions()', c)
    assert.equal(c.els.appointmentService.value, 'star-a')
    c.els.appointmentProfessional.value = 'missing'
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions()', c)
    assert.equal(c.els.appointmentService.disabled, true)
  })
  await check('editing an existing inactive service preserves only its original assigned selection', () => {
    const c = context(); c.state.services = services.map(s => ({ ...s }))
    c.state.professionals = [{ id: 'p1', services: services.map(s => ({ id: s.id })) }, { id: 'p2', services: services.map(s => ({ id: s.id })) }]
    c.els.appointmentProfessional.value = 'p1'
    c.editingAgendaAppointment = () => ({ id: 'turn', professionalId: 'p1', serviceId: 'inactive' } as any)
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("inactive")', c)
    assert.equal(c.els.appointmentService.value, 'inactive')
    assert.match(c.els.appointmentService.innerHTML, /Inactivo.*turno existente/)
    // New appointments and arbitrary preferences cannot resurrect an inactive service.
    c.editingAgendaAppointment = () => null as any
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("inactive")', c)
    assert.doesNotMatch(c.els.appointmentService.innerHTML, /value="inactive"/)
    c.editingAgendaAppointment = () => ({ id: 'turn', professionalId: 'p1', serviceId: 'first' } as any)
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("inactive")', c)
    assert.doesNotMatch(c.els.appointmentService.innerHTML, /value="inactive"/)
    c.editingAgendaAppointment = () => ({ id: 'turn', professionalId: 'p1', serviceId: 'inactive' } as any)
    c.els.appointmentProfessional.value = 'p2'
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("inactive")', c)
    assert.doesNotMatch(c.els.appointmentService.innerHTML, /value="inactive"/)
    c.els.appointmentProfessional.value = 'p1'; c.state.professionals[0].services = [{ id: 'first' }]
    runInNewContext(selectionSources + '; renderAppointmentServiceOptions("inactive")', c)
    assert.doesNotMatch(c.els.appointmentService.innerHTML, /value="inactive"/)
  })
  await check('add-service also favors assigned active services without restricting to current professional', () => {
    const c = context(); c.state.services = services.map(s => ({ ...s })); c.state.professionals = [{ id: 'p2', services: [{ id: 'star-a' }, { id: 'first' }, { id: 'star-b' }] }]
    runInNewContext(selectionSources + source('renderAppointmentAddServiceProfessionals') + source('openAppointmentAddServicePanel') + '; openAppointmentAddServicePanel()', c)
    assert.deepEqual([...c.els.appointmentAddServiceService.innerHTML.matchAll(/value="([^"]*)"/g)].map(m => m[1]), ['star-a', 'star-b', 'first'])
  })
  assert.equal(failures, 0, `${failures} failed; ${passes} passed`)
  console.log(`Service Agenda favorite: ${passes} checks passed`)
} finally {
  await app.close(); await uiApp.close()
  for (const restore of restores.reverse()) restore()
  await prisma.$disconnect()
}
