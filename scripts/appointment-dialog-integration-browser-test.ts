import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { renderCrmHtml } from '../src/routes/crm-ui.js'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/cpu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const summary = { appointmentId: 'a', appointmentIds: ['a'], pricingMode: 'FIXED', serviceSubtotal: 10000, productSubtotal: 0, originalTotal: 10000, agreedAmount: 10000, finalAmount: 10000, discountAmount: 0, paidAmount: 0, balanceAmount: 10000 }
const service = { id: 's', name: 'Corte', duration: 30, price: 10000, priceMode: 'FIXED', isActive: true }
const professional = { id: 'p', businessId: 'b', name: 'Profesional de prueba', isActive: true, services: [service] }
const customer = { id: 'c', name: 'Cliente de prueba', phone: '' }
const appointment = { id: 'a', businessId: 'b', customerId: 'c', customer, professionalId: 'p', professional, serviceId: 's', service, startAt: '2026-11-20T13:30:00-03:00', endAt: '2026-11-20T14:00:00-03:00', status: 'CONFIRMED', origin: 'CRM', financeSummary: summary }
let html = renderCrmHtml({ cashRegisterEnabled: true, pollingMarker: { effective: false, headerName: '', headerValue: '' } as any })
const bootStart = html.lastIndexOf('\n    loadSession()')
const bootEnd = html.indexOf('\n    }\n  </script>', bootStart)
assert.ok(bootStart > 0 && bootEnd > bootStart, 'only the authentication bootstrap is suppressed; controllers, listeners, markup and CSS stay real')
html = html.slice(0, bootStart) + '\n    window.appointmentQa = { state, openAppointmentDialog, closeAppointmentDialog, openAppointmentCheckout, submitAppointmentCheckout, hideAppointmentCheckout };\n' + html.slice(bootEnd)
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors: string[] = []
  const requests: { path: string, method: string }[] = []
  page.on('pageerror', (error: Error) => errors.push(error.message))
  await page.route('**/*', async (route: any) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== 'http://weex.test') return route.abort()
    if (url.pathname === '/crm') return route.fulfill({ contentType: 'text/html', body: html })
    requests.push({ path: url.pathname + url.search, method: request.method() })
    let body: unknown
    if (url.pathname.endsWith('/finance')) body = summary
    else if (url.pathname === '/cash-register/payment-methods') body = [{ id: 'cash', kind: 'CASH', name: 'Efectivo', isActive: true }, { id: 'bank', kind: 'TRANSFER', name: 'Banco', isActive: true }]
    else if (url.pathname === '/cash-register/payment-context') body = { day: { id: 'day' }, session: { id: 'session' } }
    else if (url.pathname.includes('/product-items')) body = { items: [], subtotal: 0 }
    else if (url.pathname.startsWith('/customers')) body = []
    else if (url.pathname.startsWith('/products')) body = []
    else return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected offline request: ' + url.pathname }) })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('http://weex.test/crm')
  assert.deepEqual(errors, [], 'the real CRM must initialize without JavaScript errors')
  await page.evaluate(({ appointment, professional, service, customer }: any) => {
    const qa = (window as any).appointmentQa
    Object.assign(qa.state, {
      businessId: 'b', business: { id: 'b', name: 'Negocio de prueba', timezone: 'America/Argentina/Buenos_Aires' },
      currentUser: { id: 'admin', role: 'BUSINESS_ADMIN' }, professionals: [professional], services: [service], customers: [customer],
      agendaAppointments: [appointment], appointments: [appointment], agendaSelectedDate: new Date('2026-11-20T13:30:00-03:00'),
    })
    document.body.dataset.auth = 'ready'
    qa.openAppointmentDialog({ professionalId: 'p', serviceId: 's' })
  }, { appointment, professional, service, customer })
  const box = page.locator('#appointment-dialog .appointment-dialog-card')
  assert.equal((await box.boundingBox())!.width, 600)
  assert.equal(await page.locator('#appointment-start').inputValue() !== '', true)
  assert.equal(await page.locator('#appointment-service').inputValue(), 's')
  assert.equal(requests.some(request => /payment-context|payment-methods/.test(request.path)), false, 'opening a new appointment must not preload financial endpoints')

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((appointment: any) => (window as any).appointmentQa.openAppointmentDialog({ appointment }), appointment)
    assert.equal((await box.boundingBox())!.width, width === 1440 ? 980 : width - 20)
    if (width < 700) {
      await page.locator('[data-appointment-tab="cliente"]').click()
      assert.equal(await page.locator('#appointment-panel-cliente').isVisible(), true)
      await page.locator('[data-appointment-tab="pago"]').click()
      assert.equal(await page.locator('#appointment-panel-pago').isVisible(), true)
    }
    const before = requests.length
    await page.evaluate(() => (window as any).appointmentQa.openAppointmentCheckout('total'))
    assert.equal(await page.locator('#appointment-checkout').isVisible(), true, 'the real checkout opens in ' + width)
    assert.equal((await page.locator('.ap-checkout-card').boundingBox())!.width, width === 1440 ? 410 : width - 28)
    assert.equal(await page.locator('#appointment-checkout-mixed').isVisible(), false, 'cash selection keeps mixed controls hidden')
    assert.equal(await page.locator('#appointment-checkout-methods .ap-radio').count(), 3, 'configured methods receive the reference visual style')
    assert.equal(await page.locator('#appointment-checkout-complete').isVisible(), true)
    await page.locator('input[name="appointment-checkout-method"][value="__MIXED__"]').check()
    assert.equal(await page.locator('#appointment-checkout-mixed').isVisible(), true)
    const checkbox = page.locator('#appointment-checkout-complete')
    const checkboxBox = (await checkbox.boundingBox())!
    assert.ok(checkboxBox.width < 25 && checkboxBox.height < 25, 'checkbox stays compact under real CRM CSS: ' + JSON.stringify(checkboxBox))
    assert.equal(await page.locator('#appointment-checkout').evaluate((element: HTMLElement) => element.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(requests.slice(before).filter(request => request.method !== 'GET').length, 0, 'opening checkout cannot record a payment')
    await page.locator('#appointment-checkout-cancel').click()
    assert.equal(await page.locator('#appointment-checkout').isVisible(), false)
  }
  assert.deepEqual(errors, [], 'no page errors through new/edit/mobile tabs and cash/mixed checkout')
  console.log('OK: full CRM markup/controllers/CSS offline at 1440/390/320; new/edit, tabs, real cash/mixed checkout and zero page errors.')
} finally {
  await browser.close()
}
