import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
process.env.DOTENV_CONFIG_PATH = '__instagram_ui_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((script) => script.includes('function loadInstagramReels('))!
function fn(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(inline)
  assert.ok(match, 'expected shipped function ' + name)
  return inline.slice(match.index, inline.indexOf('\n    }', match.index) + 6)
}
function node() {
  return { innerHTML: '', textContent: '', className: '', value: '', hidden: false, disabled: false, dataset: {},
    listeners: {} as Record<string, Function>, addEventListener(name: string, listener: Function) { this.listeners[name] = listener },
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, querySelectorAll() { return [] } }
}
const nodes: Record<string, any> = {}
const els: any = new Proxy({}, { get(target: any, key) { return target[key] ??= node() } })
const state: any = { businessId: 'business-a', instagramReels: [], instagramReelsLoaded: false, marketingView: 'instagram-reels',
  instagramSettings: { connection: { instagramAccountId: 'account-a' } } }
const row = { id: 'media-a', accountId: 'account-a', providerMediaId: 'provider-a', caption: 'Corte observado', mediaProductType: 'REELS', publishedAt: '2026-01-01T12:00:00Z',
  permalink: 'https://www.instagram.com/reel/abc/', insightsStatus: 'partial', lastInsightAttemptAt: '2026-10-25T12:00:00Z',
  latestMetrics: { values: { reach: 0, views: null, likes: 10 }, observedAtByMetric: { reach: '2026-10-24T10:00:00Z', likes: '2026-10-25T11:00:00Z' } } }
let catalogue: any = { accountId: 'account-a', items: [row], total: 1, linkedPublicationIds: ['linked-other-page'], limit: 25, offset: 0 }
let localStatus = 503
const localRows = [{ id: 'linked-other-page', caption: 'Imported elsewhere', status: 'PUBLISHED', videoAvailable: false },
  { id: 'local-published', caption: 'Publicado pendiente', status: 'PUBLISHED', videoAvailable: false }, { id: 'local-draft', caption: 'Borrador local', status: 'DRAFT', videoAvailable: false }]
const requests: Array<{ url: string; method: string; body?: any }> = []
let fetchHandler: ((url: string, options: any) => Promise<Response>) | null = null
const context: any = { state, els, URL, URLSearchParams, Date, Intl,
  window: { location: { origin: 'https://fixture.invalid' } }, toDatetimeLocalValue: (value: string) => value.slice(0, 16), setButtonLoading: () => true,
  document: { hidden: false, visibilityState: 'visible', getElementById: (id: string) => nodes[id] ??= node(), querySelectorAll: () => [] },
  sessionStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
  buildGetJsonRequestOptions: (options: any) => options,
  fetch: async (url: string, options: any = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (fetchHandler) return fetchHandler(url, options)
    return new Response(JSON.stringify(url.includes('instagram-publications') ? localStatus === 200 ? localRows : { message: 'Almacenamiento no disponible' } : catalogue), { status: url.includes('instagram-publications') ? localStatus : 200 })
  }
}
const existing = ['escapeHtml', 'getJson', 'instagramReelStatusMeta', 'renderInstagramReels', 'loadInstagramReels', 'saveInstagramSettings', 'renderInstagramSettings', 'showInstagramSettingsFeedback', 'clearInstagramSettingsFeedback', 'refreshInstagramPublication']
const helpers = [...inline.matchAll(/    (?:async )?function ((?:instagramMedia|renderInstagramMedia|resetInstagramMedia|loadInstagramMedia|syncInstagramMedia|pauseInstagramMedia|applyInstagramMedia|openInstagramMedia|closeInstagramMedia|bindInstagramMedia)\w*)\(/g)].map((match) => match[1]!)
runInNewContext([...new Set([...existing, ...helpers])].map(fn).join('\n'), context)
const call = (expression: string) => runInNewContext(expression, context)
await call('loadInstagramReels()')
assert.ok(requests.some((request) => request.url.includes('/instagram-media')), 'opening Instagram Reels must read the independent cached catalogue even when local publication storage returns503')
assert.ok(requests.every((request) => request.method === 'GET'), 'opening the section never starts a provider synchronization')
console.log('OK: real shipped Instagram loader reads cached catalogue independently from unavailable publication storage')
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const defaultCatalogue = () => ({ accountId: 'account-a', items: [{ ...row }], total: 1, linkedPublicationIds: ['linked-other-page'], limit: 25, offset: 0 })
const continuation = '12345678-1234-4234-8234-123456789abc'
async function fresh() {
  fetchHandler = null; catalogue = defaultCatalogue(); state.businessId = 'business-a'; state.marketingView = 'instagram-reels'
  els.appShell.dataset.section = 'campaigns'
  call('resetInstagramMediaState()')
  await call('loadInstagramReels()')
  return state.instagramMedia
}
call('bindInstagramMediaControls()')
assert.ok(nodes['instagram-media-body'].innerHTML.includes('<strong>0</strong>'))
assert.ok(nodes['instagram-media-body'].innerHTML.includes('Sin datos'))
assert.ok(nodes['instagram-media-body'].innerHTML.includes(call('instagramMediaDate("2026-10-24T10:00:00Z")')))
assert.ok(nodes['instagram-media-body'].innerHTML.includes(call('instagramMediaDate("2026-10-25T11:00:00Z")')))
assert.ok(!requests.some((request) => request.url.includes('/history')), 'history is fetched only on demand')
localStatus = 200
await call('loadInstagramReels()')
assert.ok(!els.instagramReelsTableBody.innerHTML.includes('linked-other-page'), 'global dedup excludes publications imported on other pages')
assert.ok(els.instagramReelsTableBody.innerHTML.includes('Publicado pendiente'))
assert.ok(els.instagramReelsTableBody.innerHTML.includes('Borrador local'))
catalogue = { ...catalogue, items: [], total: 0, offset: 25 }
await call('loadInstagramMediaCatalogue()')
assert.ok(!els.instagramReelsTableBody.innerHTML.includes('linked-other-page'), 'empty or filtered catalogue pages cannot duplicate globally linked local rows')
assert.ok(els.instagramReelsTableBody.innerHTML.includes('Publicado pendiente'))
localStatus = 503
await call('loadInstagramReels()')
assert.ok(els.instagramReelsTableBody.innerHTML.includes('Publicado pendiente'), 'local errors retain prior local cache')

await fresh()
const cache = state.instagramMedia.data
fetchHandler = async () => response({ message: 'Offline' }, 503)
await call('loadInstagramMediaCatalogue()')
assert.equal(state.instagramMedia.data, cache)
assert.match(nodes['instagram-media-feedback'].textContent, /Conservamos/)
fetchHandler = async () => response({ items: {} })
await call('loadInstagramMediaCatalogue()')
assert.equal(state.instagramMedia.data, cache, 'malformed successful responses cannot replace valid cache')
fetchHandler = null
nodes['instagram-media-from'].value = '2026-10-01'
nodes['instagram-media-to'].value = '2026-10-25'
nodes['instagram-media-sort'].value = 'views'
await nodes['instagram-media-filters'].listeners.submit({ preventDefault() {} })
const dateQuery = new URL('https://fixture.invalid' + requests.at(-1)!.url).searchParams
assert.equal(dateQuery.get('from'), new Date('2026-10-01T00:00:00').toISOString())
assert.equal(dateQuery.get('to'), new Date('2026-10-25T23:59:59.999').toISOString())
assert.equal(dateQuery.get('sort'), 'views')
assert.ok(dateQuery.get('from')!.endsWith('Z') && dateQuery.get('to')!.endsWith('Z'))
const beforeInvalid = requests.length
nodes['instagram-media-from'].value = '2027-01-01'
await nodes['instagram-media-filters'].listeners.submit({ preventDefault() {} })
assert.equal(requests.length, beforeInvalid)
assert.match(nodes['instagram-media-feedback'].textContent, /Revisá/)

await fresh()
catalogue.items[0].caption = '<img src=x onerror=alert(1)> 👀'
for (const unsafe of ['javascript:alert(1)', 'http://instagram.com/reel/a', 'https://user:secret@instagram.com/reel/a', 'https://instagram.com.evil.test/reel/a']) {
  catalogue.items[0].permalink = unsafe
  await call('loadInstagramMediaCatalogue()')
  assert.ok(!nodes['instagram-media-body'].innerHTML.includes('<a '))
  assert.ok(!nodes['instagram-media-body'].innerHTML.includes('<img'))
}
catalogue.items[0].permalink = 'https://www.instagram.com/reel/a/'
await call('loadInstagramMediaCatalogue()')
assert.ok(nodes['instagram-media-body'].innerHTML.includes('rel="noopener noreferrer"'))
assert.ok(nodes['instagram-media-body'].innerHTML.includes('&#128064;'), 'non-ASCII generated HTML uses entities without breaking emoji')

await fresh()
let pages = [{ status: 'more', imported: 5, continuation }, { status: 'complete', imported: 2, continuation: null }]
fetchHandler = async (url) => response(url.endsWith('/sync') ? { accountId: 'account-a', ...pages.shift() } : catalogue)
let beforeSync = requests.length
await nodes['instagram-media-sync'].listeners.click()
let posts = requests.slice(beforeSync).filter((request) => request.method === 'POST')
assert.equal(posts.length, 2, 'one explicit action chains bounded pages')
assert.deepEqual(posts[0]?.body, {})
assert.deepEqual(posts[1]?.body, { continuation })
assert.equal(state.instagramMedia.processed, 7)
assert.equal(state.instagramMedia.syncing, false)

await fresh()
let resolvePage!: (result: Response) => void
let pageRequests = 0
fetchHandler = async (url) => {
  if (url.endsWith('/sync')) { pageRequests++; if (pageRequests === 1) return new Promise((resolve) => { resolvePage = resolve }); return response({ accountId: 'account-a', status: 'complete', imported: 2, continuation: null }) }
  return response(catalogue)
}
const running = nodes['instagram-media-sync'].listeners.click()
await nodes['instagram-media-sync'].listeners.click()
assert.equal(pageRequests, 1, 'double click cannot create parallel provider syncs')
nodes['instagram-media-pause'].listeners.click()
resolvePage(response({ accountId: 'account-a', status: 'more', imported: 5, continuation }))
await running
assert.equal(pageRequests, 1, 'pause finishes the current page without starting another')
assert.equal(state.instagramMedia.continuation, continuation)
await nodes['instagram-media-sync'].listeners.click()
assert.equal(pageRequests, 2)
assert.equal(state.instagramMedia.processed, 7)

await fresh()
let syncFailed = true
fetchHandler = async (url) => response(url.endsWith('/sync') ? { accountId: 'account-a', status: syncFailed ? 'failed' : 'complete', imported: syncFailed ? 0 : 1, continuation: syncFailed ? continuation : null } : catalogue)
await nodes['instagram-media-sync'].listeners.click()
assert.equal(state.instagramMedia.continuation, continuation)
assert.equal(state.instagramMedia.syncing, false)
assert.match(nodes['instagram-media-feedback'].textContent, /pausó/)
syncFailed = false
await nodes['instagram-media-sync'].listeners.click()
assert.equal(state.instagramMedia.continuation, null)

await fresh()
fetchHandler = async (url) => response(url.includes('/history') ? { accountId: 'account-a', mediaId: 'media-a', items: [{ observedAt: '2026-10-25T10:00:00Z', status: 'partial', values: { reach: 0, views: null } }], total: 8, offset: url.includes('offset=5') ? 5 : 0 } : catalogue)
await call('openInstagramMediaHistory("media-a")')
assert.equal(nodes['instagram-media-history'].hidden, false)
assert.ok(nodes['instagram-media-history-body'].innerHTML.includes('Sin datos'))
assert.ok(nodes['instagram-media-history-body'].innerHTML.includes('<td>0</td>'))
await call('openInstagramMediaHistory("media-a", 5)')
assert.ok(requests.at(-1)?.url.endsWith('history?limit=5&offset=5'))
nodes['instagram-media-history-close'].listeners.click()
assert.equal(nodes['instagram-media-history'].hidden, true)

// Every asynchronous surface must discard late results after a business/context change.
for (const surface of ['catalogue', 'history', 'sync'] as const) {
  await fresh()
  let resolveLate!: (value: Response) => void
  fetchHandler = async () => new Promise((resolve) => { resolveLate = resolve })
  const pending = surface === 'catalogue' ? call('loadInstagramMediaCatalogue()') : surface === 'history' ? call('openInstagramMediaHistory("media-a")') : nodes['instagram-media-sync'].listeners.click()
  state.businessId = 'business-b'
  call('resetInstagramMediaState()')
  const replacement = call('instagramMediaContext()')
  replacement.accountId = 'account-b'
  call('renderInstagramMediaCatalogue()')
  resolveLate(response(surface === 'sync' ? { accountId: 'account-a', status: 'more', imported: 5, continuation } : surface === 'history' ? { accountId: 'account-a', items: [], total: 0 } : catalogue))
  await pending
  assert.equal(state.instagramMedia, replacement)
  assert.equal(replacement.accountId, 'account-b')
  assert.equal(replacement.continuation, null)
  assert.equal(replacement.history, null)
}
await fresh()
state.instagramMedia.offset = 25; state.instagramMedia.continuation = continuation; state.instagramMedia.history = { id: 'media-a' }
catalogue = { ...defaultCatalogue(), accountId: 'account-b' }
await call('loadInstagramMediaCatalogue()')
assert.equal(state.instagramMedia.accountId, 'account-b')
assert.equal(state.instagramMedia.offset, 0)
assert.equal(state.instagramMedia.history, null)
assert.equal(state.instagramMedia.continuation, null)
const beforeReads = requests.filter((request) => request.method === 'POST').length
await call('loadInstagramReels({silent:true})')
assert.equal(requests.filter((request) => request.method === 'POST').length, beforeReads, 'poll/read refreshes never start a provider sync')
await fresh()
let resolveLeaving!: (result: Response) => void
let sectionPosts = 0
fetchHandler = async (url) => {
  if (!url.endsWith('/sync')) return response(catalogue)
  sectionPosts++
  return sectionPosts === 1 ? new Promise((resolve) => { resolveLeaving = resolve }) : response({ accountId: 'account-a', status: 'complete', imported: 1, continuation: null })
}
const leaving = nodes['instagram-media-sync'].listeners.click()
els.appShell.dataset.section = 'cash-register'
resolveLeaving(response({ accountId: 'account-a', status: 'more', imported: 5, continuation }))
await leaving
assert.equal(sectionPosts, 1, 'leaving the main Marketing section pauses new POST pages even if its Instagram tab remains selected')
assert.equal(state.instagramMedia.continuation, continuation)
// Opening the view while a same-business credential save is pending is not an account change.
await fresh()
state.instagramSettings = { connection: { instagramAccountId: 'account-a', username: 'old', hasAccessToken: true, hasAppSecret: true } }
els.instagramAccountId.value = 'account-a'; els.instagramUsername.value = 'fresh'; els.instagramTokenExpires.value = ''
els.instagramAccessToken.value = 'fresh-token'; els.instagramAppSecret.value = '0123456789abcdef0123456789abcdef'
let resolveSettings!: (value: Response) => void
fetchHandler = async () => new Promise((resolve) => { resolveSettings = resolve })
call('resetInstagramMediaState()')
const saving = call('saveInstagramSettings({preventDefault(){}})')
call('instagramMediaContext()')
resolveSettings(response({ connection: { instagramAccountId: 'account-a', username: 'fresh', hasAccessToken: true, hasAppSecret: true, connected: true }, enabled: false }))
await saving
assert.equal(state.instagramSettings.connection.username, 'fresh', 'first opening the catalogue must not discard a legitimate pending credential save')
assert.equal(state.instagramMedia, null, 'successful credential save invalidates all catalogue state even for the same account')
await fresh()
let resolvePublication!: (value: Response) => void
fetchHandler = async () => new Promise((resolve) => { resolvePublication = resolve })
const sseRefresh = call('refreshInstagramPublication("local-draft")')
state.businessId = 'business-b'
call('resetInstagramMediaState()')
state.instagramReels = [{ id: 'business-b-draft', caption: 'Nueva cuenta', status: 'DRAFT' }]
resolvePublication(response({ id: 'local-draft', caption: 'Respuesta vieja', status: 'PUBLISHED' }))
await sseRefresh
assert.equal(state.instagramReels[0].id, 'business-b-draft', 'late SSE GET cannot add previous-business publications')
await fresh()
fetchHandler = async () => new Promise((resolve) => { resolveSettings = resolve })
const staleSave = call('saveInstagramSettings({preventDefault(){}})')
state.businessId = 'business-b'
call('resetInstagramMediaState()')
state.instagramSettings = { connection: { instagramAccountId: 'account-b', username: 'new-business' } }
resolveSettings(response({ connection: { instagramAccountId: 'account-a', username: 'old-business' } }))
await staleSave
assert.equal(state.instagramSettings.connection.username, 'new-business')

// Exercise the four shipped business/demo transitions with unrelated CRM services stubbed.
const transitions = ['enterCommercialDemo', 'exitCommercialDemo', 'returnToAccountAdminBusiness', 'switchSupportBusiness']
for (const transition of transitions) {
  const transitionState: any = { businessId: 'old-business', currentUser: { role: 'ACCOUNT_ADMIN' },
    business: { id: 'old-business' }, currentSessionBusiness: { id: 'home-business', name: 'Home' },
    businesses: [{ id: 'new-business', name: 'New' }], instagramMedia: { continuation, history: {}, offset: 25 },
    instagramMediaGeneration: 7, instagramReels: localRows, instagramReelsLoaded: true,
    conversationCache: new Map(), conversationMarketingCache: new Map(), conversationViewCache: new Map(), knownInboundMessageIds: new Set() }
  const isolated: any = { state: transitionState, els, encodeURIComponent,
    isSalesAccountAdministrator: () => true, isWorkshopBusiness: () => true,
    getJson: async () => ({ id: 'demo-business', name: 'Demo' }) }
  for (const name of ['loadBusinessScopedBasics', 'hydrateWorkspaceNav', 'renderLandingSettings', 'renderAiControls',
    'renderProfessionals', 'renderServices', 'renderAuthUi', 'setSection', 'showCrmToast', 'setSettingsView',
    'renderBusinessSettings', 'renderWhatsappSettings', 'renderInstagramSettings', 'loadConversations',
    'stopCrmRealtimeEvents', 'stopCashRealtimeEvents']) isolated[name] = () => {}
  runInNewContext(['resetInstagramMediaState', ...transitions].map(fn).join('\n'), isolated)
  await runInNewContext(transition + '("new-business")', isolated)
  assert.equal(transitionState.instagramMedia, null, transition + ' clears history, filters and continuation')
  assert.equal(transitionState.instagramMediaGeneration, 8, transition + ' invalidates pending asynchronous work')
  assert.equal(transitionState.instagramReelsLoaded, false)
  assert.equal(transitionState.instagramReels.length, 0)
}
console.log('OK: real bindings, null/zero timestamps, global dedup/cache failures, local-day filters, safe HTML/links, chained sync/pause/retry, history and stale-context replies')
