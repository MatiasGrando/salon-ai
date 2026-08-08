import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')

const vintageStart = route.indexOf('function renderLanding(')
const vintageEnd = route.indexOf('function renderSalonWhiteLanding(', vintageStart)
const vintage = route.slice(vintageStart, vintageEnd)

assert.ok(vintage.includes('const services = business.services'), 'la plantilla vintage debe usar todo el catálogo')
assert.equal(vintage.includes('business.services.slice('), false, 'la plantilla vintage no debe limitar servicios')
assert.ok(vintage.includes('const visibleServices = services'), 'el carrusel vintage debe mostrar todos los servicios')
assert.ok(vintage.includes('const carouselServices = [...visibleServices, ...visibleServices]'), 'el carrusel vintage debe duplicar el catálogo completo para desplazarse en bucle')

const salonWhiteStart = vintageEnd
const salonWhiteEnd = route.indexOf('function renderLandingLightbox(', salonWhiteStart)
const salonWhite = route.slice(salonWhiteStart, salonWhiteEnd)

assert.ok(salonWhite.includes('const services = business.services'), 'la plantilla blanca debe usar todo el catálogo')
assert.equal(salonWhite.includes('business.services.slice('), false, 'la plantilla blanca no debe limitar servicios')

console.log('Landing service catalog contract: OK (catálogo completo en vintage y blanca)')
