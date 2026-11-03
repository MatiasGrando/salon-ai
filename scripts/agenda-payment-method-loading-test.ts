import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { appointmentFinanceMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

const ast = ts.createSourceFile('cash-ui.js', cashRegisterScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const names = ['configuredPaymentLine', 'selectDefaultPaymentMethod', 'renderConfiguredPaymentMethods', 'loadCashPaymentMethods', 'loadCreateAppointmentCashState', 'loadAppointmentFinance', 'showAppointmentFinanceError', 'submitAppointmentPayment', 'submitAppointmentDeposit', 'readCreateAppointmentPayment', 'prepareAppointmentFinance']
const functions = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && (names.includes(node.name?.text || '') || ['appointmentPaymentOperationKey', 'syncAppointmentPaymentLoading'].includes(node.name?.text || ''))).map((node) => node.getText(ast)).join('\n')
const shell = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const buttonHelperStart = shell.indexOf('    function setButtonLoading(')
const buttonHelper = shell.slice(buttonHelperStart, shell.indexOf('    async function withButtonLoading(', buttonHelperStart))
assert.ok(buttonHelperStart >= 0)

function button() {
  let content = 'Registrar pago'
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  return {
    dataset: {} as Record<string, string>, disabled: false,
    get innerHTML() { return content }, set innerHTML(value: string) { content = value },
    get textContent() { return content }, set textContent(value: string) { content = value },
    classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value), contains: (value: string) => classes.has(value) },
    setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name), getAttribute: (name: string) => attributes.get(name)
  }
}

