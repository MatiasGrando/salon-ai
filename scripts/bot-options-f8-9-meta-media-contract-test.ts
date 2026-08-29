import assert from 'node:assert/strict'
import { downloadMetaDepositProof, MetaDepositMediaError } from '../src/bot-options/infrastructure/meta-deposit-proof-media.js'
import { DEPOSIT_PROOF_MAX_BYTES } from '../src/services/deposit-proof-image-validation.js'
import { renderDepositNotification } from '../src/services/deposit-notification-content.js'
import { encodeDirectNotificationRecovery, isDirectNotificationRecoveryAggregate, parseDirectNotificationRecovery } from '../src/services/deposit-notification-outbox.js'

const headers = (values: Record<string, string> = {}) => ({ get: (name: string) => values[name.toLowerCase()] ?? null })
const stream = async function* (parts: Uint8Array[]) { for (const part of parts) yield part }
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00])
const fetchOk = async (url: string) => !url.startsWith('https://lookaside.fbsbx.com/')
  ? { ok: true, headers: headers(), body: null, json: async () => ({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/media-1', mime_type: 'image/jpeg', file_size: jpeg.length }) }
  : { ok: true, headers: headers({ 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }), body: stream([jpeg]) }
const accepted = await downloadMetaDepositProof({ mediaId: 'media-1', accessToken: 'token', fetch: fetchOk })
assert.deepEqual(accepted.data, jpeg)
assert.equal(accepted.mimeType, 'image/jpeg')

await assert.rejects(
  () => downloadMetaDepositProof({ mediaId: 'pdf', accessToken: 'token', fetch: async () => ({ ok: true, headers: headers(), body: null, json: async () => ({ url: 'https://cdn.example/pdf', mime_type: 'application/pdf', file_size: 1 }) }) }),
  (error: unknown) => error instanceof MetaDepositMediaError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
)
for (const maliciousUrl of ['https://attacker.example/collect', 'http://lookaside.fbsbx.com/whatsapp_business/attachments/insecure']) {
  let calls = 0
  await assert.rejects(
    () => downloadMetaDepositProof({
      mediaId: 'malicious', accessToken: 'tenant-secret',
      fetch: async () => {
        calls += 1
        if (calls > 1) throw new Error('download URL must not receive a request')
        return { ok: true, headers: headers(), body: null, json: async () => ({ url: maliciousUrl, mime_type: 'image/jpeg', file_size: jpeg.length }) }
      }
    }),
    (error: unknown) => error instanceof MetaDepositMediaError && error.code === 'UNSAFE_DOWNLOAD_URL'
  )
  assert.equal(calls, 1, `unsafe download URL must receive zero second fetches: ${maliciousUrl}`)
}
await assert.rejects(
  () => downloadMetaDepositProof({
    mediaId: 'timeout', accessToken: 'token', timeoutMs: 1,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }),
  (error: unknown) => error instanceof MetaDepositMediaError && error.code === 'DOWNLOAD_TIMEOUT'
)
await assert.rejects(
  () => downloadMetaDepositProof({ mediaId: 'large', accessToken: 'token', fetch: async () => ({ ok: true, headers: headers(), body: null, json: async () => ({ url: 'https://cdn.example/large', mime_type: 'image/png', file_size: DEPOSIT_PROOF_MAX_BYTES + 1 }) }) }),
  (error: unknown) => error instanceof MetaDepositMediaError && error.code === 'TOO_LARGE'
)
const safe = renderDepositNotification('LATE_PROOF')
assert.equal(safe.type, 'informative_text')
assert.match(safe.body, /no se reabre automáticamente/)
assert.doesNotMatch(JSON.stringify(safe), /filename|sha256|hash|proofData/i)
for (const kind of ['PROOF_RECEIVED', 'LATE_PROOF', 'INVALID_PROOF', 'PROOF_UNAVAILABLE', 'EXPIRED', 'APPROVED', 'RESUBMISSION', 'FINAL_REJECTION'] as const) {
  const recovery = { kind, depositId: `deposit-${kind}`, sourceId: `source-${kind}` }
  const encoded = encodeDirectNotificationRecovery(recovery)
  assert.deepEqual(parseDirectNotificationRecovery(encoded), recovery)
  assert.doesNotMatch(encoded, /phone|text|evidence|url|hash|filename|reason/i)
  assert.doesNotMatch(JSON.stringify(renderDepositNotification(kind)), /filename|sha256|hash|proofData|reason/i)
}
for (const malformed of [
  'direct:',
  'direct:v2:anything',
  'direct:v1:not+base64url'
]) {
  assert.equal(isDirectNotificationRecoveryAggregate(malformed), true, `${malformed} remains in the reserved direct namespace`)
  assert.equal(parseDirectNotificationRecovery(malformed), null)
}
for (const reviewId of ['direct-review-id', 'direct', 'review:direct:v1:anything', 'review-outbox-id']) {
  assert.equal(isDirectNotificationRecoveryAggregate(reviewId), false, `${reviewId} must remain a review outbox identifier`)
  assert.equal(parseDirectNotificationRecovery(reviewId), null)
}
const extraField = `direct:v1:${Buffer.from(JSON.stringify({ v: 1, kind: 'EXPIRED', depositId: 'deposit', sourceId: 'source', reason: 'forbidden' })).toString('base64url')}`
assert.equal(isDirectNotificationRecoveryAggregate(extraField), true)
assert.equal(parseDirectNotificationRecovery(extraField), null, 'recovery parser rejects non-canonical or sensitive extra fields')
const noncanonical = `direct:v1:${Buffer.from(JSON.stringify({ kind: 'EXPIRED', v: 1, sourceId: 'source', depositId: 'deposit' })).toString('base64url')}`
assert.equal(isDirectNotificationRecoveryAggregate(noncanonical), true)
assert.equal(parseDirectNotificationRecovery(noncanonical), null, 'recovery parser rejects valid-shaped but noncanonical serialization')
console.log('OK F8.9 pure: allowlisted HTTPS Meta download, URL/token exfiltration rejection, metadata/stream limits, PDF/timeout rejection, and redacted durable notification content.')
