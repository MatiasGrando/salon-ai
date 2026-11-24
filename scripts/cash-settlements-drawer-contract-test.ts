import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { cashRegisterMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

assert.match(cashRegisterMarkup, /id="cash-professional-payment-drawer"[^>]*hidden/, 'El pago se abre en un Drawer oculto')
assert.match(cashRegisterMarkup, /id="cash-professional-payment-open"/, 'La pantalla tiene una acción principal')
assert.match(cashRegisterMarkup, /id="cash-professional-period-dates"[^>]*hidden/, 'Las fechas se muestran solo en Personalizado')

function functions(names: string[]) {
  const ast = ts.createSourceFile('cash.js', cashRegisterScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = new Map<string, string>()
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return names.map(name => {
    assert.ok(declarations.has(name), 'Función real necesaria: ' + name)
    return declarations.get(name)
  }).join('\n')
}

const node = (value = '') => ({ value, hidden: false, disabled: false, textContent: '', innerHTML: '', className: '', dataset: {} as Record<string, string>,
  classList: { toggle() {} }, setAttribute() {}, focus() {}, querySelectorAll: () => [] })
const ui: any = Object.fromEntries(['professionalPaymentProfessional', 'professionalPaymentType', 'professionalPaymentAmount', 'professionalPaymentSource', 'professionalPaymentMethod', 'professionalPaymentObservation', 'professionalPaymentFeedback', 'professionalPaymentBalance', 'professionalPaymentContext', 'professionalPaymentSubmit', 'professionalPaymentOpen', 'professionalPaymentPanel', 'professionalPeriodDates', 'professionalSummary'].map(key => [key, node()]))
ui.professionalPaymentProfessional.value = 'p1'
ui.professionalPaymentType.value = 'PAYMENT'
ui.professionalPaymentSource.value = 'CASH_REGISTER'
ui.professionalPaymentMethod.value = 'CASH'
ui.professionalPaymentAmount.value = '1000'
const form = { dataset: {} as Record<string, string>, reset() { ui.professionalPaymentAmount.value = '' }, querySelector: () => ui.professionalPaymentSubmit,
  querySelectorAll: () => [] }
ui.professionalPaymentForm = form
const date = node('2026-11-17')
const state: any = { businessId: 'b1', currentUser: { id: 'u1', role: 'BUSINESS_ADMIN' }, cashRegister: { current: { session: { id: 's1' } }, professionalSummaryResult: { items: [{ id: 'p1', name: 'Gaspar', currentBalance: 19500 }] }, professionalBalances: { p1: 19500 }, professionalFilterOptions: [{ id: 'p1', name: 'Gaspar' }, { id: 'old', name: 'Lucas', archivedAt: '2026-01-01' }], professionalExpandedIds: new Set() } }
const calls: any[] = [], notifications: string[] = []
let resolvePost: (value: any) => void = () => {}, rejectPost: (error: Error) => void = () => {}
let closed = 0, refreshes = 0, opened = false
const context: any = vm.createContext({ state, cashUi: ui, URLSearchParams, cashScoped: (value: string) => value, crypto: { randomUUID: () => 'idempotent-key' }, document: { getElementById: () => date, querySelectorAll: () => [] },
  cashBusinessIsoDate: () => '2026-11-17', canUseCashPermission: () => true,
  isCashBusinessScopedRole: () => true, configuredPaymentLine: (_: any, amount: number) => ({ amount, method: 'CASH', paymentMethodId: 'cash-id' }),
  selectDefaultPaymentMethod: (select: any) => { select.value = 'CASH' }, cashMoney: (amount: number) => '$ ' + amount,
  escapeHtml: (value: unknown) => String(value), ensureFinancialDateDefaults() {},
  cashRegisterScopeKey: () => state.businessId + ':' + state.currentUser.id,
  cashRegisterScopeIsCurrent: (register: any, scope: string) => state.cashRegister === register && scope === state.businessId + ':' + state.currentUser.id,
  professionalPaymentDrawer: { close: async () => { closed += 1; opened = false; return true }, open: () => { opened = true }, isOpen: () => opened },
  professionalPeriodDates: () => ({ from: '2026-11-16', to: '2026-11-22' }),
  cashPeriodDates: () => ({ from: '2026-11-17', to: '2026-11-17' }),
  setButtonLoading: (button: any, loading: boolean) => { button.disabled = loading; return true },
  showCrmToast: (message: string) => notifications.push(message),
  loadCashRegister: async () => { refreshes += 1 }, loadProfessionalSettlements: async () => { refreshes += 1 },
  invalidateCashRegister() {}, loadTreasury: async () => { throw new Error('No consultar Tesorería oculta') }, loadTreasuryConsolidated: async () => { throw new Error('No consultar Tesorería oculta') },
  getJson: (url: string, options: any) => { calls.push({ url, options }); return new Promise((resolve, reject) => { resolvePost = resolve; rejectPost = reject }) }
})

vm.runInContext(functions(['canManageProfessionalPayments', 'professionalPaymentDraft', 'syncProfessionalPaymentBalance', 'selectProfessionalPayment', 'openProfessionalPayment', 'syncProfessionalPaymentSource', 'submitProfessionalPayment']), context)
const submit = () => context.submitProfessionalPayment({ preventDefault() {} })
const first = submit()
assert.equal(calls.length, 1)
assert.equal(calls[0].url, '/professional-settlements/payments')
assert.deepEqual(JSON.parse(calls[0].options.body), { professionalId: 'p1', type: 'PAYMENT', amount: 1000, idempotencyKey: 'idempotent-key', cashSessionId: 's1', method: 'CASH', paymentMethodId: 'cash-id', businessId: 'b1' })
assert.equal(ui.professionalPaymentSubmit.disabled, true)
void submit()
assert.equal(calls.length, 1, 'Doble clic no duplica el pago')
resolvePost({})
await first
assert.equal(closed, 1, 'El éxito cierra el Drawer')
assert.equal(notifications.length, 1)
assert.equal(ui.professionalPaymentSubmit.disabled, false)
assert.equal(refreshes, 1, 'El éxito actualiza una vez las liquidaciones')

ui.professionalPaymentAmount.value = '3000'
const failed = submit()
rejectPost(new Error('Saldo insuficiente'))
await failed
assert.equal(closed, 1)
assert.equal(ui.professionalPaymentAmount.value, '3000', 'El error conserva el importe')
assert.match(ui.professionalPaymentFeedback.textContent, /Saldo insuficiente/)
assert.equal(ui.professionalPaymentSubmit.disabled, false)

state.currentUser.role = 'STAFF'
const prior = calls.length
await submit()
assert.equal(calls.length, prior, 'El personal conserva la vista de lectura aun con flags privilegiados')

state.currentUser.role = 'BUSINESS_ADMIN'
ui.professionalPaymentSource.value = 'TREASURY'
ui.professionalPaymentType.value = 'ADVANCE'
date.value = '2026-11-16'
state.cashRegister.current.session = null
context.syncProfessionalPaymentSource()
assert.equal(ui.professionalPaymentMethod.disabled, true)
assert.equal(date.disabled, false)
assert.equal(ui.professionalPaymentSubmit.textContent, 'Confirmar adelanto')
const treasury = submit()
const treasuryBody = JSON.parse(calls.at(-1).options.body)
assert.equal(calls.at(-1).url, '/treasury/pay-professional')
assert.equal(treasuryBody.effectiveDate, '2026-11-16')
assert.equal(treasuryBody.type, 'ADVANCE')
assert.equal(treasuryBody.cashSessionId, undefined)
assert.equal(treasuryBody.method, undefined)
resolvePost({})
await treasury

ui.professionalPaymentAmount.value = '4000'
const beforeScopeSwitch = { closed, refreshes, notifications: notifications.length }
const stale = submit()
state.businessId = 'b2'
resolvePost({})
await stale
assert.deepEqual({ closed, refreshes, notifications: notifications.length }, beforeScopeSwitch, 'Una respuesta de otra cuenta no cierra ni avisa en la nueva')
state.businessId = 'b1'

ui.professionalPaymentAmount.value = '4500'
const closing = context.professionalPaymentDrawer.close
let finishClose: () => void = () => {}
context.professionalPaymentDrawer.close = () => new Promise<void>(resolve => { finishClose = resolve })
const beforeAnimation = notifications.length
const animation = submit()
resolvePost({})
await Promise.resolve()
await Promise.resolve()
state.businessId = 'b2'
finishClose()
await animation
assert.equal(notifications.length, beforeAnimation, 'El cambio de cuenta durante la animación también queda aislado')
state.businessId = 'b1'
context.professionalPaymentDrawer.close = closing

ui.professionalPaymentAmount.value = '5000'
context.loadProfessionalSettlements = async () => { throw new Error('No se pudo actualizar') }
const refreshError = submit()
resolvePost({})
await refreshError
assert.equal(ui.professionalPaymentAmount.value, '')
assert.match(notifications.at(-1)!, /registrado/)
assert.doesNotMatch(ui.professionalPaymentFeedback.textContent, /No se pudo actualizar/)

state.cashRegister.professionalBalances = { p1: 19500 }
await context.openProfessionalPayment('p1')
assert.equal(ui.professionalPaymentProfessional.value, 'p1')
assert.equal(ui.professionalPaymentAmount.value, '19500', 'Pagar sugiere el saldo actual')
assert.equal(ui.professionalPaymentType.value, 'PAYMENT')
await context.openProfessionalPayment()
assert.equal(ui.professionalPaymentProfessional.value, '')
assert.equal(ui.professionalPaymentAmount.value, '', 'El botón general permite elegir libremente')

ui.professionalPaymentProfessional.value = 'unknown'
const missingBalance = context.selectProfessionalPayment()
ui.professionalPaymentProfessional.value = 'p1'
ui.professionalPaymentAmount.value = '8000'
resolvePost({ items: [{ id: 'unknown', currentBalance: 92000 }] })
await missingBalance
assert.equal(ui.professionalPaymentAmount.value, '8000', 'La respuesta anterior no altera el nuevo profesional')

ui.professionalPaymentProfessional.value = 'unknown-2'
const editingBalance = context.selectProfessionalPayment()
ui.professionalPaymentAmount.value = '7000'
state.cashRegister.professionalPaymentDraftRevision = 1
resolvePost({ items: [{ id: 'unknown-2', currentBalance: 93000 }] })
await editingBalance
assert.equal(ui.professionalPaymentAmount.value, '7000', 'La sugerencia tardía conserva el importe ya editado')

ui.professionalCount = node()
vm.runInContext(functions(['renderProfessionalServiceDetails', 'professionalSettlementRow', 'professionalSettlementGroup', 'renderProfessionalSettlements', 'setProfessionalPeriodPreset']), context)
ui.professionalPaymentProfessional.value = 'p1'
ui.professionalPaymentAmount.value = '1234'
context.renderProfessionalSettlements({ items: [{ id: 'p1', name: 'Gaspar', isActive: true, currentBalance: 19500, completedServices: 2 }, { id: 'old', name: 'Lucas', archivedAt: '2026-01-01', currentBalance: 5000 }] })
assert.equal(ui.professionalPaymentProfessional.value, 'p1')
assert.equal(ui.professionalPaymentAmount.value, '1234', 'Refrescar la tabla conserva el importe editado')
assert.match(ui.professionalSummary.innerHTML, /<table class="cash-professional-summary-table">/)
for (const text of ['Realizados', 'Generado per&iacute;odo', 'Pagos/adelantos per&iacute;odo', 'Saldo del per&iacute;odo', 'Saldo actual']) assert.ok(ui.professionalSummary.innerHTML.includes(text), text)
assert.match(ui.professionalSummary.innerHTML, /<details class="cash-professional-former[^>]*"><summary>/, 'Los desvinculados están cerrados inicialmente')
assert.match(ui.professionalSummary.innerHTML, /data-professional-settlement-pay="old"/, 'Se conserva el pago de saldos históricos de desvinculados')
assert.equal((ui.professionalSummary.innerHTML.match(/class="cash-professional-avatar/g) || []).length, 2, 'Cada profesional tiene una inicial visible en el resumen')
assert.match(ui.professionalSummary.innerHTML, /data-professional-settlement-pay="p1"[^>]*><svg/, 'Pagar reutiliza los iconos lineales de Caja')
assert.doesNotMatch(ui.professionalSummary.innerHTML, /class="cash-professional-group-heading"/, 'La tabla actual no duplica el encabezado visible')
assert.equal(ui.professionalCount.textContent, '1 profesional', 'El contador corresponde al equipo actual y mantiene separado el historial')
assert.match(ui.professionalPaymentProfessional.innerHTML, /Lucas/)
state.currentUser.role = 'STAFF'
context.renderProfessionalSettlements({ items: [{ id: 'p1', name: 'Gaspar', currentBalance: 19500 }] })
assert.doesNotMatch(ui.professionalSummary.innerHTML, /data-professional-settlement-pay=/)
ui.professionalPeriodFrom = node()
ui.professionalPeriodTo = node()
context.setProfessionalPeriodPreset('custom')
assert.equal(ui.professionalPeriodDates.hidden, false)
context.setProfessionalPeriodPreset('today')
assert.equal(ui.professionalPeriodDates.hidden, true)
ui.professionalEntries = node()
ui.professionalPageInfo = node()
ui.professionalPrevious = node()
ui.professionalNext = node()
context.cashDate = () => '17/11/26'
vm.runInContext(functions(['professionalSettlementEntryDate', 'renderProfessionalSettlementEntries']), context)
context.renderProfessionalSettlementEntries({ items: [
  { id: 'earned', type: 'EARNING', direction: 'CREDIT', amount: 5000, professional: { name: 'Gaspar' } },
  { id: 'paid', type: 'PAYMENT', direction: 'DEBIT', amount: 2000, professional: { name: 'Gaspar' } }
], total: 2 })
assert.match(ui.professionalEntries.innerHTML, /class="cash-settlement-type earning"><svg[\s\S]*Servicio realizado/)
assert.match(ui.professionalEntries.innerHTML, /class="cash-settlement-type payment"><svg[\s\S]*Pago/)
assert.match(ui.professionalEntries.innerHTML, /class="cash-settlement-credit">\+\$ 5000/)
assert.match(ui.professionalEntries.innerHTML, /class="negative">−\$ 2000/)
console.log('Liquidaciones: Drawer, payloads contables, doble submit, respuesta tardía, borrador y permisos OK')
