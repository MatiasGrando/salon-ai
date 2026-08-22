import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { storeBusinessImage } from '../src/services/media-storage-service.js'

const originalFetch = globalThis.fetch
const originalUrl = process.env.SUPABASE_URL
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const originalBucket = process.env.SUPABASE_MEDIA_BUCKET

try {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  process.env.SUPABASE_MEDIA_BUCKET = 'business-media'

  const requests: Array<{ url: string; method: string; headers: Headers; body: Uint8Array | null }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method || 'GET',
      headers: new Headers(init?.headers),
      body: init?.body instanceof Uint8Array ? init.body : null
    })
    return new Response('', { status: 200 })
  }

  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const publicUrl = await storeBusinessImage({
    businessId: 'business-1',
    kind: 'services',
    value: onePixelPng,
    maxBytes: 2 * 1024 * 1024
  })

  assert.match(publicUrl, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/business-media\/business-1\/services\/[a-f0-9]{24}\.webp$/)
  assert.equal(requests.length, 2, 'debe subir el archivo y verificar la URL pública')
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.headers.get('content-type'), 'image/webp')
  assert.equal(requests[0]?.headers.get('cache-control'), 'max-age=31536000, immutable')
  assert.equal(requests[0]?.headers.get('x-upsert'), 'true')
  assert.equal(Buffer.from(requests[0]?.body || []).subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(requests[1]?.method, 'HEAD')

  const existingUrl = 'https://example.supabase.co/storage/v1/object/public/business-media/existing.webp'
  assert.equal(await storeBusinessImage({
    businessId: 'business-1',
    kind: 'services',
    value: existingUrl,
    maxBytes: 2 * 1024 * 1024
  }), existingUrl)
  assert.equal(requests.length, 2, 'una URL existente no debe volver a subirse')

  const serviceRoute = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
  const professionalRoute = readFileSync(new URL('../src/routes/professional.ts', import.meta.url), 'utf8')
  const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
  const crmUiRoute = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
  assert.match(serviceRoute, /kind: 'services'/)
  assert.match(professionalRoute, /kind: 'professionals'/)
  assert.match(businessRoute, /kind: 'logos'/)
  assert.match(businessRoute, /kind: 'covers'/)
  assert.match(businessRoute, /kind: 'gallery'/)
  assert.match(crmUiRoute, /async function optimizeImageFile\(file, maxDimension\)/)
} finally {
  globalThis.fetch = originalFetch
  restoreEnv('SUPABASE_URL', originalUrl)
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey)
  restoreEnv('SUPABASE_MEDIA_BUCKET', originalBucket)
}

console.log('Supabase media storage contract: OK')

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
