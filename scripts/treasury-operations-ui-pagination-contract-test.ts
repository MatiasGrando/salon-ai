import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { treasuryPage } from '../src/routes/treasury.js'
import { cashRegisterMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

assert.deepEqual(treasuryPage(undefined), { page: 1, pageSize: 20, offset: 0 })
assert.deepEqual(treasuryPage('3'), { page: 3, pageSize: 20, offset: 40 })
for (const value of ['0', '-1', '1.5', 'abc', '10001']) assert.equal(treasuryPage(value), null)
const route = readFileSync(new URL('../src/routes/treasury.ts', import.meta.url), 'utf8')
assert.ok(route.includes('LIMIT ${pageSize} OFFSET ${offset}'))
assert.ok(route.includes('SELECT COUNT(*)::bigint AS "total"'))
assert.ok(route.includes('totalPages: Math.max(1, Math.ceil(total / pageSize))'))

const ast = ts.createSourceFile('cash.js', cashRegisterScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declarations = new Map<string, string>()
let drawerBinding = ''
function visit(part: ts.Node) {
  if (ts.isFunctionDeclaration(part) && part.name) declarations.set(part.name.text, part.getText(ast))
  if (ts.isVariableDeclaration(part) && part.name.getText(ast) === 'treasuryMovementDrawer') drawerBinding = 'const ' + part.getText(ast)
  ts.forEachChild(part, visit)
}
visit(ast)
const actual = (...names: string[]) => names.map(name => declarations.get(name) || '').join('\n')
const nodes = new Map<string, any>()
const node = (id: string) => {
  if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, dataset: {}, textContent: '', className: '', innerHTML: '', writes: 0,
    setAttribute() {}, focus() {}, querySelectorAll: () => [], insertAdjacentHTML(_position: string, html: string) { this.innerHTML += html },
    reset() { for (const [key, field] of nodes) if (key.startsWith('cash-treasury-outflow-')) field.value = key.endsWith('-kind') ? 'EXPENSE' : '' },
    getClientRects: () => [1] })
  return nodes.get(id)
}
const state: any = { businessId: 'b1', currentUser: { id: 'u1', role: 'BUSINESS_ADMIN' }, cashRegister: {} }
const requests: any[] = [], notices: string[] = []
let respond: (value: any) => void = () => {}, reject: (error: Error) => void = () => {}
let hold = false, nextError = false, opened = false, closed = 0, refreshed = 0, config: any
const entries = Array.from({ length: 47 }, (_, i) => ({ id: 'm' + i, kind: i === 0 ? 'DAILY_TRANSFER' : 'EXPENSE', direction: 'OUTFLOW', amount: 1000 + i, description: 'Detalle <' + i + '>', correctionRole: i === 1 ? 'REVERSAL' : undefined, dateCorrected: i === 2 }))
const response = (page: number) => ({ accounts: [{ id: 'cash', kind: 'CASH', name: 'Efectivo', balance: 80000, isActive: true }], counterparties: [], movements: entries.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: 47, totalPages: 3 })
const context: any = vm.createContext({ state, URLSearchParams, Map, Set, document: { getElementById: node, querySelectorAll: () => [] },
  cashScoped: (url: string) => url + (url.includes('?') ? '&' : '?') + 'businessId=' + state.businessId,
  cashRegisterScopeKey: () => state.businessId + ':' + state.currentUser.id,
  cashRegisterScopeIsCurrent: (register: any, scope: string) => register === state.cashRegister && scope === state.businessId + ':' + state.currentUser.id,
  cashMoney: (value: number) => '$ ' + value, cashDate: () => '22/11/26', escapeHtml: (value: any) => String(value).replaceAll('<', '&lt;'),
  showCrmToast: (message: string) => notices.push(message), isCashBusinessScopedRole: () => true,
  window: { crypto: { randomUUID: () => 'stable-key' } }, crypto: { randomUUID: () => 'stable-key' },
  ensureFinancialDateDefaults() { if (!node('cash-treasury-outflow-date').value) node('cash-treasury-outflow-date').value = '2026-11-22' },
  renderTreasuryClassificationOptions() {}, setButtonLoading(button: any, busy: boolean) { button.disabled = busy },
  els: { confirmationDialog: { hidden: true } }, requestCrmConfirmation: async () => false,
  createCrmDrawer(options: any) { config = options; return { open() { opened = true }, isOpen: () => opened, async close(force: boolean) { if (!force && !(await options.beforeClose())) return false; opened = false; closed++; return true } } },
  treasuryMovementDrawer: { open() { opened = true }, isOpen: () => opened, async close() { opened = false; closed++; return true } },
  loadTreasuryConsolidated: async () => { refreshed++ },
  getJson(url: string, options?: any) {
    requests.push({ url, options })
    if (options || hold) return new Promise((resolve, fail) => { respond = resolve; reject = fail })
    if (nextError) { nextError = false; return Promise.reject(new Error('Sin conexión')) }
    return Promise.resolve(response(Number(new URL(url, 'http://local').searchParams.get('page') || 1)))
  }
})
vm.runInContext(actual('treasuryFilterUrl', 'treasuryMovementRows', 'renderTreasuryPagination', 'renderTreasuryMovements', 'renderTreasuryAccounts', 'loadTreasury', 'treasuryMovementDraft', 'openTreasuryMovement', 'submitTreasuryOutflow'), context)
if (drawerBinding) vm.runInContext(drawerBinding, context)
node('cash-treasury-counterparty-dialog').hidden = true
const rows = () => (node('cash-treasury-entries').innerHTML.match(/<tr>/g) || []).length
if (!process.argv.includes('--drawer-only')) {
  await context.loadTreasury()
  assert.equal(rows(), 5, 'Tesorería muestra cinco movimientos al abrir: ' + node('cash-treasury-feedback').textContent)
  const firstRows = node('cash-treasury-entries').innerHTML
  const accountsHtml = node('cash-treasury-account-grid').innerHTML
  node('cash-treasury-account-grid').innerHTML = 'cuentas sin reconstruir'
  let existingWrites = 0
  let currentHtml = firstRows
  Object.defineProperty(node('cash-treasury-entries'), 'innerHTML', { configurable: true, get: () => currentHtml, set: value => { existingWrites++; currentHtml = value } })
  await context.loadTreasury({ append: true })
  assert.equal(rows(), 15)
  assert.equal(requests.length, 1, '5→15 usa la caché de veinte')
  assert.ok(currentHtml.startsWith(firstRows), 'Ampliar conserva las filas existentes')
  assert.equal(existingWrites, 1, 'Se añade un fragmento por insertAdjacentHTML')
  const firstFifteen = currentHtml
  await context.loadTreasury({ append: true })
  assert.equal(rows(), 25)
  assert.equal(requests.length, 2, '15→25 pide solo el segundo lote')
  assert.equal(new URL(requests[1].url, 'http://local').searchParams.get('page'), '2')
  assert.ok(currentHtml.startsWith(firstFifteen))
  assert.equal(node('cash-treasury-account-grid').innerHTML, 'cuentas sin reconstruir')
  assert.match(currentHtml, /data-treasury-correct-date="m24"/)
  assert.doesNotMatch(currentHtml, /data-treasury-correct-date="m[012]"/)
  assert.equal(state.cashRegister.treasuryMovements.find((entry: any) => entry.id === 'm24').id, 'm24')
  await context.loadTreasury({ append: true })
  assert.equal(rows(), 35)
  nextError = true
  const beforeError = currentHtml
  await context.loadTreasury({ append: true })
  assert.equal(currentHtml, beforeError, 'El error conserva las filas')
  assert.equal(node('cash-treasury-next').disabled, false)
  hold = true
  const retry = context.loadTreasury({ append: true })
  const count = requests.length
  const duplicate = context.loadTreasury({ append: true })
  assert.equal(requests.length, count, 'El doble clic comparte la solicitud activa')
  respond(response(3)); await retry; await duplicate; hold = false
  assert.equal(rows(), 45)
  await context.loadTreasury({ append: true })
  assert.equal(rows(), 47)
  assert.equal(node('cash-treasury-next').hidden, true)
  await context.loadTreasury({ refresh: true })
  assert.equal(rows(), 47, 'El refresco de operaciones conserva la cantidad visible')
  node('cash-treasury-filter-kind').value = 'INCOME'
  await context.loadTreasury()
  assert.equal(rows(), 5, 'Cambiar filtros reinicia a cinco')
  assert.equal(new URL(requests.at(-1).url, 'http://local').searchParams.get('kind'), 'INCOME')
  node('cash-treasury-filter-search').value = 'uno'
  hold = true
  const stale = context.loadTreasury()
  const staleRespond = respond
  node('cash-treasury-filter-search').value = 'dos'
  const fresh = context.loadTreasury()
  respond({ ...response(1), total: 1, totalPages: 1, movements: [{ ...entries[4], description: 'Respuesta nueva' }] }); await fresh
  staleRespond(response(1)); await stale; hold = false
  assert.match(currentHtml, /Respuesta nueva/)
  assert.doesNotMatch(currentHtml, /Detalle/)
  hold = true
  const foreign = context.loadTreasury({ refresh: true })
  state.businessId = 'b2'; respond(response(1)); await foreign; hold = false
  assert.match(currentHtml, /Respuesta nueva/, 'Otra cuenta no modifica el listado')
  state.businessId = 'b1'
  node('cash-treasury-account-grid').innerHTML = accountsHtml
  console.log('OK Tesorería: 5→15→25, caché, append, errores, doble clic, filtros y contexto')
}

