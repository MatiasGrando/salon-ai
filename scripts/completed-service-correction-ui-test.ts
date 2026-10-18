import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appointmentFinanceMarkup, cashRegisterScript, cashRegisterStyles } from '../src/routes/crm-ui/cash-register.js'
import { renderCrmHtml } from '../src/routes/crm-ui.js'

const source = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.ok(appointmentFinanceMarkup.includes('id="appointment-service-correction"'), 'el detalle necesita su panel de corrección')
assert.ok(!appointmentFinanceMarkup.includes('<form class="appointment-service-correction'), 'no anidar formularios')
assert.match(cashRegisterStyles, /\.appointment-service-correction\s*\{/)
assert.match(cashRegisterStyles, /\.appointment-correction-grid\s*\{[^}]*minmax\(0, 1fr\)/)
assert.match(cashRegisterStyles, /@media\s*\(max-width: 640px\)[\s\S]*appointment-correction-grid/)
assert.match(source, /const completedReadOnly = editingAgendaAppointment\(\)\?\.status === 'COMPLETED'/)
assert.match(source, /appointmentService\.disabled = completedReadOnly/)
assert.match(source, /appointmentProfessional\.disabled = completedReadOnly/)
assert.match(source, /appointmentSubmit\.hidden = completedReadOnly/)

const permissionNodes: any = new Proxy({ blockForm: null } as any, { get(target, property) { return property in target ? target[property] : target[property] = node() } })
let permissionAppointment: any = { status: 'COMPLETED' }
const permissionContext = vm.createContext({ els: permissionNodes, state: { editingAppointmentId: 'appt' }, editingAgendaAppointment: () => permissionAppointment, appointmentServicesForProfessional: () => [{ id: 'a' }], canCreateAppointments: () => true, canEditAppointments: () => true, canCancelAppointments: () => true })
const permissionStart = source.indexOf('    function applyAgendaPermissions()')
vm.runInContext(source.slice(permissionStart, source.indexOf('\n    }', permissionStart) + 6), permissionContext)
vm.runInContext('applyAgendaPermissions()', permissionContext)
assert.equal(permissionNodes.appointmentService.disabled, true)
assert.equal(permissionNodes.appointmentSubmit.hidden, true)
permissionAppointment = null
permissionNodes.appointmentCustomerName.readOnly = true
permissionNodes.appointmentDepositPaid.checked = false
vm.runInContext('applyAgendaPermissions()', permissionContext)
assert.equal(permissionNodes.appointmentService.disabled, false, 'un turno nuevo se puede cargar después de revisar uno realizado')
assert.equal(permissionNodes.appointmentSubmit.hidden, false)
assert.equal(permissionNodes.appointmentDepositAmount.disabled, true, 'la seña sin marcar mantiene su importe deshabilitado')
assert.equal(permissionNodes.appointmentCustomerName.readOnly, true, 'se conservan las restricciones de clientes del staff')

function fn(name: string) {
  const start = cashRegisterScript.indexOf('    function ' + name + '(')
  const asyncStart = cashRegisterScript.indexOf('    async function ' + name + '(')
  const offset = start >= 0 ? start : asyncStart
  assert.ok(offset >= 0, `falta ${name}`)
  const end = cashRegisterScript.indexOf('\n    }', offset) + 6
  return cashRegisterScript.slice(offset, end)
}

function node() { return { value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', className: '', focus() {}, setAttribute() {}, removeAttribute() {} } }
const cashUi: any = Object.fromEntries(['correction', 'correctionToggle', 'correctionPanel', 'correctionService', 'correctionCurrent', 'correctionPrevious', 'correctionNext', 'correctionProducts', 'correctionDiscount', 'correctionPaid', 'correctionImpact', 'correctionRefund', 'correctionSession', 'correctionMethod', 'correctionReason', 'correctionFeedback', 'correctionSubmit', 'correctionCancel'].map((key) => [key, node()]))
const appointment: any = { id: 'appt', businessId: 'shop', serviceId: 'a', professionalId: 'pro', status: 'COMPLETED', service: { id: 'a', name: 'Servicio A' }, serviceItems: [{ serviceId: 'a' }] }
const state: any = { businessId: 'shop', editingAppointmentId: 'appt', currentUser: { role: 'BUSINESS_ADMIN', businessId: 'shop' }, cashRegister: { appointmentFinanceCache: {}, appointmentFinanceSummaryCache: {}, appointmentFinance: { accountId: 'account', pricingMode: 'FIXED', agreedAmount: 40, finalAmount: 45, productSubtotal: 10, discountAmount: 5, paidAmount: 45 }, current: { session: { id: 'session' } }, paymentMethodsBusinessId: 'shop', paymentMethods: [{ id: 'cash', name: 'Efectivo', kind: 'CASH' }], serviceCorrection: {} } }
const services = [{ id: 'a', name: 'Servicio A', price: 40, priceMode: 'FIXED' }, { id: 'b', name: 'Servicio B', price: 20, priceMode: 'FIXED' }, { id: 'c', name: 'Servicio C', price: 60, priceMode: 'FIXED' }]
const requests: any[] = []
let reopened = 0
let blockedResolve: (() => void) | undefined
let blockRequest = false
let requestFailure: any = null
const ctx = vm.createContext({
  state, cashUi, crypto: { randomUUID }, editingAgendaAppointment: () => appointment,
  appointmentServicesForProfessional: () => services,
  cashMoney: (amount: number) => '$' + amount, escapeHtml: (text: unknown) => String(text ?? ''),
  setButtonLoading: (button: any, busy: boolean) => { if (busy && button.disabled) return false; button.disabled = busy; return true },
  getJson: async (url: string, input: any) => { requests.push({ url, body: JSON.parse(input.body) }); if (blockRequest) await new Promise<void>((resolve) => { blockedResolve = resolve }); if (requestFailure) throw requestFailure; return { appointment: { ...appointment, serviceId: 'b' } } },
  loadAppointmentFinance: async () => state.cashRegister.appointmentFinance,
  loadAgenda: async () => {}, loadAppointments: async () => {}, renderAppointments() {},
  invalidateAppointmentFinanceCache() {}, showCrmToast() {}, closeAppointmentDialog() {},
  openAppointmentDialog: () => { reopened++ },
  requestAnimationFrame: (callback: () => void) => callback(),
})
for (const name of ['isCashBusinessScopedRole', 'cashScoped', 'canCorrectCompletedService', 'completedServiceCorrectionPreview', 'syncCompletedServiceCorrection', 'prepareCompletedServiceCorrection', 'submitCompletedServiceCorrection']) vm.runInContext(fn(name), ctx)
const call = (expression: string) => vm.runInContext(expression, ctx)
const idsStart = source.indexOf('    function appointmentServiceIds(')
const serviceIdsHelper = source.slice(idsStart, source.indexOf('\n    }', idsStart) + 6)
vm.runInContext(serviceIdsHelper, ctx)

assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), true)
for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
  state.currentUser.role = role
  state.currentUser.businessId = null
  assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), true, role + ' administra el local activo autorizado')
  call('prepareCompletedServiceCorrection(editingAgendaAppointment())')
  assert.equal(cashUi.correction.hidden, false, role + ' ve la acción en el detalle realizado')
}
for (const role of ['STAFF']) {
  state.currentUser.role = role
  assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), false, role)
}
state.currentUser.role = 'BUSINESS_ADMIN'
state.currentUser.businessId = 'other'
assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), false)
state.currentUser.businessId = 'shop'
appointment.serviceItems.push({ serviceId: 'b' })
assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), false, 'multi-servicio queda excluido')
appointment.serviceItems.pop()
appointment.status = 'CONFIRMED'
assert.equal(call('canCorrectCompletedService(editingAgendaAppointment())'), false)
appointment.status = 'COMPLETED'

