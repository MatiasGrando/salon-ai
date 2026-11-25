import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import {
  appointmentDialogStyles,
  appointmentDialogLayoutScript,
  appointmentCheckoutMarkup,
  renderAppointmentDialogMarkup,
} from '../src/routes/crm-ui/appointment-dialog.js'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/cpu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const screenshots = 'C:/Users/cpu/.codex/visualizations/2026/10/29/01a18814-9892-7d01-9ed2-a8e4aeac57bf/appointment-redesign'
await mkdir(screenshots, { recursive: true })
const reference = await readFile(new URL('./fixtures/weex-appointment-reference-v2.html', import.meta.url), 'utf8')
const finance = `<div class="ap-panel"><small>Saldo pendiente</small><div class="ap-money">$10.000</div><hr class="ap-divider"><div class="ap-summary">${[['Servicios', '$10.000'], ['Productos', '$0'], ['Descuento', '$0'], ['Ajuste', '$0'], ['Total', '$10.000'], ['Pagado', '$0']].map(([key, value]) => '<div><span>' + key + '</span><strong>' + value + '</strong></div>').join('')}</div><hr class="ap-divider"><div class="ap-quick"><button type="button" class="ap-btn ap-primary ap-full">Cobrar saldo</button><button type="button" class="ap-btn ap-full">Registrar seña</button><div class="ap-rightlinks"><button type="button" class="ap-btn ap-link">Aplicar descuento</button><span class="ap-muted">·</span><button type="button" class="ap-btn ap-link">Ajustar total</button></div></div></div>`
const create = `<details class="ap-panel" id="visual-initial-pay"><summary><span>Importe del turno<br><small style="font-weight:400">Sin pago registrado · Agregar seña o pago</small></span><span class="ap-money ap-money-small">$10.000</span></summary><label class="ap-field">Tipo<select><option>Sin pago</option></select></label></details>`
const products = '<div class="ap-panel"><div class="ap-row ap-between"><h4>Productos</h4><button class="ap-btn ap-link" type="button">+ Agregar</button></div><div class="ap-muted">No hay productos agregados</div></div>'
const markup = renderAppointmentDialogMarkup({ cashRegisterEnabled: true, financeCreateMarkup: create, financeEditMarkup: finance, productsMarkup: products })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await context.route('**/*', (route: any) => route.abort())
const page = await context.newPage()
const refPage = await context.newPage()
const captureCheckoutOnly = process.argv.includes('--capture-checkout-only')
const capture = async (name: string) => {
  if (!captureCheckoutOnly || name === 'checkout-mobile-390') await page.screenshot({ path: screenshots + '/' + name + '.png' })
}
try {
  await refPage.setContent(reference)
  await page.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><style>body{margin:0;background:#f5f7fa}.dialog{width:680px;padding:32px}.field{font-size:20px}.dialog-actions{justify-content:flex-end}${appointmentDialogStyles}</style></head><body><button id="launcher">Agenda</button>${markup}${appointmentCheckoutMarkup}<script>${appointmentDialogLayoutScript}</script></body></html>`)
  await page.evaluate(() => {
    document.getElementById('appointment-dialog')!.hidden = false
    for (const id of ['appointment-professional', 'appointment-add-service-professional']) document.getElementById(id)!.innerHTML = '<option>Profesional de prueba</option>'
    for (const id of ['appointment-service', 'appointment-add-service-service']) document.getElementById(id)!.innerHTML = '<option>Servicio de prueba</option>'
    ;(document.getElementById('appointment-start') as HTMLInputElement).value = '2026-11-24T13:30'
    ;(document.getElementById('appointment-customer-name') as HTMLInputElement).value = 'Cliente de prueba'
    document.getElementById('appointment-customer-name-display')!.textContent = 'Cliente de prueba'
    document.getElementById('appointment-customer-phone-display')!.textContent = '+54 9 11 1234 5678'
    document.getElementById('appointment-customer-avatar')!.textContent = 'C'
    document.getElementById('appointment-header-date')!.textContent = 'Martes 24 de noviembre · 13:30'
    document.getElementById('appointment-visit-services')!.hidden = false
    document.getElementById('appointment-visit-services-list')!.innerHTML = '<div class="appointment-visit-service"><div><strong>Servicio de prueba</strong><small>Profesional de prueba · 30 min</small></div><span>$10.000</span></div>'
    document.getElementById('appointment-customer-technical-profile')!.hidden = false
    document.getElementById('appointment-customer-technical-profile-display')!.textContent = 'Todavía no hay datos técnicos guardados.'
    ;(window as any).setAppointmentDialogMode('new')
  })
  const width = async (selector: string) => (await page.locator(selector).boundingBox())!.width
  assert.equal(await width('.appointment-dialog-card'), 600)
  const refNewWidth = (await refPage.locator('#new').boundingBox())!.width
  assert.equal(await width('.appointment-dialog-card'), refNewWidth)
  assert.equal(await page.locator('#appointment-start').getAttribute('type'), 'datetime-local')
  assert.equal(await page.locator('#appointment-primary-fields #appointment-service').count(), 1)
  assert.equal(await page.locator('#appointment-visit-services').isVisible(), false, 'a new appointment cannot present a fake coordinated visit cart')
  const newFooter = (await page.locator('.ap-foot').boundingBox())!
  const newActions = (await page.locator('.ap-save-actions').boundingBox())!
  assert.ok(Math.abs(newFooter.x + newFooter.width - newActions.x - newActions.width - 22) <= 1, 'new appointment actions align to the right as approved')
  await capture('new-desktop')

  await page.evaluate(() => {
    ;(window as any).setAppointmentDialogMode('edit')
    document.getElementById('appointment-dialog-title')!.textContent = 'Detalle del turno'
    document.getElementById('appointment-submit')!.textContent = 'Guardar cambios'
    document.getElementById('appointment-cancel')!.textContent = 'Cerrar'
    document.getElementById('appointment-mobile-balance')!.textContent = '$10.000'
  })
  await refPage.evaluate(() => (window as any).show('edit'))
  assert.equal(await width('.appointment-dialog-card'), 980)
  assert.equal(await page.locator('#appointment-service-edit-slot #appointment-service').count(), 1)
  assert.equal(await page.locator('#appointment-service').isVisible(), false, 'the service editor stays available in a compact disclosure')
  const columnWidths = await page.locator('.ap-columns').evaluate((node: Element) => getComputedStyle(node).gridTemplateColumns.split(' ').map(Number.parseFloat))
  const refColumnWidths = await refPage.locator('#edit .columns').evaluate((node: Element) => getComputedStyle(node).gridTemplateColumns.split(' ').map(Number.parseFloat))
  assert.deepEqual(columnWidths, refColumnWidths, 'desktop columns must match the approved reference')
  assert.equal(await page.locator('#appointment-start').evaluate((node: Element) => getComputedStyle(node).fontSize), '14px')
  assert.equal(await page.locator('#appointment-start').evaluate((node: Element) => getComputedStyle(node).borderRadius), '8px')
  assert.equal(await page.locator('#appointment-submit').evaluate((node: Element) => getComputedStyle(node).backgroundColor), 'rgb(37, 99, 235)')
  assert.equal(await page.locator('#appointment-customer-fields').isVisible(), false)
  await page.locator('#appointment-customer-edit').click()
  assert.equal(await page.locator('#appointment-customer-fields').isVisible(), true)
  await page.locator('#appointment-customer-edit').click()
  await capture('edit-desktop')

  for (const viewport of [390, 320]) {
    await page.setViewportSize({ width: viewport, height: 844 })
    await page.evaluate(() => (window as any).setAppointmentDialogTab('turno'))
    assert.equal(await width('.appointment-dialog-card'), viewport - 20)
    assert.equal(await page.locator('#appointment-panel-turno').isVisible(), true)
    assert.equal(await page.locator('#appointment-panel-cliente').isVisible(), false)
    await page.locator('[data-appointment-tab="cliente"]').click()
    assert.equal(await page.locator('#appointment-panel-cliente').isVisible(), true)
    assert.equal(await page.locator('#appointment-panel-turno').isVisible(), false)
    await page.locator('[data-appointment-tab="cliente"]').press('ArrowRight')
    assert.equal(await page.locator('#appointment-panel-pago').isVisible(), true)
    assert.equal(await page.locator('[data-appointment-tab="pago"]').getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('body').evaluate((node: Element) => node.scrollWidth <= innerWidth), true)
    const footer = (await page.locator('.ap-foot').boundingBox())!
    assert.ok(footer.y + footer.height <= 844, 'footer must remain in viewport')
    await capture('edit-mobile-' + viewport)
    await page.evaluate(() => {
      document.getElementById('appointment-checkout-methods')!.innerHTML = ['Efectivo', 'Transferencia', 'Tarjeta', 'Pago mixto'].map((label, index) => '<label class="ap-radio"><input type="radio" name="visual-method" ' + (index === 3 ? 'checked' : '') + '>' + label + '</label>').join('')
      document.getElementById('appointment-checkout-display')!.textContent = '$10.000'
      document.getElementById('appointment-checkout-subtitle')!.textContent = 'Servicio de prueba · Profesional de prueba'
      document.getElementById('appointment-checkout-complete-row')!.hidden = false
      document.getElementById('appointment-checkout-complete-note')!.textContent = 'Se registrará el cobro y se finalizará este turno en una sola operación.'
      document.getElementById('appointment-checkout-mixed-fields')!.innerHTML = ['Efectivo', 'Transferencia', 'Tarjeta'].map((label, index) => '<label class="ap-field">' + label + '<input type="number" value="' + [6000, 4000, 0][index] + '"></label>').join('')
      document.getElementById('appointment-checkout-mixed-note')!.textContent = 'Distribuido: $10.000 de $10.000'
      document.getElementById('appointment-checkout-mixed')!.hidden = false
      ;(window as any).showAppointmentCheckout()
    })
    assert.equal(await width('.ap-checkout-card'), viewport - 28)
    assert.equal(await page.locator('.ap-radio:has(input:checked)').textContent(), 'Pago mixto', 'a visible mixed grid must depict the selected mixed-payment method')
    assert.equal(await page.locator('#appointment-checkout-mixed-fields').evaluate((node: Element) => getComputedStyle(node).gridTemplateColumns.split(' ').length), viewport <= 380 ? 1 : 3)
    assert.equal(await page.locator('#appointment-checkout').evaluate((node: Element) => node.scrollWidth <= innerWidth), true)
    await capture('checkout-mobile-' + viewport)
    await page.evaluate(() => (window as any).hideAppointmentCheckout())
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.locator('#appointment-mobile-charge').evaluate((node: HTMLElement) => node.focus())
  await page.locator('#appointment-submit').focus()
  await page.evaluate(() => (window as any).showAppointmentCheckout())
  assert.equal(await width('.ap-checkout-card'), 410)
  await page.locator('#appointment-checkout-cancel').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'appointment-checkout-close')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'appointment-checkout-cancel')
  await page.evaluate(() => {
    ;(window as any).dismisses = []
    document.getElementById('appointment-checkout')!.addEventListener('appointment-checkout-dismiss-request', (event: Event) => {
      ;(window as any).dismisses.push((event as CustomEvent).detail.reason)
      event.preventDefault()
    })
  })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#appointment-checkout').isVisible(), true, 'controller must own dismissal while payment is pending or dirty')
  assert.deepEqual(await page.evaluate(() => (window as any).dismisses), ['escape'])
  await page.evaluate(() => (window as any).hideAppointmentCheckout())
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'appointment-submit')
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
  console.log('OK: reference widths, columns, colors, responsive tabs, overflow, checkout focus, cancellation and focus restoration verified in offline Chrome.')
} finally {
  await browser.close()
}
