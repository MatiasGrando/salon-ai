import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { glowSiteRoutes, isGlowSitePublicResource } from '../src/routes/glow-site.js'

const dir = await mkdtemp(join(tmpdir(), 'glow-host-test-'))
const app = Fastify()
try {
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Glow</title>')
  await writeFile(join(dir, 'assets', 'index-Ab12cd34.js'), 'console.log("Glow")')
  await writeFile(join(dir, 'hero-glow.jpg'), 'image')
  await writeFile(join(dir, 'private.txt'), 'secret')
  await app.register(glowSiteRoutes, { siteDir: dir })
  for (const url of ['/', '/reservar?sede=canitas']) {
    const res = await app.inject({ url, headers: { host: 'glow.weex.com.ar' } })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-security-policy']!, /script-src 'self'/)
    assert.match(res.body, /Glow/)
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
  assert.equal(isGlowSitePublicResource('GET', 'glow.weex.com.ar', '/hero-glow.jpg'), true)
  assert.equal(isGlowSitePublicResource('POST', 'glow.weex.com.ar', '/hero-glow.jpg'), false)
  assert.equal(isGlowSitePublicResource('GET', 'other.weex.com.ar', '/hero-glow.jpg'), false)
  assert.equal(isGlowSitePublicResource('GET', 'glow.weex.com.ar', '/assets/private.txt'), false)
  const guard = await readFile('src/plugins/auth-guard.ts', 'utf8')
  const server = await readFile('src/server.ts', 'utf8')
  assert.match(guard, /isGlowSitePublicResource\(request.method, request.headers.host, path\)/)
  assert.match(server, /app.register\(glowSiteRoutes\)/)
  console.log('Glow hosting contract: OK')
} finally {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}
