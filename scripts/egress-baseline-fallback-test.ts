import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderCrmHtml } from '../src/routes/crm-ui.js'

type Listener = (...args: any[]) => unknown

function createElement(id = ''): any {
  const listeners = new Map<string, Listener[]>()
  const target: Record<string, any> = Object.assign(function elementMethod() {}, {
    id, dataset: {}, style: { setProperty() {}, removeProperty() {} }, hidden: false, value: '', checked: false, disabled: false,
    innerHTML: '', textContent: '', scrollHeight: 0, scrollTop: 0, clientHeight: 0, className: '',
    classList: { add() {}, remove() {}, toggle() { return false }, contains() { return false } },
    addEventListener(type: string, listener: Listener) { listeners.set(type, [...(listeners.get(type) || []), listener]) },
    removeEventListener() {}, querySelector: () => createElement(), querySelectorAll: () => [], closest: () => createElement(),
    appendChild() {}, append() {}, replaceChildren() {}, remove() {}, focus() {}, click() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), __listeners: listeners
  })
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as keyof typeof object]
      if (property === Symbol.iterator) return function * () {}
      return createElement(String(property))
    }
  })
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob() }
}

function scriptsFromRenderedHtml(html: string) {
  const scripts: string[] = []
  let offset = 0
  while (true) {
    const open = html.indexOf('<script', offset)
    if (open === -1) return scripts
    const contentStart = html.indexOf('>', open)
    const close = contentStart === -1 ? -1 : html.indexOf('</script>', contentStart + 1)
    if (contentStart === -1 || close === -1) return scripts
    scripts.push(html.slice(contentStart + 1, close))
    offset = close + '</script>'.length
  }
}

