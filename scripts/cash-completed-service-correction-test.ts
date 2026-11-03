import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import Fastify from 'fastify'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { prisma } from '../src/config/prisma.js'
import { PrismaCashRepository } from '../src/repositories/prisma-cash-repository.js'
import { appointmentRoutes } from '../src/routes/appointment.js'
import { cashRegisterRoutes } from '../src/routes/cash-register.js'
import { cashRegisterMarkup, cashRegisterScript, cashRegisterStyles } from '../src/routes/crm-ui/cash-register.js'
import { renderCrmHtml } from '../src/routes/crm-ui.js'

// Exercise the real route and Prisma selection without a live business/database.
const appointment = { id: 'old-appointment', businessId: 'local', professionalId: 'professional', serviceId: 'a', status: 'COMPLETED', customerId: 'customer', customer: { id: 'customer', name: 'Cliente', phone: '123' }, service: { id: 'a', name: 'Servicio A', price: 40, priceMode: 'FIXED' }, serviceItems: [{ serviceId: 'a' }], quotedPrice: 40, manualDepositAmount: null }
const originals = { business: prisma.business.findFirst, user: prisma.user.findFirst, appointments: prisma.appointment.findMany }
let active = true
let contextQueries = 0
;(prisma.business as any).findFirst = async ({ where }: any) => {
  if (where.accountAdminId && (where.accountAdminId !== 'admin' || where.id !== 'local')) return null
  return where.id === 'foreign' ? null : { id: 'local' }
}
;(prisma.user as any).findFirst = async ({ where }: any) => active && where.id === 'admin' && where.isActive === true
  ? { id: 'admin', name: 'Admin', role: where.role, businessId: where.role === 'BUSINESS_ADMIN' ? 'local' : null } : null
;(prisma.appointment as any).findMany = async ({ where }: any) => {
  contextQueries++
  assert.equal(where.professional.businessId, 'local', 'consulta puntual siempre acotada al local propio')
  assert.equal(where.businessId, 'local', 'también el turno pertenece al local propio')
  assert.equal(where.startAt, undefined, 'el contexto no depende del rango de Agenda')
  return where.id === appointment.id ? [appointment] : []
}
const app = Fastify()
app.addHook('preHandler', async request => { request.auth = { user: { id: 'admin', name: 'Admin', role: request.headers['x-role'] || 'BUSINESS_ADMIN', businessId: ['SUPER_ADMIN', 'ACCOUNT_ADMIN'].includes(String(request.headers['x-role'])) ? null : 'local', canViewCashRegister: true } } as never })
await app.register(appointmentRoutes)
await app.register(cashRegisterRoutes, { authorizeBusiness: async () => true, cashService: { listCashEntries: async () => ({ entries: [{ id: 'payment', serviceCorrectionAppointmentId: appointment.id }], nextCursor: null }), getCurrentCashRegister: async () => ({ day: { id: 'old-day' } }) } as never })
try {
  const url = '/appointments/' + appointment.id + '/service-correction-context'
  const result = await app.inject({ method: 'GET', url })
  assert.equal(result.statusCode, 200, 'Caja necesita cargar un turno histórico puntual fuera de la Agenda')
  assert.equal(result.json().id, appointment.id)
  assert.equal(contextQueries, 1)
  assert.equal((await app.inject({ method: 'GET', url: url + '?businessId=foreign' })).json().businessId, 'local', 'query no puede seleccionar otro local')
  for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
    assert.equal((await app.inject({ method: 'GET', url: url + '?businessId=local', headers: { 'x-role': role } })).statusCode, 200, role + ' carga el contexto del local autorizado')
    const rows = (await app.inject({ method: 'GET', url: '/cash-register/days/old-day/entries?businessId=local', headers: { 'x-role': role } })).json()
    assert.equal(rows.entries[0].serviceCorrectionAppointmentId, appointment.id, role + ' recibe el acceso desde Caja')
    assert.equal((await app.inject({ method: 'GET', url: url + '?businessId=foreign', headers: { 'x-role': role } })).statusCode, 404)
  }
  for (const role of ['STAFF']) {
    assert.equal((await app.inject({ method: 'GET', url, headers: { 'x-role': role } })).statusCode, 403)
    const rows = (await app.inject({ method: 'GET', url: '/cash-register/days/old-day/entries', headers: { 'x-role': role } })).json()
    assert.equal(rows.entries[0].serviceCorrectionAppointmentId, undefined, 'el acceso exclusivo no se ofrece a ' + role)
  }
  assert.equal((await app.inject({ method: 'GET', url: '/appointments/foreign/service-correction-context' })).statusCode, 404)
  appointment.status = 'CONFIRMED'
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, 'el contexto está limitado a realizados')
  appointment.status = 'COMPLETED'
  active = false
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 403, 'administrador inactivo pierde el contexto')
} finally {
  await app.close()
  ;(prisma.business as any).findFirst = originals.business
  ;(prisma.user as any).findFirst = originals.user
  ;(prisma.appointment as any).findMany = originals.appointments
}

