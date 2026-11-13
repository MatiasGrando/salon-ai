import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function agendaRangeContains\(/, 'debe centralizar la validacion del rango precargado')
assert.match(source, /function navigateAgendaToDate\(/, 'debe centralizar toda navegacion de fecha')
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, dayOffset\)\)/,
  'el gesto diario profesional debe reutilizar el rango precargado'
)
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, -state\.agendaViewDays\)\)/,
  'la flecha anterior debe navegar segun la vista sin recargar si ya esta precargada'
)
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, state\.agendaViewDays\)\)/,
  'la flecha siguiente debe navegar segun la vista sin recargar si ya esta precargada'
)
assert.doesNotMatch(
  source,
  /state\.agendaSelectedDate = addDays\(state\.agendaSelectedDate, dayOffset\)[\s\S]{0,180}await loadAgenda\(\)/,
  'el gesto diario no debe forzar una consulta completa por cada paso'
)

process.env.DOTENV_CONFIG_PATH = '__offline_agenda_prefetch_navigation__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_agenda_prefetch_navigation'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const handlers = html.match(/\n    function showAgendaLoadError\([\s\S]+?(?=\n    function renderAgenda\()/)?.[0]
assert.ok(handlers, 'la agenda renderizada contiene los controladores de carga y navegación')

const day = (number: number) => new Date(Date.UTC(2026, 10, number))
const state = {
  businessId: 'test-business', currentUser: {},
  agendaMonthDate: day(12), agendaSelectedDate: day(12), agendaViewDays: 1,
  agendaDeletingAppointmentIds: new Set<string>(), agendaAppointments: [], agendaBlocks: [],
  agendaLoadController: null, agendaLoadRequest: 0
}
const els = { agendaProfessional: { value: '' }, agendaGridWrap: { innerHTML: '' }, appShell: { dataset: { section: 'agenda' } } }
const renders: number[] = []
const requests: { url: URL; signal: AbortSignal; resolve: (items: unknown[]) => void }[] = []
let now = day(12).getTime()
class TestDate extends Date {
  static override now() { return now }
}
const context = {
  state, els, URLSearchParams, AbortController, Date: TestDate,
  isOwnAgendaScope: () => false,
  agendaProfessionalPreferenceKey: () => 'test-scope',
  prepareAgendaWorkspace: async () => {},
  renderAgenda: () => { renders.push(state.agendaSelectedDate.getUTCDate()) },
  startOfDay: (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
  addDays: (date: Date, count: number) => new Date(date.getTime() + count * 86_400_000),
  getJson: (url: string, { signal }: { signal: AbortSignal }) => new Promise<unknown[]>((resolve) => {
    requests.push({ url: new URL(url, 'https://agenda.invalid'), signal, resolve })
  })
}
const agenda = runInNewContext(`
  let crmWorkspaceVersion = 0, agendaRequest = null, agendaDataScope = null,
    agendaDataProfessional = '', agendaDataStale = true, agendaMutationVersion = 0
  const agendaRangeCache = new Map()
  function invalidateAgendaRanges() {
    agendaMutationVersion += 1
    agendaDataStale = true
    agendaRangeCache.clear()
  }
  ${handlers}
  ;({ loadAgenda, navigateAgendaToDate })
`, context) as {
  loadAgenda: (options?: { initial?: boolean; preferCached?: boolean; buffer?: boolean }) => Promise<void>
  navigateAgendaToDate: (date: Date) => Promise<void>
}

function expectRange(index: number, from: number, to: number, professional: string | null) {
  const pair = requests.slice(index, index + 2)
  assert.deepEqual(pair.map(({ url }) => url.pathname), ['/appointments', '/schedule-blocks'])
  for (const { url } of pair) {
    assert.equal(url.searchParams.get('from'), day(from).toISOString())
    assert.equal(url.searchParams.get('to'), day(to).toISOString())
    assert.equal(url.searchParams.get('professionalId'), professional)
  }
  return pair
}

const initial = agenda.loadAgenda({ initial: true })
expectRange(0, 12, 13, null).forEach(({ resolve }) => resolve([]))
await initial
assert.equal(requests.length, 2, 'la primera carga solo pide el día visible')
assert.equal(renders.at(-1), 12)

const warming = agenda.loadAgenda({ buffer: true, preferCached: true })
const buffer = expectRange(2, 5, 20, null)
const nextDay = agenda.navigateAgendaToDate(day(13))
assert.equal(requests.length, 4, 'la navegación reutiliza una precarga que cubre el día en curso')
assert.ok(buffer.every(({ signal }) => !signal.aborted), 'la navegación conserva la consulta en curso')
buffer.forEach(({ resolve }) => resolve([]))
await Promise.all([warming, nextDay])
assert.equal(renders.at(-1), 13)

const previousDay = agenda.navigateAgendaToDate(day(12))
assert.equal(renders.at(-1), 12, 'un día cubierto se muestra de inmediato')
await previousDay
assert.equal(requests.length, 4, 'el día cubierto se reutiliza sin otra consulta')

now += 120_000
els.agendaProfessional.value = 'professional-a'
const cachedFilter = agenda.loadAgenda({ preferCached: true })
assert.equal(requests.length, 4, 'un filtro puede reutilizar la precarga de todos los profesionales')
await cachedFilter

const distantDay = agenda.navigateAgendaToDate(day(25))
const filterBuffer = expectRange(4, 18, 33, 'professional-a')
const afterDistantDay = agenda.navigateAgendaToDate(day(26))
assert.equal(requests.length, 6, 'una fecha sin caché pide una sola ventana y la reutiliza al avanzar')
filterBuffer.forEach(({ resolve }) => resolve([]))
await Promise.all([distantDay, afterDistantDay])
assert.equal(renders.at(-1), 26)

els.agendaProfessional.value = 'professional-b'
const otherProfessionalDay = agenda.loadAgenda({ preferCached: true })
expectRange(6, 19, 34, 'professional-b').forEach(({ resolve }) => resolve([]))
await otherProfessionalDay
assert.equal(renders.at(-1), 26)
els.agendaProfessional.value = 'professional-a'
const previousFilter = agenda.loadAgenda({ preferCached: true })
assert.equal(requests.length, 8, 'al volver al filtro anterior se reutiliza su propia ventana')
await previousFilter

const refresh = agenda.loadAgenda()
expectRange(8, 19, 34, 'professional-a').forEach(({ resolve }) => resolve([]))
await refresh
await agenda.navigateAgendaToDate(day(25))
assert.equal(requests.length, 10, 'una actualización explícita conserva los días vecinos para navegar sin otra consulta')

state.agendaViewDays = 7
const newWeek = agenda.navigateAgendaToDate(day(45))
expectRange(10, 38, 59, 'professional-a').forEach(({ resolve }) => resolve([]))
await newWeek
const previousWeek = agenda.navigateAgendaToDate(day(38))
assert.equal(renders.at(-1), day(38).getUTCDate(), 'la semana anterior ya está disponible al mostrarla')
const weekRefill = expectRange(12, 31, 52, 'professional-a')
weekRefill.forEach(({ resolve }) => resolve([]))
await previousWeek

console.log('OK agenda: navegación instantánea sobre rango precargado y renovación anticipada.')
