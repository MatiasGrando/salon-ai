import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { renderLanding } from '../src/routes/landing-ui.js'

const landingRoute = readFileSync(new URL('../src/routes/landing-ui.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.ok(crmUi.includes('Vista previa de mi p&aacute;gina'), 'el CRM debe ofrecer una vista previa con los datos reales cargados')
assert.ok(crmUi.includes('Ver plantilla modelo'), 'el CRM debe ofrecer una plantilla modelo completa por separado')
assert.ok(crmUi.includes('data-preview-mode="current"'), 'la vista propia debe declarar el modo current')
assert.ok(crmUi.includes('data-preview-mode="model"'), 'la muestra debe declarar el modo model')
assert.ok(crmUi.includes("'&preview=' + encodeURIComponent(link.dataset.previewMode || 'current')"), 'cada enlace debe conservar su modo explícito')

assert.ok(landingRoute.includes("query.preview === 'model'"), 'la landing pública debe reconocer el modo model')
assert.ok(landingRoute.includes('function landingBusinessForModel('), 'el modelo debe proyectarse desde una ficha demo aislada')
assert.ok(landingRoute.includes("name: modelIdentity.name"), 'la muestra no debe exponer el nombre real del negocio')
assert.ok(landingRoute.includes('services: []'), 'la muestra debe descartar el catálogo parcial del negocio')
assert.ok(landingRoute.includes('professionals: []'), 'la muestra debe descartar profesionales parciales del negocio')
assert.ok(landingRoute.includes('landingTemplateContent: {}'), 'la muestra debe descartar textos parciales del negocio')
assert.ok(landingRoute.includes('landingModelMedia'), 'cada plantilla modelo debe declarar su propio catálogo visual')
assert.ok(landingRoute.includes("return '#plantilla-modelo'"), 'los CTA del modelo no deben abrir el flujo real de reservas')
assert.ok(landingRoute.includes('Plantilla modelo'), 'la página debe identificar visualmente que contiene datos de ejemplo')
assert.ok(landingRoute.includes('Contenido de ejemplo. No genera reservas reales.'), 'la muestra debe explicar que no opera sobre datos reales')

const configuredBusiness = {
  id: 'business-real',
  slug: 'negocio-real',
  name: 'NOMBRE REAL PRIVADO',
  landingTemplate: 'salon-white',
  landingSubtitle: 'SUBTITULO REAL PRIVADO',
  landingFeature: 'DATO REAL PRIVADO',
  landingOpeningYear: 1999,
  landingDescription: 'DESCRIPCION REAL PRIVADA',
  landingTemplateContent: { 'salon-white': { description: 'TEXTO PARCIAL PRIVADO' } },
  coverImageUrl: 'https://example.com/portada-real.jpg',
  landingSocialImageUrl: null,
  landingGalleryImages: JSON.stringify(['https://example.com/galeria-real.jpg']),
  publicWhatsapp: '+5491100000000',
  publicAddress: 'DIRECCION REAL PRIVADA',
  publicAddressArea: 'AREA REAL PRIVADA',
  publicMapsUrl: 'https://maps.example.com/real',
  contactEmail: 'real@example.com',
  instagramUrl: 'https://instagram.com/real',
  facebookUrl: null,
  tiktokUrl: null,
  whatsappConfig: { displayPhoneNumber: '+5491100000000' },
  services: [{ id: 'real-service', name: 'SERVICIO REAL PARCIAL', description: null, duration: 30, customerDurationMin: null, customerDurationMax: null, category: null, price: 100, priceMode: 'FIXED', imageUrl: null }],
  professionals: [{ id: 'real-professional', name: 'PROFESIONAL REAL PARCIAL', description: null, avatarUrl: null }],
  businessHours: [{ id: 'real-hours', businessId: 'business-real', dayOfWeek: 6, startTime: '01:00', endTime: '02:00' }]
}

const currentHtml = renderLanding(configuredBusiness as never, '/negocio-real', 'salon-white', false)
assert.ok(currentHtml.includes('NOMBRE REAL PRIVADO'), 'la vista current debe reflejar los datos que el negocio cargó')
assert.ok(currentHtml.includes('SERVICIO REAL PARCIAL'), 'la vista current debe reflejar el catálogo parcial real')

const modelHtml = renderLanding(configuredBusiness as never, '/negocio-real', 'salon-white', true)
for (const privateValue of ['NOMBRE REAL PRIVADO', 'SUBTITULO REAL PRIVADO', 'TEXTO PARCIAL PRIVADO', 'SERVICIO REAL PARCIAL', 'PROFESIONAL REAL PARCIAL', 'DIRECCION REAL PRIVADA', 'real@example.com']) {
  assert.equal(modelHtml.includes(privateValue), false, `la plantilla modelo no debe filtrar datos reales: ${privateValue}`)
}
assert.ok(modelHtml.includes('Studio Aura'), 'el modelo Studio claro debe usar una identidad ficticia completa')
assert.equal(modelHtml.includes('/landing-assets/barber-hero-service.png'), false, 'Studio claro no debe mostrar una portada de barbería')
assert.ok(modelHtml.includes('/landing-assets/salon-white-hero.png'), 'Studio claro debe usar la portada de su mock original')
assert.ok(modelHtml.includes('/landing-assets/salon-white-service-color.png'), 'Studio claro debe usar servicios coherentes con su mock claro')
assert.ok(modelHtml.includes('/landing-assets/salon-white-professional-sofia.png'), 'Studio claro debe mostrar profesionales propios de la plantilla')
assert.equal(modelHtml.includes('min-height: calc(100svh - var(--sw-hero-offset))'), false, 'Studio claro no debe agrandar y recortar artificialmente el hero')
assert.ok(modelHtml.includes('.sw-services,\n        .sw-team { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }'), 'servicios y profesionales deben usar todo el ancho disponible como el mock')
assert.equal(modelHtml.includes('.sw-services,\n        .sw-team { max-width:'), false, 'las grillas no deben agregar un margen lateral inexistente en el mock')
assert.ok(modelHtml.includes('Corte y color'), 'Studio claro debe incluir un catálogo demo coherente')
assert.ok(modelHtml.includes('Sofía'), 'Studio claro debe incluir profesionales demo completos')
assert.ok(modelHtml.includes('href="#plantilla-modelo"'), 'los CTA del modelo deben permanecer dentro de la muestra')
assert.equal(/undefined|NaN/.test(modelHtml), false, 'los servicios modelo deben mostrar duraciones válidas')

const classicHtml = renderLanding(configuredBusiness as never, '/negocio-real', 'classic', true)
assert.ok(classicHtml.includes('/landing-assets/barber-hero-service.png'), 'Vintage debe usar la portada de barbería generada')
assert.ok(classicHtml.includes('/landing-assets/barber-service-fade.png'), 'Vintage debe mostrar servicios de barbería')
assert.ok(classicHtml.includes('/landing-assets/barber-professional-matias.png'), 'Vintage debe mostrar profesionales de barbería')
assert.ok(classicHtml.includes('/landing-assets/barber-gallery-tools.png'), 'Vintage debe completar la galería con recursos de barbería')
assert.equal(classicHtml.includes('/landing-assets/luxe-nails-hero.png'), false, 'Vintage no debe mezclar imágenes de manicuría')

const editorialHtml = renderLanding(configuredBusiness as never, '/negocio-real', 'editorial', true)
assert.ok(editorialHtml.includes('/landing-assets/barber-hero-interior.png'), 'Editorial debe mantener la variante clara del concepto de barbería')
assert.ok(editorialHtml.includes('/landing-assets/barber-professional-nico.png'), 'Editorial debe conservar el catálogo visual de barbería')

const luxeHtml = renderLanding(configuredBusiness as never, '/negocio-real', 'luxe-nails', true)
assert.ok(luxeHtml.includes('/landing-assets/luxe-nails-hero.png'), 'Luxe Nails debe usar la portada embebida del mock original')
assert.ok(luxeHtml.includes('/landing-assets/luxe-nails-service-nail-art.png'), 'Luxe Nails debe usar las imágenes de servicios del mock original')
assert.ok(luxeHtml.includes('/landing-assets/luxe-nails-gallery-1.png'), 'Luxe Nails debe usar la galería del mock original')
assert.equal(luxeHtml.includes('/landing-assets/barber-service-fade.png'), false, 'Luxe Nails no debe mezclar imágenes de barbería')

const assetPath = (name: string) => fileURLToPath(new URL(`../src/assets/landing/${name}`, import.meta.url))
const heroMetadata = await sharp(assetPath('salon-white-hero.png')).metadata()
assert.ok((heroMetadata.height || 0) > (heroMetadata.width || 0), 'la portada debe conservar la proporción vertical del archivo original')
for (const professionalAsset of ['salon-white-professional-sofia.png', 'salon-white-professional-camila.png', 'salon-white-professional-valentina.png']) {
  const metadata = await sharp(assetPath(professionalAsset)).metadata()
  assert.ok((metadata.height || 0) >= (metadata.width || 0), `${professionalAsset} debe conservar el encuadre vertical original`)
}

console.log('Landing template preview modes contract: OK')