const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const enums = [...schema.matchAll(/^enum (\w+) \{/gm)].map(match => match[1]!)
try {
  for (const name of enums) {
    const body = schema.match(new RegExp('enum ' + name + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
    const values = body.split('\n').flatMap(line => line.match(/@map\("([^"]+)"\)/)?.[1] ?? line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1] ?? [])
    await db.exec('CREATE TYPE "' + name + '" AS ENUM (' + values.map(value => "'" + value + "'").join(',') + ')')
  }
  for (const name of ['CashEntry', 'Appointment', 'AppointmentServiceItem', 'AppointmentAccount', 'AppointmentAccountLink', 'Customer', 'CashExpenseCategory', 'CashExpenseSubcategory']) {
    const body = schema.match(new RegExp('model ' + name + ' \\{([\\s\\S]*?)\\n\\}'))![1]!
    const columns = body.split('\n').flatMap(line => {
      const field = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
      if (!field || /\[\]/.test(line)) return []
      const scalar = ({ String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamptz', Json: 'jsonb' } as Record<string, string>)[field[2]!]
      const type = scalar ?? (enums.includes(field[2]!) ? '"' + field[2] + '"' : null)
      return type ? ['"' + field[1] + '" ' + type] : []
    })
    await db.exec('CREATE TABLE "' + name + '" (' + columns.join(',') + ')')
  }
  const repository = new PrismaCashRepository({ $transaction: async (work: any) => work({ $queryRaw: async (sql: Prisma.Sql) => (await db.query(sql.text, sql.values)).rows }) } as never)
  const list = () => repository.transaction(transaction => transaction.listCashEntries({ businessId: 'local', registerDayId: 'old-day', cursor: null, limit: 50, type: null, method: null, expenseCategoryId: null, cashSessionId: null, query: null }))
  await db.exec(`INSERT INTO "Customer" (id,"businessId",name) VALUES ('customer','local','Cliente');
    INSERT INTO "Appointment" (id,"businessId","customerId","serviceId",status) VALUES ('old-appointment','local','customer','a','COMPLETED');
    INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId") VALUES ('old-appointment','a');
    INSERT INTO "AppointmentAccount" (id,"businessId","pricingMode") VALUES ('account','local','FIXED');
    INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('local','old-appointment','account');
    INSERT INTO "CashEntry" (id,"businessId","accountId","registerDayId",type,direction,amount,"paymentMethod",origin,"effectiveAt") VALUES ('payment','local','account','old-day','PAYMENT','INFLOW',40,'CASH','AGENDA','2026-01-01');`)
  assert.equal((await list())[0]?.serviceCorrectionAppointmentId, appointment.id)
  for (const mutation of [
    `UPDATE "Appointment" SET status='CONFIRMED'`,
    `UPDATE "AppointmentAccount" SET "pricingMode"='ESTIMATED'`,
    `INSERT INTO "AppointmentAccountLink" ("businessId","appointmentId","accountId") VALUES ('local','other','account')`,
    `INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId") VALUES ('old-appointment','b')`,
    `UPDATE "Appointment" SET "businessId"='foreign'`,
    `UPDATE "CashEntry" SET type='REFUND'`,
    `INSERT INTO "CashEntry" (id,"businessId","reversesEntryId",type) VALUES ('reversed','local','payment','REVERSAL')`
  ]) {
    await db.exec('BEGIN')
    await db.exec(mutation)
    assert.equal((await list())[0]?.serviceCorrectionAppointmentId, null, mutation)
    await db.exec('ROLLBACK')
  }
} finally { await db.close() }

const crmSource = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
function fn(source: string, name: string) {
  const offset = ['    function ', '    async function '].map(prefix => source.indexOf(prefix + name + '(')).find(index => index >= 0) ?? -1
  assert.ok(offset >= 0, 'falta la función compartida ' + name)
  return source.slice(offset, source.indexOf('\n    }', offset) + 6)
}
function node() { return { disabled: false, hidden: false, value: '', innerHTML: '', textContent: '', className: '', focus() {}, setAttribute() {}, removeAttribute() {} } }
const cashUi: any = { entryList: node(), nextPage: node() }
const state: any = { businessId: 'local', currentUser: { role: 'BUSINESS_ADMIN', businessId: 'local' }, agendaAppointments: [], appointments: [], cashRegister: { selectedDayId: 'old-day', entries: [{ id: 'payment', businessId: 'local', type: 'PAYMENT', direction: 'INFLOW', amount: 40, method: 'CASH', effectiveAt: '2026-01-01', serviceCorrectionAppointmentId: appointment.id }] } }
const calls: string[] = []
let releaseContext: ((value: any) => void) | undefined
let deferred = false
let failure = false
const context = vm.createContext({ state, cashUi, els: { appShell: { dataset: { section: 'cash' } } },
  cashTypeLabels: { PAYMENT: 'Cobro' }, cashMethodLabels: { CASH: 'Efectivo' }, cashMoney: (value: number) => '$' + value, cashDate: String, escapeHtml: String,
  setButtonLoading: (button: any, value: boolean) => { if (button) button.disabled = value }, showCrmToast: (message: string) => calls.push('toast:' + message),
  canCorrectCompletedService: (item: any) => item?.status === 'COMPLETED' && item.businessId === state.businessId,
  getJson: async (url: string) => { calls.push(url); if (failure) throw new Error('Error temporal'); if (deferred) return new Promise(resolve => { releaseContext = resolve }); return appointment },
  openAppointmentDialog: (input: any) => { state.editingAppointmentId = input.appointment.id; state.editingAppointmentSnapshot = input.appointment; state.appointmentDialogSource = input.source; state.appointmentDialogRevision = (state.appointmentDialogRevision || 0) + 1; calls.push('dialog:' + input.source) },
  openCompletedServiceCorrection: async () => { calls.push('same-panel') }
})
for (const name of ['isCashBusinessScopedRole', 'cashScoped', 'canCorrectCashEntryService', 'renderCashEntries', 'openCashServiceCorrection']) vm.runInContext(fn(cashRegisterScript, name), context)
vm.runInContext(fn(crmSource, 'editingAgendaAppointment'), context)
const run = (expression: string) => vm.runInContext(expression, context)
run('renderCashEntries()')
assert.match(cashUi.entryList.innerHTML, /Corregir fecha[\s\S]*Corregir servicio/)
for (const role of ['STAFF']) {
  state.currentUser.role = role
  run('renderCashEntries()')
  assert.doesNotMatch(cashUi.entryList.innerHTML, /data-cash-correct-service/)
}
state.currentUser.role = 'BUSINESS_ADMIN'
for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
  state.currentUser.role = role
  state.currentUser.businessId = null
  run('renderCashEntries()')
  assert.match(cashUi.entryList.innerHTML, /data-cash-correct-service/, role + ' ve Corregir servicio en Caja')
  await run('openCashServiceCorrection(state.cashRegister.entries[0])')
  assert.ok(calls.includes('/appointments/' + appointment.id + '/service-correction-context?businessId=local'), role + ' consulta el contexto con el local activo')
}
state.currentUser.role = 'BUSINESS_ADMIN'
state.currentUser.businessId = 'local'
await run('openCashServiceCorrection(state.cashRegister.entries[0])')
assert.equal(run('editingAgendaAppointment().id'), appointment.id, 'turno fuera del rango se conserva en el snapshot del diálogo')
assert.equal(state.agendaAppointments.length, 0, 'abrir histórico no contamina Agenda')
assert.equal(state.appointments.length, 0, 'abrir histórico no contamina conversación')
assert.ok(calls.includes('same-panel'), 'ambos accesos abren el mismo formulario')
const count = calls.length
deferred = true
const opening = run('openCashServiceCorrection(state.cashRegister.entries[0])')
await Promise.resolve()
await run('openCashServiceCorrection(state.cashRegister.entries[0])')
assert.equal(calls.length, count + 1, 'doble clic genera una única consulta')
state.appointmentDialogRevision++
releaseContext?.(appointment)
await opening
assert.equal(calls.length, count + 1, 'un contexto pendiente no reemplaza otro diálogo abierto')
deferred = false
failure = true
await run('openCashServiceCorrection(state.cashRegister.entries[0])')
failure = false
await run('openCashServiceCorrection(state.cashRegister.entries[0])')
assert.equal(calls.at(-1), 'same-panel', 'error de carga permite reintentar')
deferred = true
const wrongBusiness = run('openCashServiceCorrection(state.cashRegister.entries[0])')
await Promise.resolve()
const beforeSwitch = calls.length
state.businessId = 'other'
releaseContext?.(appointment)
await wrongBusiness
assert.equal(calls.length, beforeSwitch, 'una respuesta del local anterior no abre el diálogo')
state.businessId = 'local'
deferred = false

// Run the production save handler from Caja with no Agenda rows available.
for (const key of ['correctionService', 'correctionReason', 'correctionMethod', 'correctionFeedback', 'correctionSubmit']) cashUi[key] = node()
Object.assign(context, {
  crypto: { randomUUID },
  completedServiceCorrectionPreview: () => ({ service: { id: 'b', price: 20 }, finalAmount: 20, paidAmount: 40, productSubtotal: 0, discountAmount: 0, refundAmount: 20 }),
  closeAppointmentDialog: () => { state.editingAppointmentId = null; state.editingAppointmentSnapshot = null; state.appointmentDialogSource = null; state.appointmentDialogRevision++ },
  selectCashDay: async (id: string) => { calls.push('day:' + id); state.cashRegister.selectedDayId = id },
  renderAppointmentFinance() {}, loadAgenda: async () => { throw new Error('Caja no depende del rango Agenda') }
})
vm.runInContext(fn(cashRegisterScript, 'submitCompletedServiceCorrection'), context)
function readySave() {
  state.editingAppointmentId = appointment.id
  state.editingAppointmentSnapshot = appointment
  state.appointmentDialogSource = 'cash'
  state.appointmentDialogRevision++
  Object.assign(state.cashRegister, { selectedDayId: 'old-day', viewMode: 'day', periodLoaded: true, professionalSummaryResult: { stale: true }, current: { session: { id: 'current-session' } }, paymentMethodsBusinessId: 'local', paymentMethods: [{ id: 'cash' }], appointmentFinanceCache: {}, appointmentFinanceSummaryCache: {}, appointmentFinance: { agreedAmount: 40 }, serviceCorrection: { ready: true } })
  cashUi.correctionReason.value = 'Se realizó el servicio B'
  cashUi.correctionMethod.value = 'cash'
}
let sends = 0
let refreshFailure = false
let resolveSaved: ((value: any) => void) | undefined
let deferSave = false
context.getJson = async (url: string, options: any) => {
  if (options?.method === 'POST') { sends++; if (deferSave) return new Promise(resolve => { resolveSaved = resolve }); return {} }
  assert.match(url, /service-correction-context$/)
  if (refreshFailure) throw new Error('No se pudo refrescar')
  return { ...appointment, serviceId: 'b', service: { id: 'b', name: 'Servicio B' } }
}
readySave()
await run('submitCompletedServiceCorrection()')
assert.equal(sends, 1)
assert.equal(state.cashRegister.selectedDayId, 'old-day', 'guardar conserva la jornada anterior')
assert.ok(calls.includes('day:old-day'), 'se refrescan los movimientos de la jornada seleccionada')
assert.equal(state.editingAppointmentSnapshot.serviceId, 'b', 'se vuelve a consultar el turno correcto por ID')
assert.equal(state.cashRegister.periodLoaded, false)
assert.equal(state.cashRegister.professionalSummaryResult, null)
assert.equal(state.agendaAppointments.length, 0)
readySave()
refreshFailure = true
await run('submitCompletedServiceCorrection()')
assert.equal(sends, 2)
assert.equal(state.editingAppointmentId, null, 'fallo al refrescar cierra el formulario ya guardado')
await run('submitCompletedServiceCorrection()')
assert.equal(sends, 2, 'fallo de refresco nunca reenvía la corrección financiera')
assert.ok(calls.some(value => value.includes('La corrección se guardó')))
refreshFailure = false
readySave()
deferSave = true
const saving = run('submitCompletedServiceCorrection()')
await Promise.resolve()
state.appointmentDialogRevision++
state.editingAppointmentSnapshot = { ...appointment, serviceId: 'another-selection' }
resolveSaved?.({})
await saving
assert.equal(state.editingAppointmentSnapshot.serviceId, 'another-selection', 'respuesta al guardar no reemplaza un diálogo reabierto')
deferSave = false
readySave()
state.appointmentDialogSource = null
state.editingAppointmentSnapshot = null
state.agendaAppointments = [appointment]
let resolveAgenda: (() => void) | undefined
context.loadAgenda = async () => new Promise<void>(resolve => { resolveAgenda = resolve })
const agendaSaving = run('submitCompletedServiceCorrection()')
await Promise.resolve()
state.appointmentDialogRevision++
state.editingAppointmentSnapshot = { ...appointment, serviceId: 'cash-dialog-opened-during-agenda-refresh' }
resolveAgenda?.()
await agendaSaving
assert.equal(state.editingAppointmentSnapshot.serviceId, 'cash-dialog-opened-during-agenda-refresh', 'refresco de Agenda no limpia el snapshot de otro diálogo')

const closeNodes: any = new Proxy({}, { get(target: any, key) { return target[key] ||= node() } })
const closeState = { editingAppointmentId: appointment.id, editingAppointmentSnapshot: appointment, appointmentDialogSource: 'cash', appointmentDialogRevision: 1 }
const closingContext = vm.createContext({ state: closeState, els: closeNodes, closeAppointmentCustomerResults() {}, resetAppointmentCustomerTechnicalProfile() {}, updateAppointmentContactActions() {}, closeAppointmentAttentionMenu() {}, closeAppointmentAddServicePanel() {} })
vm.runInContext(fn(crmSource, 'closeAppointmentDialog'), closingContext)
vm.runInContext('closeAppointmentDialog()', closingContext)
assert.equal(closeState.editingAppointmentSnapshot, null, 'cerrar elimina el snapshot histórico')
assert.equal(closeState.appointmentDialogSource, null)
assert.equal(closeState.appointmentDialogRevision, 2, 'cerrar invalida cargas pendientes')
const preparationNodes: any = new Proxy({}, { get(target: any, key) { return target[key] ||= { ...node(), dataset: {}, classList: { add() {}, remove() {} } } } })
const preparationContext = vm.createContext({ state: { cashRegister: {} }, cashUi: preparationNodes, hydrateIcons() {}, canCorrectCompletedService: () => false })
vm.runInContext(fn(crmSource, 'setButtonLoading'), preparationContext)
vm.runInContext(fn(cashRegisterScript, 'prepareCompletedServiceCorrection'), preparationContext)
vm.runInContext("setButtonLoading(cashUi.correctionSubmit, true, 'Guardando...'); prepareCompletedServiceCorrection(null)", preparationContext)
assert.equal(preparationNodes.correctionSubmit.dataset.loading, undefined, 'reabrir elimina el bloqueo visual de una operación anterior')
assert.equal(preparationNodes.correctionSubmit.disabled, true, 'el panel permanece deshabilitado hasta cargar finanzas actuales')
assert.match(cashRegisterStyles, /\.cash-entry-actions[\s\S]*flex-wrap/, 'las dos acciones deben distribuirse sin desborde')
console.log('OK acceso Caja: contexto autorizado, SQL real, turno histórico aislado, mismo formulario y errores recuperables')

if (process.env.CORRECTION_QA_BROWSER_MODULE && process.env.CASH_CORRECTION_QA_OUTPUT_DIR) {
  const { chromium } = await import(pathToFileURL(process.env.CORRECTION_QA_BROWSER_MODULE).href)
  const browser = await chromium.launch({ headless: true, ...(process.env.CORRECTION_QA_BROWSER_CHANNEL ? { channel: process.env.CORRECTION_QA_BROWSER_CHANNEL } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.route('**/*', (route: any) => route.abort())
    const rendered = renderCrmHtml({ pollingMarker: { effective: false, headerName: '', headerValue: '' } as any })
    const style = rendered.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    await page.setContent('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + style + '</style><body data-current-section="cash"><main class="app" data-section="cash">' + cashRegisterMarkup + '</main></body></html>')
    const fixtureState = { businessId: 'local', currentUser: { role: 'BUSINESS_ADMIN', businessId: 'local' }, cashRegister: { entries: [{ ...state.cashRegister.entries[0], customerNames: ['Alonso Fernández'], amount: 44000 }, { id: 'expense', businessId: 'local', type: 'EXPENSE', direction: 'OUTFLOW', amount: 5000, method: 'CASH', description: 'Insumos', effectiveAt: '2026-01-01' }], nextCursor: null } }
    await page.addScriptTag({ content: `
      const state = ${JSON.stringify(fixtureState)};
      const cashUi = { entryList: document.getElementById('cash-entry-list'), nextPage: document.getElementById('cash-next-page') };
      const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      const cashMoney = (value) => '$ ' + value.toLocaleString('es-AR');
      const cashDate = () => '13/10/26, 20:29';
      const cashTypeLabels = { PAYMENT: 'Cobro', EXPENSE: 'Gasto' };
      const cashMethodLabels = { CASH: 'Efectivo' };
      ${fn(cashRegisterScript, 'canCorrectCashEntryService')}
      ${fn(cashRegisterScript, 'renderCashEntries')}
      document.getElementById('cash-empty-state').hidden = true;
      document.getElementById('cash-dashboard').hidden = false;
      document.getElementById('cash-session-strip').hidden = true;
      document.getElementById('cash-session-history').hidden = true;
      document.getElementById('cash-day-select').innerHTML = '<option>13/10/2026 · Jornada cerrada</option>';
      document.getElementById('cash-gross').textContent = '$ 44.000';
      document.getElementById('cash-outgoing').textContent = '$ 5.000';
      document.getElementById('cash-status').textContent = 'Jornada cerrada';
      renderCashEntries();
    ` })
    for (const role of ['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
      await page.evaluate(`state.currentUser.role = '${role}'; state.currentUser.businessId = ${role === 'BUSINESS_ADMIN' ? "'local'" : 'null'}; renderCashEntries()`)
      assert.equal(await page.locator('[data-cash-correct-service="payment"]').isVisible(), true, role + ' ve el acceso desde Caja en el navegador')
    }
    await page.evaluate("state.currentUser.role = 'STAFF'; renderCashEntries()")
    assert.equal(await page.locator('[data-cash-correct-service="payment"]').count(), 0)
    await page.evaluate("state.currentUser.role = 'SUPER_ADMIN'; renderCashEntries()")
    await mkdir(process.env.CASH_CORRECTION_QA_OUTPUT_DIR, { recursive: true })
    for (const [label, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height })
      await page.locator('[data-cash-correct-service]').scrollIntoViewIfNeeded()
      for (const selector of ['[data-cash-correct-date="payment"]', '[data-cash-correct-service="payment"]']) {
        const button = page.locator(selector)
        assert.equal(await button.isVisible(), true, selector + ' visible en ' + label)
        const bounds = await button.boundingBox()
        assert.ok(bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, selector + ' dentro del viewport')
      }
      assert.equal(await page.locator('#cash-entry-list').evaluate((element: HTMLElement) => element.scrollWidth > element.clientWidth + 1), false, 'movimientos sin desborde en ' + label)
      assert.equal(await page.locator('[data-cash-correct-service="expense"]').count(), 0)
      await page.screenshot({ path: join(process.env.CASH_CORRECTION_QA_OUTPUT_DIR, 'caja-corregir-servicio-' + label + '.png') })
    }
    console.log('OK navegador Caja: acciones accesibles escritorio/móvil, jornada anterior, sin desborde; capturas en ' + process.env.CASH_CORRECTION_QA_OUTPUT_DIR)
  } finally { await browser.close() }
}
