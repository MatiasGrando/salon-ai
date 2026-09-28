import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { createNewBotIngressRepository } from '../src/new-bot/infrastructure/ingress-repository.js'
import { newBotWhatsAppWebhookRoutes } from '../src/new-bot/infrastructure/whatsapp-webhook.js'

const migration = await readFile(new URL('../prisma/migrations/20260927010000_new_bot_durable_ingress/migration.sql', import.meta.url), 'utf8')
const database = new PGlite()
const secrets = { 'phone-a': 'secret-a', 'phone-b': 'secret-b' }
const contexts = {
  'phone-a': { businessId: 'tenant-a', vertical: 'salon', phoneNumberId: 'phone-a', appSecret: secrets['phone-a'], enabled: true },
  'phone-b': { businessId: 'tenant-b', vertical: 'workshop', phoneNumberId: 'phone-b', appSecret: secrets['phone-b'], enabled: true },
}
const client = {
  async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
    return database.transaction(async (pg) => operation({
      async $queryRaw(query: Prisma.Sql) {
        return (await pg.query(query.text, query.values)).rows
      },
    }))
  },
}

function payload(messages: unknown[], phoneNumberId = 'phone-a'): Buffer {
  return Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'account-a',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
          messages,
        },
      }],
    }],
  }), 'utf8')
}
function textMessage(id: string, from = '15551112222', text = 'hello') {
  return { id, from, timestamp: '1780000000', type: 'text', text: { body: text } }
}
function signed(rawBody: Buffer, secret = secrets['phone-a']) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
}
function makeApp(options: {
  store?: Parameters<typeof newBotWhatsAppWebhookRoutes>[1]['store']
  resolveConfiguration?: Parameters<typeof newBotWhatsAppWebhookRoutes>[1]['resolveConfiguration']
} = {}) {
  const app = Fastify({ bodyLimit: 1024 * 1024 })
  app.register(newBotWhatsAppWebhookRoutes, {
    path: '/webhooks/new-bot/whatsapp',
    resolveConfiguration: options.resolveConfiguration ?? (async (phoneNumberId: string) => contexts[phoneNumberId as keyof typeof contexts] ?? null),
    store: options.store ?? createNewBotIngressRepository(client as never),
    maxBodyBytes: 256 * 1024,
  })
  return app
}
async function post(app: ReturnType<typeof makeApp>, rawBody: Buffer, signature?: string) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/new-bot/whatsapp',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-hub-signature-256': signature } : {}),
    },
    payload: rawBody,
  })
}
async function countEvents() {
  return Number((await database.query<{ count: bigint }>('SELECT count(*)::bigint AS count FROM "NewBotInboxEvent"')).rows[0]?.count ?? 0)
}

