import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import {
  extractUntrustedPhoneNumberIdCandidate,
  parseWhatsAppWebhookPayload,
  verifyMetaSignature
} from '../src/bot-options/infrastructure/meta-webhook-adapter.js'

const SECRET = 'app-secret-de-prueba'
const RAW_BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

// ─── Firma (decisión D) ───────────────────────────────────────────────────────

const goodSignature = 'sha256=' + createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')
assert.deepEqual(verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: goodSignature, appSecret: SECRET }), { ok: true })

// Body crudo con bytes distintos aunque el JSON sea equivalente → firma distinta.
assert.equal(
  verifyMetaSignature({ rawBody: '{"a":1}', signatureHeader: 'sha256=' + createHmac('sha256', SECRET).update('{ "a":1 }').digest('hex'), appSecret: SECRET }).ok,
  false
)

assert.equal(verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: undefined, appSecret: SECRET }).ok, false)
assert.equal(verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: '', appSecret: SECRET }).ok, false)
assert.equal(verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: 'sha256=zz', appSecret: SECRET }).ok, false)
assert.deepEqual(
  verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: [goodSignature, goodSignature], appSecret: SECRET }),
  { ok: false, reason: 'duplicate_header' }
)
assert.deepEqual(
  verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: goodSignature, appSecret: '' }),
  { ok: false, reason: 'empty_secret' }
)
assert.deepEqual(
  verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: goodSignature, appSecret: '   ' }),
  { ok: false, reason: 'empty_secret' }
)
assert.equal(
  verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: 'md5=abc', appSecret: SECRET }).ok,
  false,
  'sólo se acepta sha256'
)

const tampered = 'sha256=' + createHmac('sha256', 'otro-secreto').update(RAW_BODY).digest('hex')
const tamperedCheck = verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: tampered, appSecret: SECRET })
assert.equal(tamperedCheck.ok, false)
if (!tamperedCheck.ok) assert.equal(tamperedCheck.reason, 'invalid_signature')

const flippedBit = Buffer.from(RAW_BODY, 'utf8')
const flipIndex = flippedBit.length - 2
flippedBit[flipIndex] = (flippedBit[flipIndex] as number) ^ 0x01
assert.equal(
  verifyMetaSignature({ rawBody: flippedBit, signatureHeader: goodSignature, appSecret: SECRET }).ok,
  false,
  'un byte alterado invalida la firma'
)

// Longitud de firma inválida no debe comparar buffers de largo distinto.
assert.equal(verifyMetaSignature({ rawBody: RAW_BODY, signatureHeader: 'sha256=abcd', appSecret: SECRET }).ok, false)

// Sanidad: HMAC determinista con entrada aleatoria; buffer crudo con firma propia verifica.
const noise = randomBytes(32).toString('hex')
assert.equal(
  verifyMetaSignature({ rawBody: noise, signatureHeader: 'sha256=' + createHmac('sha256', SECRET).update(noise).digest('hex'), appSecret: SECRET }).ok,
  true
)

const rawBufferBody = randomBytes(64)
const bufferSignature = 'sha256=' + createHmac('sha256', SECRET).update(rawBufferBody).digest('hex')
assert.equal(verifyMetaSignature({ rawBody: rawBufferBody, signatureHeader: bufferSignature, appSecret: SECRET }).ok, true)
assert.equal(verifyMetaSignature({ rawBody: rawBufferBody, signatureHeader: goodSignature, appSecret: SECRET }).ok, false)

// ─── Parseo de mensajes y statuses ───────────────────────────────────────────

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'PN_1', display_phone_number: '5491100000000' },
            contacts: [{ profile: { name: 'Ana' }, wa_id: '5491144444444' }],
            messages: [
              {
                from: '5491144444444',
                id: 'wamid.texto',
                timestamp: '1756080000',
                type: 'text',
                text: { body: 'hola' }
              },
              {
                from: '5491144444444',
                id: 'wamid.boton',
                timestamp: '1756080001',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: { id: 'b1.abc.def', title: 'Sacar un turno' }
                }
              },
              {
                from: '5491144444444',
                id: 'wamid.doc',
                timestamp: '1756080002',
                type: 'document',
                document: { id: 'media_1', mime_type: 'application/pdf', filename: 'comprobante.pdf' }
              },
              {
                from: '5491144444444',
                id: 'wamid.audio',
                timestamp: '1756080003',
                type: 'audio',
                audio: { id: 'media_2', mime_type: 'audio/ogg' }
              }
            ],
            statuses: [
              { id: 'wamid.texto', status: 'delivered', timestamp: '1756080010', recipient_id: '5491144444444' },
              {
                id: 'wamid.boton',
                status: 'failed',
                timestamp: '1756080011',
                recipient_id: '5491144444444',
                errors: [{ message: 'algo falló' }]
              }
            ]
          }
        }
      ]
    }
  ]
}

const parsed = parseWhatsAppWebhookPayload(payload)
const messages = parsed.events.filter((event) => event.kind === 'message')
assert.equal(messages.length, 4)

