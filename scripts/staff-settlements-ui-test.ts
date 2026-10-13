import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { cashRegisterScript, cashRegisterStyles } from '../src/routes/crm-ui/cash-register.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const mainScript = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
function functions(source: string, names: string[]) {
  const ast = ts.createSourceFile('crm.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const found = new Map<string, string>()
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return names.map((name) => { assert.ok(found.has(name), 'Production function required: ' + name); return found.get(name) }).join('\n')
}
const navFunctions = functions(mainScript, ['staffVisibleSections', 'staffSettlementsLabel', 'staffPermissionFields', 'syncStaffProfileFields'])
const cashFunctions = functions(cashRegisterScript, ['canUseCashPermission', 'cashScoped', 'isCashBusinessScopedRole', 'loadProfessionalSettlements', 'renderProfessionalSettlementFilter', 'loadStaffSettlements', 'setCashView', 'startCashRealtimeEvents', 'stopCashRealtimeEvents'])

function element() {
  return { hidden: false, value: '', textContent: '', innerHTML: '', className: '', dataset: {} as any,
    classList: { toggle() {}, add() {}, remove() {} }, querySelector() { return element() }, closest() { return element() } }
}
function harness(profile: string, extra: any = {}) {
  const user = { id: 'user-1', role: 'STAFF', staffProfile: profile, professionalId: profile === 'PROFESSIONAL' ? 'p1' : null, ...extra }
  const state: any = { currentUser: user, businessId: 'b1', business: {}, professionals: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Luis' }],
    cashRegister: { professionalPage: 1, professionalTotalPages: 1, permissions: {}, viewMode: 'day' } }
  const cashUi: any = Object.fromEntries(['viewDay', 'viewPeriod', 'viewProfessionals', 'viewTreasury', 'treasuryView', 'periodView', 'professionalView', 'professionalSummary', 'professionalPaymentPanel', 'professionalEntries', 'professionalPeriodFeedback', 'professionalPeriodLabel', 'professionalFilterField', 'professionalFilter'].map((key) => [key, element()]))
  const panels: any = { '.cash-professional-period': element(), '.cash-professional-movements': element(), '.cash-professional-heading': element() }
  const headings: any = { h3: element(), p: element() }
  panels['.cash-professional-heading'].querySelector = (selector: string) => headings[selector]
  cashUi.professionalView.querySelector = (selector: string) => panels[selector]
  const summaryPanel = element()
  cashUi.professionalSummary.closest = () => summaryPanel
  const todayPanel = element(), todayTable = element()
  const els: any = { appShell: { dataset: { section: 'settlements' } }, staffUserProfile: { value: profile }, staffProfessionalField: element(), staffUserProfessional: element(), staffUserForm: { querySelectorAll: () => [] }, staffPermissionsTitle: element(), staffPermissionsHelp: element(), staffSettlementsPermissionLabel: element(), staffCanViewProfessionalSettlements: element() }
  const document = { body: { dataset: { currentSection: 'settlements' } }, getElementById: (id: string) => id.endsWith('today-panel') ? todayPanel : todayTable }
  const calls: string[] = [], rendered: any[] = [], sources: any[] = []
  const context: any = vm.createContext({ state, cashUi, els, document, URLSearchParams, isWorkshopBusiness: () => false, isPipelineBusiness: () => false,
    professionalPeriodDates: () => ({ from: '2026-10-01', to: '2026-10-13' }), professionalPeriodLabel: () => 'Octubre',
    escapeHtml: (value: any) => String(value).replace(/</g, '&lt;'), cashMoney: (value: any) => '$' + value,
    ensureFinancialDateDefaults() {}, syncProfessionalPaymentSource() {}, renderCashCurrent() {}, loadCashPeriod: () => { throw new Error('Caja period forbidden') }, loadTreasury: () => { throw new Error('Treasury forbidden') }, loadTreasuryConsolidated: () => { throw new Error('Treasury forbidden') },
    renderProfessionalSettlements: (result: any) => rendered.push(result), renderProfessionalSettlementEntries: (result: any) => rendered.push(result),
    getJson: async (url: string) => { calls.push(url); assert.ok(url.startsWith('/professional-settlements/'), 'No Caja/configuration requests'); return { items: [{ id: 'p1', name: 'Ana', completedServices: 2, billedAmount: 50000 }], filterOptions: [{ id: 'p1', name: 'Ana', archivedAt: null }, { id: 'p2', name: 'Luis', archivedAt: null }, { id: 'p-old', name: 'Archivado', archivedAt: '2026-10-01' }], entries: [], date: '2026-10-13' } },
    window: { EventSource: true }, EventSource: class { constructor(url: string) { sources.push(url) } addEventListener() {} close() {} }
  })
  vm.runInContext(navFunctions + '\n' + cashFunctions, context)
  return { state, context, calls, cashUi, panels, headings, summaryPanel, todayPanel, todayTable, els, rendered, sources }
}
for (const profile of ['PROFESSIONAL', 'SECRETARY']) {
  const denied = harness(profile)
  assert.equal(denied.context.staffVisibleSections().includes('settlements'), false, 'Default off')
  await denied.context.loadStaffSettlements()
  assert.equal(denied.calls.length, 0, 'No requests without opt-in')
  const h = harness(profile, { canViewProfessionalSettlements: true })
  assert.equal(h.context.staffVisibleSections().includes('settlements'), true)
  assert.equal(h.context.staffVisibleSections().includes('cash'), false, 'Settlements does not enable Caja')
  assert.equal(h.context.staffSettlementsLabel(), profile === 'PROFESSIONAL' ? 'Mis liquidaciones' : 'Ver liquidaciones')
  await h.context.loadStaffSettlements()
  assert.equal(h.calls.length, 2)
  assert.equal(h.cashUi.professionalPaymentPanel.hidden, true, 'No payouts for staff')
  assert.equal(h.panels['.cash-professional-period'].hidden, false)
  assert.equal(h.panels['.cash-professional-movements'].hidden, false)
  assert.equal(h.todayPanel.hidden, true)
  assert.equal(h.cashUi.professionalFilterField.hidden, profile === 'PROFESSIONAL')
  h.context.syncStaffProfileFields()
  assert.equal(h.context.staffPermissionFields().canViewProfessionalSettlements, h.els.staffCanViewProfessionalSettlements)
  assert.match(h.els.staffSettlementsPermissionLabel.textContent, profile === 'PROFESSIONAL' ? /propias/ : /profesionales/)
  h.context.startCashRealtimeEvents()
  assert.equal(h.sources.length, 0, 'Opt-in alone cannot subscribe to unscoped Caja events')
  for (const mode of ['day', 'period', 'treasury']) {
    h.context.setCashView(mode)
    assert.equal(h.state.cashRegister.viewMode, 'professionals', 'Standalone view cannot switch to ' + mode)
  }
}
const own = harness('PROFESSIONAL', { canViewProfessionalSettlements: true })
own.cashUi.professionalFilter.value = 'p2'
await own.context.loadStaffSettlements()
for (const call of own.calls) assert.equal(new URL(call, 'https://example.invalid').searchParams.get('professionalId'), 'p1', 'Own filter ignores forged selection')
const secretary = harness('SECRETARY', { canViewProfessionalSettlements: true })
await secretary.context.loadStaffSettlements()
assert.match(secretary.cashUi.professionalFilter.innerHTML, /Archivado/)
assert.match(secretary.cashUi.professionalFilter.innerHTML, /Desvinculado/)
secretary.calls.length = 0
secretary.cashUi.professionalFilter.value = 'p2'
await secretary.context.loadStaffSettlements()
assert.match(secretary.cashUi.professionalFilter.innerHTML, /Todos los profesionales/)
assert.match(secretary.cashUi.professionalFilter.innerHTML, /Ana/)
assert.match(secretary.cashUi.professionalFilter.innerHTML, /Luis/)
for (const call of secretary.calls) {
  const params = new URL(call, 'https://example.invalid').searchParams
  assert.equal(params.get('professionalId'), 'p2')
  assert.equal(params.get('from'), '2026-10-01')
  assert.equal(params.get('to'), '2026-10-13')
}
secretary.cashUi.professionalFilter.value = 'p-old'
secretary.calls.length = 0
await secretary.context.loadStaffSettlements()
assert.equal(secretary.cashUi.professionalFilter.value, 'p-old', 'Archive choice survives filtered summary that contains only p1')
for (const call of secretary.calls) assert.equal(new URL(call, 'https://example.invalid').searchParams.get('professionalId'), 'p-old')
secretary.state.businessId = 'b2'
secretary.context.renderProfessionalSettlementFilter()
assert.equal(secretary.cashUi.professionalFilter.value, '')
assert.doesNotMatch(secretary.cashUi.professionalFilter.innerHTML, /Ana|Luis|Archivado/, 'Changing business clears cached options before requesting data')
await secretary.context.loadStaffSettlements()
secretary.state.currentUser.id = 'another-user'
secretary.context.renderProfessionalSettlementFilter()
assert.doesNotMatch(secretary.cashUi.professionalFilter.innerHTML, /Ana|Luis|Archivado/, 'Changing user also clears cached options')
const cashier = harness('SECRETARY', { canViewProfessionalSettlements: true, canViewCashRegister: true })
assert.equal(cashier.context.staffVisibleSections().includes('cash'), true, 'Independent legitimate Caja permission remains')
cashier.els.appShell.dataset.section = 'cash'
cashier.context.setCashView('day')
assert.equal(cashier.state.cashRegister.viewMode, 'day')
await cashier.context.loadProfessionalSettlements()
assert.equal(cashier.calls.length, 2, 'Caja shared view also uses full scoped opt-in')
const protectedPanel = harness('PROFESSIONAL', { canViewProfessionalSettlements: true, canManageProfessionalSettlements: true })
await protectedPanel.context.loadStaffSettlements()
assert.equal(protectedPanel.cashUi.professionalPaymentPanel.hidden, true, 'A stale privileged flag must not expose staff payout controls')
const today = harness('SECRETARY', { canViewTodayProfessionalProduction: true })
today.els.appShell.dataset.section = 'cash'
assert.equal(today.context.staffVisibleSections().includes('cash'), true)
await today.context.loadProfessionalSettlements()
assert.deepEqual(today.calls, ['/professional-settlements/today'])
assert.equal(today.panels['.cash-professional-period'].hidden, true)
assert.equal(today.summaryPanel.hidden, true)
assert.equal(today.cashUi.professionalPaymentPanel.hidden, true)
assert.match(today.todayTable.innerHTML, /Facturado/)
const race = harness('SECRETARY', { canViewProfessionalSettlements: true })
const pending: Array<(value: any) => void> = []
race.context.getJson = () => new Promise((resolve) => pending.push(resolve))
race.cashUi.professionalFilter.value = 'p1'
const first = race.context.loadProfessionalSettlements()
race.cashUi.professionalFilter.value = 'p2'
const second = race.context.loadProfessionalSettlements()
pending[2]({ marker: 'new', items: [] }); pending[3]({ marker: 'new', entries: [] })
await second
pending[0]({ marker: 'old', items: [] }); pending[1]({ marker: 'old', entries: [] })
await first
assert.deepEqual(race.rendered.map((result) => result.marker), ['new', 'new'], 'Late older filter must not overwrite current selection')
const switched = harness('PROFESSIONAL', { canViewProfessionalSettlements: true })
const oldScope: Array<(value: any) => void> = []
switched.context.getJson = () => new Promise((resolve) => oldScope.push(resolve))
const switching = switched.context.loadProfessionalSettlements()
switched.state.businessId = 'b2'
oldScope.forEach((resolve) => resolve({ items: [], entries: [] }))
await switching
assert.equal(switched.rendered.length, 0, 'Late response cannot populate another business')
assert.match(html, /data-mobile-section="settlements"/)
assert.match(html, /id="staff-can-view-professional-settlements"/)
assert.match(html, /loadStaffSettlements\(\)/)
assert.match(cashRegisterStyles, /data-section="settlements"/)
assert.match(cashRegisterStyles, /cash-settlement-filter/)
assert.match(cashRegisterStyles, /\.cash-settlement-filter\[hidden\]\s*\{\s*display:\s*none/)
console.log('Staff settlements UI: OK (opt-in, independent navigation, own scope, secretary filters, read-only, today fallback, no Caja SSE)')