await database.exec('CREATE TABLE "Business" ("id" text PRIMARY KEY); INSERT INTO "Business" VALUES (\'tenant-a\'), (\'tenant-b\');')
await database.exec(migration)
const app = makeApp()
try {
  await app.ready()
  const raw = payload([textMessage('event-1')])
  const response = await post(app, raw, signed(raw))
  assert.equal(response.statusCode, 200)
  assert.deepEqual(await response.json(), { status: 'accepted', accepted: 1, duplicate: 0 })
  const stored = (await database.query<{ businessId: string; vertical: string; providerEventId: string; conversationId: string; message: { kind: string; text?: string } }>(
    'SELECT "businessId", "vertical", "providerEventId", "conversationId", "message" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['event-1'],
  )).rows[0]
  assert.deepEqual(stored, { businessId: 'tenant-a', vertical: 'salon', providerEventId: 'event-1', conversationId: '15551112222', message: { kind: 'text', text: 'hello' } })

  assert.equal((await post(app, raw, signed(raw))).statusCode, 200, 'duplicate delivery is acknowledged')
  const batch = payload([
    textMessage('event-2'), { id: 'event-3', from: '15553334444', type: 'interactive', interactive: { button_reply: { id: 'service:cut', title: 'Cut' } } },
  ])
  assert.equal((await post(app, batch, signed(batch))).statusCode, 200, 'multiple messages for one authenticated phone are admitted as a batch')
  assert.deepEqual((await database.query<{ kind: string; selectionId?: string }>('SELECT "message"->>\'kind\' AS kind, "message"->>\'selectionId\' AS "selectionId" FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['event-3'])).rows[0], { kind: 'selection', selectionId: 'service:cut' })

  let emptyStatusStoreCalls = 0
  const emptyStatusesApp = makeApp({ store: { async insert() { emptyStatusStoreCalls += 1; return 'accepted' } } })
  await emptyStatusesApp.ready()
  const emptyStatusesBody = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'account-a', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-a' }, statuses: [], messages: [textMessage('empty-status-array')] } }] }],
  }))
  const emptyStatusesResponse = await post(emptyStatusesApp, emptyStatusesBody, signed(emptyStatusesBody))
  await emptyStatusesApp.close()
  // Regression probes for malformed status shape, bounded candidate traversal, and ingress field bounds.
  const malformedStatusShape = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'account-a', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-a' }, statuses: 'not-an-array', messages: [textMessage('bad-status-shape')] } }] }],
  }))
  const malformedStatusResponse = await post(app, malformedStatusShape, signed(malformedStatusShape))
  const malformedStatusStored = (await database.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['bad-status-shape'])).rows.length

  const limitProbe = { resolverCalls: 0, storeCalls: 0 }
  const limitApp = makeApp({
    resolveConfiguration: async (phoneNumberId) => {
      limitProbe.resolverCalls += 1
      return { ...contexts['phone-a'], phoneNumberId }
    },
    store: { async insert() { limitProbe.storeCalls += 1; return 'accepted' } },
  })
  await limitApp.ready()
  const elevenPhones = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: Array.from({ length: 11 }, (_, index) => ({
    id: `account-${index}`,
    changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: `phone-${index}` }, messages: [textMessage(`phone-event-${index}`)] } }],
  })) }))
  const elevenPhonesResponse = await post(limitApp, elevenPhones, signed(elevenPhones))
  const phoneLimitProbe = { statusCode: elevenPhonesResponse.statusCode, ...limitProbe }
  limitProbe.resolverCalls = 0
  limitProbe.storeCalls = 0
  const oneHundredOneMessages = payload(Array.from({ length: 101 }, (_, index) => textMessage(`message-${index}`)))
  const messageLimitResponse = await post(limitApp, oneHundredOneMessages, signed(oneHundredOneMessages))
  const messageLimitProbe = { statusCode: messageLimitResponse.statusCode, ...limitProbe }
  await limitApp.close()

  const beforeInvalidConfiguration = await countEvents()
  const laterInvalidConfigApp = makeApp({
    resolveConfiguration: async (phoneNumberId) => phoneNumberId === 'phone-b'
      ? { ...contexts['phone-b'], businessId: 'tenant-a', vertical: 'x'.repeat(81), appSecret: secrets['phone-a'] }
      : contexts['phone-a'],
  })
  await laterInvalidConfigApp.ready()
  const laterInvalidConfigBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [
    { id: 'account-a', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-a' }, messages: [textMessage('valid-first-target')] } }] },
    { id: 'account-b', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-b' }, messages: [textMessage('invalid-later-target')] } }] },
  ] }))
  const laterInvalidConfigResponse = await post(laterInvalidConfigApp, laterInvalidConfigBody, signed(laterInvalidConfigBody))
  const laterInvalidConfigPersisted = Number((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM "NewBotInboxEvent" WHERE "providerEventId" IN ($1, $2)', ['valid-first-target', 'invalid-later-target'])).rows[0]?.count ?? 0)
  await laterInvalidConfigApp.close()

  const oversizedBusinessApp = makeApp({ resolveConfiguration: async () => ({ ...contexts['phone-a'], businessId: 'b'.repeat(129) }) })
  await oversizedBusinessApp.ready()
  const oversizedBusinessBody = payload([textMessage('oversized-business')])
  const oversizedBusinessResponse = await post(oversizedBusinessApp, oversizedBusinessBody, signed(oversizedBusinessBody))
  await oversizedBusinessApp.close()

  assert.deepEqual({
    emptyStatusesStatus: emptyStatusesResponse.statusCode,
    emptyStatusStoreCalls,
    malformedStatusStatus: malformedStatusResponse.statusCode,
    malformedStatusStored,
    phoneLimitProbe,
    messageLimitProbe,
    laterInvalidConfigStatus: laterInvalidConfigResponse.statusCode,
    laterInvalidConfigPersisted,
    oversizedBusinessStatus: oversizedBusinessResponse.statusCode,
  }, {
    emptyStatusesStatus: 200,
    emptyStatusStoreCalls: 1,
    malformedStatusStatus: 400,
    malformedStatusStored: 0,
    phoneLimitProbe: { statusCode: 413, resolverCalls: 0, storeCalls: 0 },
    messageLimitProbe: { statusCode: 413, resolverCalls: 0, storeCalls: 0 },
    laterInvalidConfigStatus: 409,
    laterInvalidConfigPersisted: 0,
    oversizedBusinessStatus: 409,
  }, 'all webhook correction regressions should fail closed before persistence or configuration lookup')
  const beforeFailures = await countEvents()
  assert.equal((await post(app, raw)).statusCode, 401, 'missing signature is rejected')
  assert.equal((await post(app, raw, signed(raw, 'wrong-secret'))).statusCode, 403, 'wrong signature is rejected')
  const invalidMessageShape = payload([{ id: 'invalid-shape', from: '15551112222', type: 'text', text: { body: 42 } }])
  assert.equal((await post(app, invalidMessageShape, signed(invalidMessageShape, 'wrong-secret'))).statusCode, 403, 'message validation must not precede authentication')
  assert.equal((await post(app, invalidMessageShape, signed(invalidMessageShape))).statusCode, 400, 'authenticated malformed message is rejected')
  assert.equal((await post(app, Buffer.from(raw.toString('utf8').replace('hello', 'tampered')), signed(raw))).statusCode, 403, 'signature binds the exact raw bytes')
  const unknownPhone = payload([textMessage('unknown')], 'missing-phone')
  assert.equal((await post(app, unknownPhone, signed(unknownPhone))).statusCode, 404, 'unknown phone configuration is rejected')
  const disconnected = makeApp({ resolveConfiguration: async () => ({ ...contexts['phone-a'], enabled: false }) })
  await disconnected.ready()
  assert.equal((await post(disconnected, raw, signed(raw))).statusCode, 409, 'disconnected phone is rejected')
  await disconnected.close()
  const missingSecret = makeApp({ resolveConfiguration: async () => ({ ...contexts['phone-a'], appSecret: '' }) })
  await missingSecret.ready()
  assert.equal((await post(missingSecret, raw, signed(raw))).statusCode, 409, 'missing tenant secret is rejected closed')
  await missingSecret.close()
  const mismatch = makeApp({ resolveConfiguration: async () => ({ ...contexts['phone-a'], phoneNumberId: 'different-phone' }) })
  await mismatch.ready()
  assert.equal((await post(mismatch, raw, signed(raw))).statusCode, 409, 'mismatched phone configuration is rejected')
  await mismatch.close()

  const crossTenantBatch = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      { id: 'account-a', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-a' }, messages: [textMessage('cross-a')] } }] },
      { id: 'account-b', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-b' }, messages: [textMessage('cross-b')] } }] },
    ],
  }))
  assert.equal((await post(app, crossTenantBatch, signed(crossTenantBatch))).statusCode, 403, 'one tenant signature cannot authorize another tenant in the same batch')
  const sharedSecretBatch = makeApp({ resolveConfiguration: async (phoneNumberId) => phoneNumberId === 'phone-b' ? { ...contexts['phone-b'], appSecret: secrets['phone-a'] } : contexts['phone-a'] })
  await sharedSecretBatch.ready()
  assert.equal((await post(sharedSecretBatch, crossTenantBatch, signed(crossTenantBatch))).statusCode, 422, 'cross-tenant batches stay rejected even if config secrets match')
  await sharedSecretBatch.close()
  assert.equal(await countEvents(), beforeFailures, 'failed requests must not partially persist')
  const malformed = Buffer.from('{invalid json')
  assert.equal((await post(app, malformed, signed(malformed))).statusCode, 400)
  const statuses = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'account-a', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'phone-a' }, statuses: [{ id: 'out-1', status: 'delivered' }] } }] }],
  }))
  assert.equal((await post(app, statuses, signed(statuses))).statusCode, 422, 'status-only deliveries are never silently acknowledged')
  assert.equal(await countEvents(), beforeFailures)

  const oversize = payload([textMessage('large', '15551112222', 'x'.repeat(300_000))])
  assert.ok((await post(app, oversize, signed(oversize))).statusCode >= 400, 'oversized body must be rejected')
} finally {
  await app.close()
}

