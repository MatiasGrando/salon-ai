import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
process.env.DOTENV_CONFIG_PATH = '__instagram_planning_ui_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const { localDateTimeToInstants } = await import('../src/bot-options/application/availability-queries.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((script) => script.includes('function submitInstagramReel('))!
function fn(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(inline)
  assert.ok(match)
  return inline.slice(match.index, inline.indexOf('\n    }', match.index) + 6)
}
const requests: any[] = [], nodes: any = {}
function element() {
  return { value: '', checked: false, disabled: false, hidden: false, isConnected: true, dataset: {} as any, style: {}, textContent: '', innerHTML: '', files: [] as any[],
    listeners: {} as Record<string, Function[]>, focus() { context.document.activeElement = this }, reset() {}, scrollIntoView() {},
    removeAttribute(name: string) { if(name==='hidden')this.hidden=false }, setAttribute(name: string) { if(name==='hidden')this.hidden=true }, addEventListener(type: string, callback: Function) { (this.listeners[type] ??= []).push(callback) }, querySelectorAll() { return [] } }
}
const els: any = new Proxy({}, { get(target: any, key: string) { const id=key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()); return target[key] ??= nodes[id] ??= element() } })
els.appShell.dataset.section = 'campaigns'
const state: any = { businessId: 'a', marketingView: 'instagram-reels', business: { timezone: 'America/New_York' }, instagramReelKeywords: [], instagramReels: [] }
let publishFails = false, fetchHandler: ((url: string, options: any) => Promise<Response>) | null = null
let current: any = null, xhrCount = 0
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const defaultFetch = async (url: string, options: any) => {
  const payload = options.body ? JSON.parse(options.body) : null
  if (url.endsWith('/uploads')) return json({ uploadUrl: 'https://storage.invalid/file', objectPath: 'a/file', uploadHeaders: {} })
  if (url.endsWith('/verify')) return json({ verified: true, objectPath: 'a/file', mimeType: 'video/mp4', sizeBytes: 100 })
  if (url.endsWith('/publish')) { if (publishFails) return json({ message: 'fake-error' }, 503); current = { ...current, status: 'READY', revision: current.revision + 1 }; return json(current) }
  if (url.endsWith('/schedule')) { current = { ...current, status: 'SCHEDULED', revision: current.revision + 1, scheduledAt: payload.scheduledAt }; return json(current) }
  if (url.endsWith('/instagram-publications')) { current = { ...payload, id: 'draft-1', businessId: state.businessId, revision: 0, status: 'DRAFT' }; return json(current) }
  if (url.includes('/instagram-publications/')) { if (options.method === 'PATCH') current = { ...current, ...payload, revision: current.revision + 1 }; return json(current) }
  if (url.includes('/time-options')) {
    const parsed = new URL(url, 'https://test.invalid'), minute = Number(parsed.searchParams.get('minute'))
    return json({ timezone: state.business.timezone, requiresChoice: minute === 90,
      candidates: minute === 90 ? [{ instant: '2026-11-01T05:30:00Z', offset: 'UTC-4' }, { instant: '2026-11-01T06:30:00Z', offset: 'UTC-5' }]
        : [{ instant: parsed.searchParams.get('date') + 'T04:00:00Z', offset: 'UTC-4' }] })
  }
  return json({ timezone: state.business.timezone, accountId: 'account-a', offset: 0, items: [], total: 0, undatedItems: [], undatedTotal: 0 })
}
class XHR {
  status = 200
  listeners: any = {}
  upload = { addEventListener() {} }
  open() {} setRequestHeader() {}
  addEventListener(type: string, fn: Function) { this.listeners[type] = fn }
  send() { xhrCount++; this.listeners.load() }
  abort() { this.listeners.abort?.() }
}
const context: any = { els, state, URL, URLSearchParams, Date, Intl, AbortController, encodeURIComponent, XMLHttpRequest: XHR,
  requestAnimationFrame: (fn: Function) => fn(), setButtonLoading: () => true, buildGetJsonRequestOptions: (value: any) => value,
  document: { activeElement: null, body:{dataset:{}}, getElementById: (id: string) => nodes[id] ??= element(), querySelectorAll: () => [], querySelector:()=>element() },
  staffVisibleSections:()=>['campaigns','conversations'],isWorkshopBusiness:()=>false,staffSettlementsLabel:()=>'Liquidaciones',stopAgendaNowLineTimer(){},closeMobileDrawer(){},isMobile:()=>false,
  fetch: async (url: string, options: any = {}) => { requests.push({ url, options }); return (fetchHandler || defaultFetch)(url, options) } }
