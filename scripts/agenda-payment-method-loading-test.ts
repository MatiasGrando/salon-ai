import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { appointmentFinanceMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

const ast = ts.createSourceFile('cash-ui.js', cashRegisterScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const names = ['configuredPaymentLine', 'selectDefaultPaymentMethod', 'renderConfiguredPaymentMethods', 'loadCashPaymentMethods', 'loadCreateAppointmentCashState', 'loadAppointmentFinance', 'showAppointmentFinanceError', 'submitAppointmentPayment', 'submitAppointmentDeposit', 'readCreateAppointmentPayment']
const functions = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || '')).map((node) => node.getText(ast)).join('\n')
assert.equal(functions.match(/(?:async )?function /g)?.length, names.length)

function select(kind = 'CASH') {
  let options = ['CASH', 'TRANSFER', 'CARD'].map((value) => ({ value, dataset: {} as Record<string, string> }))
  let value = kind
  return {
    get options() { return options }, get value() { return value }, set value(next: string) { value = next },
    get selectedIndex() { return options.findIndex((option) => option.value === value) },
    set innerHTML(html: string) {
      options = Array.from(html.matchAll(/value="([^"]+)" data-kind="([^"]+)"/g), (match) => ({ value: match[1], dataset: { kind: match[2] } }))
      value = options[0]?.value || ''
    }
  }
}

function harness(role = 'STAFF') {
  const state: any = { businessId: 'salon-1', currentUser: { role }, editingAppointmentId: 'appointment-1', cashRegister: {
    paymentMethods: [], appointmentFinanceRequestId: 0, appointmentFinanceCache: {}, appointmentFinanceInFlight: {},
    appointmentFinance: { balanceAmount: 100 }, current: { session: { id: 'session-1' } }, editFinance: {}, createFinance: { collectTotal: true }
  } }
  const cashUi: any = Object.fromEntries(['operationMethod', 'productSaleMethod', 'professionalPaymentMethod', 'createDepositMethod', 'createPaymentMethod', 'createPaymentMethodTwo', 'editDepositMethod', 'paymentMethod', 'paymentMethodTwo'].map((name) => [name, select(name.includes('Two') || name.includes('Deposit') ? 'TRANSFER' : 'CASH')]))
  Object.assign(cashUi, {
    financeFeedback: { textContent: '', className: '' }, createPaymentFeedback: { textContent: '', className: '' },
    paymentAmount: { value: '100' }, paymentAmountTwo: { value: '40' }, paymentLineTwo: { hidden: true },
    paymentCompleteRow: { hidden: true }, paymentComplete: { checked: false }, paymentObservation: { value: '' },
    editDepositAmount: { value: '20' }, createEstimatedTotal: { value: '' }, createPaymentAmount: { value: '100' },
    createPaymentAmountTwo: { value: '40' }, createPaymentLineTwo: { hidden: true }, createPaymentObservation: { value: '' }
  })
  const calls: { url: string, payload?: any }[] = []
  const toasts: string[] = []
  let methodFailure = false
  let paymentFailure = false
  let customMethods: any[] | undefined
  const context: any = vm.createContext({ state, cashUi,
    canUseCashPermission: (permission: string) => permission === 'canRecordAppointmentPayments',
    cashScoped: (url: string) => url + '?businessId=' + state.businessId,
    escapeHtml: (value: string) => value,
    appointmentFinanceCacheKey: (id: string) => state.businessId + ':' + id,
    resetAppointmentFinanceView: () => {}, cacheAppointmentFinanceSummary: () => {}, renderAgenda: () => {},
    renderAppointmentFinance: (finance: any) => { state.cashRegister.appointmentFinance = finance },
    syncCreateAppointmentPayment: () => { cashUi.createPaymentFeedback.textContent = '' },
    showCrmToast: (message: string) => toasts.push(message), isCashBusinessScopedRole: () => role !== 'STAFF',
    loadAgenda: async () => {}, els: { appShell: { dataset: { section: 'agenda' } } },
    calculateCreateAppointmentTotals: () => ({ price: { total: 100 }, final: 100, depositAmount: 0 }),
    getJson: async (url: string, options?: any) => {
      calls.push({ url, payload: options?.body && JSON.parse(options.body) })
      if (url.includes('payment-methods')) {
        if (methodFailure) throw new Error('No se pudieron cargar los medios de pago.')
        return customMethods || ['CASH', 'TRANSFER', 'CARD'].map((kind) => ({ id: state.businessId + '-' + kind, kind, name: kind, isDefault: true }))
      }
      if (url.includes('payment-context')) return { session: { id: 'session-1' } }
      if (url.includes('/finance')) return { accountId: 'account-1', balanceAmount: 100 }
      if (url.endsWith('/payments')) {
        if (paymentFailure) throw new Error('Revisá los datos ingresados')
        return {}
      }
      throw new Error('Unexpected request ' + url)
    }
  })
  vm.runInContext(functions, context)
  return { context, state, cashUi, calls, toasts, failMethods: (value: boolean) => { methodFailure = value }, failPayment: () => { paymentFailure = true }, methods: (value: any[]) => { customMethods = value } }
}