// HTTP success cannot precede the repository's committed-promise boundary.
let releaseCommit: (() => void) | undefined
const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve })
const committedThenDelayedStore = {
  async insert(record: Parameters<ReturnType<typeof createNewBotIngressRepository>['insert']>[0]) {
    const status = await createNewBotIngressRepository(client as never).insert(record)
    await commitGate
    return status
  },
}
const delayedApp = makeApp({ store: committedThenDelayedStore })
try {
  await delayedApp.ready()
  const raw = payload([textMessage('delayed-commit')])
  let responseReturned = false
  const request = post(delayedApp, raw, signed(raw)).then((response) => {
    responseReturned = true
    return response
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(responseReturned, false, 'ACK must await the committed store promise')
  assert.equal(await countEvents(), 4, 'the underlying durable INSERT is committed before releasing the acknowledgment')
  releaseCommit?.()
  assert.equal((await request).statusCode, 200)
} finally {
  releaseCommit?.()
  await delayedApp.close()
}

// A real deferred PostgreSQL constraint exercises failure at COMMIT through HTTP.
await database.exec('CREATE TABLE "WebhookCommitGate" ("id" text PRIMARY KEY); INSERT INTO "WebhookCommitGate" SELECT DISTINCT "providerEventId" FROM "NewBotInboxEvent"; ALTER TABLE "NewBotInboxEvent" ADD CONSTRAINT "webhook_commit_gate_fkey" FOREIGN KEY ("providerEventId") REFERENCES "WebhookCommitGate"("id") DEFERRABLE INITIALLY DEFERRED')
const failingApp = makeApp()
try {
  await failingApp.ready()
  const raw = payload([textMessage('commit-fails')])
  assert.equal((await post(failingApp, raw, signed(raw))).statusCode, 503)
  assert.equal((await database.query('SELECT 1 FROM "NewBotInboxEvent" WHERE "providerEventId"=$1', ['commit-fails'])).rows.length, 0)
} finally {
  await failingApp.close()
  await database.close()
}
console.log('new-bot-webhook-test: OK')