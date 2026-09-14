import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { instagramWebhookRoutes } from '../src/routes/instagram-webhook.js'

const secret = 'instagram-app-secret'
const mixedPayload = {
  object: 'instagram',
  entry: [{
    id: 'ig-business-1',
    messaging: [{
      sender: { id: 'dm-user' }, recipient: { id: 'ig-business-1' },
      message: { mid: 'dm-1', text: 'hola' }
    }],
    changes: [{
      field: 'comments',
      value: {
        from: { id: 'comment-user', username: 'ana' },
        media: { id: 'reel-1', media_product_type: 'REELS' },
        id: 'comment-1', text: 'precio'
      }
    }]
  }]
}

async function setup(input: {
  appSecret?: string
  commentsRuntimeReady?: boolean
  ingress?: { ingest(payload: unknown): Promise<unknown> }
  legacy?: { handleWebhook(payload: unknown): Promise<unknown> }
} = {}) {
  const calls: string[] = []
  const app = Fastify()
  await app.register(instagramWebhookRoutes, {
    appSecret: input.appSecret ?? null,
    commentsRuntimeReady: input.commentsRuntimeReady ?? true,
    commentIngress: input.ingress ?? {
      async ingest(payload) { assert.deepEqual(payload, mixedPayload); calls.push('comments'); return { created: 1 } }
    },
    legacyWebhookService: {
      verifyWebhook: () => ({ verified: true, challenge: 'challenge' }),
      ...(input.legacy ?? {
        async handleWebhook(payload) { assert.deepEqual(payload, mixedPayload); calls.push('messaging'); return { received: true } }
      })
    }
  })
  return { app, calls }
}

function signedRequest(payload: unknown, signingSecret = secret) {
  const raw = JSON.stringify(payload)
  return {
    method: 'POST' as const,
    url: '/webhooks/instagram',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', signingSecret).update(Buffer.from(raw)).digest('hex')}`
    },
    payload: raw
  }
}

{
  const { app, calls } = await setup({ appSecret: secret })
  const response = await app.inject(signedRequest(mixedPayload))
  assert.equal(response.statusCode, 200)
  assert.deepEqual(calls, ['comments', 'messaging'])
  await app.close()
}

{
  const { app, calls } = await setup({ appSecret: secret })
  const rawWithWhitespace = `${JSON.stringify(mixedPayload)}\n`
  const response = await app.inject({
    method: 'POST', url: '/webhooks/instagram',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(Buffer.from(rawWithWhitespace)).digest('hex')}`
    },
    payload: rawWithWhitespace
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(calls, ['comments', 'messaging'])
  await app.close()
}

for (const headers of [
  { 'content-type': 'application/json' },
  { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }
]) {
  const { app, calls } = await setup({ appSecret: secret })
  const response = await app.inject({ method: 'POST', url: '/webhooks/instagram', headers, payload: JSON.stringify(mixedPayload) })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(calls, [])
  await app.close()
}

{
  const { app, calls } = await setup({ appSecret: secret })
  const first = await app.inject(signedRequest(mixedPayload))
  const duplicate = await app.inject(signedRequest(mixedPayload))
  assert.equal(first.statusCode, 200)
  assert.equal(duplicate.statusCode, 200)
  assert.deepEqual(calls, ['comments', 'messaging', 'comments', 'messaging'])
  await app.close()
}

{
  let legacyCalled = false
  const { app } = await setup({
    appSecret: secret,
    ingress: { async ingest() { throw new Error('database unavailable') } },
    legacy: { async handleWebhook() { legacyCalled = true; return { received: true } } }
  })
  const response = await app.inject(signedRequest(mixedPayload))
  assert.equal(response.statusCode, 503)
  assert.equal(legacyCalled, false)
  await app.close()
}

// Missing secret fails closed for comment events.
{
  const { app, calls } = await setup()
  const response = await app.inject({
    method: 'POST', url: '/webhooks/instagram',
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(mixedPayload)
  })
  assert.equal(response.statusCode, 503)
  assert.deepEqual(calls, [])
  await app.close()
}

{
  const { app, calls } = await setup({ appSecret: secret, commentsRuntimeReady: false })
  const response = await app.inject(signedRequest(mixedPayload))
  assert.equal(response.statusCode, 503)
  assert.deepEqual(calls, [])
  await app.close()
}

{
  const dmOnly = {
    object: 'instagram',
    entry: [{
      id: 'ig-business-1',
      messaging: [{ sender: { id: 'dm-user' }, recipient: { id: 'ig-business-1' }, message: { mid: 'dm-2', text: 'hola' } }]
    }]
  }
  let ingressCalled = false
  let legacyCalled = false
  const app = Fastify()
  await app.register(instagramWebhookRoutes, {
    appSecret: null,
    commentsRuntimeReady: false,
    commentIngress: { async ingest() { ingressCalled = true } },
    legacyWebhookService: {
      verifyWebhook: () => ({ verified: true }),
      async handleWebhook(payload) { assert.deepEqual(payload, dmOnly); legacyCalled = true; return { received: true } }
    }
  })
  const response = await app.inject({
    method: 'POST', url: '/webhooks/instagram', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(dmOnly)
  })
  assert.equal(response.statusCode, 200)
  assert.equal(ingressCalled, true)
  assert.equal(legacyCalled, true)
  await app.close()
}

console.log('Instagram webhook route contract: OK')
