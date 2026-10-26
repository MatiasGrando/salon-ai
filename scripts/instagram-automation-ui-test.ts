import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
process.env.DOTENV_CONFIG_PATH = '__instagram_automation_ui_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((s) => s.includes('function loadInstagramReels('))!
function fn(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(inline)
  assert.ok(match)
  return inline.slice(match.index, inline.indexOf('\n    }', match.index) + 6)
}
function node() {
  return { innerHTML: '', textContent: '', value: '', checked: false, hidden: false, disabled: false, dataset: {} as any,
    className: '', isConnected: true, focus() { context.document.activeElement = this }, scrollIntoView() {},
    listeners: {} as Record<string, Function[]>, addEventListener(event: string, handler: Function) { (this.listeners[event] ??= []).push(handler) },
    setAttribute(name: string, value: string) { if (name === 'hidden') this.hidden = true }, removeAttribute(name: string) { if (name === 'hidden') this.hidden = false },
    querySelectorAll() { return [] } }
}
const nodes: Record<string, any> = {}
const els: any = new Proxy({ appShell: { dataset: { section: 'campaigns' } }, instagramReelsTableBody: node() } as Record<string, any>, { get(target,key: string) { return target[key] ??= node() } })
const state: any = { businessId: 'business-a', marketingView: 'instagram-reels', instagramReels: [
  { id: 'published-a', status: 'PUBLISHED', caption: 'CRM publicado', videoAvailable: false }, { id: 'draft-a', status: 'DRAFT', caption: 'Borrador', videoAvailable: true }
] }
const requests: any[] = []
let handler: (url: string, options: any) => Promise<Response> = async () => new Response('{}')
const context: any = { state, els, URL, URLSearchParams, Date, AbortController,
  document: { activeElement: null, hidden: false, body: { dataset: {} }, getElementById: (id: string) => nodes[id] ??= node(), querySelector: () => node(), querySelectorAll: () => [] },
  staffVisibleSections: () => ['campaigns', 'conversations'], isWorkshopBusiness: () => false,
  staffSettlementsLabel: () => 'Liquidaciones', stopAgendaNowLineTimer() {}, closeMobileDrawer() {}, isMobile: () => false,
  buildGetJsonRequestOptions: (options: any) => options,
  fetch: (url: string, options: any = {}) => { requests.push({ url, options }); return handler(url, options) } }
const names = ['escapeHtml', 'getJson', 'instagramReelStatusMeta', 'renderInstagramReels', 'normalizeInstagramReelKeyword', 'setSection', 'setMarketingView',
  ...[...inline.matchAll(/    (?:async )?function ((?:instagramMedia|renderInstagramMedia|resetInstagramMedia|loadInstagramMedia|syncInstagramMedia|pauseInstagramMedia|applyInstagramMedia|openInstagramMedia|bindInstagramMedia)\w*)\(/g)].map((m) => m[1]!)]
runInNewContext([...new Set(names)].map(fn).join('\n'), context)
const call = (code: string) => runInNewContext(code, context)
const media = call('instagramMediaContext()')
media.accountId = 'account-a'
media.data = { items: [{ id: 'media-a', caption: 'Importado', accountId: 'account-a' }], total: 1, offset: 0, linkedPublicationIds: [] }
call('renderInstagramMediaCatalogue()')
assert.ok(nodes['instagram-media-body'].innerHTML.includes('data-instagram-automation'), 'rendered imported Reels must expose the common keyword-automation configuration control')
console.log('OK: real catalogue rendering exposes configuration for imported Reels')

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const legacy = { id: 'automation-a', enabled: true, keywords: ['precio'], privateReplyEnabled: true,
  privateReplyText: 'Completá {{weex_form:oferta}}', publicReplyEnabled: false, publicReplyText: 'Texto apagado' }
const result = (target = 'media-a', type = 'media', config: any = legacy) => ({ accountId: 'account-a', mediaId: type === 'media' ? target : null,
  publicationId: type === 'publications' ? target : null, automation: config, recentActions: [
    { kind: 'PUBLIC_REPLY', status: 'SENT', attempts: 1, sentAt: '2026-10-26T10:00:00Z' },
    { kind: 'PRIVATE_REPLY', status: 'UNKNOWN', attempts: 0, sentAt: null, lastError: '<img src=x onerror=alert(1)>' }
  ] })
let currentResponse: any = result()
handler = async () => response(currentResponse)
call('bindInstagramMediaControls()')
call('renderInstagramReels()')
const publishedRow = els.instagramReelsTableBody.innerHTML.split('</tr>').find((row: string) => row.includes('data-instagram-publication-id="published-a"'))!
assert.ok(!publishedRow.includes('<td>Mensaje privado</td>'), 'published fallback must not falsely claim private delivery when public-only configuration is supported')
assert.ok(els.instagramReelsTableBody.innerHTML.split('</tr>').find((row: string) => row.includes('data-instagram-publication-id="draft-a"'))!.includes('<td>Mensaje privado</td>'), 'existing draft response semantics remain unchanged')
assert.ok(els.instagramReelsTableBody.innerHTML.includes('data-instagram-automation-id="published-a"'))
assert.ok(!els.instagramReelsTableBody.innerHTML.includes('data-instagram-automation-id="draft-a"'))
const origin = { ...node(), dataset: { instagramAutomation: 'media', instagramAutomationId: 'media-a' } }
const clickRow = async (button = origin, container = nodes['instagram-media-body']) => {
  for (const listener of container.listeners.click) await listener({ target: { closest: (selector: string) => selector === '[data-instagram-automation]' ? button : null } })
}
await clickRow()
const n = call('instagramMediaAutomationNodes()')
assert.equal(requests.length, 1)
assert.equal(requests[0].options.method, undefined, 'opening never starts sync, upload or provider POST')
assert.ok(requests[0].url.endsWith('/instagram-media/media-a/automation'))
assert.equal(n['private-text'].value, legacy.privateReplyText)
assert.equal(n['public-text'].value, legacy.publicReplyText)
assert.equal(n['private-enabled'].checked, true)
assert.equal(n['public-enabled'].checked, false)
assert.ok(n.results.innerHTML.includes('Comentario p&uacute;blico'))
assert.ok(n.results.innerHTML.includes('Mensaje privado'))
assert.ok(n.results.innerHTML.includes('Incierta'))
assert.ok(!n.results.innerHTML.includes('<img'))
assert.ok(!n.results.innerHTML.includes('Reenviar'))
const submit = () => n.form.listeners.submit[0]({ preventDefault() {} })
const pause = () => n.pause.listeners.click[0]({ preventDefault() {} })
n.keywords.value = 'PRECIO, precio, turno'; n['private-enabled'].checked = false; n['private-text'].value = ''
n['public-enabled'].checked = true; n['public-text'].value = 'Te respondemos acá'
handler = async (_, options) => response(result('media-a', 'media', { id: 'automation-a', ...JSON.parse(options.body) }))
await submit()
const saved = JSON.parse(requests.at(-1).options.body)
assert.deepEqual(Object.keys(saved).sort(), ['enabled', 'keywords', 'privateReplyEnabled', 'privateReplyText', 'publicReplyEnabled', 'publicReplyText'].sort())
assert.deepEqual(saved.keywords, ['precio', 'turno'])
assert.equal(saved.privateReplyText, ''); assert.equal(saved.publicReplyEnabled, true)
assert.match(n.feedback.textContent, /guardada/)
await pause()
assert.equal(JSON.parse(requests.at(-1).options.body).enabled, false)
assert.equal(n.state.textContent, 'Pausada')
n.enabled.checked = true; n['public-text'].value = '{{weex_form:private}}'
const beforeInvalid = requests.length
await submit()
assert.equal(requests.length, beforeInvalid)
assert.equal(context.document.activeElement, n['public-text'])
n['public-text'].value = 'Edición que debe conservarse'
handler = async () => response({ message: 'error remoto con secret-token' }, 503)
await submit()
assert.equal(n['public-text'].value, 'Edición que debe conservarse')
assert.match(n.feedback.textContent, /No se guardó/)
assert.ok(!n.feedback.textContent.includes('secret-token'))
let resolveSave!: (value: Response) => void
handler = async () => new Promise((resolve) => { resolveSave = resolve })
const pending = submit()
await submit()
assert.equal(requests.length, beforeInvalid + 2, 'double activation cannot enqueue parallel PATCHes')
n.close.listeners.click[0]()
assert.equal(context.document.activeElement, origin, 'close restores focus to the row control')
assert.equal(n.panel.hidden, true)
resolveSave(response(result()))
await pending
assert.equal(media.automation, null, 'closing discards a late save response')

for (const type of ['media', 'publications']) {
  const id = type === 'media' ? 'media-a' : 'published-a'
  const oldButton = { ...node(), dataset: { instagramAutomation: type, instagramAutomationId: id } }
  const replacement = { ...node(), dataset: { instagramAutomation: type, instagramAutomationId: id } }
  const wrongTarget = { ...node(), dataset: { instagramAutomation: type, instagramAutomationId: 'other' } }
  handler = async () => response(result(id, type))
  await clickRow(oldButton, type === 'media' ? nodes['instagram-media-body'] : els.instagramReelsTableBody)
  call(type === 'media' ? 'renderInstagramMediaCatalogue()' : 'renderInstagramReels()')
  oldButton.isConnected = false
  context.document.querySelectorAll = () => [wrongTarget, replacement]
  n.close.listeners.click[0]()
  assert.equal(context.document.activeElement, replacement, 'closing after a list refresh restores focus to the replacement control for the same target')
  await clickRow(oldButton, type === 'media' ? nodes['instagram-media-body'] : els.instagramReelsTableBody)
  context.document.querySelectorAll = () => [wrongTarget]
  n.close.listeners.click[0]()
  assert.equal(context.document.activeElement, nodes['instagram-media-refresh'], 'a target removed from the page returns focus to the existing catalogue refresh action')
}
context.document.querySelectorAll = () => []

for (const type of ['media', 'publications']) {
  currentResponse = result(type === 'media' ? 'media-a' : 'published-a', type)
  handler = async () => response(currentResponse)
  const button = { ...node(), dataset: { instagramAutomation: type, instagramAutomationId: type === 'media' ? 'media-a' : 'published-a' } }
  await clickRow(button, type === 'media' ? nodes['instagram-media-body'] : els.instagramReelsTableBody)
  assert.equal(n.panel.hidden, false)
  assert.ok(requests.at(-1).url.includes('/instagram-' + type + '/'))
}
currentResponse = result('media-a', 'media', null)
handler = async () => response(currentResponse)
await clickRow()
assert.equal(n.state.textContent, 'Sin configurar')
assert.equal(n.enabled.checked, false)
assert.equal(n['private-enabled'].checked, true)
assert.equal(n['public-enabled'].checked, false)
for (const mismatch of [{ accountId: 'other' }, { mediaId: 'wrong-target' }]) {
  handler = async () => response({ ...result(), ...mismatch })
  await clickRow()
  assert.equal(state.instagramMedia.automation.data, null, 'mismatched account/target response is not editable')
  assert.equal(n.save.disabled, true)
}
handler = async () => response(result())
await clickRow()
let resolveOld!: (value: Response) => void
handler = async () => new Promise((resolve) => { resolveOld = resolve })
const oldRead = call('instagramMediaAutomationLoad(state.instagramMedia,state.instagramMedia.automation)')
handler = async () => response(result('media-a', 'media', { ...legacy, publicReplyText: 'Nueva lectura' }))
await call('instagramMediaAutomationLoad(state.instagramMedia,state.instagramMedia.automation)')
resolveOld(response(result()))
await oldRead
assert.equal(n['public-text'].value, 'Nueva lectura', 'out-of-order reads cannot overwrite a later read')
for (const surface of ['GET', 'PATCH']) for (const changed of ['business', 'account', 'target']) {
  handler = async () => response(result())
  state.businessId = 'business-a'; call('resetInstagramMediaState()')
  const fresh = call('instagramMediaContext()'); fresh.accountId = 'account-a'; fresh.data = media.data
  await clickRow()
  let resolveLate!: (value: Response) => void
  handler = async () => new Promise((resolve) => { resolveLate = resolve })
  const late = surface === 'GET' ? call('instagramMediaAutomationLoad(state.instagramMedia,state.instagramMedia.automation)') : submit()
  const signal = requests.at(-1).options.signal
  if (changed === 'business') { state.businessId = 'business-b'; call('resetInstagramMediaState()') }
  else if (changed === 'account') call('instagramMediaObserveAccount("account-b")')
  else call('instagramMediaAutomationClose(false)')
  assert.equal(signal.aborted, true)
  resolveLate(response(result()))
  await late
  assert.equal(state.instagramMedia?.automation ?? null, null)
  assert.equal(n.panel.hidden, true)
}
assert.ok(requests.every((r) => !r.options.method || r.options.method === 'PATCH'), 'configuration controls never use upload/sync/send POSTs')
for (const navigation of ['setSection("conversations")', 'setMarketingView("templates")']) {
  state.marketingView = 'instagram-reels'; state.templatesLoaded = true; els.appShell.dataset.section = 'campaigns'
  handler = async () => response(result())
  const fresh = call('instagramMediaContext()'); fresh.accountId = 'account-a'; fresh.data = media.data
  await clickRow()
  let resolveNavigation!: (value: Response) => void
  handler = async () => new Promise((resolve) => { resolveNavigation = resolve })
  const loading = call('instagramMediaAutomationLoad(state.instagramMedia,state.instagramMedia.automation)')
  const signal = requests.at(-1).options.signal
  call(navigation)
  assert.equal(signal.aborted, true, 'real tab/section navigation cancels configuration reads')
  assert.equal(n.panel.hidden, true)
  resolveNavigation(response(result()))
  await loading
  assert.equal(state.instagramMedia.automation, null)
}
state.marketingView = 'instagram-reels'; els.appShell.dataset.section = 'campaigns'
handler = async () => response(result('media-a', 'media', { ...legacy, publicReplyText: '</textarea><script>bad()</script>' }))
state.instagramMedia.data.items[0].caption = '<img onerror=bad()> Reel'
await clickRow()
assert.equal(n.caption.textContent, '<img onerror=bad()> Reel')
assert.equal(n['public-text'].value, '</textarea><script>bad()</script>', 'remote texts populate values without interpolating markup')
console.log('OK: shipped bindings configure both real targets, preserve private values, save/pause/errors, action outcomes, focus and stale-context safety')
