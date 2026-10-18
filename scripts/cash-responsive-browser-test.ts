import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { cashRegisterMarkup } from '../src/routes/crm-ui/cash-register.js'

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
    node('cash-entry-list').innerHTML = Array.from({ length: 30 }, (_, i) => `<div class="cash-entry" data-qa-row="day-${i}"><div class="cash-entry-main"><strong>${longName}</strong><span>Cobro de servicio ${i + 1}</span></div><span>Efectivo</span><span>17/10/2026</span><small>Responsable</small><strong class="cash-entry-amount">$ 44.000</strong><div class="cash-entry-actions cash-entry-action"><button class="secondary" type="button">Corregir fecha</button><button class="secondary" type="button">Corregir servicio</button></div></div>`).join('')
    node('cash-period-expense-list').innerHTML = Array.from({ length: 30 }, (_, i) => `<div class="cash-period-expense-row" data-qa-row="period-${i}"><div><strong>Gasto ${i + 1}</strong><p>${longName}</p></div><span>Efectivo</span><span>17/10/2026</span><strong>$ 5.000</strong></div>`).join('')
    node('cash-professional-summary').innerHTML = '<div class="cash-professional-summary-head"><span></span><strong>Profesional</strong><span>Servicios</span><span>Producción</span><span>Comisión</span><span>Pagos</span><strong>Saldo</strong></div>' + Array.from({ length: 20 }, (_, i) => `<div class="cash-professional-summary-row"><button type="button" class="cash-professional-toggle">+</button><strong>Profesional ${i + 1}</strong><span>20</span><span>$ 400.000</span><span>$ 200.000</span><span>$ 100.000</span><strong>$ 100.000</strong></div>`).join('')
    node('cash-professional-entries').innerHTML = Array.from({ length: 20 }, (_, i) => `<div class="cash-professional-movement-row" data-qa-row="professionals-${i}"><span>17/10/2026</span><strong>${longName}</strong><span>Servicio</span><span>Movimiento ${i + 1}</span><strong>$ 20.000</strong><span>Responsable</span></div>`).join('')
    node('cash-treasury-inactive').hidden = true
    node('cash-treasury-operations').hidden = false
    node('cash-treasury-history-panel').hidden = false
    node('cash-treasury-entries').innerHTML = Array.from({ length: 30 }, (_, i) => `<tr data-qa-row="treasury-${i}"><td>17/10/2026</td><td>Transferencia</td><td>Gasto ${i + 1}</td><td>Insumos</td><td>Proveedor del negocio</td><td>$ 5.000</td><td><button type="button">Corregir fecha</button></td></tr>`).join('')
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
    for (const mode of ['day', 'period', 'professionals', 'treasury']) {
      await view.evaluate((element: HTMLElement) => { element.scrollTop = 0 })
      await page.locator('#cash-view-' + mode).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, mode + ': sin scroll global accidental en ' + label)
      const offscreenControls = await page.locator('.cash-shell :is(input, select, textarea, button)').evaluateAll((elements: HTMLElement[]) => elements.filter(element => {
        if (!element.getClientRects().length || element.closest('.cash-view-switch, .cash-today-table-wrap, .cash-professional-table')) return false
        const rect = element.getBoundingClientRect()
        return rect.x < -1 || rect.right > innerWidth + 1
      }).map(element => element.id || element.className))
      assert.deepEqual(offscreenControls, [], mode + ': filtros y acciones dentro del ancho en ' + label)
      const clippedButtons = await page.locator('.cash-shell button').evaluateAll((elements: HTMLElement[]) => elements.filter(element => element.getClientRects().length && !element.closest('.cash-professional-table, .cash-today-table-wrap') && element.scrollWidth > element.clientWidth + 1).map(element => element.id || element.textContent))
      assert.deepEqual(clippedButtons, [], mode + ': los botones conservan el texto legible en ' + label)
      if (mode === 'day' && width <= 560) assert.ok((await page.locator('.cash-toolbar > label').boundingBox())!.height < 150, 'el selector de jornada no hereda una altura de columna excesiva en ' + label)
      const before = await view.evaluate((element: HTMLElement) => element.scrollTop)
      const region = await view.boundingBox()
      await page.mouse.move(region!.x + region!.width / 2, Math.min(height - 20, region!.y + region!.height / 2))
      await page.mouse.wheel(0, 2000)
      await page.waitForFunction((start: number) => document.getElementById('cash-register-view')!.scrollTop > start, before)
      await view.evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight })
      const rowIndex = mode === 'professionals' ? 19 : 29
      const last = await page.locator(`[data-qa-row="${mode}-${rowIndex}"]`).boundingBox()
      assert.ok(last && last.y >= -1 && last.y < height, mode + ': último registro alcanzable con scroll en ' + label)
      assert.ok(await view.evaluate((element: HTMLElement) => element.scrollHeight > element.clientHeight), mode + ': Caja conserva un área de scroll propia en ' + label)
      if (mode === 'professionals' || mode === 'treasury') {
        const table = page.locator(mode === 'professionals' ? '#cash-professional-entries' : '#cash-treasury-history-panel .cash-today-table-wrap')
        const overflow = await table.evaluate((element: HTMLElement) => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowX }))
        if (overflow.scroll > overflow.client + 1) {
          assert.ok(['auto', 'scroll'].includes(overflow.overflow), mode + ': tabla admite scroll horizontal en ' + label)
          await table.evaluate((element: HTMLElement) => { element.scrollLeft = element.scrollWidth })
          assert.ok(await table.evaluate((element: HTMLElement) => element.scrollLeft > 0), mode + ': últimas columnas accesibles en ' + label)
        }
      }
      if (output && [390, 768, 1440].includes(width)) {
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
