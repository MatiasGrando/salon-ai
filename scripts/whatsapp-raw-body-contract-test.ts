import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { installWhatsAppRawBodyParser } from '../src/plugins/whatsapp-raw-body.js'

const app = Fastify({ bodyLimit: 6 * 1024 * 1024 })
app.post('/outside-scope', async (request) => ({
  hasRawBody: Buffer.isBuffer(request.whatsappRawBody),
  body: request.body
}))
await app.register(async (scope) => {
  installWhatsAppRawBodyParser(scope)
  scope.post('/webhooks/whatsapp', async (request) => ({
    rawBase64: request.whatsappRawBody?.toString('base64'),
    body: request.body
  }))
})

const exactBody = Buffer.from('{ "message": "byte-exact á", "count": 1 }', 'utf8')
const accepted = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: exactBody
})
assert.equal(accepted.statusCode, 200)
assert.deepEqual(accepted.json(), {
  rawBase64: exactBody.toString('base64'),
  body: { message: 'byte-exact á', count: 1 }
})

const outsideScope = await app.inject({
  method: 'POST',
  url: '/outside-scope',
  headers: { 'content-type': 'application/json' },
  payload: exactBody
})
assert.deepEqual(outsideScope.json(), {
  hasRawBody: false,
  body: { message: 'byte-exact á', count: 1 }
})

const invalid = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: '{'
})
assert.equal(invalid.statusCode, 400)
assert.equal(invalid.json().code, 'FST_ERR_CTP_INVALID_JSON_BODY')

const oversizedPayload = JSON.stringify({ value: 'x'.repeat(5 * 1024 * 1024) })
const oversized = await app.inject({
  method: 'POST',
  url: '/webhooks/whatsapp',
  headers: { 'content-type': 'application/json' },
  payload: oversizedPayload
})
assert.equal(oversized.statusCode, 413)
assert.equal(oversized.json().code, 'FST_ERR_CTP_BODY_TOO_LARGE')

await app.close()
console.log('OK WhatsApp raw body: exact bytes, legacy JSON body and Fastify errors satisfy the contract.')