async function settle(rounds = 30) {
  for (let index = 0; index < rounds; index += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function runRenderedCrm(markerEffective: boolean, overlapFallbackWithManual = false) {
  const html = renderCrmHtml({ pollingMarker: { effective: markerEffective, headerName: 'X-CRM-Refresh-Mode', headerValue: 'fallback-poll' } })
  const scripts = scriptsFromRenderedHtml(html)
  assert.ok(scripts.length >= 1, 'the complete production CRM script is rendered')
  const elements = new Map<string, any>()
  const body = createElement('body')
  body.dataset.auth = 'loading'
  const marker = createElement('crm-polling-marker')
  marker.dataset = { effective: String(markerEffective), header: 'X-CRM-Refresh-Mode', value: 'fallback-poll' }
  const reportsNav = createElement('reports-nav')
  reportsNav.dataset.navSection = 'reports'
  const workspaceNav = createElement('workspace-nav')
  workspaceNav.querySelectorAll = (selector: string) => selector === 'button[data-nav-section]' ? [reportsNav] : []
  const reportClose = createElement('report-close')
  reportClose.dataset.closeReportConversation = 'conversation-safe'
  const document = {
    body,
    documentElement: createElement('html'),
    getElementById(id: string) {
      if (!elements.has(id)) {
        const element = createElement(id)
        if (id === 'report-unconverted-chats') element.querySelectorAll = (selector: string) => selector === '[data-close-report-conversation]' ? [reportClose] : []
        elements.set(id, element)
      }
      return elements.get(id)
    },
    querySelector(selector: string) {
      if (selector === 'meta[name="crm-polling-marker"]') return marker
      if (selector === '.workspace-nav') return workspaceNav
      return createElement(selector)
    },
    querySelectorAll: (selector: string) => selector === '.workspace-nav button[data-nav-section]' ? [reportsNav] : [],
    createElement: (tag: string) => createElement(tag), addEventListener() {}, removeEventListener() {}
  }
  const conversationInitial = { id: 'conversation-safe', phone: '5491111111111', customerName: 'Cliente seguro', status: 'ACTIVE', updatedAt: '2026-08-23T20:00:00.000Z', latestActivityAt: '2026-08-23T20:00:00.000Z', messages: [] }
  const conversationUpdated = { ...conversationInitial, updatedAt: '2026-08-23T20:01:00.000Z', latestActivityAt: '2026-08-23T20:01:00.000Z' }
  const calls: Array<{ url: string; headers: Headers; method: string; signal: AbortSignal | null }> = []
  let updateRequested = false
  let summaryRequests = 0
  let blockNextFallbackSummary = false
  let fallbackOverlapActive = false
  let manualOverlapActive = false
  const fallbackCausalCalls: typeof calls = []
  const manualOverlapCalls: typeof calls = []
  let signalBlockedSummary: (() => void) | null = null
  let releaseBlockedSummary: (() => void) | null = null
  const blockedSummaryEntered = new Promise<void>((resolve) => { signalBlockedSummary = resolve })
  const blockedSummaryRelease = new Promise<void>((resolve) => { releaseBlockedSummary = resolve })
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const headers = new Headers(init.headers)
    const call = { url, headers, method: init.method || 'GET', signal: init.signal || null }
    calls.push(call)
    if (overlapFallbackWithManual && manualOverlapActive) manualOverlapCalls.push(call)
    else if (overlapFallbackWithManual && fallbackOverlapActive) fallbackCausalCalls.push(call)
    if (url === '/auth/me') return jsonResponse({ user: { id: 'staff-1', name: 'Staff', role: 'STAFF', canViewConversations: true, canViewCustomers: true }, business: null })
    if (url.startsWith('/businesses?')) return jsonResponse([{ id: 'business-1', name: 'Negocio' }])
    if (url.startsWith('/crm/conversations/summary')) {
      summaryRequests += 1
      if (blockNextFallbackSummary && fallbackOverlapActive && !manualOverlapActive) {
        blockNextFallbackSummary = false
        signalBlockedSummary?.()
        await blockedSummaryRelease
      }
      return jsonResponse({
        counts: { active: 1, unread: 0, handoff: 0, archived: 0, deposits: 0 },
        latestActivityAt: summaryRequests === 1 ? conversationInitial.latestActivityAt : conversationUpdated.latestActivityAt
      })
    }
    if (url.startsWith('/crm/conversations?') && url.includes('since=')) { updateRequested = true; return jsonResponse({ items: [conversationUpdated], counts: { active: 1 }, latestActivityAt: conversationUpdated.latestActivityAt }) }
    if (url.startsWith('/crm/conversations?')) return jsonResponse({ items: [conversationInitial], counts: { active: 1, unread: 0, handoff: 0, archived: 0, deposits: 0 }, latestActivityAt: conversationInitial.latestActivityAt, nextCursor: null })
    if (url.includes('/messages?')) return jsonResponse({ items: [], nextCursor: null })
    if (url.startsWith('/crm/deposits?')) return jsonResponse({ activeCount: 0, reviewCount: 0 })
    if (url.startsWith('/appointments?') || url.startsWith('/customers/')) return jsonResponse([])
    if (url.startsWith('/reports/overview?')) return jsonResponse({
      period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-23T00:00:00.000Z' },
      appointments: { total: 0, active: 0, completed: 0, cancelled: 0, cancellationRate: 0, noShow: 0 },
      customers: { active: 1, new: 0 }, chatConversion: { rate: 0, converted: 0, total: 1 },
      customerMix: { newCustomers: 0, returningCustomers: 1, newRate: 0, returningRate: 100 },
      visitGap: { averageDays: null, sampleSize: 0 }, futureAgenda: { total: 0, byProfessional: [] },
      inactiveCustomers: { total: 0, items: [] }, riskCustomers: { total: 0, items: [] }, revenue: null,
      services: [], professionals: [], unconvertedChats: { total: 1, items: [{ id: 'conversation-safe', phone: conversationInitial.phone, updatedAt: conversationInitial.updatedAt }] }
    })
    if (url.startsWith('/reports/professional-production?')) return jsonResponse({ rows: [], summary: {} })
    if (url.startsWith('/demo-profiles') || url.startsWith('/admin/demo-profiles')) return jsonResponse([])
    if (url.startsWith('/customers?')) return jsonResponse([{ id: 'customer-safe', name: 'Cliente seguro', phone: conversationInitial.phone }])
    if (url.startsWith('/business-hours?') || url.startsWith('/professionals?') || url.startsWith('/staff?') || url.startsWith('/service-categories?') || url.startsWith('/services?')) return jsonResponse([])
    return jsonResponse([])
  }
  const intervals: Listener[] = []
  const eventSources: Array<{ listeners: Map<string, Listener[]> }> = []
  class EventSourceStub {
    listeners = new Map<string, Listener[]>()
    constructor(_url: string) { eventSources.push(this) }
    addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]) }
    close() {}
  }
  const storage = { getItem: () => null, setItem() {}, removeItem() {} }
  const context: any = {
    console, document, navigator: { userAgent: 'egress-contract', mediaDevices: null },
    location: { href: 'http://localhost/crm', pathname: '/crm', search: '', origin: 'http://localhost' },
    localStorage: storage, sessionStorage: storage, fetch, Headers, Request, Response, URL, URLSearchParams, AbortController, Blob, FormData,
    EventSource: EventSourceStub, Audio: class { play() { return Promise.resolve() } }, Image: class {}, crypto: globalThis.crypto,
    setTimeout: (callback: Listener) => { queueMicrotask(() => callback()); return 1 }, clearTimeout() {},
    setInterval: (callback: Listener) => { intervals.push(callback); return intervals.length }, clearInterval() {},
    requestAnimationFrame: (callback: Listener) => { callback(); return 1 }, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), getComputedStyle: () => ({ display: 'block' }),
    addEventListener() {}, removeEventListener() {}, innerWidth: 1280
  }
  context.window = context
  context.globalThis = context
  for (const script of scripts) vm.runInNewContext(script, context, { filename: 'rendered-crm.html' })
  await settle()
  assert.equal(eventSources.length, 1, 'the complete startCrm path opens production EventSource; calls=' + calls.map((call) => call.url).join(',') + '; error=' + elements.get('conversation-list')?.innerHTML)
  const executeManualClose = async () => {
    for (const listener of reportsNav.__listeners.get('click') || []) await listener({ preventDefault() {}, target: reportsNav })
    await settle()
    for (const listener of reportClose.__listeners.get('click') || []) await listener({ preventDefault() {}, target: reportClose })
    const closeReason = document.getElementById('opportunity-close-reason')
    closeReason.value = 'OTHER'
    const closeForm = document.getElementById('opportunity-close-form')
    for (const listener of closeForm.__listeners.get('submit') || []) await listener({ preventDefault() {}, currentTarget: closeForm, target: closeForm })
    await settle()
  }

  if (overlapFallbackWithManual) {
    blockNextFallbackSummary = true
    fallbackOverlapActive = true
    for (const listener of eventSources[0].listeners.get('error') || []) listener({ type: 'error' })
    await blockedSummaryEntered
    manualOverlapActive = true
    await executeManualClose()
    manualOverlapActive = false
    releaseBlockedSummary?.()
    await settle()
    fallbackOverlapActive = false
    return { calls, beforeError: calls.length, beforeScheduled: calls.length, updateRequested, sseEventCalls: [], manualCalls: manualOverlapCalls, overlapCalls: fallbackCausalCalls }
  }

  const beforeError = calls.length
  for (const listener of eventSources[0].listeners.get('error') || []) listener({ type: 'error' })
  await settle()
  assert.ok(intervals.length >= 1, 'the production fallback schedules its timer after SSE error')
  const beforeScheduled = calls.length
  intervals[intervals.length - 1]()
  await settle()
  const beforeSseEvent = calls.length
  for (const listener of eventSources[0].listeners.get('deposit_updated') || []) listener({ data: JSON.stringify({ businessId: 'business-1', depositId: 'deposit-safe' }) })
  await settle()
  const sseEventCalls = calls.slice(beforeSseEvent)

  const beforeManual = calls.length
  await executeManualClose()
  const manualCalls = calls.slice(beforeManual)
  return { calls, beforeError, beforeScheduled, updateRequested, sseEventCalls, manualCalls, overlapCalls: [] }
}