const helpers = ['getJson', 'escapeHtml', 'instagramReelStatusMeta', 'submitInstagramReel', 'instagramReelMimeType', 'setInstagramReelFeedback', 'setInstagramReelProgress',
  'resetInstagramReelForm','openInstagramReelDialog','closeInstagramReelDialog','renderInstagramReelReview','renderInstagramReelKeywords','normalizeInstagramReelKeyword','renderInstagramReels',
  'addInstagramReelKeyword','readInstagramReelVideo','uploadInstagramReelFile','bindInstagramPlanningControls','setMarketingView','setSection',
  ...[...inline.matchAll(/    (?:async )?function ((?:instagramMedia|renderInstagramMedia|resetInstagramMedia|loadInstagramMedia|syncInstagramMedia|pauseInstagramMedia|applyInstagramMedia|openInstagramMedia|bindInstagramMedia)\w*)\(/g)].map(match=>match[1]!)]
runInNewContext([...new Set(helpers)].map(fn).join('\n'), context)
const call = (code: string) => runInNewContext(code, context)
context.loadInstagramReels = async () => {}
const bindings = inline.slice(inline.indexOf("    els.instagramReelNew.addEventListener"),inline.indexOf("    els.marketingMainTabs.addEventListener",inline.indexOf("    els.instagramReelNew.addEventListener")))
runInNewContext(bindings, context)
const submit = () => els.instagramReelForm.listeners.submit[0]({ preventDefault() {} })
const open = () => els.instagramReelNew.listeners.click[0]()
open()
els.instagramReelVideo.files = [{ name: 'test.mp4', type: 'video/mp4', size: 100 }]
els.instagramReelAutomationEnabled.checked = false
await submit()
assert.ok(requests.some((request) => request.url.endsWith('/instagram-publications')), 'the shipped editor must create a video draft without requiring inactive keyword/private actions')
assert.equal(xhrCount, 1)
assert.equal(requests.filter(request => request.url.endsWith('/publish')).length, 0, 'default save is a draft')
assert.equal(state.instagramPlanning.editor.publication.id, 'draft-1')
nodes['instagram-reel-destination'].value = 'now'; publishFails = true
await submit()
assert.equal(state.instagramPlanning.editor.publication.id, 'draft-1')
assert.match(els.instagramReelFeedback.textContent, /borrador sigue guardado/)
publishFails = false; await submit()
assert.equal(xhrCount, 1, 'enqueue retry retains its verified file and created draft ID')
assert.equal(requests.filter(request => request.url.endsWith('/instagram-publications')).length, 1)
assert.ok(requests.filter(request => request.url.endsWith('/publish')).every(request => Number.isInteger(JSON.parse(request.options.body).expectedRevision)))
await submit()
assert.equal(requests.filter(request => request.url.endsWith('/publish')).length, 2, 'a READY reload cannot resend a job')
open(); els.instagramReelVideo.files = []
for (const id of ['instagram-reel-schedule-date','instagram-reel-schedule-time']) context.document.getElementById(id)
nodes['instagram-reel-schedule-date'].value = '2026-11-01'; nodes['instagram-reel-schedule-time'].value = '01:30'
await nodes['instagram-reel-resolve-time'].listeners.click[0]()
assert.ok(nodes['instagram-reel-time-options'].innerHTML.includes('UTC-4')); assert.ok(nodes['instagram-reel-time-options'].innerHTML.includes('UTC-5'))
assert.equal(nodes['instagram-reel-time-options'].value, '', 'DST folds require an explicit candidate selection')
let release!: (response: Response) => void
fetchHandler = async () => new Promise(resolve => { release = resolve })
els.instagramReelVideo.files = [{ name: 'late.mp4', type: 'video/mp4', size: 100 }]
const late = submit(), controller = state.instagramPlanning.editor.controller
els.instagramReelClose.listeners.click[0]()
assert.equal(controller.signal.aborted, true)
release(json({ uploadUrl: 'https://storage.invalid/file', objectPath: 'a/file', uploadHeaders: {} })); await late
assert.equal(state.instagramPlanning.editor, null); assert.equal(xhrCount, 1, 'closing before upload response starts no late XHR')
fetchHandler = null
const p = state.instagramPlanning
p.data = { timezone: p.zone, items: [{ id: 'dated', kind: 'publication', caption: '<img onerror=bad()>', status: 'UNKNOWN', eventAt: '2026-11-01T12:00:00Z', scheduledAt: null, publishedAt: null }], total: 101,
  undatedItems: [{ id: 'issue', kind: 'publication', caption: 'Sin fecha', status: 'FAILED', scheduledAt: null, publishedAt: null }], undatedTotal: 155 }
call('instagramMediaPlanRender()')
assert.ok(!nodes['instagram-planning-body'].innerHTML.includes('<img'))
assert.ok(!nodes['instagram-planning-body'].innerHTML.includes('data-instagram-plan-action="edit"'))
assert.ok(!nodes['instagram-planning-body'].innerHTML.includes('Reenviar'))
assert.equal(nodes['instagram-planning-more'].disabled, false, 'pagination accounts for both dated and undated totals')
const originalZone = p.zone
for (const [zone, day, expected] of [['America/Santiago','2026-09-06','2026-09-06T04:00:00.000Z'],['Asia/Kathmandu','1986-01-01','1985-12-31T18:30:00.000Z']]) {
  p.zone = zone
  fetchHandler = async (url) => {
    const parsed = new URL(url,'https://test.invalid'), candidates = localDateTimeToInstants(parsed.searchParams.get('date')!,Number(parsed.searchParams.get('minute')),zone!)
    return candidates.length ? json({ timezone:zone,candidates:candidates.map(instant=>({instant:instant.toISOString()})) }) : json({message:'Gap'},400)
  }
  assert.equal(await call('instagramMediaPlanBoundary(state.instagramPlanning,"'+day+'")'), expected, 'civil-day ranges begin at the first valid instant after a midnight gap')
}
p.zone = originalZone; fetchHandler = null
for (const navigation of ['setMarketingView("templates")','setSection("conversations")']) {
  state.templatesLoaded=true;state.marketingView='instagram-reels';els.appShell.dataset.section='campaigns'
  const active=call('instagramMediaPlanContext()')
  let deliver!: (response: Response)=>void
  fetchHandler=async(url,options)=>url.includes('instagram-calendar?')?new Promise(resolve=>{deliver=resolve}):defaultFetch(url,options)
  const loading=call('instagramMediaPlanLoad()')
  for(let attempt=0;attempt<20&&!deliver;attempt++)await new Promise(resolve=>setTimeout(resolve,0))
  call(navigation)
  assert.equal(active.controller.signal.aborted,true,'real main-section/tab navigation must invalidate a pending calendar request')
  deliver(json({timezone:active.zone,accountId:'old-account',items:[],total:0,undatedItems:[],undatedTotal:0}));await loading
  assert.equal(state.instagramPlanning,null)
}
state.marketingView='instagram-reels';els.appShell.dataset.section='campaigns';fetchHandler=null
current={id:'existing',businessId:'a',revision:0,status:'DRAFT',caption:'Opened text',shareToFeed:true,automation:{enabled:false,keywords:[]}}
context.row={kind:'publication',id:'existing'}
await call('instagramMediaPlanOpen(row,"edit",els.instagramReelNew)')
current={...current,revision:1,caption:'Other operator saved this'}
await submit()
assert.equal(current.caption,'Other operator saved this','re-reading a newer revision must not promote stale form edits into an overwrite')
for (const changed of ['account','timezone']) {
  state.business={timezone:'America/New_York'}; call('resetInstagramMediaState()')
  const media=call('instagramMediaContext()');media.accountId='old-account'
  open();els.instagramReelVideo.files=[{name:'late.mp4',type:'video/mp4',size:100}]
  const active=state.instagramPlanning,editor=active.editor
  const before: number=xhrCount
  let deliver!: (response: Response)=>void
  fetchHandler=async()=>new Promise(resolve=>{deliver=resolve})
  const saving=submit()
  if(changed==='account')call('instagramMediaObserveAccount("new-account")')
  else{state.business={timezone:'Europe/Madrid'};call('instagramMediaPlanContext()')}
  assert.equal(editor.controller.signal.aborted,true,'same-business identity/timezone changes invalidate the editor request')
  assert.equal(els.instagramReelDialog.hidden,true)
  deliver(json({uploadUrl:'https://storage.invalid/file',objectPath:'a/file',uploadHeaders:{}}));await saving
  assert.equal(xhrCount,before,'an old account or zone cannot start its late upload')
  assert.notEqual(state.instagramPlanning,active)
}
fetchHandler=null
state.business={timezone:'America/New_York'};call('resetInstagramMediaState()')
const navigationContext=call('instagramMediaPlanContext()');navigationContext.anchor='2026-10-26'
let firstCalendar=true,deliverOld!: (response: Response)=>void
fetchHandler=async(url,options)=>{
  if(!url.includes('instagram-calendar?'))return defaultFetch(url,options)
  if(firstCalendar){firstCalendar=false;return new Promise(resolve=>{deliverOld=resolve})}
  return json({timezone:'America/New_York',accountId:'account-a',items:[],total:0,undatedItems:[],undatedTotal:0})
}
const beforeNavigation=requests.filter(request=>request.url.includes('instagram-calendar?')).length
const oldCalendar=call('instagramMediaPlanLoad()')
for(let attempt=0;attempt<20&&!deliverOld;attempt++)await new Promise(resolve=>setTimeout(resolve,0))
const monthButton={dataset:{instagramPlanView:'month'}}
nodes['instagram-planning'].listeners.click[0]({target:{closest:(selector:string)=>selector==='[data-instagram-plan-view]'?monthButton:null}})
for(let attempt=0;attempt<20&&navigationContext.loading;attempt++)await new Promise(resolve=>setTimeout(resolve,0))
deliverOld(json({timezone:'America/New_York',accountId:'account-a',items:[{id:'old-week'}],total:1,undatedItems:[],undatedTotal:0}));await oldCalendar
assert.equal(requests.filter(request=>request.url.includes('instagram-calendar?')).length,beforeNavigation+2,'changing view during a pending read starts the latest range and discards the old range')
assert.equal(navigationContext.period.first,'2026-10-01')
assert.deepEqual(navigationContext.data.items,[])
fetchHandler=null
navigationContext.data={items:[{kind:'media',id:'copy-me',caption:'Copy me',status:'PUBLISHED'}],undatedItems:[]}
const duplicateDeliveries: Array<(response:Response)=>void>=[]
fetchHandler=async()=>new Promise(resolve=>duplicateDeliveries.push(resolve))
const duplicateEvent={target:{closest:()=>({dataset:{instagramPlanAction:'duplicate',kind:'media',id:'copy-me'}})}}
const firstDuplicate=nodes['instagram-planning-body'].listeners.click[0](duplicateEvent)
const secondDuplicate=nodes['instagram-planning-body'].listeners.click[0](duplicateEvent)
assert.equal(duplicateDeliveries.length,1,'double activation must not issue two duplicate writes')
for(const deliver of duplicateDeliveries)deliver(json({requiresFile:true,publication:null,content:{caption:'Copy',shareToFeed:true,automation:{enabled:false,keywords:[]}}}))
await Promise.all([firstDuplicate,secondDuplicate])
assert.equal(state.instagramPlanning.editor.publication,null)
assert.match(els.instagramReelFeedback.textContent,/necesita un video propio/)
fetchHandler=null
const monthContext=state.instagramPlanning;monthContext.anchor='2026-01-31';monthContext.view='month'
nodes['instagram-planning'].listeners.click[0]({target:{closest:(selector:string)=>selector==='[data-instagram-plan-move]'?{dataset:{instagramPlanMove:'1'}}:null}})
for(let attempt=0;attempt<20&&monthContext.loading;attempt++)await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(monthContext.period.first,'2026-02-01','month navigation starts from the current civil period rather than overflowing a day31 into March')
console.log('OK: real editor/event bindings, optional automation, retained draft/upload retries, explicit DST choice, safe UNKNOWN, context abort and complete calendar pagination')
