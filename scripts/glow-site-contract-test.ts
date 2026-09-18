import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { glowSiteRoutes, isGlowSitePublicResource } from '../src/routes/glow-site.js'

const dir = await mkdtemp(join(tmpdir(), 'glow-host-test-'))
const app = Fastify()
try {
  const sourceHtml = await readFile('sites/peluqueria-glow-web/index.html', 'utf8')
  const siteUrl = 'https://glow.weex.com.ar/'
  const imageUrl = `${siteUrl}hero-glow.jpg`
  const metadata = Object.fromEntries([...sourceHtml.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)].map(match => [match[1], match[2]]))
  assert.match(sourceHtml, /<link rel="canonical" href="https:\/\/glow\.weex\.com\.ar\/"\s*\/?>/)
  assert.equal(metadata['og:url'], siteUrl)
  assert.equal(metadata['og:type'], 'website')
  assert.equal(metadata['og:site_name'], 'Glow Peluquería')
  assert.equal(metadata['og:locale'], 'es_AR')
  assert.equal(metadata['og:title'], 'Glow Peluquería | Villa Urquiza y Cañitas')
  assert.equal(metadata['og:description'], metadata.description)
  assert.equal(metadata['og:image'], imageUrl)
  assert.equal(metadata['og:image:secure_url'], imageUrl)
  assert.equal(metadata['og:image:type'], 'image/jpeg')
  assert.equal(metadata['og:image:width'], '1024')
  assert.equal(metadata['og:image:height'], '682')
  assert.equal(metadata['og:image:alt'], 'Glow Peluquería: color y estilo en Villa Urquiza y Cañitas')
  assert.equal(metadata['twitter:card'], 'summary_large_image')
  for (const field of ['title', 'description', 'image', 'image:alt']) {
    assert.equal(metadata[`twitter:${field}`], metadata[`og:${field}`])
  }
  const heroImage = await readFile('sites/peluqueria-glow-web/public/hero-glow.jpg')
  const mobileHeroImage = await readFile('sites/peluqueria-glow-web/public/hero-glow-mobile-v1.png')
  assert.equal(mobileHeroImage.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(heroImage.subarray(0, 2).toString('hex'), 'ffd8')
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'index.html'), sourceHtml)
  await writeFile(join(dir, 'assets', 'index-Ab12cd34.js'), 'console.log("Glow")')
  await writeFile(join(dir, 'hero-glow.jpg'), heroImage)
  await writeFile(join(dir, 'hero-glow-mobile-v1.png'), mobileHeroImage)
  await writeFile(join(dir, 'private.txt'), 'secret')
  await app.register(glowSiteRoutes, { siteDir: dir })
  for (const url of ['/', '/reservar?sede=canitas']) {
    const res = await app.inject({ url, headers: { host: 'glow.weex.com.ar' } })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-security-policy']!, /script-src 'self'/)
    assert.match(res.body, /Glow/)
    assert.match(res.body, /property="og:image" content="https:\/\/glow\.weex\.com\.ar\/hero-glow\.jpg"/)
  }
  const asset = await app.inject({ url: '/assets/index-Ab12cd34.js', headers: { host: 'glow.weex.com.ar' } })
  assert.equal(asset.statusCode, 200)
  assert.match(asset.headers['content-type']!, /javascript/)
  assert.match(asset.headers['cache-control']!, /immutable/)
  for (const url of ['/private.txt', '/assets/private.txt', '/assets/%2e%2e%2fprivate.txt']) {
    assert.equal((await app.inject({ url, headers: { host: 'glow.weex.com.ar' } })).statusCode, 404)
  }
  assert.equal((await app.inject({ url: '/', headers: { host: 'other.weex.com.ar' } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'HEAD', url: '/hero-glow.jpg', headers: { host: 'glow.weex.com.ar' } })).statusCode, 200)
  const previewImage = await app.inject({ url: '/hero-glow.jpg', headers: { host: 'glow.weex.com.ar', 'user-agent': 'facebookexternalhit/1.1' } })
  assert.equal(previewImage.statusCode, 200)
  assert.equal(previewImage.headers['content-type'], 'image/jpeg')
  assert.deepEqual(previewImage.rawPayload, heroImage)
  assert.equal((await app.inject({ url: '/hero-glow.jpg', headers: { host: 'other.weex.com.ar' } })).statusCode, 404)
  assert.equal(isGlowSitePublicResource('GET', 'glow.weex.com.ar', '/hero-glow.jpg'), true)
  assert.equal(isGlowSitePublicResource('POST', 'glow.weex.com.ar', '/hero-glow.jpg'), false)
  assert.equal(isGlowSitePublicResource('GET', 'other.weex.com.ar', '/hero-glow.jpg'), false)
  assert.equal(isGlowSitePublicResource('GET', 'glow.weex.com.ar', '/assets/private.txt'), false)
  const mobileImage = await app.inject({ url: '/hero-glow-mobile-v1.png', headers: { host: 'glow.weex.com.ar' } })
  assert.equal(mobileImage.statusCode, 200)
  assert.equal(mobileImage.headers['content-type'], 'image/png')
  assert.deepEqual(mobileImage.rawPayload, mobileHeroImage)
  assert.equal((await app.inject({ method: 'HEAD', url: '/hero-glow-mobile-v1.png', headers: { host: 'glow.weex.com.ar' } })).statusCode, 200)
  assert.equal((await app.inject({ url: '/hero-glow-mobile-v1.png', headers: { host: 'other.weex.com.ar' } })).statusCode, 404)
  assert.equal(isGlowSitePublicResource('GET', 'glow.weex.com.ar', '/hero-glow-mobile-v1.png'), true)
  assert.equal(isGlowSitePublicResource('POST', 'glow.weex.com.ar', '/hero-glow-mobile-v1.png'), false)
  assert.equal(isGlowSitePublicResource('GET', 'other.weex.com.ar', '/hero-glow-mobile-v1.png'), false)
  const guard = await readFile('src/plugins/auth-guard.ts', 'utf8')
  const server = await readFile('src/server.ts', 'utf8')
  assert.match(guard, /isGlowSitePublicResource\(request.method, request.headers.host, path\)/)
  assert.match(server, /app.register\(glowSiteRoutes\)/)
  console.log('Glow hosting contract: OK')
} finally {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}