cashUi.correctionService.value = 'b'
let preview = call('completedServiceCorrectionPreview()')
assert.equal(preview.finalAmount, 25, 'productos y descuento nominal se conservan')
assert.equal(preview.refundAmount, 20)
assert.equal(preview.balanceAmount, 0)
cashUi.correctionService.value = 'c'
preview = call('completedServiceCorrectionPreview()')
assert.equal(preview.finalAmount, 65)
assert.equal(preview.balanceAmount, 20)
assert.equal(preview.refundAmount, 0)
cashUi.correctionService.value = 'b'
state.cashRegister.appointmentFinance.discountAmount = 40
assert.equal(call('completedServiceCorrectionPreview()'), null, 'no permitir descuento mayor al nuevo subtotal')
state.cashRegister.appointmentFinance.discountAmount = 5
state.cashRegister.appointmentFinance.pricingMode = 'ESTIMATED'
assert.equal(call('completedServiceCorrectionPreview()'), null, 'cuenta estimada no tiene corrección automática')
state.cashRegister.appointmentFinance.pricingMode = 'FIXED'

call('prepareCompletedServiceCorrection(editingAgendaAppointment())')
assert.equal(cashUi.correctionPanel.hidden, true)
assert.equal(cashUi.correctionReason.value, '')
cashUi.correctionService.value = 'b'
cashUi.correctionReason.value = 'Carga equivocada'
cashUi.correctionMethod.value = 'cash'
state.cashRegister.serviceCorrection.ready = true
cashUi.correctionSubmit.disabled = false
state.cashRegister.current = null
await call('submitCompletedServiceCorrection()')
assert.equal(requests.length, 0, 'devolución requiere Caja abierta')
state.cashRegister.current = { session: { id: 'session' } }
cashUi.correctionMethod.value = ''
await call('submitCompletedServiceCorrection()')
assert.equal(requests.length, 0, 'medio de devolución debe elegirse explícitamente')
cashUi.correctionMethod.value = 'cash'
blockRequest = true
const first = call('submitCompletedServiceCorrection()')
await Promise.resolve()
await call('submitCompletedServiceCorrection()')
assert.equal(requests.length, 1, 'doble clic no duplica devolución')
blockedResolve?.()
await first
assert.equal(reopened, 1)
assert.match(requests[0].body.requestId, /^[a-f\d-]{36}$/)
const { requestId, ...payload } = requests[0].body
assert.deepEqual(payload, { serviceId: 'b', expectedServiceId: 'a', expectedServicePrice: 20, expectedAgreedAmount: 40, expectedPaidAmount: 45, expectedDiscountAmount: 5, expectedProductSubtotal: 10, reason: 'Carga equivocada', cashSessionId: 'session', paymentMethodId: 'cash' })
cashUi.correctionReason.value = 'No conservar al reabrir'
call('prepareCompletedServiceCorrection(editingAgendaAppointment())')
assert.equal(cashUi.correctionReason.value, '')
assert.equal(cashUi.correctionPanel.hidden, true)
assert.equal(cashUi.correctionMethod.value, '')

