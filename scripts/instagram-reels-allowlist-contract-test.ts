import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { instagramPublicationRoutes } from '../src/routes/instagram-publications.js'
import { resolveInstagramReelsRuntimeConfig } from '../src/services/instagram-reels-runtime.js'

const disabled = resolveInstagramReelsRuntimeConfig({
  INSTAGRAM_REELS_ENABLED: 'true'
})
assert.equal(disabled.enabled, true)
assert.deepEqual(disabled.businessIds, [], 'sin allowlist el runtime debe quedar fail-closed')

const configured = resolveInstagramReelsRuntimeConfig({
  INSTAGRAM_REELS_ENABLED: 'true',
  INSTAGRAM_REELS_BUSINESS_IDS: ' business-a, business-b, business-a, '
})
assert.deepEqual(configured.businessIds, ['business-a', 'business-b'])

const calls: string[] = []
const app = Fastify()
await app.register(instagramPublicationRoutes, {
  runtimeReady: true,
  allowedBusinessIds: ['business-a'],
  service: {
    async createDraft() { throw new Error('not used') },
    async list(businessId) { calls.push(businessId); return [] },
    async get() { throw new Error('not used') },
    async updateDraft() { throw new Error('not used') },
    async publish() { throw new Error('not used') }
  }
})

assert.equal((await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-publications' })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/businesses/business-b/instagram-publications' })).statusCode, 404)
assert.deepEqual(calls, ['business-a'], 'un comercio fuera de la allowlist no debe alcanzar el servicio')
await app.close()

const runtime = readFileSync(new URL('../src/services/instagram-reels-runtime.ts', import.meta.url), 'utf8')
const publicationWorker = readFileSync(new URL('../src/services/instagram-publication-worker.ts', import.meta.url), 'utf8')
const commentWorker = readFileSync(new URL('../src/services/instagram-comment-worker.ts', import.meta.url), 'utf8')
const ingress = readFileSync(new URL('../src/services/instagram-comment-ingress-service.ts', import.meta.url), 'utf8')

assert.match(runtime, /INSTAGRAM_REELS_BUSINESS_IDS/)
assert.match(publicationWorker, /businessId:\s*\{\s*in:\s*this\.businessIds\s*\}/)
assert.match(commentWorker, /businessId:\s*\{\s*in:\s*this\.businessIds\s*\}/)
assert.match(ingress, /businessId:\s*\{\s*in:\s*this\.businessIds\s*\}/)

console.log('Instagram Reels allowlist contract: OK')