const effective = await runRenderedCrm(true)
const scheduledCalls = effective.calls.slice(effective.beforeScheduled)
const markedCalls = scheduledCalls.filter((call) => call.headers.get('X-CRM-Refresh-Mode') === 'fallback-poll')
assert.ok(markedCalls.some((call) => call.url.startsWith('/crm/conversations/summary')), 'scheduled fallback summary is marked')
assert.ok(markedCalls.some((call) => call.url.startsWith('/crm/deposits?')), 'fire-and-forget deposit refresh remains marked')
assert.ok(markedCalls.some((call) => call.url.includes('/crm/conversations?') && call.url.includes('since=')), 'incremental update remains marked')
assert.ok(markedCalls.some((call) => call.url.includes('/messages?')), 'selected message fan-out remains marked')
assert.ok(markedCalls.some((call) => call.url.startsWith('/appointments?')), 'selected appointment fan-out remains marked')
assert.ok(markedCalls.some((call) => call.url.startsWith('/customers/customer-safe/notes')), 'selected notes fan-out remains marked')
assert.equal(effective.updateRequested, true)
assert.equal(effective.calls.slice(0, effective.beforeError).some((call) => call.headers.has('X-CRM-Refresh-Mode')), false, 'manual and initial requests remain unmarked')
assert.ok(effective.sseEventCalls.some((call) => call.url.startsWith('/crm/deposits?')), 'production deposit_updated listener generates its refresh')
assert.equal(effective.sseEventCalls.some((call) => call.headers.has('X-CRM-Refresh-Mode')), false, 'SSE-triggered refresh never receives fallback causality')
assert.ok(effective.manualCalls.some((call) => call.url.includes('/opportunity/close')), 'manual product action executes before the shared summary refresh')
assert.ok(effective.manualCalls.some((call) => call.url.startsWith('/crm/conversations/summary')), 'manual product action calls shared refreshConversationSummary')
assert.equal(effective.manualCalls.some((call) => call.headers.has('X-CRM-Refresh-Mode')), false, 'manual shared refresh and its fan-out remain unmarked')

