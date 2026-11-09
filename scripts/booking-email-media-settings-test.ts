import assert from 'node:assert/strict'
import Fastify from 'fastify'
import sharp from 'sharp'
import type { AuthContext } from '../src/services/auth-service.js'
import {
  bookingEmailMediaSources,
  resolveBookingEmailMedia,
  storeBookingEmailMedia,
  type BookingEmailMediaSettings
} from '../src/services/booking-email-media-service.js'

process.env.DOTENV_CONFIG_PATH = 'tmp/booking-email-media-test-env-does-not-exist'
process.env.DATABASE_URL = 'postgresql://local:local@127.0.0.1:9/weex_test'
process.env.SUPABASE_URL = 'https://storage.example.com'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-local-key'

const { prisma } = await import('../src/config/prisma.js')
const { businessRoutes } = await import('../src/routes/business.js')

const jpeg = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#e3c877' } }).jpeg().toBuffer()
const imageDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
const crop = { x: 0.1, y: 0.15, width: 0.8, height: 0.7 }
const galleryImage = 'https://images.example.com/corte.jpg'
const business = {
  id: 'business-a',
  name: 'La Cochera',
  coverImageUrl: 'https://images.example.com/frente.jpg',
  logoUrl: 'https://images.example.com/logo.jpg',
  landingGalleryImages: JSON.stringify([galleryImage, imageDataUrl, '/bad-relative.jpg']),
  bookingEmailMedia: null as BookingEmailMediaSettings | null
}
const sources = bookingEmailMediaSources(business)
assert.deepEqual(sources.gallery.map(source => source?.split(':')[0] || null), ['https', 'data-sha256', null])
assert.deepEqual(resolveBookingEmailMedia(business), {
  bannerUrl: null,
  logoUrl: business.logoUrl,
  galleryUrls: []
})
const fullFrame = { x: 0, y: 0, width: 1, height: 1, fillRatio: 0 }
const body = {
  logoUrl: sources.logo,
  banner: { source: 'cover', sourceUrl: sources.cover, crop, imageDataUrl },
  gallery: [
    { sourceUrl: sources.gallery[1], crop: fullFrame, imageDataUrl },
    { sourceUrl: galleryImage, crop, imageDataUrl }
  ]
}
const authHeaders = { 'x-test-role': 'ACCOUNT_ADMIN' }
const route = '/businesses/business-a/booking-email-media'
const uploads: string[] = []
const originalFetch = globalThis.fetch
const originalFindFirst = prisma.business.findFirst
const originalFindUnique = prisma.business.findUnique
const originalUpdateMany = prisma.business.updateMany
let reads = 0
let writes = 0
let conflict = false

prisma.business.findFirst = (async (args) => {
  reads++
  assert.equal(args?.where?.accountAdminId, 'account-a')
  return args?.where?.id === business.id ? business : null
}) as typeof prisma.business.findFirst
prisma.business.findUnique = (async () => business) as unknown as typeof prisma.business.findUnique
prisma.business.updateMany = (async (args) => {
  writes++
  assert.equal(args?.where?.id, business.id)
  assert.equal(args?.where?.accountAdminId, 'account-a')
  assert.equal(args?.where?.logoUrl, business.logoUrl)
  assert.equal(args?.where?.coverImageUrl, business.coverImageUrl)
  assert.equal(args?.where?.landingGalleryImages, business.landingGalleryImages)
  assert.ok(args?.where?.bookingEmailMedia)
  if (conflict) return { count: 0 }
  business.bookingEmailMedia = args?.data.bookingEmailMedia as BookingEmailMediaSettings
  return { count: 1 }
}) as typeof prisma.business.updateMany
globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/storage\.example\.com\/storage\/v1\/object\//)
  if (options?.method === 'POST') {
    assert.match(String(url), /\/business-a\/booking-email-(?:banner|gallery)\/[a-f0-9]+\.jpg$/)
    assert.equal(new Headers(options.headers).get('content-type'), 'image/jpeg')
    uploads.push(String(url))
  } else {
    assert.equal(options?.method, 'HEAD')
    assert.match(String(url), /\/object\/public\//)
  }
  return new Response(null, { status: 200 })
}

const app = Fastify()
app.addHook('onRequest', async request => {
  const role = request.headers['x-test-role']
  if (role) request.auth = {
    user: { id: 'account-a', role, businessId: null, canCreateBusinesses: false }
  } as AuthContext
})
await app.register(businessRoutes)

