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
  nextPage: { disabled: true, hidden: false, textContent: '' }
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
const firstIds = Array.from({ length: 5 }, (_, i) => `first-${i}`)

const first = load()
assert.equal(lastRequest().url.searchParams.get('limit'), '5')
assert.equal(lastRequest().url.searchParams.get('businessId'), 'local-a')
assert.equal(cursor(), null)
resolvePage(firstIds, 'to-next')
await first
assert.deepEqual(Array.from(context.visibleRows), firstIds)
assert.equal(ui.nextPage.disabled, false)
assert.match(ui.entryPageInfo.textContent, /Mostrando 5 movimientos/)

const second = load({ append: true })
assert.equal(cursor(), 'to-next')
assert.equal(lastRequest().url.searchParams.get('limit'), '10')
assert.ok(ui.nextPage.disabled, 'Ver más se bloquea mientras se consulta')
assert.deepEqual(Array.from(context.visibleRows), firstIds, 'las cinco filas siguen visibles durante la consulta')
void load({ append: true })
void load({ preserve: true })
assert.equal(requests.length, 2, 'el doble clic y el refresco simultáneo conservan una sola consulta')
const additionalIds = Array.from({ length: 10 }, (_, i) => `more-${i}`)
resolvePage(additionalIds, 'more-15')
await second
const expandedIds = [...firstIds, ...additionalIds]
assert.deepEqual(Array.from(context.visibleRows), expandedIds, 'Ver más agrega diez filas a las cinco anteriores')
assert.match(ui.entryPageInfo.textContent, /Mostrando 15 movimientos/)

const refreshed = load({ preserve: true })
assert.equal(cursor(), null)
assert.equal(lastRequest().url.searchParams.get('limit'), '15', 'el refresco recupera el total visible sin consultar toda la jornada')
assert.deepEqual(Array.from(context.visibleRows), expandedIds)
resolvePage(expandedIds.map(id => 'fresh-' + id), 'fresh-15')
await refreshed
const freshIds = expandedIds.map(id => 'fresh-' + id)
assert.deepEqual(Array.from(context.visibleRows), freshIds)

const failedMore = load({ append: true })
assert.equal(cursor(), 'fresh-15')
lastRequest().reject(new Error('Sin conexión'))
assert.equal(await failedMore, false)
assert.deepEqual(Array.from(context.visibleRows), freshIds)
assert.equal(ui.nextPage.disabled, false)
assert.deepEqual(errors, ['Sin conexión'])
const retriedMore = load({ append: true })
assert.equal(cursor(), 'fresh-15', 'reintentar conserva el cursor que falló')
resolvePage(['last-0', 'last-1'])
await retriedMore
assert.deepEqual(Array.from(context.visibleRows), [...freshIds, 'last-0', 'last-1'])
assert.equal(ui.nextPage.hidden, true, 'Ver más desaparece al agotar la lista')
const completedRequestCount = requests.length
await load({ append: true })
assert.equal(requests.length, completedRequestCount, 'agotar la lista impide otra consulta')

const superseded = load({ preserve: true })
ui.search.value = ' barba '
resolvePage(['stale-filter'])
assert.equal(await superseded, false, 'una respuesta previa no aplica mientras espera el debounce de búsqueda')
const filtered = load()
assert.equal(cursor(), null)
assert.equal(lastRequest().url.searchParams.get('q'), 'barba')
assert.equal(lastRequest().url.searchParams.get('limit'), '5')
resolvePage(['filtered'])
await filtered
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

ui.search.value = ''
const manyIds = Array.from({ length: 115 }, (_, i) => `large-${i}`)
const register = context.state.cashRegister
register.entries = manyIds.map(id => ({ id }))
register.entryPage = { filterUrl: context.cashEntriesFilterUrl('day-b'), nextCursor: 'old-115' }
const largeRefresh = load({ preserve: true })
assert.equal(lastRequest().url.searchParams.get('limit'), '100')
resolvePage(manyIds.slice(0, 100), 'after-100')
await new Promise<void>((resolve) => setImmediate(resolve))
assert.equal(cursor(), 'after-100')
assert.equal(lastRequest().url.searchParams.get('limit'), '15')
resolvePage(manyIds.slice(100), 'after-115')
await largeRefresh
assert.deepEqual(Array.from(context.visibleRows), manyIds, 'el refresco conserva las 115 filas visibles respetando el límite del servidor')
assert.equal(register.entryPage.nextCursor, 'after-115')

const staleBusiness = load({ preserve: true })
context.state.businessId = 'local-b'
context.state.cashRegister = context.createCashRegisterWorkspace()
context.state.cashRegister.selectedDayId = 'day-b'
resolvePage(['old-business'])
assert.equal(await staleBusiness, false)
ui.search.value = ''
const initialFailure = load()
lastRequest().reject(new Error('Carga inicial fallida'))
await initialFailure
assert.equal(ui.nextPage.textContent, 'Reintentar')
assert.equal(ui.nextPage.hidden, false)
const initialRetry = load({ append: true })
assert.equal(lastRequest().url.searchParams.get('limit'), '5')
resolvePage([])
await initialRetry
assert.equal(ui.nextPage.hidden, true)
assert.equal(ui.entryPageInfo.textContent, 'Sin movimientos')
assert.match(cashRegisterMarkup, /id="cash-entry-page-info"[^>]*aria-live="polite"/)
assert.doesNotMatch(cashRegisterMarkup, /id="cash-previous-page"/)
assert.match(cashRegisterMarkup, /id="cash-next-page"[^>]*>Ver m&aacute;s<\/button>/)
console.log('Caja actual: cinco movimientos iniciales, diez adicionales, refresco, reintento y aislamiento OK')