for (const role of ['STAFF', 'BUSINESS_ADMIN', 'SUPER_ADMIN']) {
  const h = harness(role)
  await h.context.loadAppointmentFinance()
  assert.equal(h.cashUi.paymentMethod.value, 'salon-1-CASH', role + ' must load methods from Agenda without viewing Caja')
  for (const kind of ['CASH', 'TRANSFER', 'CARD']) {
    h.cashUi.paymentMethod.value = 'salon-1-' + kind
    const line = h.context.configuredPaymentLine(h.cashUi.paymentMethod, 100)
    assert.equal(line.method, kind)
    assert.equal(line.paymentMethodId, 'salon-1-' + kind)
  }
  h.cashUi.paymentMethod.value = 'salon-1-CARD'
  await h.context.loadCashPaymentMethods({ force: true })
  assert.equal(h.cashUi.paymentMethod.value, 'salon-1-CARD', 'refresh preserves the user selection')
}

for (const kind of ['CASH', 'TRANSFER', 'CARD']) {
  const h = harness()
  const line = h.context.configuredPaymentLine(select(kind), 100)
  assert.equal(line.method, kind, 'legacy option must retain its kind')
  assert.equal(line.paymentMethodId, undefined, 'legacy enum must never be submitted as a configured ID')
}

{
  const h = harness()
  h.state.cashRegister.appointmentFinanceCache['salon-1:appointment-1'] = { balanceAmount: 100 }
  await h.context.loadAppointmentFinance({ force: false })
  assert.equal(h.cashUi.paymentMethod.value, 'salon-1-CASH', 'cached finance still loads methods')
  assert.ok(!h.calls.some((call) => call.url.includes('/finance')), 'reuse finance cache')
}

{
  const h = harness()
  h.cashUi.paymentMethod.value = 'TRANSFER'
  await h.context.loadAppointmentFinance()
  assert.equal(h.cashUi.paymentMethod.value, 'salon-1-TRANSFER', 'loading maps an already chosen legacy kind to its configured default')
}

{
  const h = harness()
  await Promise.all([h.context.loadCreateAppointmentCashState(), h.context.loadAppointmentFinance()])
  assert.equal(h.calls.filter((call) => call.url.includes('payment-methods')).length, 1, 'deduplicate concurrent loads')
  assert.equal(h.context.readCreateAppointmentPayment().lines[0].paymentMethodId, 'salon-1-CASH')
  h.cashUi.paymentMethod.value = 'salon-1-TRANSFER'
  h.cashUi.paymentAmount.value = '60'
  h.cashUi.paymentLineTwo.hidden = false
  h.cashUi.paymentMethodTwo.value = 'salon-1-CARD'
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.deepEqual(h.calls.find((call) => call.payload?.lines)?.payload.lines, [
    { amount: 60, method: 'TRANSFER', paymentMethodId: 'salon-1-TRANSFER' },
    { amount: 40, method: 'CARD', paymentMethodId: 'salon-1-CARD' }
  ])
}