function deferred() {
  let resolve!: (value?: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise((pass, fail) => { resolve = pass; reject = fail })
  return { promise, resolve, reject }
}

async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve() }

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
    paymentMethods: [], appointmentFinanceRequestId: 0, appointmentFinanceCache: {}, appointmentFinanceInFlight: {}, appointmentFinanceSummaryCache: {},
    appointmentFinance: { balanceAmount: 100 }, current: { session: { id: 'session-1' } }, editFinance: {}, createFinance: { collectTotal: true }
  } }
  const cashUi: any = Object.fromEntries(['operationMethod', 'productSaleMethod', 'professionalPaymentMethod', 'createDepositMethod', 'createPaymentMethod', 'createPaymentMethodTwo', 'editDepositMethod', 'paymentMethod', 'paymentMethodTwo'].map((name) => [name, select(name.includes('Two') || name.includes('Deposit') ? 'TRANSFER' : 'CASH')]))
  Object.assign(cashUi, {
    paymentSubmit: button(), finance: { hidden: false, open: true },
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
    prepareCreateAppointmentPayment: () => {}, prepareAppointmentProducts: () => {}, hydrateIcons: () => {},
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
  vm.runInContext(buttonHelper + functions, context)
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

{
  const h = harness()
  await h.context.loadCashPaymentMethods()
  h.cashUi.paymentCompleteRow.hidden = false
  h.cashUi.paymentComplete.checked = true
  const payment = deferred(), finance = deferred(), agenda = deferred()
  let posts = 0, financeRefreshes = 0, agendaRefreshes = 0
  h.context.getJson = async () => { posts++; return payment.promise }
  h.context.loadAppointmentFinance = async () => { financeRefreshes++; return finance.promise }
  h.context.loadAgenda = async () => { agendaRefreshes++; return agenda.promise }
  const saving = h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.equal(h.cashUi.paymentSubmit.disabled, true, 'payment disables immediately before the first await')
  assert.equal(h.cashUi.paymentSubmit.classList.contains('is-loading'), true, 'existing spinner starts immediately')
  assert.equal(h.cashUi.paymentSubmit.getAttribute('aria-busy'), 'true')
  assert.match(h.cashUi.financeFeedback.textContent, /Registrando pago.*realizado/)
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  await flush()
  assert.equal(posts, 1, 'double click cannot submit another payment')
  payment.resolve()
  await flush()
  assert.equal(financeRefreshes, 1)
  assert.equal(h.cashUi.paymentSubmit.disabled, true, 'hold busy state during finance refresh')
  finance.resolve()
  await flush()
  assert.equal(agendaRefreshes, 1)
  assert.equal(h.cashUi.paymentSubmit.classList.contains('is-loading'), true, 'hold spinner through Agenda refresh')
  agenda.resolve()
  await saving
  assert.equal(h.cashUi.paymentSubmit.disabled, false)
  assert.equal(h.cashUi.paymentSubmit.textContent, 'Registrar pago')
  assert.equal(h.cashUi.paymentSubmit.getAttribute('aria-busy'), undefined)
  assert.ok(h.toasts.includes('Pago registrado y turno marcado como realizado.'))
}

for (const failure of ['methods', 'payment', 'validation']) {
  const h = harness()
  if (failure === 'methods') h.failMethods(true)
  if (failure === 'payment') h.failPayment()
  if (failure === 'validation') h.cashUi.paymentAmount.value = '0'
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.equal(h.cashUi.paymentSubmit.disabled, false, failure + ' restores the action')
  assert.equal(h.cashUi.paymentSubmit.classList.contains('is-loading'), false)
  assert.equal(h.cashUi.paymentSubmit.textContent, 'Registrar pago')
  assert.equal(h.cashUi.financeFeedback.className, 'appointment-finance-feedback error')
}

for (const outcome of ['resolve', 'reject'] as const) {
  const h = harness()
  await h.context.loadCashPaymentMethods()
  const oldPayment = deferred(), newPayment = deferred()
  let posts = 0
  h.context.getJson = async () => { posts++; return posts === 1 ? oldPayment.promise : newPayment.promise }
  h.context.loadAppointmentFinance = async () => {}
  const previous = h.context.submitAppointmentPayment({ preventDefault() {} })
  await flush()
  h.context.prepareAppointmentFinance({ id: 'appointment-1' })
  assert.equal(h.cashUi.paymentSubmit.disabled, true, 'reopening a pending appointment retains its operation')
  assert.match(h.cashUi.financeFeedback.textContent, /Registrando pago/, 'reopening preserves visible pending feedback')
  await h.context.submitAppointmentPayment({ preventDefault() {} })
  assert.equal(posts, 1, 'reopening must not allow a duplicate')
  h.state.editingAppointmentId = 'appointment-2'
  h.context.prepareAppointmentFinance({ id: 'appointment-2' })
  assert.equal(h.cashUi.paymentSubmit.disabled, false, 'a different appointment has its own action')
  const current = h.context.submitAppointmentPayment({ preventDefault() {} })
  await flush()
  const currentFeedback = h.cashUi.financeFeedback.textContent
  if (outcome === 'resolve') oldPayment.resolve()
  else oldPayment.reject(new Error('Old payment failed'))
  await previous
  assert.equal(posts, 2)
  assert.equal(h.cashUi.paymentSubmit.disabled, true, 'old cleanup cannot enable the new payment action')
  assert.equal(h.cashUi.financeFeedback.textContent, currentFeedback)
  assert.equal(h.toasts.length, 0, 'old completion does not notify the new appointment')
  newPayment.resolve()
  await current
  assert.equal(h.cashUi.paymentSubmit.disabled, false)
}

for (const phase of ['finance', 'agenda']) {
  for (const outcome of ['resolve', 'reject'] as const) {
    const h = harness()
    await h.context.loadCashPaymentMethods()
    h.cashUi.paymentCompleteRow.hidden = false
    h.cashUi.paymentComplete.checked = true
    const refresh = deferred()
    let refreshing = false
    h.context.loadAppointmentFinance = async () => {
      if (phase === 'finance') { refreshing = true; return refresh.promise }
    }
    h.context.loadAgenda = async () => { refreshing = true; return refresh.promise }
    const saving = h.context.submitAppointmentPayment({ preventDefault() {} })
    await flush()
    assert.equal(refreshing, true, phase + ' refresh reached')
    h.state.editingAppointmentId = 'appointment-2'
    h.context.prepareAppointmentFinance({ id: 'appointment-2' })
    h.cashUi.financeFeedback.textContent = 'Current appointment feedback'
    if (outcome === 'resolve') refresh.resolve()
    else refresh.reject(new Error('Previous refresh failed'))
    await saving
    assert.equal(h.cashUi.financeFeedback.textContent, 'Current appointment feedback')
    assert.equal(h.toasts.length, 0, 'late ' + phase + ' refresh cannot notify another appointment')
    assert.equal(h.cashUi.paymentSubmit.disabled, false)
  }
}

console.log('Agenda payment UI: configured methods, roles, loading, duplicate prevention, refresh and context isolation OK')
