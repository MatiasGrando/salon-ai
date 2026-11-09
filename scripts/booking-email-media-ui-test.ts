import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'
import { renderBookingConfirmationEmail } from '../src/services/booking-confirmation-email-service.js'

const markup = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
assert.ok(markup.includes('id="booking-email-media"'), 'the Landing settings must expose the email image editor')
assert.ok(/id="booking-email-media-feedback"[^>]*aria-live="polite"/.test(markup))
assert.ok(/booking-email-media[^<]{0,80}Guardar im&aacute;genes del correo/.test(markup))

const browserModule = process.env.CRM_QA_BROWSER_MODULE
if (!browserModule) {
  console.log('OK editor en CRM. Prueba de navegador omitida: falta CRM_QA_BROWSER_MODULE.')
} else {
  const { chromium } = await import(pathToFileURL(browserModule).href)
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CRM_QA_BROWSER_EXECUTABLE,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']
  })
  const origin = 'https://booking-email-fixture.invalid'
  const assets = process.env.CRM_QA_LA_COCHERA_ASSETS
  const paths = ['hero-owner.jpg', 'logo.png', 'servicios/corte-principal.png', 'servicios/corte-secundario.png', 'servicios/corte-barba.png']
  const pictures = await Promise.all(paths.map(async (file, index) => {
    if (assets && existsSync(join(assets, file))) return sharp(await readFile(join(assets, file))).png().toBuffer()
    return sharp({ create: { width: index === 0 ? 900 : 500, height: 600, channels: 3, background: ['#35291f', '#f7e1ad', '#1b4849', '#a34d23', '#353137'][index]! } }).png().toBuffer()
  }))
  const [cover, logo, ...gallery] = paths.map((_, index) => `${origin}/photo/${index}`)
  const initialMedia = {
    id: 'la-cochera-fixture', coverImageUrl: cover, logoUrl: logo, landingGalleryImages: JSON.stringify(gallery),
    bookingEmailMediaSources: { cover, logo, gallery }, bookingEmailMedia: null
  }
  const start = markup.indexOf('    loadSession()\n      .then((hasSession) => hasSession ? startCrm() : null)')
  const end = markup.indexOf('\n\n    }\n  </script>', start)
  assert.ok(start > 0 && end > start, 'CRM bootstrap boundary must be present')
  const fixtureMarkup = markup.slice(0, start) + `
    state.businessId = 'la-cochera-fixture';
    state.business = { id: state.businessId, name: 'La Cochera', slug: 'la-cochera', landingEnabled: true };
    state.currentUser = { role: 'BUSINESS_ADMIN' };
    window.bookingEmailFixture = { switchToStaff() { state.currentUser.role = 'STAFF'; renderLandingSettings(); } };
    showApp(); setSettingsView('landing'); setSection('settings'); renderLandingSettings();
  ` + markup.slice(end)

  try {
    for (const [width, height] of [[1366, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 500, serviceWorkers: 'block' })
      context.setDefaultTimeout(12_000)
      const page = await context.newPage()
      const errors: string[] = []
      const saves: any[] = []
      const rendered = new Map<string, Buffer>()
      let settings: any = null
      let rejectNextSave = true
      page.on('pageerror', (error: Error) => errors.push(error.message))
      await context.route('**/*', async (route: any) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.origin !== origin) return route.abort()
        if (url.pathname === '/crm') return route.fulfill({ contentType: 'text/html', body: fixtureMarkup })
        if (url.pathname.startsWith('/photo/')) return route.fulfill({ contentType: 'image/png', body: pictures[Number(url.pathname.split('/').at(-1))] })
        if (rendered.has(url.pathname)) return route.fulfill({ contentType: 'image/jpeg', body: rendered.get(url.pathname) })
        if (url.pathname.endsWith('/media')) return route.fulfill({ json: { ...initialMedia, bookingEmailMedia: settings } })
        if (url.pathname.endsWith('/booking-email-media') && request.method() === 'PATCH') {
          const payload = request.postDataJSON()
          saves.push(payload)
          if (rejectNextSave) {
            rejectNextSave = false
            return route.fulfill({ status: 503, json: { message: 'No pudimos guardar las imágenes. Volvé a intentar.' } })
          }
          const persist = ({ imageDataUrl, originalDataUrl, ...photo }: any, label: string) => {
            const imagePath = '/rendered/' + label
            rendered.set(imagePath, Buffer.from(imageDataUrl.split(',')[1], 'base64'))
            if (originalDataUrl) {
              rendered.set('/rendered/upload', Buffer.from(originalDataUrl.split(',')[1], 'base64'))
              photo.sourceUrl = origin + '/rendered/upload'
            }
            return { ...photo, imageUrl: origin + imagePath }
          }
          settings = {
            logoUrl: payload.logoUrl,
            banner: payload.banner ? persist(payload.banner, 'banner') : null,
            gallery: payload.gallery.map((photo: any, index: number) => persist(photo, 'gallery-' + index))
          }
          return route.fulfill({ json: { bookingEmailMedia: settings } })
        }
        return route.fulfill({ json: [] })
      })

      await page.goto(origin + '/crm')
      const editor = page.locator('#booking-email-media')
      await editor.locator('summary').click()
      const source = editor.getByLabel('Portada del correo')
      const canvas = editor.locator('#booking-email-media-canvas')
      const zoom = editor.getByLabel('Zoom')
      const horizontal = editor.getByLabel('Posición horizontal')
      const vertical = editor.getByLabel('Posición vertical')
      await canvas.waitFor({ state: 'visible' })
      assert.equal(await source.inputValue(), 'cover')
      await source.selectOption('gallery:0')
      await source.selectOption('cover')
      await zoom.press('End')
      await horizontal.press('ArrowRight')
      const beforeDrag = await vertical.inputValue()
      const box = (await canvas.boundingBox())!
      await canvas.scrollIntoViewIfNeeded()
      const canvasBox = (await canvas.boundingBox())!
      const point = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 3 }
      if (width < 500) {
        const touch = await context.newCDPSession(page)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + 18 }] })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await touch.detach()
      } else {
        await page.mouse.move(point.x, point.y)
        await page.mouse.down()
        await page.mouse.move(point.x, point.y + 18, { steps: 4 })
        await page.mouse.up()
      }
      assert.notEqual(await vertical.inputValue(), beforeDrag, 'drag moves the crop')
      assert.ok(box.width < width, 'crop viewport fits its panel')
      const gallerySelect = editor.getByLabel('Fotos de la galería')
      for (const index of [0, 1, 2]) {
        await gallerySelect.selectOption(String(index))
        await editor.getByRole('button', { name: 'Agregar foto' }).click()
      }
      await editor.getByRole('button', { name: 'Mover foto 2 arriba' }).click()
      await editor.getByRole('button', { name: 'Ajustar foto 1' }).click()
      await zoom.press('End')
      const save = editor.getByRole('button', { name: 'Guardar imágenes del correo' })
      await save.click()
      await editor.getByText('No pudimos guardar las imágenes. Volvé a intentar.').waitFor()
      await save.click()
      await editor.getByText('Imágenes del correo guardadas.').waitFor()
      assert.equal(saves.length, 2)
      assert.deepEqual(saves[0], saves[1], 'retries preserve the draft')
      const payload = saves[1]
      assert.equal(payload.banner.sourceUrl, cover)
      assert.equal(payload.logoUrl, logo)
      assert.ok(payload.banner.crop.width < 0.5 && payload.banner.crop.y !== 0)
      assert.deepEqual(payload.gallery.map((photo: any) => photo.sourceUrl), [gallery[1], gallery[0], gallery[2]])
      assert.ok(payload.gallery[0].crop.width < 0.5)
      assert.match(payload.banner.imageDataUrl, /^data:image\/jpeg;base64,/)
      assert.equal((await sharp(rendered.get('/rendered/banner')!).metadata()).width, 1200)
      assert.ok(await editor.evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth + 1))
      await editor.locator('summary').click()
      await editor.locator('summary').click()
      await canvas.waitFor({ state: 'visible' })
      assert.equal(await source.inputValue(), 'cover')
      assert.equal(await zoom.inputValue(), '300', 'saved crop reopens at the previous zoom')

      // Zooming out to the minimum preserves the full banner and portrait.
      await zoom.press('Home')
      assert.equal(await zoom.inputValue(), '0', 'banner can zoom out below fill')
      assert.ok(await horizontal.isDisabled() && await vertical.isDisabled())
      await vertical.evaluate((control: HTMLInputElement) => {
        control.value = '30'
        control.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await editor.getByRole('button', { name: 'Ajustar foto 1' }).click()
      await zoom.press('Home')
      assert.equal(await zoom.inputValue(), '0', 'portrait can zoom out below fill')
      assert.ok(await horizontal.isDisabled() && await vertical.isDisabled())
      await save.click()
      await editor.getByText('Imágenes del correo guardadas.').waitFor()

      const fullFrame = { x: 0, y: 0, width: 1, height: 1, fillRatio: 0 }
      assert.deepEqual(settings.banner.crop, fullFrame)
      assert.deepEqual(settings.gallery[0].crop, fullFrame)
      const padding = await sharp(rendered.get('/rendered/gallery-0')!).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
      assert.ok([...padding].every((channel, index) => Math.abs(channel - [255, 253, 248][index]!) < 4), 'portrait padding matches the email background')
      await editor.getByRole('button', { name: 'Ajustar foto 1' }).click()
      assert.equal(await zoom.inputValue(), '0', 'full portrait reopens at minimum zoom')

      const emailPage = await context.newPage()
      const email = renderBookingConfirmationEmail({
        recipientName: 'Matías', recipientEmail: 'example@booking-email-fixture.invalid', appointmentId: 'LC-0130',
        businessName: 'La Cochera', businessAddress: 'Franklin Delano Roosevelt 5520, Villa Urquiza, Buenos Aires',
        serviceName: 'Corte', professionalName: 'Joaquín Greco', startAt: new Date('2026-11-14T18:00:00Z'), durationMinutes: 30,
        bookingManagementUrl: origin + '/cuenta',
        emailMedia: { bannerUrl: settings.banner.imageUrl, logoUrl: null, galleryUrls: settings.gallery.map((photo: any) => photo.imageUrl) }
      })
      await emailPage.setContent(email.html, { waitUntil: 'load' })
      assert.equal(await emailPage.locator('img').count(), 4)
      assert.ok(await emailPage.locator('img').evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.complete && image.naturalWidth > 0)))
      assert.ok(await emailPage.getByRole('link', { name: 'Ver mi turno' }).isVisible())
      assert.ok(await emailPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      if (process.env.CRM_QA_OUTPUT_DIR) {
        await emailPage.screenshot({ path: join(process.env.CRM_QA_OUTPUT_DIR, `correo-la-cochera-${width}.png`), fullPage: true })
        await editor.locator('#booking-email-media-preview').screenshot({ path: join(process.env.CRM_QA_OUTPUT_DIR, `vista-previa-la-cochera-${width}.png`) })
      }
      const blockedImages = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
      try {
        await blockedImages.route('**/*', (route: any) => route.abort())
        const textPage = await blockedImages.newPage()
        await textPage.setContent(email.html, { waitUntil: 'load' })
        assert.ok(await textPage.getByText('Con Joaquín Greco', { exact: true }).isVisible())
        assert.ok(await textPage.getByRole('link', { name: 'Ver mi turno' }).isVisible())
        assert.ok(await textPage.locator('img').evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.naturalWidth === 0)))
      } finally {
        await blockedImages.close()
      }

      await source.selectOption('upload')
      await editor.getByLabel('Subir una portada').setInputFiles({ name: 'portada.png', mimeType: 'image/png', buffer: pictures[0]! })
      await canvas.waitFor({ state: 'visible' })
      await save.click()
      await editor.getByText('Imágenes del correo guardadas.').waitFor()
      assert.equal(saves.at(-1).banner.source, 'upload')
      assert.match(saves.at(-1).banner.originalDataUrl, /^data:image\//)
      await source.selectOption('none')
      for (const index of [3, 2, 1]) await editor.getByRole('button', { name: 'Quitar foto ' + index }).click()
      await save.click()
      await editor.getByText('Imágenes del correo guardadas.').waitFor()
      assert.equal(saves.at(-1).banner, null)
      assert.deepEqual(saves.at(-1).gallery, [])
      assert.ok(await editor.getByRole('img', { name: 'Logo del negocio' }).isVisible())
      await page.evaluate(() => (window as any).bookingEmailFixture.switchToStaff())
      assert.ok(await editor.isHidden())
      assert.deepEqual(errors, [], 'CRM handlers have no browser exceptions')
      await context.close()
      console.log(`OK editor y correo a ${width} px`)
    }
    console.log('OK editor y correo reales en Chrome a 1366 y 390 px, con envío y almacenamiento simulados.')
  } finally {
    await browser.close()
  }
}