{
  const h = harness()
  h.failMethods(true)
  await h.context.loadAppointmentFinance()
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.ok(!h.calls.some((call) => call.payload), 'failed method loading cannot submit a payment')
  assert.ok(h.toasts.includes('No se pudieron cargar los medios de pago.'), 'loading failure is visible')
  assert.throws(() => h.context.readCreateAppointmentPayment(), /medios de pago/, 'create payment must wait for configured methods')
  h.failMethods(false)
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.equal(h.calls.find((call) => call.payload)?.payload.lines[0].paymentMethodId, 'salon-1-CASH', 'retry recovers')
}

{
  const h = harness()
  h.methods([])
  await h.context.loadCreateAppointmentCashState()
  assert.equal(h.cashUi.createPaymentFeedback.textContent, 'No hay medios de pago activos para este local.')
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.ok(!h.calls.some((call) => call.payload), 'an empty configured list must not submit static options')
}

{
  const h = harness()
  await h.context.loadCreateAppointmentCashState()
  h.state.businessId = 'salon-2'
  assert.throws(() => h.context.configuredPaymentLine(h.cashUi.createPaymentMethod, 100), /medio de pago vigente/, 'a stale configured option must not become a legacy line')
  await h.context.loadCreateAppointmentCashState()
  assert.equal(h.cashUi.createDepositMethod.value, 'salon-2-TRANSFER', 'business switch cannot reuse old configured IDs')
  h.failPayment()
  await h.context.submitAppointmentDeposit({ preventDefault() {} })
  assert.ok(h.toasts.includes('Revisá los datos ingresados'))
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.ok(h.toasts.filter((message) => message === 'Revisá los datos ingresados').length >= 2)
}

for (const action of ['submitAppointmentPayment', 'submitAppointmentDeposit']) {
  for (const change of ['business', 'appointment']) {
    const h = harness()
    let release!: (methods: any[]) => void
    const pendingMethods = new Promise((resolve) => { release = resolve })
    const originalGet = h.context.getJson
    h.context.getJson = (url: string, options?: any) => url.includes('payment-methods') && url.includes('salon-1') ? pendingMethods : originalGet(url, options)
    const pending = h.context[action]({ preventDefault() {} })
    if (change === 'business') {
      h.state.businessId = 'salon-2'
      await h.context.loadCreateAppointmentCashState()
    } else h.state.editingAppointmentId = 'appointment-2'
    release([{ id: 'salon-1-CASH', kind: 'CASH', name: 'Efectivo' }])
    await pending
    assert.ok(!h.calls.some((call) => call.payload), action + ' cannot submit after changing ' + change)
    if (change === 'business') assert.equal(h.cashUi.paymentMethod.value, 'salon-2-CASH', 'late response cannot overwrite the selected business')
  }
}

assert.match(cashRegisterScript, /createPayment\.addEventListener\('toggle',[\s\S]{0,250}loadCreateAppointmentCashState\(\)/, 'reopening create payments retries method loading')

for (const action of ['loadAppointmentFinance', 'submitAppointmentPayment', 'submitAppointmentDeposit']) {
  for (const change of ['business', 'appointment']) {
    const h = harness()
    let reject!: (error: Error) => void
    const pendingMethods = new Promise((_, fail) => { reject = fail })
    h.context.getJson = () => pendingMethods
    const pending = h.context[action]({ preventDefault() {} })
    if (change === 'business') h.state.businessId = 'salon-2'
    else h.state.editingAppointmentId = 'appointment-2'
    h.cashUi.financeFeedback.textContent = 'Current appointment feedback'
    reject(new Error('Previous appointment failed'))
    await pending
    assert.equal(h.cashUi.financeFeedback.textContent, 'Current appointment feedback', action + ' must not overwrite feedback after changing ' + change)
    assert.equal(h.toasts.length, 0, 'do not display an unrelated stale error')
  }
}

const feedbackAt = appointmentFinanceMarkup.indexOf('id="appointment-finance-feedback"')
assert.ok(feedbackAt > appointmentFinanceMarkup.indexOf('id="appointment-payment-submit"'))
assert.ok(feedbackAt < appointmentFinanceMarkup.indexOf('id="appointment-finance-history"'), 'feedback is beside payment actions, before the history')
console.log('Agenda payment method loading: roles, cache, create/edit, mixed payment, retry and visible errors OK')
