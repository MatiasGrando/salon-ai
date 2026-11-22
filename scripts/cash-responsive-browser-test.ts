import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { cashRegisterMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

const dayMarkup = cashRegisterMarkup.slice(cashRegisterMarkup.indexOf('id="cash-dashboard"'))
const summaryCards = [...dayMarkup.matchAll(/class="cash-summary-card cash-day-card--(\w+)"/g)].map(match => match[1])
assert.deepEqual(summaryCards, ['collected', 'outgoing', 'total', 'expected'], 'Caja actual distingue sus cuatro indicadores')
assert.match(cashRegisterScript, /<table class="cash-day-table cash-movements-table"[\s\S]*?<th scope="col">Concepto<\/th>[\s\S]*?<th scope="col">Acciones<\/th>/)
assert.match(cashRegisterScript, /<table class="cash-day-table cash-sessions-table"[\s\S]*?<th scope="col">Responsable<\/th>[\s\S]*?<th scope="col">Diferencia<\/th>/)

function cashFunction(name: string) {
  const start = cashRegisterScript.search(new RegExp('    (?:async )?function ' + name + '\\('))
  assert.notEqual(start, -1)
  return cashRegisterScript.slice(start, cashRegisterScript.indexOf('\n    }', start) + 6)
}

const dayFixture = `
  const node = id => document.getElementById(id);
  const cashUi = { entryList: node('cash-entry-list'), nextPage: node('cash-next-page'),
    sessionCount: node('cash-session-count'), sessionFilter: node('cash-session-filter'), sessionList: node('cash-session-list') };
  const cashMoney = amount => '$ ' + amount.toLocaleString('es-AR');
  const cashSignedMoney = amount => (amount < 0 ? '− ' : '+ ') + cashMoney(Math.abs(amount));
  const cashDate = () => '17/10/26, 10:34 p. m.';
  const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const cashTypeLabels = { PAYMENT: 'Cobro', REFUND: 'Devolución' };
  const cashMethodLabels = { CASH: 'Efectivo', TRANSFER: 'Transferencia / Mercado Pago' };
  const canCorrectCashEntryService = entry => entry.type === 'PAYMENT' && state.currentUser.role !== 'STAFF';
  const entries = Array.from({ length: 30 }, (_, i) => ({
    id: 'movement-' + i, description: 'Cliente con nombre largo <Medina Sin Espacio> ' + i,
    type: i % 2 ? 'REFUND' : 'PAYMENT', direction: i % 2 ? 'OUTFLOW' : 'INFLOW',
    method: i % 2 ? 'TRANSFER' : 'CASH', amount: 44000 + i, origin: 'AGENDA'
  }));
  const state = { currentUser: { role: 'BUSINESS_ADMIN' }, cashRegister: { entries, nextCursor: null } };
  ${cashFunction('renderCashSessions')}
  ${cashFunction('renderCashEntries')}
  renderCashSessions([{ id: 'active-session', responsibleName: 'Matías Grando', openedAt: 1 },
    { id: 'closed-session', responsibleName: 'Responsable de cierre', openedAt: 1, closedAt: 2, expectedCash: 91000, countedCash: 90000, cashDifference: -1000 }], 482000);
  renderCashEntries();
`
const nodes = new Map<string, { innerHTML: string; textContent: string; hidden: boolean; value: string; disabled: boolean }>()
const context = vm.createContext({ URLSearchParams, document: { getElementById(id: string) {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, value: '', disabled: false })
  return nodes.get(id)
} } })
vm.runInContext(dayFixture, context)
assert.match(nodes.get('cash-session-list')!.innerHTML, /<tbody><tr[\s\S]*Matías Grando[\s\S]*>Activa<\/[\s\S]*>Cerrada<\//)
assert.match(nodes.get('cash-entry-list')!.innerHTML, /<tbody><tr[\s\S]*&lt;Medina Sin Espacio>[\s\S]*data-cash-correct-date="movement-0"[\s\S]*data-cash-correct-service="movement-0"/)
assert.match(nodes.get('cash-entry-list')!.innerHTML, /class="cash-entry-amount outflow">− /)
vm.runInContext("state.currentUser.role = 'STAFF'; renderCashEntries()", context)
assert.doesNotMatch(nodes.get('cash-entry-list')!.innerHTML, /data-cash-correct-/)
console.log('OK Caja actual: indicadores, tablas, datos escapados y acciones según el rol')

const periodFields = ['From', 'To', 'Feedback', 'Gross', 'Cash', 'Transfer', 'Card', 'UnknownCollected', 'UnknownCollectedRow', 'UnknownOutgoing', 'UnknownOutgoingRow', 'UnknownTotal', 'UnknownTotalRow', 'Refunds', 'ExpensesTotal', 'OutgoingCash', 'OutgoingTransfer', 'OutgoingCard', 'Result', 'TotalCash', 'TotalTransfer', 'TotalCard', 'Withdrawals', 'Adjustments', 'CategoryList', 'CategoryFilter', 'SubcategoryFilter', 'MethodFilter', 'Search', 'PageSize', 'ExpenseList', 'ExpenseCount', 'PageInfo', 'Previous', 'Next']
const financeFixture = `(async () => {
  const node = id => document.getElementById(id);
  const cashUi = Object.fromEntries(${JSON.stringify(periodFields)}.map(field => ['period' + field, node('cash-period-' + field.replace(/[A-Z]/g, (letter, i) => (i ? '-' : '') + letter.toLowerCase()))]));
  const cashMoney = amount => '$ ' + Number(amount || 0).toLocaleString('es-AR');
  const cashSignedMoney = amount => (amount < 0 ? '− ' : '+ ') + cashMoney(Math.abs(amount));
  const cashDate = () => '17/10/26, 10:34 p. m.';
  const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const cashMethodLabels = { CASH: 'Efectivo', TRANSFER: 'Transferencia / Mercado Pago' };
  const cashScoped = url => url;
  const isCashBusinessScopedRole = () => true;
  const state = { businessId: 'shop', currentUser: { role: 'BUSINESS_ADMIN' }, cashRegister: {} };
  const requests = [];
  const periodEntries = Array.from({ length: 30 }, (_, i) => ({ id: 'period-' + i, type: i % 2 ? 'REVERSAL' : 'EXPENSE', amount: 5000 + i, method: i % 2 ? 'TRANSFER' : 'CASH', description: 'Insumos <especiales> ' + i, expenseCategoryName: 'Productos', expenseSubcategoryName: 'Coloración', effectiveAt: 1 }));
  const movements = Array.from({ length: 20 }, (_, i) => ({ id: 'treasury-' + i, kind: i === 0 ? 'DAILY_TRANSFER' : i % 2 ? 'EXPENSE' : 'INCOME', direction: i % 2 ? 'OUTFLOW' : 'INFLOW', amount: 5000 + i, accountName: 'Cuenta del negocio', description: 'Detalle <especial> ' + i, effectiveAt: 1, createdAt: 2, expenseCategoryName: 'Productos', expenseSubcategoryName: 'Coloración', counterparty: 'Proveedor', correctionRole: i === 2 ? 'REVERSAL' : undefined, dateCorrected: i === 3, correctionReason: i === 2 ? 'Fecha <ajustada>' : '' }));
  const accounts = [{ id: 'cash', kind: 'CASH', name: 'Efectivo', balance: 85000, isActive: true }, { id: 'bank', kind: 'TRANSFER', name: 'Banco <principal>', balance: 42000, isActive: true }, { id: 'card', kind: 'CARD', name: 'Posnet', balance: 0, isActive: false }];
  const summary = { grossCollected: 153000, expenses: 20000, refunds: 5000, operatingResult: 128000, withdrawals: 3000, adjustments: -1000, collectedByMethod: { CASH: 100000, TRANSFER: 50000 }, outgoingByMethod: { CASH: 20000, TRANSFER: 5000 }, expenseByCategory: [{ name: 'Productos', amount: 20000 }] };
  const getJson = async url => {
    requests.push(url);
    if (url.startsWith('/cash-register/period/summary')) return { summary };
    if (url.startsWith('/cash-register/period/expenses')) return { entries: periodEntries, page: 2, totalPages: 2, total: 80 };
    if (url.startsWith('/treasury/consolidated')) return { summary: { collected: 160000, outgoing: 30000, total: 130000, outgoingCash: 25000, outgoingTreasury: 5000, incomingTreasury: 7000, collectedByMethod: summary.collectedByMethod, outgoingByMethod: summary.outgoingByMethod, totalByMethod: { CASH: 80000, TRANSFER: 45000 } } };
    return { accounts, counterparties: [{ id: 'supplier', name: 'Proveedor', isActive: true }], movements, page: 2, pageSize: 20, total: 61, totalPages: 4 };
  };
  cashUi.periodFrom.value = node('cash-treasury-period-from').value = '2026-10-01';
  cashUi.periodTo.value = node('cash-treasury-period-to').value = '2026-10-31';
  cashUi.periodPageSize.value = '50';
  cashUi.periodCategoryFilter.value = node('cash-treasury-filter-category').value = 'products';
  cashUi.periodSubcategoryFilter.value = node('cash-treasury-filter-subcategory').value = 'color';
  cashUi.periodMethodFilter.value = 'CASH';
  cashUi.periodSearch.value = node('cash-treasury-filter-search').value = 'insumos';
  node('cash-treasury-filter-kind').value = 'EXPENSE';
  ${cashFunction('validateCashPeriodDates')}
  ${cashFunction('renderCashPeriodSummary')}
  ${cashFunction('renderCashPeriodExpenses')}
  ${cashFunction('loadCashPeriod')}
  ${cashFunction('loadTreasury')}
  ${cashFunction('loadTreasuryConsolidated')}
  await loadCashPeriod({ page: 2 });
  await loadTreasury({ page: 2 });
  await loadTreasuryConsolidated();
  globalThis.financeRequests = requests;
})()`
await vm.runInContext(financeFixture, context)
const periodHtml = nodes.get('cash-period-expense-list')!.innerHTML
const treasuryHtml = nodes.get('cash-treasury-entries')!.innerHTML
assert.match(periodHtml, /<table[\s\S]*?<th scope="col">Fecha<\/th>[\s\S]*?<th scope="col">Importe<\/th>/, 'Historial conserva fechas y todos los campos en una tabla operativa')
assert.match(periodHtml, /&lt;especiales>[\s\S]*Coloración/)
assert.match(periodHtml, /cash-entry-amount inflow/)
assert.equal(nodes.get('cash-period-gross')!.textContent, '$ 153.000')
assert.equal(nodes.get('cash-period-expenses-total')!.textContent, '$ 25.000')
assert.equal(nodes.get('cash-period-result')!.textContent, '$ 128.000')
assert.equal(nodes.get('cash-period-withdrawals')!.textContent, '$ 3.000')
assert.equal(nodes.get('cash-period-adjustments')!.textContent, '− $ 1.000')
assert.equal(nodes.get('cash-period-unknown-collected-row')!.hidden, false)
assert.equal(nodes.get('cash-period-next')!.disabled, true)
assert.equal(nodes.get('cash-period-previous')!.disabled, false)
assert.match(nodes.get('cash-treasury-account-grid')!.innerHTML, /cash-icon[\s\S]*Banco &lt;principal>[\s\S]*Inactivo/, 'Cuentas conserva iconos, nombre escapado y estado')
assert.match(treasuryHtml, /cash-entry-chip[\s\S]*Traspaso interno/)
assert.match(treasuryHtml, /cash-entry-amount outflow/)
assert.match(treasuryHtml, /Registrado:[\s\S]*Fecha &lt;ajustada>/)
assert.match(treasuryHtml, /data-treasury-correct-date="treasury-1"/)
assert.doesNotMatch(treasuryHtml, /data-treasury-correct-date="treasury-[023]"/)
assert.equal(nodes.get('cash-treasury-consolidated-total')!.textContent, '$ 130.000')
assert.match(nodes.get('cash-treasury-page-info')!.textContent, /21–40 de 61/)
assert.equal(nodes.get('cash-treasury-next')!.disabled, false)
const financeRequests = vm.runInContext('financeRequests', context) as string[]
const periodQuery = new URL(financeRequests.find(url => url.startsWith('/cash-register/period/expenses'))!, 'http://local').searchParams
for (const [key, value] of Object.entries({ businessId: 'shop', page: '2', pageSize: '50', categoryId: 'products', subcategoryId: 'color', method: 'CASH', q: 'insumos' })) assert.equal(periodQuery.get(key), value)
const treasuryQuery = new URL(financeRequests.find(url => url.startsWith('/treasury?'))!, 'http://local').searchParams
for (const [key, value] of Object.entries({ page: '2', kind: 'EXPENSE', search: 'insumos', expenseCategoryId: 'products', expenseSubcategoryId: 'color' })) assert.equal(treasuryQuery.get(key), value)
console.log('OK Historial y Tesorería: render real, cálculos, filtros, paginación, datos escapados y correcciones')

if (process.argv.includes('--contract-only')) process.exit(0)

const modulePath = process.env.CRM_QA_BROWSER_MODULE
assert.ok(modulePath, 'Definí CRM_QA_BROWSER_MODULE con el módulo Playwright disponible para ejecutar la regresión visual.')
const { chromium } = await import(pathToFileURL(modulePath).href)
const browser = await chromium.launch({ headless: true, ...(process.env.CRM_QA_BROWSER_CHANNEL ? { channel: process.env.CRM_QA_BROWSER_CHANNEL } : {}) })
const output = process.env.CRM_QA_OUTPUT_DIR
const sizes = [[320, 568], [390, 844], [768, 640], [900, 700], [1024, 600], [1440, 900]] as const

try {
  const page = await browser.newPage()
  await page.route('**/*', (route: any) => route.abort())
  const rendered = renderCrmHtml({ cashRegisterEnabled: true, pollingMarker: { effective: false, headerName: '', headerValue: '' } as any })
  const style = rendered.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  assert.ok(style, 'Se usan los estilos completos reales del CRM, incluidas las reglas de navegación móvil.')
  await page.setContent(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}</style><body data-auth="ready" data-current-section="cash"><header class="mobile-nav"><strong>Caja</strong></header><main class="app" data-section="cash"><nav class="workspace-nav"><div class="workspace-nav-menu">${Array.from({ length: 13 }, (_, i) => `<button type="button">Sección ${i + 1}</button>`).join('')}</div></nav>${cashRegisterMarkup}</main></body></html>`)
  await page.evaluate('globalThis.__name = value => value')
  await page.evaluate(() => {
    const node = (id: string) => document.getElementById(id)!
    const longName = 'Cliente con nombre extenso para verificar el ancho de la sección'
    node('cash-view-treasury').hidden = false
    node('cash-category-shortcut').hidden = false
    node('cash-day-select').innerHTML = '<option>17/10/2026 · Jornada abierta · Responsable del negocio</option>'
    node('cash-status').textContent = 'Caja abierta'
    for (const select of document.querySelectorAll<HTMLSelectElement>('.cash-shell select')) {
      if (!select.options.length) select.innerHTML = '<option>Profesional y medio de pago del negocio</option>'
    }
    node('cash-responsible').textContent = 'Matías Grando'
    node('cash-session-time').textContent = 'Desde 24/9/26, 10:34 p. m.'
    node('cash-gross').textContent = '$ 506.000'
    node('cash-method-cash').textContent = '$ 496.000'
    node('cash-method-transfer').textContent = '$ 10.000'
    node('cash-outgoing').textContent = '$ 64.000'
    node('cash-net').textContent = '$ 442.000'
    node('cash-expected').textContent = '$ 482.000'
    node('cash-status').classList.add('open')
    node('cash-professional-summary').innerHTML = '<div class="cash-professional-summary-head"><span></span><strong>Profesional</strong><span>Servicios</span><span>Producción</span><span>Comisión</span><span>Pagos</span><strong>Saldo</strong></div>' + Array.from({ length: 20 }, (_, i) => `<div class="cash-professional-summary-row"><button type="button" class="cash-professional-toggle">+</button><strong>Profesional ${i + 1}</strong><span>20</span><span>$ 400.000</span><span>$ 200.000</span><span>$ 100.000</span><strong>$ 100.000</strong></div>`).join('')
    node('cash-professional-entries').innerHTML = Array.from({ length: 20 }, (_, i) => `<div class="cash-professional-movement-row" data-qa-row="professionals-${i}"><span>17/10/2026</span><strong>${longName}</strong><span>Servicio</span><span>Movimiento ${i + 1}</span><strong>$ 20.000</strong><span>Responsable</span></div>`).join('')
    node('cash-treasury-inactive').hidden = true
    node('cash-treasury-operations').hidden = false
    node('cash-treasury-history-panel').hidden = false
    const modes = ['day', 'period', 'professionals', 'treasury']
    const activate = (mode: string) => {
      node('cash-dashboard').hidden = mode !== 'day'
      node('cash-empty-state').hidden = true
      node('cash-period-view').hidden = mode !== 'period'
      node('cash-professional-view').hidden = mode !== 'professionals'
      node('cash-treasury-view').hidden = mode !== 'treasury'
      for (const candidate of modes) node('cash-view-' + candidate).classList.toggle('active', candidate === mode)
    }
    for (const mode of modes) node('cash-view-' + mode).addEventListener('click', () => activate(mode))
    activate('day')
  })
  await page.addScriptTag({ content: dayFixture + "document.querySelectorAll('.cash-entry').forEach((row, i) => row.dataset.qaRow = 'day-' + i)" })
  await page.evaluate(financeFixture)
  await page.evaluate(() => {
    for (const [id, prefix] of [['cash-period-expense-list', 'period'], ['cash-treasury-entries', 'treasury']]) {
      document.getElementById(id)!.querySelectorAll(id === 'cash-treasury-entries' ? 'tr' : 'tbody tr').forEach((row, i) => (row as HTMLElement).dataset.qaRow = prefix + '-' + i)
    }
  })
  if (output) await mkdir(output, { recursive: true })
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    const label = `${width}x${height}`
    const view = page.locator('#cash-register-view')
    await view.evaluate((element: HTMLElement) => { element.scrollTop = 0 })
    const bounds = await view.boundingBox()
    assert.ok(bounds && bounds.y >= 0 && bounds.y < height && bounds.y + bounds.height <= height + 1, `Caja debe tener una altura desplazable dentro del viewport en ${label}; recibido ${JSON.stringify(bounds)}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'sin desborde horizontal de la página en ' + label)
    const tabs = page.locator('.cash-view-switch')
    const tabBounds = await tabs.boundingBox()
    assert.ok(tabBounds && tabBounds.x >= 0 && tabBounds.x + tabBounds.width <= width + 1, 'pestañas contenidas en ' + label)
    await page.locator('#cash-view-treasury').focus()
    const focused = await page.locator('#cash-view-treasury').boundingBox()
    assert.ok(focused && focused.x >= tabBounds.x - 1 && focused.x + focused.width <= tabBounds.x + tabBounds.width + 1, 'el foco desplaza y revela la última pestaña en ' + label)
    let sharedChrome: Record<string, unknown> | undefined
    for (const mode of ['day', 'period', 'professionals', 'treasury']) {
      await view.evaluate((element: HTMLElement) => { element.scrollTop = 0 })
      await page.locator('#cash-view-' + mode).click()
      const chrome = await page.evaluate(() => {
        const shell = document.querySelector('.cash-shell') as HTMLElement
        const title = document.querySelector('.cash-header h2') as HTMLElement
        const icon = document.querySelector('.cash-header .cash-day-icon') as HTMLElement
        const tabIcons = Array.from(document.querySelectorAll('.cash-view-switch .cash-day-only-icon')).filter(element => element.getClientRects().length)
        return { width: shell.getBoundingClientRect().width, titleSize: getComputedStyle(title).fontSize, headerIcon: icon.getBoundingClientRect().width, tabIcons: tabIcons.length }
      })
      assert.ok(chrome.headerIcon > 0, mode + ': el icono del encabezado permanece visible en ' + label)
      assert.equal(chrome.tabIcons, 4, mode + ': las cuatro pestañas conservan sus iconos en ' + label)
      if (!sharedChrome) sharedChrome = chrome
      else assert.deepEqual(chrome, sharedChrome, mode + ': Caja conserva ancho, tipografía e iconos al cambiar de pestaña en ' + label)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, mode + ': sin scroll global accidental en ' + label)
      const offscreenControls = await page.locator('.cash-shell :is(input, select, textarea, button)').evaluateAll((elements: HTMLElement[]) => elements.filter(element => {
        if (!element.getClientRects().length || element.closest('.cash-view-switch, .cash-today-table-wrap, .cash-professional-table, .cash-table-scroll')) return false
        const rect = element.getBoundingClientRect()
        return rect.x < -1 || rect.right > innerWidth + 1
      }).map(element => element.id || element.className))
      assert.deepEqual(offscreenControls, [], mode + ': filtros y acciones dentro del ancho en ' + label)
      const clippedButtons = await page.locator('.cash-shell button').evaluateAll((elements: HTMLElement[]) => elements.filter(element => element.getClientRects().length && !element.closest('.cash-professional-table, .cash-today-table-wrap') && element.scrollWidth > element.clientWidth + 1).map(element => element.id || element.textContent))
      assert.deepEqual(clippedButtons, [], mode + ': los botones conservan el texto legible en ' + label)
      if (mode === 'day') {
        if (width <= 560) assert.ok((await page.locator('.cash-toolbar > label').boundingBox())!.height < 150, 'el selector de jornada no hereda una altura de columna excesiva en ' + label)
        const metricView = mode === 'day' ? '#cash-dashboard' : mode === 'period' ? '#cash-period-view' : '#cash-treasury-view'
        const wrappedAmounts = await page.locator(metricView + ' .cash-summary-card strong').evaluateAll((amounts: HTMLElement[]) => amounts.filter(amount => {
          if (!amount.getClientRects().length) return false
          const range = document.createRange()
          range.selectNodeContents(amount)
          return range.getClientRects().length > 1 || amount.scrollWidth > amount.clientWidth + 1
        }).map(amount => amount.id))
        assert.deepEqual(wrappedAmounts, [], 'los importes no se parten en ' + label)
      }
      const before = await view.evaluate((element: HTMLElement) => element.scrollTop)
      const region = await view.boundingBox()
      await page.mouse.move(region!.x + region!.width / 2, Math.min(height - 20, region!.y + region!.height / 2))
      await page.mouse.wheel(0, 2000)
      await page.waitForFunction((start: number) => document.getElementById('cash-register-view')!.scrollTop > start, before)
      await view.evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight })
      const rowIndex = ['professionals', 'treasury'].includes(mode) ? 19 : 29
      const last = await page.locator(`[data-qa-row="${mode}-${rowIndex}"]`).boundingBox()
      assert.ok(last && last.y >= -1 && last.y < height, mode + ': último registro alcanzable con scroll en ' + label)
      assert.ok(await view.evaluate((element: HTMLElement) => element.scrollHeight > element.clientHeight), mode + ': Caja conserva un área de scroll propia en ' + label)
      {
        const table = page.locator(mode === 'day' ? '#cash-entry-list .cash-table-scroll' : mode === 'professionals' ? '#cash-professional-entries' : mode === 'period' ? '#cash-period-expense-list .cash-table-scroll' : '#cash-treasury-history-panel .cash-today-table-wrap')
        const overflow = await table.evaluate((element: HTMLElement) => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowX }))
        if (overflow.scroll > overflow.client + 1) {
          assert.ok(['auto', 'scroll'].includes(overflow.overflow), mode + ': tabla admite scroll horizontal en ' + label)
          await table.evaluate((element: HTMLElement) => { element.scrollLeft = element.scrollWidth })
          assert.ok(await table.evaluate((element: HTMLElement) => element.scrollLeft > 0), mode + ': últimas columnas accesibles en ' + label)
        }
      }
      if (output && [390, 1440].includes(width) && ['period', 'treasury'].includes(mode)) {
        await view.evaluate((element: HTMLElement) => { element.scrollTop = 0 })
        await page.screenshot({ path: join(output, `caja-${mode}-${label}.png`) })
      }
    }
    console.log('OK Caja adaptable: cuatro pestañas, scroll vertical, tablas y filtros en ' + label)
  }
  await page.evaluate(() => {
    document.body.dataset.currentSection = 'settlements'
    document.querySelector<HTMLElement>('.app')!.dataset.section = 'settlements'
    document.getElementById('cash-professional-view')!.hidden = false
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const settlements = await page.locator('#cash-register-view').boundingBox()
  assert.ok(settlements && settlements.y >= 0 && settlements.y + settlements.height <= 845, 'Liquidaciones independiente conserva el scroll móvil')
  console.log('OK Liquidaciones: altura disponible sin recorte en acceso independiente')
} finally {
  await browser.close()
}
