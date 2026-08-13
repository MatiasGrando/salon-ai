import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')
const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.ok(businessRoute.includes("'luxe-nails'"), 'el servidor debe aceptar Luxe Nails como plantilla persistible')
assert.ok(crmUi.includes('value="luxe-nails"'), 'el CRM debe mostrar Luxe Nails entre los diseños disponibles')

const vintageStart = route.indexOf('function renderLanding(')
const vintageEnd = route.indexOf('function renderLuxeNailsLanding(', vintageStart)
const vintage = route.slice(vintageStart, vintageEnd)

assert.ok(vintage.includes('const services = business.services'), 'la plantilla vintage debe usar todo el catálogo')
assert.equal(vintage.includes('business.services.slice('), false, 'la plantilla vintage no debe limitar servicios')
assert.ok(vintage.includes('const visibleServices = demoPreview ? landingServicesForPreview(business, true) : services'), 'el carrusel vintage debe usar ejemplos solo cuando la vista previa no tiene servicios')
assert.ok(vintage.includes('const carouselServices = [...visibleServices, ...visibleServices]'), 'el carrusel vintage debe duplicar el catálogo completo para desplazarse en bucle')

const luxeStart = vintageEnd
const luxeEnd = route.indexOf('function renderSalonWhiteLanding(', luxeStart)
const luxe = route.slice(luxeStart, luxeEnd)

assert.ok(luxe.includes('const services = business.services'), 'la plantilla Luxe Nails debe usar todo el catálogo')
assert.equal(luxe.includes('business.services.slice('), false, 'la plantilla Luxe Nails no debe limitar servicios')
assert.ok(luxe.includes('reservar?template=luxe-nails'), 'la plantilla Luxe Nails debe conectar con la reserva real')

const salonWhiteStart = luxeEnd
const salonWhiteEnd = route.indexOf('function renderLandingLightbox(', salonWhiteStart)
const salonWhite = route.slice(salonWhiteStart, salonWhiteEnd)

assert.ok(salonWhite.includes('const services = business.services'), 'la plantilla blanca debe usar todo el catálogo')
assert.equal(salonWhite.includes('business.services.slice('), false, 'la plantilla blanca no debe limitar servicios')

console.log('Landing service catalog contract: OK (catálogo completo en vintage, Luxe Nails y blanca)')
