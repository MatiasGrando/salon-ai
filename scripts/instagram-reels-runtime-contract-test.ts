import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { instagramPublicationRoutes } from '../src/routes/instagram-publications.js'
import {
  createInstagramReelsRuntime,
  resolveInstagramReelsRuntimeConfig,
  startInstagramReelsWorkerRuntime
} from '../src/services/instagram-reels-runtime.js'

assert.deepEqual(resolveInstagramReelsRuntimeConfig({}), {
  enabled: false,
  intervalMs: 5000,
  businessIds: []
})
assert.equal(resolveInstagramReelsRuntimeConfig({ INSTAGRAM_REELS_ENABLED: 'true' }).enabled, true)

const disabledApp = Fastify()
await disabledApp.register(instagramPublicationRoutes, { runtimeReady: false })
const unavailable = await disabledApp.inject({
  method: 'GET',
  url: '/businesses/business-a/instagram-publications'
})
assert.equal(unavailable.statusCode, 503)
assert.match(unavailable.json().message, /no está habilitada|no está disponible/i)
await disabledApp.close()

const readinessErrors: Error[] = []
const notReady = await createInstagramReelsRuntime({
  config: { enabled: true, intervalMs: 5, businessIds: ['business-a'] },
  client: {},
  storageReady: true,
  onError(error) { readinessErrors.push(error) }
})
assert.equal(notReady.ready, false, 'sin client/migración compatible no debe aceptar trabajo')
assert.match(readinessErrors[0]?.message || '', /base de datos no está lista/i)

let publicationActive = 0
let publicationMaxActive = 0
let publicationCalls = 0
let releaseFirst!: () => void
const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve })
const errors: unknown[] = []
const runtime = startInstagramReelsWorkerRuntime({
  intervalMs: 5,
  publicationWorker: {
    async runOnce() {
      publicationCalls += 1
      publicationActive += 1
      publicationMaxActive = Math.max(publicationMaxActive, publicationActive)
      if (publicationCalls === 1) await firstRun
      publicationActive -= 1
      return { outcome: 'idle' as const }
    }
  },
  commentWorker: { async processOne() { throw new Error('access-token-secret-value') } },
  onError(error) { errors.push(error) }
})

await new Promise((resolve) => setTimeout(resolve, 25))
assert.equal(publicationCalls, 1, 'un tick lento no debe solaparse con otro')
const stopping = runtime.stop()
let stopped = false
void stopping.then(() => { stopped = true })
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(stopped, false, 'stop debe esperar el trabajo en curso')
releaseFirst()
await stopping
assert.equal(publicationMaxActive, 1)
assert.equal(runtime.isRunning(), false)
assert.equal(errors.length >= 1, true)
assert.doesNotMatch(String(errors[0]), /access-token-secret-value/, 'el runtime debe sanitizar errores antes de reportarlos')

console.log('Instagram Reels runtime contract: OK')