blockRequest = false
state.cashRegister.serviceCorrection.ready = true
cashUi.correctionSubmit.disabled = false
cashUi.correctionService.value = 'b'
cashUi.correctionReason.value = ''
await call('submitCompletedServiceCorrection()')
assert.equal(requests.length, 1, 'motivo obligatorio')
cashUi.correctionReason.value = 'Carga equivocada'
cashUi.correctionMethod.value = 'cash'
requestFailure = new Error('Respuesta interrumpida')
await call('submitCompletedServiceCorrection()')
await call('submitCompletedServiceCorrection()')
assert.equal(requests[1].body.requestId, requests[2].body.requestId, 'un reintento conserva identidad y evita doble devolución')
cashUi.correctionReason.value = 'Carga equivocada en web'
requestFailure = { message: 'Cambió el total', body: { code: 'SERVICE_CORRECTION_STALE' } }
await call('submitCompletedServiceCorrection()')
assert.notEqual(requests[2].body.requestId, requests[3].body.requestId, 'cambiar los datos inicia una confirmación nueva')
assert.equal(state.cashRegister.serviceCorrection.ready, false)
assert.equal(cashUi.correctionSubmit.disabled, true)
assert.match(cashUi.correctionFeedback.textContent, /importes cambiaron/)
await call('submitCompletedServiceCorrection()')
assert.equal(requests.length, 4, 'estado financiero cambiado obliga revisar otra vez')
requestFailure = null
for (const role of ['ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
  state.currentUser.role = role
  state.currentUser.businessId = null
  call('prepareCompletedServiceCorrection(editingAgendaAppointment())')
  state.cashRegister.serviceCorrection.ready = true
  cashUi.correctionSubmit.disabled = false
  cashUi.correctionService.value = 'b'
  cashUi.correctionReason.value = 'Carga equivocada ' + role
  cashUi.correctionMethod.value = 'cash'
  await call('submitCompletedServiceCorrection()')
  assert.equal(requests.at(-1).url, '/appointments/appt/correct-completed-service?businessId=shop', role + ' envía el local activo sin depender de user.businessId')
}
state.currentUser.role = 'BUSINESS_ADMIN'
state.currentUser.businessId = 'shop'

cashUi.financeHistory = node()
vm.runInContext('function renderAppointmentFinanceSummary() {}; function cashDate(value) { return value }; function financeEntryLabel() { return "Cobro" }', ctx)
vm.runInContext(fn('renderAppointmentFinance'), ctx)
call(`renderAppointmentFinance({ serviceCorrections: [{ previousServiceName: 'Servicio A', newServiceName: 'Servicio B', previousAmount: 40, newAmount: 20, actorName: 'Admin', reason: 'Error de carga', createdAt: '2026-10-15', previousCompensation: { amount: 12 }, newCompensation: { amount: 6 } }] })`)
assert.ok(cashUi.financeHistory.innerHTML.includes('$12 &rarr; $6'), 'el historial lee el importe dentro del snapshot de comisión')
call(`renderAppointmentFinance({ serviceCorrections: [{ previousCompensation: null, newCompensation: null }] })`)
assert.ok(cashUi.financeHistory.innerHTML.includes('Sin registro'), 'snapshot ausente no equivale a comisión cero')
state.currentUser.role = 'STAFF'
call(`renderAppointmentFinance({ serviceCorrections: [{ previousCompensation: { amount: 12 }, newCompensation: { amount: 6 } }] })`)
assert.ok(!cashUi.financeHistory.innerHTML.includes('Comisi&oacute;n'), 'el historial operativo del staff no muestra comisión privada')
state.currentUser.role = 'BUSINESS_ADMIN'

console.log('OK corrección administrativa UI: permisos, impacto, validación, doble clic y reapertura')

// Optional browser verification uses only local, synthetic records and the shipped markup/CSS/handlers.
if (process.env.CORRECTION_QA_BROWSER_MODULE && process.env.CORRECTION_QA_OUTPUT_DIR) {
  const { chromium } = await import(pathToFileURL(process.env.CORRECTION_QA_BROWSER_MODULE).href)
  const browser = await chromium.launch({ headless: true, ...(process.env.CORRECTION_QA_BROWSER_CHANNEL ? { channel: process.env.CORRECTION_QA_BROWSER_CHANNEL } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.route('**/*', (route: any) => route.abort())
    const rendered = renderCrmHtml({ pollingMarker: { effective: false, headerName: '', headerValue: '' } as any })
    const style = rendered.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    const panel = appointmentFinanceMarkup.slice(0, appointmentFinanceMarkup.indexOf('<details class="appointment-products"'))
    await page.setContent('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + style + '</style><body><div class="dialog-backdrop"><section class="dialog appointment-dialog-card"><header class="dialog-header"><h3>Detalle del turno realizado</h3></header><form class="appointment-form"><div class="appointment-modal-body">' + panel + '<details class="appointment-finance"><summary>Pago</summary></details></div><div class="dialog-actions"><button class="secondary" type="button">Cerrar</button></div></form></section></div></body></html>')
    const selectorLine = cashRegisterScript.slice(cashRegisterScript.indexOf('      correction:'), cashRegisterScript.indexOf('\n', cashRegisterScript.indexOf('      correction:')))
    const helpers = ['canCorrectCompletedService', 'completedServiceCorrectionPreview', 'syncCompletedServiceCorrection', 'prepareCompletedServiceCorrection', 'submitCompletedServiceCorrection', 'openCompletedServiceCorrection'].map(fn).join('\n')
    const listeners = cashRegisterScript.slice(cashRegisterScript.indexOf("    cashUi.correctionToggle.addEventListener"), cashRegisterScript.indexOf("    cashUi.finance.addEventListener('toggle'"))
    await page.addScriptTag({ content: `
      const cashUi = { ${selectorLine} };
      const appointment = ${JSON.stringify(appointment)};
      const services = ${JSON.stringify(services)};
      const state = ${JSON.stringify(state)};
      state.cashRegister.current = { session: { id: 'session' } };
      state.cashRegister.serviceCorrectionOperations = {};
      state.cashRegister.serviceCorrection = {};
      const editingAgendaAppointment = () => appointment;
      ${serviceIdsHelper}
      const appointmentServicesForProfessional = () => services;
      const cashMoney = (value) => '$ ' + value.toLocaleString('es-AR');
      const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      const loadAppointmentFinance = async () => state.cashRegister.appointmentFinance;
      const setButtonLoading = (button, busy) => { button.disabled = busy; };
      const getJson = async () => services;
      const cashScoped = (url) => url;
      ${helpers}
      ${listeners}
      prepareCompletedServiceCorrection(appointment);
    ` })
    for (const role of ['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN']) {
      await page.evaluate(`state.currentUser.role = '${role}'; state.currentUser.businessId = ${role === 'BUSINESS_ADMIN' ? "'shop'" : 'null'}; prepareCompletedServiceCorrection(appointment)`)
      assert.equal(await page.locator('#appointment-correction-toggle').isVisible(), true, role + ' ve el botón en el navegador')
    }
    await page.evaluate("state.currentUser.role = 'STAFF'; prepareCompletedServiceCorrection(appointment)")
    assert.equal(await page.locator('#appointment-correction-toggle').isVisible(), false)
    await page.evaluate("state.currentUser.role = 'SUPER_ADMIN'; prepareCompletedServiceCorrection(appointment)")
    await page.locator('#appointment-correction-toggle').click()
    await page.locator('#appointment-correction-service').selectOption('b')
    await page.locator('#appointment-correction-reason').fill('Se eligió el servicio A al reservar. Se realizó el servicio B.')
    await page.locator('#appointment-correction-method').selectOption('cash')
    assert.match(await page.locator('#appointment-correction-impact').innerText(), /Devolución.*20/)
    const checkOverflow = async () => {
      assert.equal(await page.locator('.appointment-modal-body').evaluate((element: HTMLElement) => element.scrollWidth > element.clientWidth + 1), false, 'panel sin desborde horizontal')
      const bounds = await page.locator('.appointment-dialog-card').boundingBox()
      const viewport = page.viewportSize()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1)
    }
    await checkOverflow()
    await mkdir(process.env.CORRECTION_QA_OUTPUT_DIR, { recursive: true })
    await page.locator('.appointment-modal-body').evaluate((element: HTMLElement) => { element.scrollTop = 0 })
    await page.screenshot({ path: join(process.env.CORRECTION_QA_OUTPUT_DIR, 'correccion-servicio-desktop.png') })
    await page.locator('#appointment-correction-cancel').click()
    await page.locator('#appointment-correction-toggle').click()
    assert.equal(await page.locator('#appointment-correction-reason').inputValue(), '')
    assert.equal(await page.locator('#appointment-correction-method').inputValue(), '')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#appointment-correction-service').selectOption('b')
    await checkOverflow()
    assert.equal(await page.locator('.appointment-correction-grid').first().evaluate((element: HTMLElement) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1)
    await page.screenshot({ path: join(process.env.CORRECTION_QA_OUTPUT_DIR, 'correccion-servicio-mobile.png') })
    await page.locator('.appointment-modal-body').evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: join(process.env.CORRECTION_QA_OUTPUT_DIR, 'correccion-servicio-mobile-actions.png') })
    console.log('OK navegador: escritorio 1440x1100, móvil 390x844, sin desbordes, acciones accesibles y reapertura limpia; capturas en ' + process.env.CORRECTION_QA_OUTPUT_DIR)
  } finally {
    await browser.close()
  }
}