try {
  assert.equal((await app.inject({ method: 'PATCH', url: route, payload: body })).statusCode, 403)
  assert.equal((await app.inject({ method: 'PATCH', url: route, headers: { 'x-test-role': 'STAFF' }, payload: body })).statusCode, 403)
  assert.equal(reads, 0, 'staff y solicitudes sin sesión se rechazan antes de consultar el negocio')
  const denied = await app.inject({ method: 'PATCH', url: '/businesses/business-b/booking-email-media', headers: authHeaders, payload: body })
  assert.equal(denied.statusCode, 404)

  const staleLogo = await app.inject({ method: 'PATCH', url: route, headers: authHeaders, payload: { ...body, logoUrl: null } })
  assert.equal(staleLogo.statusCode, 409)
  const wrongGallery = await app.inject({
    method: 'PATCH', url: route, headers: authHeaders,
    payload: { ...body, gallery: [{ ...body.gallery[0], sourceUrl: 'https://other.example.com/foto.jpg' }] }
  })
  assert.equal(wrongGallery.statusCode, 400)
  await assert.rejects(storeBookingEmailMedia(business, {
    ...body, banner: { ...body.banner, imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==' }
  }), /JPG/)
  await assert.rejects(storeBookingEmailMedia(business, {
    ...body, banner: { ...body.banner, crop: { ...crop, x: 0.9 } }
  }), /encuadre/)
  await assert.rejects(storeBookingEmailMedia(business, {
    ...body, banner: { ...body.banner, crop: { ...crop, fillRatio: -0.1 } }
  }), /encuadre/)
  assert.deepEqual([uploads.length, writes], [0, 0])

  const saved = await app.inject({ method: 'PATCH', url: route, headers: authHeaders, payload: body })
  assert.equal(saved.statusCode, 200, saved.body)
  const settings = saved.json<{ bookingEmailMedia: BookingEmailMediaSettings }>().bookingEmailMedia
  assert.deepEqual(settings.gallery.map(photo => photo.sourceUrl), [sources.gallery[1], galleryImage])
  assert.deepEqual(settings.banner?.crop, crop, 'legacy crops keep their shape')
  assert.deepEqual(settings.gallery[0]?.crop, fullFrame, 'full-image fit survives storage')
  assert.equal(settings.banner?.sourceUrl, business.coverImageUrl)
  assert.deepEqual([uploads.length, writes], [3, 1])
  assert.deepEqual(resolveBookingEmailMedia(business), {
    bannerUrl: settings.banner?.imageUrl, logoUrl: null, galleryUrls: settings.gallery.map(photo => photo.imageUrl)
  })
  const reloaded = await app.inject({ method: 'GET', url: '/businesses/business-a/media', headers: authHeaders })
  assert.deepEqual(reloaded.json().bookingEmailMedia, settings)
  assert.deepEqual(reloaded.json().bookingEmailMediaSources, sources)

  const changed = resolveBookingEmailMedia({
    ...business, logoUrl: null, coverImageUrl: 'https://images.example.com/nueva.jpg', landingGalleryImages: JSON.stringify([galleryImage])
  })
  assert.deepEqual(changed, { bannerUrl: null, logoUrl: null, galleryUrls: [settings.gallery[1]?.imageUrl] })
  const changedLogo = resolveBookingEmailMedia({ ...business, logoUrl: 'https://images.example.com/logo-nuevo.jpg' })
  assert.deepEqual([changedLogo.bannerUrl, changedLogo.logoUrl], [null, 'https://images.example.com/logo-nuevo.jpg'])

  conflict = true
  const concurrent = await app.inject({
    method: 'PATCH', url: route, headers: authHeaders, payload: { logoUrl: sources.logo, banner: null, gallery: [] }
  })
  assert.equal(concurrent.statusCode, 409)
  assert.deepEqual(business.bookingEmailMedia, settings)
  conflict = false
  const logoOnly = await app.inject({
    method: 'PATCH', url: route, headers: authHeaders, payload: { logoUrl: sources.logo, banner: null, gallery: [] }
  })
  assert.equal(logoOnly.statusCode, 200)
  assert.deepEqual(resolveBookingEmailMedia(business), { bannerUrl: null, logoUrl: business.logoUrl, galleryUrls: [] })

  const store = async ({ kind }: { kind: string }) => `https://storage.example.com/${kind}.jpg`
  const uploadBody = {
    ...body, gallery: [],
    banner: { source: 'upload', originalDataUrl: imageDataUrl, crop, imageDataUrl }
  }
  const uploadSettings = await storeBookingEmailMedia(business, uploadBody, store)
  assert.equal(uploadSettings.banner?.sourceUrl, 'https://storage.example.com/booking-email-original.jpg')
  const reused = await storeBookingEmailMedia({ ...business, bookingEmailMedia: uploadSettings }, {
    ...uploadBody, banner: { source: 'upload', sourceUrl: uploadSettings.banner?.sourceUrl, crop, imageDataUrl }
  }, store)
  assert.deepEqual(reused, uploadSettings)
} finally {
  await app.close()
  prisma.business.findFirst = originalFindFirst
  prisma.business.findUnique = originalFindUnique
  prisma.business.updateMany = originalUpdateMany
  globalThis.fetch = originalFetch
  await prisma.$disconnect()
}

console.log('OK: alcance por negocio, JPEG públicos, galería ordenada, selección persistida y fuentes vigentes.')
