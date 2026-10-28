import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'

process.env.DOTENV_CONFIG_PATH = '__offline_agenda_preference_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_agenda_preference'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function renderAgendaFilters'))!
function source(name: string, optional = false) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(script)
  if (optional && !match) return ''
  assert.ok(match, 'generated handler exists: ' + name)
  const tail = script.slice(match.index + 4).search(/\n    (?:(?:async )?function |const |let |els\.)/)
  return script.slice(match.index, tail < 0 ? undefined : match.index + 4 + tail)
}
const preferenceSources = ['isOwnAgendaScope', 'agendaOwnProfessionalId', 'agendaVisibleProfessionals', 'agendaProfessionalPreferenceKey', 'validAgendaProfessionalFilter', 'restoreAgendaProfessionalFilter', 'rememberAgendaProfessionalFilter'].map(n => source(n, true)).join('\n')
function element() {
  const listeners: Record<string, Function> = {}
  return { value: '', innerHTML: '', dataset: {} as any, listeners, addEventListener(name: string, handler: Function) { listeners[name] = handler }, querySelectorAll: () => [], querySelector: () => null, classList: { toggle() {} } }
}
function nativeSelect() {
  const select = element()
  let options = [''], selected = '', markup = '<option value="">Todos los profesionales</option>'
  Object.defineProperties(select, {
    value: { get: () => selected, set: (value: string) => { selected = options.includes(value) ? value : '' } },
    innerHTML: { get: () => markup, set: (value: string) => {
      markup = value
      options = [...value.matchAll(/<option value="([^"]*)"/g)].map(match => match[1])
      selected = options[0] || ''
    } }
  })
  return select
}
function context(storage = new Map<string, string>()): any {
  const els: any = new Proxy({}, { get: (t: any, k: string) => t[k] ??= element() })
  const state: any = { currentUser: { id: 'user-a', role: 'STAFF', staffProfile: 'SECRETARY', agendaScope: 'ALL' }, businessId: 'business-a', business: { id: 'business-a' },
    professionals: [{ id: 'p1', name: 'One', businessId: 'business-a' }, { id: 'p2', name: 'Two', businessId: 'business-a' }], agendaProfessionalPreferenceScope: null, agendaProfessionalCatalogScope: null }
  const loads: any[] = []
  const c: any = { state, els, storage, loads, activeProfessionals: () => state.professionals.filter((p: any) => p.isActive !== false), bookableServices: () => [],
    escapeHtml: (v: string) => v, serviceCatalogLabel: (v: any) => v.name, renderAgendaProfessionalControls() {}, instagramMediaObserveAccount() {}, loadAgenda: async () => loads.push(els.agendaProfessional.value),
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } }
  runInNewContext(preferenceSources + source('renderAgendaFilters'), c)
  if (c.agendaProfessionalPreferenceKey) state.agendaProfessionalCatalogScope = c.agendaProfessionalPreferenceKey()
  c.render = () => runInNewContext('renderAgendaFilters()', c)
  c.choose = async (value: string) => {
    els.agendaProfessional.value = value
    const handler = script.match(/els\.agendaProfessional\.addEventListener\('change', async \(\) => \{([\s\S]*?)\n    \}\)/)![1]
    await runInNewContext('(async function(){' + handler + '})()', c)
  }
  return c
}
let passes = 0, failures = 0
async function check(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message.split('\n')[0]) }
}
await check('select, close and reopen keeps one professional for the same secretary', async () => {
  const first = context(); first.render(); await first.choose('p2')
  const reopened = context(first.storage); reopened.render()
  assert.equal(reopened.els.agendaProfessional.value, 'p2')
  assert.equal(reopened.storage.size, 1)
  assert.equal(JSON.parse([...reopened.storage.values()][0]), 'p2')
})
await check('initial native select with only Todos restores after the catalog options exist', async () => {
  const first = context(); first.els.agendaProfessional = nativeSelect(); first.render(); await first.choose('p2')
  const reopened = context(first.storage); reopened.els.agendaProfessional = nativeSelect(); reopened.render()
  assert.equal(reopened.els.agendaProfessional.value, 'p2')
})
await check('Todos is an explicit remembered preference, not a stale prior choice', async () => {
  const first = context(); first.render(); await first.choose('p1'); await first.choose('')
  const reopened = context(first.storage); reopened.els.agendaProfessional.value = 'p1'; reopened.render()
  assert.equal(reopened.els.agendaProfessional.value, '')
  assert.equal(JSON.parse([...first.storage.values()][0]), '')
})
await check('another actor, role, staff profile or business never inherits the saved or previous DOM filter', async () => {
  const first = context(); first.render(); await first.choose('p2')
  for (const kind of ['user', 'role', 'profile', 'business']) {
    const c = context(first.storage); c.render(); assert.equal(c.els.agendaProfessional.value, 'p2')
    if (kind === 'user') c.state.currentUser.id = 'user-b'
    if (kind === 'role') c.state.currentUser.role = 'BUSINESS_ADMIN'
    if (kind === 'profile') c.state.currentUser.staffProfile = 'PROFESSIONAL'
    if (kind === 'business') { c.state.businessId = 'business-b'; c.state.business.id = 'business-b'; c.state.professionals.forEach((p: any) => p.businessId = 'business-b') }
    c.state.agendaProfessionalCatalogScope = c.agendaProfessionalPreferenceKey()
    c.render(); assert.equal(c.els.agendaProfessional.value, '', kind)
  }
  const same = context(first.storage); same.render(); assert.equal(same.els.agendaProfessional.value, 'p2')
})
await check('saved inactive, missing or wrong-business professional safely falls back to Todos', async () => {
  for (const kind of ['inactive', 'missing', 'tenant']) {
    const first = context(); first.render(); await first.choose('p2')
    const c = context(first.storage)
    if (kind === 'inactive') c.state.professionals[1].isActive = false
    if (kind === 'missing') c.state.professionals.pop()
    if (kind === 'tenant') c.state.professionals[1].businessId = 'business-other'
    c.render(); assert.equal(c.els.agendaProfessional.value, '', kind)
  }
})
await check('STAFF OWN cannot restore or explicitly persist another professional after access changes', async () => {
  const first = context(); first.render(); await first.choose('p2')
  first.state.currentUser.agendaScope = 'OWN'; first.state.currentUser.professionalId = 'p1'
  first.render(); assert.equal(first.els.agendaProfessional.value, 'p1', 'own-scope Agenda selects only the linked professional')
  await first.choose('p2'); assert.equal(first.els.agendaProfessional.value, '')
  await first.choose('p1'); assert.equal(first.els.agendaProfessional.value, 'p1')
  const c = context(first.storage); c.state.currentUser.agendaScope = 'OWN'; c.state.currentUser.professionalId = 'p1'; c.render()
  assert.equal(c.els.agendaProfessional.value, 'p1')
})
await check('corrupt, non-string, blocked read or blocked write does not break the Agenda', async () => {
  for (const value of ['{broken', 'null', '[]', '42', '{"professionalId":"p1"}']) {
    const c = context(); c.storage.set(c.agendaProfessionalPreferenceKey(), value); c.render()
    assert.equal(c.els.agendaProfessional.value, '')
  }
  const denied = context(); denied.localStorage.getItem = () => { throw new Error('denied') }; denied.render(); assert.equal(denied.els.agendaProfessional.value, '')
  denied.localStorage.setItem = () => { throw new Error('quota') }; await denied.choose('p1'); assert.equal(denied.els.agendaProfessional.value, 'p1'); assert.equal(denied.loads.length, 1)
})
await check('missing authentication or business never reads or writes an unscoped/global preference', async () => {
  for (const kind of ['user', 'actorId', 'role', 'business', 'businessMismatch']) {
    const c = context(); let reads = 0, writes = 0
    c.localStorage.getItem = () => { reads++; return '"p2"' }; c.localStorage.setItem = () => { writes++ }
    if (kind === 'user') c.state.currentUser = null
    if (kind === 'actorId') c.state.currentUser.id = null
    if (kind === 'role') c.state.currentUser.role = null
    if (kind === 'business') c.state.businessId = null
    if (kind === 'businessMismatch') c.state.business.id = 'old-business'
    c.render(); await c.choose('p2')
    assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(c.els.agendaProfessional.value, '')
  }
})
await check('pending catalog does not consume or erase a saved preference; authorized completion restores it', async () => {
  const first = context(); first.render(); await first.choose('p2')
  const c = context(first.storage); c.state.agendaProfessionalCatalogScope = null; c.state.professionals = []; c.render()
  assert.equal(c.state.agendaProfessionalPreferenceScope, null)
  c.state.professionals = first.state.professionals; c.state.agendaProfessionalCatalogScope = c.agendaProfessionalPreferenceKey(); c.render()
  assert.equal(c.els.agendaProfessional.value, 'p2')
})
await check('a pending refresh after restoration does not permanently lose the remembered preference', async () => {
  const c = context(); c.render(); await c.choose('p2')
  c.state.agendaProfessionalCatalogScope = null; c.render()
  assert.equal(c.els.agendaProfessional.value, '')
  c.state.agendaProfessionalCatalogScope = c.agendaProfessionalPreferenceKey(); c.render()
  assert.equal(c.els.agendaProfessional.value, 'p2')
})
await check('catalog refresh validates runtime access but does not undo a temporary impact navigation', async () => {
  const c = context(); c.render(); await c.choose('p2')
  c.els.agendaProfessional.value = 'p1'; c.render()
  assert.equal(c.els.agendaProfessional.value, 'p1'); assert.equal(JSON.parse([...c.storage.values()][0]), 'p2')
  const reopened = context(c.storage); reopened.render(); assert.equal(reopened.els.agendaProfessional.value, 'p2')
  c.state.professionals[0].isActive = false; c.render(); assert.equal(c.els.agendaProfessional.value, '')
})
await check('actual tab, mobile select and column-header handlers persist explicit choices', async () => {
  const chunks = [
    script.match(/button\.addEventListener\('click', async \(\) => \{\s*els\.agendaProfessional\.value = button\.dataset\.agendaProTab[^]*?\n        \}\)/)![0],
    script.match(/els\.agendaGridWrap\.querySelector\('\[data-agenda-mobile-professional\]'\)\?\.addEventListener\('change', async \(event\) => \{[^]*?\n      \}\)/)![0],
    script.match(/button\.addEventListener\('click', async \(\) => \{\s*if \(state\.agendaDidDrag\) return\s*els\.agendaProfessional\.value = button\.dataset\.agendaProfessionalColumn[^]*?\n            \}\)/)![0]
  ]
  for (const [index, chunk] of chunks.entries()) {
    const c = context(); c.render(); c.button = element(); c.button.dataset = { agendaProTab: 'p2', agendaProfessionalColumn: 'p2' }
    const mobile = element(); c.els.agendaGridWrap.querySelector = () => mobile
    runInNewContext(chunk, c)
    if (index === 1) await mobile.listeners.change({ target: { value: 'p2' } })
    else await c.button.listeners.click()
    const reopened = context(c.storage); reopened.render(); assert.equal(reopened.els.agendaProfessional.value, 'p2', 'action ' + index)
  }
})
await check('stale asynchronous catalog response never marks an old actor/business as restored or overwrites current catalog', async () => {
  const c = context(); let resolve: Function = () => {}; let catalogRequested = false
  Object.assign(c, { isWorkshopBusiness: () => false, isSalesAccountAdministrator: () => false, loadStaffUsers: async () => {},
    getJson: async (url: string) => {
      if (url.startsWith('/professionals')) { catalogRequested = true; return new Promise(r => { resolve = r }) }
      if (url.includes('/availability-settings')) return { morningCutTime: '12:30', eveningCutTime: '16:30' }
      return []
    } })
  const pending = runInNewContext(source('loadBusinessScopedBasics') + '; loadBusinessScopedBasics()', c)
  while (!catalogRequested) await new Promise(r => setTimeout(r, 0))
  c.state.currentUser.id = 'user-new'; c.state.businessId = 'business-new'; c.state.business = { id: 'business-new' }
  c.state.professionals = [{ id: 'current', businessId: 'business-new', name: 'Current' }]
  c.state.agendaProfessionalCatalogScope = c.agendaProfessionalPreferenceKey()
  resolve([{ id: 'stale', businessId: 'business-a', name: 'Stale' }]); await pending
  assert.equal(c.state.professionals[0].id, 'current')
  assert.equal(c.state.agendaProfessionalCatalogScope, c.agendaProfessionalPreferenceKey())
})
await check('an older refresh in the same scope cannot revive professionals removed by a newer catalog', async () => {
  const c = context(); const pending: Function[] = []
  Object.assign(c, { isWorkshopBusiness: () => false, isSalesAccountAdministrator: () => false, loadStaffUsers: async () => {},
    getJson: async (url: string) => {
      if (url.startsWith('/professionals')) return new Promise(r => pending.push(r))
      return []
    } })
  const first = runInNewContext(source('loadBusinessScopedBasics') + '; loadBusinessScopedBasics()', c)
  while (pending.length < 1) await new Promise(r => setTimeout(r, 0))
  const second = runInNewContext(source('loadBusinessScopedBasics') + '; loadBusinessScopedBasics()', c)
  while (pending.length < 2) await new Promise(r => setTimeout(r, 0))
  pending[1]([{ id: 'p1', businessId: 'business-a', name: 'Current' }]); await second
  pending[0]([{ id: 'p2', businessId: 'business-a', name: 'Stale' }]); await first
  assert.equal(c.state.professionals[0].id, 'p1')
})
console.log(`Agenda professional filter persistence: ${passes} passed, ${failures} failed`)
if (failures) process.exitCode = 1
