import assert from 'node:assert/strict'
import vm from 'node:vm'
import { cashRegisterMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

const source = (from: string, to: string) => {
  const start = cashRegisterScript.indexOf(from)
  const end = cashRegisterScript.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `No se encontró ${from.trim()} en el CRM`)
  return cashRegisterScript.slice(start, end)
}
const loader = source('\n    function renderCashEntries()', '\n    function cashIsoDate(').replace(
  /function renderCashEntries\(\) \{[\s\S]*?\n    }/,
  'function renderCashEntries() { visibleRows = Array.from(state.cashRegister.entries, ({ id }) => id) }'
)
const workspace = source('\n    function createCashRegisterWorkspace()', '\n    }') + '\n    }'
const ui = {
  typeFilter: { value: '' }, methodFilter: { value: '' }, categoryFilter: { value: '' },
  subcategoryFilter: { value: '' }, sessionFilter: { value: '' }, search: { value: '' },
  entryList: { innerHTML: '', setAttribute() {}, removeAttribute() {} },
  entryPagination: { hidden: false }, entryPageInfo: { textContent: '' },
  previousPage: { disabled: true }, nextPage: { disabled: true }
}
const requests: Array<{ url: URL; resolve: (body: unknown) => void; reject: (error: Error) => void }> = []
const errors: string[] = []
const context: vm.Context = vm.createContext({
  state: { businessId: 'local-a', cashRegister: {} }, cashUi: ui, visibleRows: [] as string[],
  URLSearchParams, encodeURIComponent, escapeHtml: (value: string) => value, isCashBusinessScopedRole: () => true,
  cashRegisterScopeKey: () => context.state.businessId,
  cashRegisterScopeIsCurrent: (register: unknown, scope: string) => register === context.state.cashRegister && scope === context.state.businessId,
  cashScoped: (value: string) => value, renderCashSummary: () => {},
  getJson: (path: string) => new Promise((resolve, reject) => requests.push({ url: new URL(path, 'http://offline.test'), resolve, reject })),
  showCrmToast: (message: string) => errors.push(message)
})
vm.runInContext(workspace + loader, context)
context.state.cashRegister = context.createCashRegisterWorkspace()
context.state.cashRegister.selectedDayId = 'day-a'
const load = (options = {}) => context.loadCashEntries(options)
const lastRequest = () => requests.at(-1)!
const page = (ids: string[], nextCursor: string | null = null) => ({ entries: ids.map((id) => ({ id })), nextCursor })
const resolvePage = (ids: string[], nextCursor: string | null = null) => lastRequest().resolve(page(ids, nextCursor))
const cursor = () => lastRequest().url.searchParams.get('cursor')
const firstIds = Array.from({ length: 25 }, (_, i) => `first-${i}`)

const first = load()
assert.equal(lastRequest().url.searchParams.get('limit'), '25')
assert.equal(lastRequest().url.searchParams.get('businessId'), 'local-a')
assert.equal(cursor(), null)
resolvePage(firstIds, 'to-next')
await first
assert.deepEqual(Array.from(context.visibleRows), firstIds)
assert.equal(ui.previousPage.disabled, true)
assert.equal(ui.nextPage.disabled, false)

const second = load({ direction: 'next' })
assert.equal(cursor(), 'to-next')
assert.ok(ui.previousPage.disabled && ui.nextPage.disabled, 'se bloquean ambos controles mientras se carga la página')
void load({ direction: 'next' })
void load({ preserve: true })
assert.equal(requests.length, 2, 'el doble clic y el refresco simultáneo conservan una sola consulta')
resolvePage(['second-0', 'second-1'])
await second
assert.deepEqual(Array.from(context.visibleRows), ['second-0', 'second-1'], 'la página reemplaza el listado')
assert.match(ui.entryPageInfo.textContent, /P[áa]gina 2.*26[–-]27/)
assert.equal(ui.previousPage.disabled, false)
assert.equal(ui.nextPage.disabled, true)

const refreshed = load({ preserve: true })
assert.equal(cursor(), 'to-next', 'una actualización de la jornada conserva la página')
assert.deepEqual(Array.from(context.visibleRows), ['second-0', 'second-1'])
resolvePage(['second-fresh'])
await refreshed
assert.deepEqual(Array.from(context.visibleRows), ['second-fresh'])

const failedPrevious = load({ direction: 'previous' })
assert.equal(cursor(), null)
lastRequest().reject(new Error('Sin conexión'))
assert.equal(await failedPrevious, false)
assert.deepEqual(Array.from(context.visibleRows), ['second-fresh'])
assert.equal(ui.previousPage.disabled, false)
assert.deepEqual(errors, ['Sin conexión'])
const previous = load({ direction: 'previous' })
assert.equal(cursor(), null)
resolvePage(firstIds, 'to-updated-next')
await previous
assert.deepEqual(Array.from(context.visibleRows), firstIds)
assert.equal(ui.previousPage.disabled, true)

const superseded = load({ direction: 'next' })
assert.equal(cursor(), 'to-updated-next', 'volver y avanzar usa el cursor de la respuesta más reciente')
ui.search.value = ' barba '
resolvePage(['stale-filter'])
assert.equal(await superseded, false, 'una respuesta previa no aplica mientras espera el debounce de búsqueda')
const filtered = load()
assert.equal(cursor(), null)
assert.equal(lastRequest().url.searchParams.get('q'), 'barba')
resolvePage(['filtered'])
await filtered
assert.equal(ui.previousPage.disabled, true)
assert.deepEqual(Array.from(context.visibleRows), ['filtered'])

const staleDay = load({ preserve: true })
const pending = lastRequest()
const newDay = context.selectCashDay('day-b')
assert.equal(lastRequest().url.pathname, '/cash-register/days/day-b/summary')
assert.equal(ui.entryPagination.hidden, true, 'el paginador de la jornada anterior se oculta en cuanto cambia la selección')
lastRequest().resolve({ day: { id: 'day-b' }, summary: {}, sessions: [] })
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(cursor(), null)
assert.equal(lastRequest().url.pathname, '/cash-register/days/day-b/entries')
resolvePage(['new-day'])
await newDay
pending.resolve(page(['old-day']))
assert.equal(await staleDay, false)
assert.deepEqual(Array.from(context.visibleRows), ['new-day'])

const staleRevision = load({ preserve: true })
const oldRevision = lastRequest()
context.state.cashRegister.revision = 4
const newRevision = load({ preserve: true })
resolvePage(['latest'])
await newRevision
oldRevision.resolve(page(['stale-revision']))
assert.equal(await staleRevision, false)
assert.deepEqual(Array.from(context.visibleRows), ['latest'])

const staleBusiness = load({ preserve: true })
context.state.businessId = 'local-b'
context.state.cashRegister = context.createCashRegisterWorkspace()
context.state.cashRegister.selectedDayId = 'day-b'
resolvePage(['old-business'])
assert.equal(await staleBusiness, false)
assert.match(cashRegisterMarkup, /id="cash-entry-page-info"[^>]*aria-live="polite"/)
assert.match(cashRegisterMarkup, /id="cash-previous-page"[^>]*>Anterior<\/button>/)
assert.match(cashRegisterMarkup, /id="cash-next-page"[^>]*>Siguiente<\/button>/)
console.log('Caja actual: cursor, navegación, reintento y aislamiento de la página OK')