const textEvent = messages[0]!
assert.ok(textEvent.kind === 'message' && textEvent.messageType === 'text')
assert.equal(textEvent.eventKey, 'wamid.texto')
assert.equal(textEvent.phoneNumberId, 'PN_1')
assert.equal(textEvent.textBody, 'hola')
assert.equal(textEvent.providerOccurredAtIso, new Date(1756080000 * 1000).toISOString())

const buttonEvent = messages[1]
assert.ok(buttonEvent && buttonEvent.kind === 'message' && buttonEvent.messageType === 'interactive')
if (buttonEvent.kind === 'message') assert.equal(buttonEvent.interactiveReplyId, 'b1.abc.def')

const documentEvent = messages[2]
assert.ok(documentEvent && documentEvent.kind === 'message' && documentEvent.mediaType === 'document')
if (documentEvent.kind === 'message') {
  assert.equal(documentEvent.mediaId, 'media_1')
  assert.equal(documentEvent.filename, 'comprobante.pdf')
}

const audioEvent = messages[3]
assert.ok(audioEvent && audioEvent.kind === 'message' && audioEvent.messageType === 'unsupported')

const statuses = parsed.events.filter((event) => event.kind === 'status')
assert.equal(statuses.length, 2)
const delivered = statuses[0]
assert.ok(delivered && delivered.kind === 'status' && delivered.status === 'delivered')
if (delivered.kind === 'status') assert.equal(delivered.eventKey, 'wamid.texto:delivered:1756080010')
const failedStatus = statuses[1]
assert.ok(failedStatus && failedStatus.kind === 'status' && failedStatus.status === 'failed')
if (failedStatus.kind === 'status') assert.equal(failedStatus.errorMessage, 'algo falló')

// Payload vacío/desconocido no rompe y queda tipado.
const empty = parseWhatsAppWebhookPayload({ object: 'whatsapp_business_account', entry: [] })
assert.equal(empty.events[0]?.kind, 'unsupported_change')
assert.match(empty.events[0]?.eventKey ?? '', /^unknown-change:[0-9a-f]{64}$/)
assert.equal(
  empty.events[0]?.eventKey,
  parseWhatsAppWebhookPayload({ entry: [], object: 'whatsapp_business_account' }).events[0]?.eventKey,
  'el hash canónico no depende del orden de claves'
)
assert.notEqual(empty.events[0]?.eventKey, parseWhatsAppWebhookPayload({ object: 'otro', entry: [] }).events[0]?.eventKey)
assert.equal(parseWhatsAppWebhookPayload(null).events[0]?.kind, 'unsupported_change')

const hugeTimestampPayload = structuredClone(payload)
hugeTimestampPayload.entry[0]!.changes[0]!.value.messages[0]!.timestamp = '9'.repeat(10_000)
hugeTimestampPayload.entry[0]!.changes[0]!.value.statuses[0]!.timestamp = '9'.repeat(10_000)
let hugeTimestampParsed: ReturnType<typeof parseWhatsAppWebhookPayload> | undefined
assert.doesNotThrow(() => { hugeTimestampParsed = parseWhatsAppWebhookPayload(hugeTimestampPayload) })
assert.equal(hugeTimestampParsed?.events[0]?.kind === 'message' ? hugeTimestampParsed.events[0].providerOccurredAtIso : 'unexpected', null)
const hugeStatus = hugeTimestampParsed?.events.find((event) => event.kind === 'status')
assert.equal(hugeStatus?.kind === 'status' ? hugeStatus.providerOccurredAtIso : 'unexpected', null)

// El candidato de tenant se extrae antes de confiar en el body y nunca resuelve ambigüedad.
assert.equal(extractUntrustedPhoneNumberIdCandidate(JSON.stringify(payload)), 'PN_1')
assert.equal(extractUntrustedPhoneNumberIdCandidate(Buffer.from(JSON.stringify(payload), 'utf8')), 'PN_1')
assert.equal(extractUntrustedPhoneNumberIdCandidate('{'), null)
assert.equal(extractUntrustedPhoneNumberIdCandidate(Buffer.from([0xff])), null)
assert.equal(extractUntrustedPhoneNumberIdCandidate(JSON.stringify({ entry: [] })), null)

const repeatedCandidate = structuredClone(payload)
repeatedCandidate.entry.push(structuredClone(repeatedCandidate.entry[0]!))
assert.equal(extractUntrustedPhoneNumberIdCandidate(JSON.stringify(repeatedCandidate)), 'PN_1')

const ambiguousCandidate = structuredClone(payload)
const secondEntry = structuredClone(ambiguousCandidate.entry[0]!)
secondEntry.changes[0]!.value.metadata.phone_number_id = 'PN_2'
ambiguousCandidate.entry.push(secondEntry)
assert.equal(extractUntrustedPhoneNumberIdCandidate(JSON.stringify(ambiguousCandidate)), null)

console.log('OK bot-options meta adapter: firma HMAC por negocio y parseo tipado cumplen el contrato.')
