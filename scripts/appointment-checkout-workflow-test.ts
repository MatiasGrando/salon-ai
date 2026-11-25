import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'
const ast = ts.createSourceFile('cash.js', cashRegisterScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const names = ['appointmentPaymentOperationKey', 'appointmentPaymentStorageKey', 'readPendingAppointmentPayment', 'writePendingAppointmentPayment', 'buildAppointmentCheckoutPayload', 'canCompleteCheckoutAppointment', 'submitAppointmentCheckout']
const functions = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || '')).map((node) => node.getText(ast)).join('\n')
for (const name of names) assert.ok(functions.includes('function ' + name + '('), name)
const storage = new Map<string, string>()
let posts: any[] = [], saved = true, saveCount = 0, fail: any = null, resolvePayment: any, applied = 0, hidden = 0
const appointment = { id: 'a', status: 'CONFIRMED', startAt: '2020-01-01' }
const state: any = { businessId: 'b', currentUser: { id: 'staff', role: 'STAFF' }, editingAppointmentId: 'a', cashRegister: { current: { session: { id: 'cash' } }, appointmentFinance: { balanceAmount: 100 }, paymentMethods: [{ id: 'cash-method', kind: 'CASH' }, { id: 'bank-method', kind: 'TRANSFER' }], paymentMethodsBusinessId: 'b', checkout: { appointmentId: 'a', mode: 'deposit', selectedMethod: 'cash-method', amount: 20 } } }
const ui: any = { amount: { value: '20' }, complete: { checked: false }, observation: { value: '' }, error: { textContent: '' }, submit: { disabled: false } }
const context: any = vm.createContext({ state, cashUi: { paymentObservation: ui.observation }, isCashBusinessScopedRole: () => false, checkoutUi: ui, JSON, Number, String, Boolean, Date, Array, crypto: { randomUUID: () => 'request-' + Math.random() }, sessionStorage: { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) }, canUseCashPermission: () => true, canCompleteAppointments: () => true, editingAgendaAppointment: () => appointment, cashRegisterScopeKey: () => JSON.stringify([state.businessId, state.currentUser.id]), cashRegisterScopeIsCurrent: (register: any, scope: string) => register === state.cashRegister && scope === JSON.stringify([state.businessId,state.currentUser.id]), ensureAppointmentDraftSaved: async () => { saveCount++; return saved }, cashScoped: (p: string) => p, configuredPaymentLine: (s: any, amount: number) => ({ amount, method: state.cashRegister.paymentMethods.find((m: any) => m.id === s.value)?.kind, paymentMethodId: s.value }), readAppointmentCheckoutLines: () => [{ amount: Number(ui.amount.value), method: 'CASH', paymentMethodId: 'cash-method' }], applyAppointmentCheckoutResult: async () => { applied++ }, showCrmToast() {}, hideAppointmentCheckout: () => { hidden++ }, renderAppointmentCheckout() {}, setButtonLoading: (button: any, loading: boolean) => { button.disabled = loading; return true }, getJson: async (url: string, options: any) => { posts.push(JSON.parse(options.body)); if (fail) throw fail; if (resolvePayment) return await new Promise((resolve) => { resolvePayment = resolve }); return { entries: [], finance: { paidAmount: 20, balanceAmount: 80 }, completion: null } } })
vm.runInContext(functions, context)
assert.equal(context.canCompleteCheckoutAppointment({ ...appointment, status: 'NO_SHOW' }), false)
assert.equal(context.canCompleteCheckoutAppointment({ ...appointment, startAt: '2099-01-01' }), false)
assert.equal(context.canCompleteCheckoutAppointment(appointment), true)
let payload = context.buildAppointmentCheckoutPayload()
assert.equal(payload.expectedBalance, 100)
assert.equal(payload.lines[0].amount, 20)
ui.amount.value = '101'
assert.throws(() => context.buildAppointmentCheckoutPayload(), /saldo/)
ui.amount.value = '20'
state.cashRegister.checkout.mode = 'total'
assert.throws(() => context.buildAppointmentCheckoutPayload(), /exactamente/)
state.cashRegister.checkout.mode = 'deposit'
saved = false
await context.submitAppointmentCheckout()
assert.equal(posts.length, 0, 'failed draft save prevents payment')
saved = true
fail = new Error('timeout')
await context.submitAppointmentCheckout()
assert.equal(posts.length, 1)
assert.equal(applied, 0)
const first = posts[0]
assert.ok(first.requestId)
assert.equal(context.readPendingAppointmentPayment().payload.requestId, first.requestId)
ui.amount.value = '40'
fail = null
await context.submitAppointmentCheckout()
assert.equal(posts.length, 2)
assert.deepEqual(posts[1], first, 'uncertain retry reuses exact original payload and request key')
assert.equal(saveCount, 2, 'retry does not repeat a successfully saved draft')
assert.equal(applied, 1)
assert.equal(context.readPendingAppointmentPayment(), null)
assert.equal(hidden, 1)
// A rejected request is safe to edit and gets a new intention; an uncertain request survives reopen.
state.cashRegister.checkout.mode = 'deposit'; ui.amount.value = '20'; fail = Object.assign(new Error('invalid'), { status: 400 })
await context.submitAppointmentCheckout()
assert.equal(context.readPendingAppointmentPayment(), null)
fail = new Error('network'); await context.submitAppointmentCheckout()
assert.ok(context.readPendingAppointmentPayment())
state.currentUser.id = 'other'
assert.equal(context.readPendingAppointmentPayment(), null, 'pending payment is isolated by actor')
state.currentUser.id = 'staff'; state.editingAppointmentId = 'different'
assert.equal(context.readPendingAppointmentPayment(), null, 'pending payment is isolated by appointment')
state.editingAppointmentId = 'a'
assert.ok(context.readPendingAppointmentPayment())
// One lock covers both deposit and total requests.
fail = null; resolvePayment = true
const a = context.submitAppointmentCheckout()
await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
const count = posts.length
await context.submitAppointmentCheckout()
assert.equal(posts.length, count)
assert.equal(ui.submit.disabled, true)
resolvePayment({ entries: [], finance: {}, completion: null }); resolvePayment = null
await a
assert.equal(ui.submit.disabled, false)
console.log('OK: checkout permissions, exact money, save-before-pay, persistent retry and deposit/total lock.')
