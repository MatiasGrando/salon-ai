import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { STAFF_PRESET_DEFINITIONS } from '../src/services/staff-permission-service.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

// Production markup/styles/functions in an isolated browser; no server, data or network.
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const panel = html.slice(html.indexOf('<section class="settings-panel" id="staff-accounts-panel"'), html.indexOf('<details class="settings-panel settings-collapsible" data-settings-panel="assistant"'))
assert.equal((panel.match(/data-staff-permission-group=/g) || []).length, 8, 'eight real permission groups')
const main = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
assert.doesNotThrow(() => new Function(main), 'complete rendered CRM script parses')
const names = ['staffPermissionFields', 'renderStaffPresetOptions', 'renderStaffPresetDescription', 'applyStaffPreset', 'syncStaffProfileFields', 'markStaffPermissionsCustom', 'syncStaffPermissionOverview', 'normalizeStaffPermissionSearch', 'resetStaffUserForm', 'editStaffUser', 'saveStaffUser', 'clearStaffUserFeedback', 'showStaffUserFeedback']
const ast = ts.createSourceFile('crm.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const found = new Map<string, string>()
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
for (const name of names) assert.ok(found.has(name), name)
const elements = [...main.matchAll(/(\w+): document\.getElementById\('([^']+)'\)/g)].map(match => `${match[1]}:document.getElementById('${match[2]}')`).join(',')
const presets = Object.entries(STAFF_PRESET_DEFINITIONS).map(([id, preset]) => ({ id, ...preset }))
const bindings = main.slice(main.indexOf('els.staffUserForm?.addEventListener'), main.indexOf('els.staffUserList?.addEventListener'))
const { chromium } = await import(pathToFileURL('C:/Users/cpu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const directory = 'C:/Users/cpu/.codex/visualizations/2026/10/29/01a18814-9892-7d01-9ed2-a8e4aeac57bf/staff-permission-groups'
await mkdir(directory, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  await page.route('**/*', route => route.abort())
  await page.setContent(html.slice(0, html.indexOf('</head>') + 7) + '<body><main class="settings-shell staff-fixture">' + panel.replace('data-settings-panel="staff" hidden', 'data-settings-panel="staff"') + '</main><style>html,body{height:auto;overflow:auto}.staff-fixture .settings-panel{display:block}</style></body>')
  await page.addScriptTag({ content: `
    const els={${elements}};
    const state={businessId:'business-a',staffPresets:${JSON.stringify(presets)},staffUsers:[]};
    const activeProfessionals=()=>[{id:'professional-a',name:'Carolina'}];
    const escapeHtml=value=>String(value).replace(/</g,'&lt;');
    const setButtonLoading=()=>true;
    const renderStaffUsers=()=>{};
    const getJson=async(path,input)=>{window.savedStaff={path,payload:JSON.parse(input.body)};return []};
    ${names.map(name => found.get(name)).join('\n')}
    ${bindings}
    els.staffUserProfessional.innerHTML='<option value="professional-a">Carolina</option>';
    resetStaffUserForm();
  ` })
  const count = () => page.locator('#staff-permission-count').textContent()
  assert.equal(Math.round((await page.locator('#staff-accounts-panel').boundingBox())!.width), 764, 'actual settings shell width at desktop')
  assert.equal(await page.locator('.staff-access-layout').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1, 'summary stacks inside the constrained settings form')
  assert.equal(await page.locator('.staff-template').evaluate(node => getComputedStyle(node).backgroundImage), 'none', 'CRM panels use a flat background')
  assert.equal(await count(), '4 de 9 activos', 'Professional default and applicable count')
  assert.equal(await page.locator('[data-staff-permission-group]:visible').count(), 4)
  await page.selectOption('#staff-user-profile', 'SECRETARY')
  assert.equal(await page.locator('[data-staff-permission-group]:visible').count(), 8)
  assert.match(await count() || '', /de 27 activos/)
  assert.equal(await page.locator('#staff-professional-field').isVisible(), false)
  await page.selectOption('#staff-user-preset', 'SECRETARY_CASHIER')
  assert.equal(await count(), '23 de 27 activos', 'real preset, no mock totals')
  await page.locator('[data-staff-permission-group="cash"] summary').click()
  await page.uncheck('#staff-can-adjust-cash')
  assert.equal(await count(), '22 de 27 activos')
  assert.equal(await page.inputValue('#staff-user-preset'), 'CUSTOM')
  await page.fill('#staff-permission-search', 'ajustar')
  assert.equal(await page.locator('[data-staff-permission-group]:visible').count(), 1)
  assert.equal(await page.locator('.staff-permission-grid label:visible').count(), 1)
  assert.equal(await page.locator('[data-staff-permission-group="cash"] [data-staff-group-count]').textContent(), '0 de 1')
  await page.fill('#staff-permission-search', 'SEÑAS')
  assert.equal(await page.locator('.staff-permission-grid label:visible').count(), 3, 'search handles accents and case')
  await page.fill('#staff-permission-search', 'sin coincidencias')
  assert.equal(await page.locator('#staff-permission-empty').isVisible(), true)
  await page.fill('#staff-permission-search', '')
  await page.locator('[data-staff-permission-group="cash"]').evaluate((node: HTMLDetailsElement) => { node.open = false })
  await page.fill('#staff-user-name', 'Caroline')
  await page.fill('#staff-user-email', 'caroline@example.com')
  await page.screenshot({ path: directory + '/secretary-desktop.png', fullPage: true })
  await page.evaluate(() => {
    const w = window as any
    w.editStaffUserForTest = () => eval(`state.staffUsers=[{id:'staff-a',name:'Caroline',email:'caroline@example.com',staffProfile:'PROFESSIONAL',permissionPreset:'CUSTOM',professionalId:'professional-a',isActive:true,canCreateAppointments:true,canCreateCustomers:true,canViewProfessionalSettlements:true}];editStaffUser('staff-a')`)
    w.editStaffUserForTest()
  })
  assert.equal(await count(), '3 de 9 activos', 'edit hydrates saved controls and totals')
  assert.equal(await page.inputValue('#staff-user-professional'), 'professional-a')
  assert.equal(await page.isChecked('#staff-can-create-customers'), true)
  assert.equal(await page.isChecked('#staff-can-view-customers'), false)
  await page.locator('[data-staff-permission-group="customers"]').evaluate((node: HTMLDetailsElement) => { node.open = true })
  await page.locator('#staff-user-submit').click()
  const saved = await page.evaluate(() => (window as any).savedStaff)
  assert.equal(saved.path, '/staff-users/staff-a')
  assert.equal(saved.payload.canCreateCustomers, true)
  assert.equal(saved.payload.canViewCustomers, false)
  assert.equal(saved.payload.canViewProfessionalSettlements, true)
  assert.equal(saved.payload.professionalId, 'professional-a')
  await page.evaluate(() => (window as any).editStaffUserForTest())
  assert.equal(await count(), '3 de 9 activos', 'reopen restores edit state')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok((await page.locator('[data-staff-permission-group="professionals"] .staff-permission-group-title strong').boundingBox())!.height < 22, 'professional group title fits on mobile')
  await page.screenshot({ path: directory + '/professional-mobile.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow')
  assert.equal(await page.locator('.staff-permission-grid label:visible').evaluateAll(labels => labels.every(label => {
    const bounds = label.getBoundingClientRect()
    return [...label.querySelectorAll('input, strong, small')].every(child => {
      const box = child.getBoundingClientRect()
      return box.left >= bounds.left && box.right <= bounds.right
    })
  })), true, 'checkboxes and permission text remain inside their rows on mobile')
  for (const selector of ['#staff-user-name', '#staff-permission-search', '[data-staff-permission-group="agenda"]', '.staff-access-summary', '#staff-user-submit']) {
    const box = await page.locator(selector).boundingBox()
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, selector + ' remains in viewport')
  }
  console.log('Staff permission groups: profiles, 9/27 counts, presets, filtering, edits, save, reopen and mobile OK')
  console.log('Screenshots: ' + directory)
} finally { await browser.close() }
