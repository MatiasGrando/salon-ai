import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  injectSocialPreviewImage,
  renderSocialPreviewMetadata,
  resolveSocialPreviewImage
} from '../src/services/landing-social-preview.js'
import { renderLanding } from '../src/routes/landing-ui.js'

const [schema, migration, businessRoute, businessService, crmUi, landingUi, mediaStorage, yamilaRoute, naturaFlowRoute] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260914200000_add_landing_social_image/migration.sql', 'utf8'),
  readFile('src/routes/business.ts', 'utf8'),
  readFile('src/services/business-service.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8'),
  readFile('src/routes/landing-ui.ts', 'utf8'),
  readFile('src/services/media-storage-service.ts', 'utf8'),
  readFile('src/routes/yamila-site.ts', 'utf8'),
  readFile('src/routes/natura-flow-site.ts', 'utf8')
])

assert.match(schema, /landingSocialImageUrl\s+String\?/)
assert.match(migration, /ADD COLUMN "landingSocialImageUrl" TEXT/)
assert.match(businessRoute, /landingSocialImageUrl\?: string \| null/)
assert.match(businessRoute, /kind: 'social'/)
assert.match(businessService, /landingSocialImageUrl\?: string \| null/)
assert.match(mediaStorage, /'social'/)

assert.match(crmUi, /Vista previa al compartir/)
assert.match(crmUi, /id="landing-social-image"/)
assert.match(crmUi, /landingSocialImageUrl: state\.landingSocialImageUrl/)
assert.match(crmUi, /setLandingSocialImage\(state\.business\?\.landingSocialImageUrl \|\| null\)/)

assert.match(landingUi, /renderSocialPreviewMetadata/)
assert.match(yamilaRoute, /resolveSocialPreviewImage/)
assert.match(naturaFlowRoute, /resolveSocialPreviewImage/)

assert.equal(resolveSocialPreviewImage({
  landingSocialImageUrl: 'https://cdn.example/social.jpg',
  coverImageUrl: 'https://cdn.example/cover.jpg',
  logoUrl: 'https://cdn.example/logo.jpg'
}), 'https://cdn.example/social.jpg')
assert.equal(resolveSocialPreviewImage({
  landingSocialImageUrl: null,
  coverImageUrl: 'https://cdn.example/cover.jpg',
  logoUrl: 'https://cdn.example/logo.jpg'
}), 'https://cdn.example/cover.jpg')
assert.equal(resolveSocialPreviewImage({
  landingSocialImageUrl: null,
  coverImageUrl: null,
  logoUrl: null
}, 'https://cdn.example/default.jpg'), 'https://cdn.example/default.jpg')

const metadata = renderSocialPreviewMetadata({
  title: 'Salón & Spa',
  description: 'Cuidado <real>',
  canonicalUrl: 'https://demo.weex.com.ar/',
  imageUrl: 'https://cdn.example/social.jpg',
  imageAlt: 'Portada "Demo"'
})
assert.match(metadata, /property="og:title" content="Salón &amp; Spa"/)
assert.match(metadata, /property="og:image" content="https:\/\/cdn\.example\/social\.jpg"/)
assert.match(metadata, /name="twitter:card" content="summary_large_image"/)
assert.match(metadata, /rel="canonical" href="https:\/\/demo\.weex\.com\.ar\/"/)

const injected = injectSocialPreviewImage(
  '<meta property="og:image" content="old.jpg"><meta name="twitter:image" content="old.jpg">',
  'https://cdn.example/new.jpg'
)
assert.match(injected, /property="og:image" content="https:\/\/cdn\.example\/new\.jpg"/)
assert.match(injected, /name="twitter:image" content="https:\/\/cdn\.example\/new\.jpg"/)

const landingHtml = renderLanding({
  name: 'Demo Social',
  slug: 'demo-social',
  landingTemplate: 'classic',
  landingSocialImageUrl: 'https://cdn.example/social.jpg',
  coverImageUrl: 'https://cdn.example/cover.jpg',
  logoUrl: null,
  landingEnabled: true,
  landingSubtitle: 'Bienestar',
  landingFeature: 'Atención personalizada',
  landingDescription: 'Una descripción para compartir.',
  landingTemplateContent: {
    classic: {
      subtitle: 'Bienestar',
      benefit1: 'Calidad',
      benefit2: 'Experiencia',
      benefit3: 'Cuidado',
      brandIcon: 'generic',
      description: 'Una descripción para compartir.'
    }
  },
  landingOpeningYear: null,
  landingGalleryImages: null,
  publicWhatsapp: null,
  publicAddress: null,
  publicAddressArea: null,
  publicMapsUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  services: [],
  professionals: [],
  businessHours: [],
  whatsappConfig: null,
  paymentSettings: null
} as never)
assert.match(landingHtml, /property="og:url" content="https:\/\/demo-social\.weex\.com\.ar\/"/)
assert.match(landingHtml, /property="og:image" content="https:\/\/cdn\.example\/social\.jpg"/)
assert.match(landingHtml, /property="og:description" content="Una descripción para compartir\."/)

console.log('Landing social preview contract: OK')