node('cash-treasury-outflow-account').value = 'cash'
node('cash-treasury-outflow-kind').value = 'EXPENSE'
node('cash-treasury-outflow-description').value = 'Productos'
node('cash-treasury-outflow-amount').value = '5000'
node('cash-treasury-outflow-category').value = 'products'
node('cash-treasury-outflow-subcategory').value = 'color'
node('cash-treasury-outflow-counterparty').value = 'supplier'
node('cash-treasury-outflow-date').value = '2026-11-21'
const form = node('cash-treasury-outflow-form')
form.querySelectorAll = () => [...nodes].filter(([id]) => id.startsWith('cash-treasury-outflow-') && id !== 'cash-treasury-outflow-form').map(([, field]) => field)
const submit = () => context.submitTreasuryOutflow({ preventDefault() {}, currentTarget: form })
const prior = requests.length
const saving = submit()
void submit()
assert.equal(requests.length, prior + 1, 'Doble submit no duplica el movimiento')
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { accountId: 'cash', kind: 'EXPENSE', description: 'Productos', amount: 5000, expenseCategoryId: 'products', expenseSubcategoryId: 'color', counterpartyId: 'supplier', effectiveDate: '2026-11-21', idempotencyKey: 'stable-key', businessId: 'b1' })
reject(new Error('Saldo insuficiente')); await saving
assert.equal(node('cash-treasury-outflow-amount').value, '5000')
assert.equal(form.dataset.key, 'stable-key')
assert.equal(closed, 0)
assert.match(node('cash-treasury-outflow-feedback').textContent, /Saldo insuficiente/)
assert.match(cashRegisterMarkup, /id="cash-treasury-movement-drawer"[^>]*hidden/)
assert.ok(drawerBinding, 'Reutiliza el Drawer existente')
form.dataset.initial = context.treasuryMovementDraft()
assert.equal(await config.beforeClose(), true)
node('cash-treasury-outflow-amount').value = '6000'
assert.equal(await config.beforeClose(), false, 'Cambios protegidos por confirmación integrada')
assert.equal(config.isTopmost(), true)
node('cash-treasury-counterparty-dialog').hidden = false
assert.equal(config.isTopmost(), false, 'El destinatario conserva foco y Escape')
node('cash-treasury-counterparty-dialog').hidden = true
context.loadTreasury = async () => { refreshed++ }
const success = submit(); respond({}); await success
assert.equal(closed, 1)
assert.equal(node('cash-treasury-outflow-amount').value, '')
assert.equal(form.dataset.key, undefined)
assert.equal(refreshed, 2)
assert.match(notices.at(-1)!, /registrado/)
node('cash-treasury-outflow-amount').value = '7000'
context.loadTreasury = async () => { throw new Error('No se pudo actualizar') }
const refreshFailure = submit(); respond({}); await refreshFailure
assert.equal(closed, 2)
assert.match(notices.at(-1)!, /registrado/)
assert.doesNotMatch(node('cash-treasury-outflow-feedback').textContent, /No se pudo actualizar/)
node('cash-treasury-outflow-amount').value = '8000'
const late = submit(); state.businessId = 'b2'; respond({}); await late
assert.equal(closed, 2, 'Una respuesta de otra cuenta no cierra el panel actual')
assert.equal(node('cash-treasury-outflow-amount').value, '8000')
state.businessId = 'b1'; state.currentUser.role = 'STAFF'
const callsBeforeStaff = requests.length
await submit()
assert.equal(requests.length, callsBeforeStaff)
console.log('OK Tesorería: Drawer, campos/payload, doble submit, guardia, errores, éxito y contexto')
