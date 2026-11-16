import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: true })
const response = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(response.statusCode, 200)
const scripts = [...response.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
const script = scripts.find((value) => value.includes('function setSection(section'))
assert.ok(script, 'rendered CRM must include setSection')

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `expected ${name} in rendered CRM`)
  let depth = 0
  let cursor = source.indexOf(') {', start) + 2
  assert.ok(cursor > 1, `expected function body for ${name}`)
  for (; cursor < source.length; cursor++) {
    if (source[cursor] === '{') depth++
    if (source[cursor] === '}' && --depth === 0) return source.slice(start, cursor + 1)
  }
  throw new Error(`unterminated ${name}`)
}

let resolveDetails!: () => void
let details = new Promise<void>((resolve) => { resolveDetails = resolve })
let settingsActivationCount = 0
let marketingActivation: string | null = null
let cashEntryCount = 0
const appShell = { dataset: { section: 'agenda' } }
const settingsStatus = { dataset: {} as Record<string, string>, setAttribute() {}, className: '', textContent: '', remove() { settingsRoot.status = null } }
const settingsRoot = {
  status: null as typeof settingsStatus | null,
  shell: { busy: '', inert: false, pending: false, setAttribute(name: string, value: string) { if (name === 'aria-busy') this.busy = value }, classList: { toggle(_name: string, value: boolean) { settingsRoot.shell.pending = value } } },
  querySelector(selector: string) { return selector === '.settings-shell' ? this.shell : this.status },
  prepend(status: typeof settingsStatus) { this.status = status },
}
const campaignsRoot = {
  status: null as typeof settingsStatus | null,
  shell: { busy: '', inert: false, pending: false, setAttribute(name: string, value: string) { if (name === 'aria-busy') this.busy = value }, classList: { toggle(_name: string, value: boolean) { campaignsRoot.shell.pending = value } } },
  querySelector(selector: string) { return selector === '.campaigns-shell' ? this.shell : this.status },
  setAttribute() {},
  prepend(status: typeof settingsStatus) { this.status = status },
}
const document = {
  body: { dataset: {} as Record<string, string> },
  getElementById: (id: string) => id === 'settings-view' ? settingsRoot : id === 'campaigns-view' ? campaignsRoot : null,
  createElement: () => {
    const inCampaigns = appShell.dataset.section === 'campaigns'
    const status = { ...settingsStatus, setAttribute() {}, appendChild() {}, remove() { if (inCampaigns) campaignsRoot.status = null; else settingsRoot.status = null } }
    if (inCampaigns) campaignsRoot.status = status
    else settingsRoot.status = status
    return status
  },
  querySelectorAll: () => [],
}
const sandbox: Record<string, any> = {
  workspaceNavigation: 0,
  deferredWorkspace: { detailsReady: false },
  state: { marketingView: 'campaigns', campaignsLoaded: true, templatesLoaded: true },
  els: { appShell },
  document,
  staffVisibleSections: () => ['agenda', 'settings', 'campaigns', 'accounts', 'cash'],
  isWorkshopBusiness: () => false,
  ensureWorkspaceDetails: () => details,
  showCrmToast: () => {},
  closeMobileDrawer: () => {},
  stopAgendaNowLineTimer: () => {},
  instagramMediaPlanLeave: () => {},
  instagramStoriesReset: () => {},
  instagramMediaAutomationClose: () => {},
  setSettingsView: () => { settingsActivationCount += 1 },
  ensureBusinessMedia: async () => {},
  loadManagedAccounts: async () => {},
  renderManagedAccountsLoadError: () => {},
  setMarketingView: (view: string) => { marketingActivation = view },
  loadCampaigns: async () => {},
  loadWhatsappTemplates: async () => {},
  enterCashRegister: async () => { cashEntryCount += 1 },
}
const setSection = new Function('sandbox', `with (sandbox) { ${extractFunction(script, 'setWorkspaceDetailsLoading')}; ${extractFunction(script, 'activateDeferredWorkspaceSection')}; ${extractFunction(script, 'loadDeferredWorkspaceSection')}; ${extractFunction(script, 'setSection')}; return setSection }`)(sandbox) as (section: string, options?: { deferAgenda?: boolean; marketingView?: string }) => void

setSection('settings')
assert.equal(appShell.dataset.section, 'settings', 'settings should become active before deferred workspace details resolve')
assert.equal(document.body.dataset.currentSection, 'settings', 'visible navigation context should update synchronously')
assert.equal(sandbox.workspaceNavigation, 1)
assert.equal(settingsRoot.shell.busy, 'true', 'the destination section should expose an accessible loading state')
assert.equal(settingsRoot.status?.textContent, 'Cargando Ajustes…', 'the loading message should be visible inside the section')
assert.equal(settingsRoot.shell.inert, true, 'settings controls should wait for shared details')
assert.equal(settingsRoot.shell.pending, true, 'stale section content should not remain visible behind the loading message')
resolveDetails()
await details
await new Promise((resolve) => setImmediate(resolve))
assert.equal(settingsRoot.shell.busy, 'false')
assert.equal(settingsRoot.shell.inert, false)
assert.equal(settingsRoot.shell.pending, false)
assert.equal(settingsActivationCount, 1, 'settings-specific initialization should run after details are ready')
assert.doesNotMatch(script, /if \(button\.dataset\.marketingNav\) setMarketingView\(button\.dataset\.marketingNav\)/, 'sidebar handlers must pass the requested marketing tab without initializing it twice')
// A newer navigation must win while the shared detail request is still pending.
sandbox.deferredWorkspace = { detailsReady: false }
details = new Promise<void>((resolve) => { resolveDetails = resolve })
appShell.dataset.section = 'agenda'
setSection('settings')
setSection('campaigns', { marketingView: 'instagram-reels' })
assert.equal(sandbox.state.marketingView, 'instagram-reels', 'the selected Instagram submenu should be remembered immediately')
assert.equal(campaignsRoot.status?.textContent, 'Cargando Instagram…', 'the in-section status should identify the requested Marketing view')
setSection('cash')
assert.equal(appShell.dataset.section, 'cash', 'Caja should navigate immediately while workspace details are pending')
assert.equal(document.body.dataset.currentSection, 'cash')
assert.equal(cashEntryCount, 1, 'Caja should reuse its existing loading entry path')
resolveDetails()
await details
await new Promise((resolve) => setImmediate(resolve))
assert.equal(settingsActivationCount, 1, 'late details must not initialize the abandoned Settings section')
assert.equal(marketingActivation, null, 'late details must not initialize the abandoned Instagram section')
assert.equal(campaignsRoot.status, null, 'leaving Instagram should clear its stale loading status')
sandbox.deferredWorkspace.detailsReady = true
setSection('campaigns', { marketingView: 'instagram-reels' })
assert.equal(settingsRoot.status, null, 'reopening the ready section should remove any stale loading message')
assert.equal(campaignsRoot.shell.pending, false, 'reopening the ready section should restore its content')
assert.equal(marketingActivation, 'instagram-reels', 'reopening a ready section should activate the requested Instagram tab')

await app.close()
console.log('CRM priority navigation contract: OK')