const overlap = await runRenderedCrm(true, true)
const overlapFallbackCalls = overlap.overlapCalls
assert.ok(overlapFallbackCalls.some((call) => call.url.startsWith('/crm/conversations/summary')), 'pending fallback summary keeps its causal marker while manual work overlaps')
assert.equal(overlapFallbackCalls.every((call) => call.headers.get('X-CRM-Refresh-Mode') === 'fallback-poll'), true, 'every explicitly captured fallback-causal call retains the exact marker')
assert.equal(overlapFallbackCalls.every((call) => call.method === 'GET'), true, 'fallback marker preserves the existing request method/options')
assert.equal(overlapFallbackCalls.every((call) => call.signal === null || call.signal instanceof AbortSignal), true, 'fallback propagation preserves existing AbortSignal options')
assert.equal(overlap.manualCalls.every((call) => !call.headers.has('X-CRM-Refresh-Mode')), true, 'every explicitly captured overlapping manual call remains unmarked')
const overlapClose = overlap.manualCalls.find((call) => call.url.includes('/opportunity/close'))
assert.equal(overlapClose?.method, 'PATCH', 'overlapping manual action preserves its productive PATCH option')
assert.equal(overlapClose?.headers.get('content-type'), 'application/json', 'overlapping manual action preserves its productive content type option')
assert.equal(overlapClose?.signal, null, 'marker isolation does not synthesize or replace a manual request signal')
assert.equal(overlap.manualCalls.some((call) => call.url.startsWith('/crm/conversations/summary')), true, 'overlapping manual action reaches the same shared summary refresh without contamination')

const disabled = await runRenderedCrm(false)
assert.equal(disabled.calls.some((call) => call.headers.has('X-CRM-Refresh-Mode')), false, 'ineffective marker never reaches fetch headers')

console.log('egress baseline fallback: ok')
