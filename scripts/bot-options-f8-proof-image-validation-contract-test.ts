import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  DEPOSIT_PROOF_MAX_BYTES,
  DepositProofImageValidationError,
  sanitizeDepositProofFilename,
  validateDepositProofImage
} from '../src/services/deposit-proof-image-validation.js'

for (const [mimeType, bytes] of await Promise.all([
  sharp({ create: { width: 2, height: 2, channels: 3, background: '#135' } }).jpeg().toBuffer().then((bytes) => ['image/jpeg', bytes] as const),
  sharp({ create: { width: 2, height: 2, channels: 4, background: '#2468' } }).png().toBuffer().then((bytes) => ['image/png', bytes] as const),
  sharp({ create: { width: 2, height: 2, channels: 3, background: '#357' } }).webp().toBuffer().then((bytes) => ['image/webp', bytes] as const)
])) {
  const result = await validateDepositProofImage({ data: bytes, declaredMimeType: mimeType, filename: '../Recibo\r\n.exe' })
  assert.equal(result.sourceMimeType, mimeType)
  assert.equal(result.derivedMimeType, 'image/webp')
  assert.match(result.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(result.derivedSha256, /^[0-9a-f]{64}$/)
  assert.equal(result.sourceFilename, mimeType === 'image/jpeg' ? 'Recibo.jpg' : `Recibo.${mimeType.slice(6)}`)
  assert.ok(result.derivedByteSize <= DEPOSIT_PROOF_MAX_BYTES)
}

await assert.rejects(
  validateDepositProofImage({ data: Buffer.from('%PDF-1.7'), declaredMimeType: 'application/pdf', filename: 'receipt.pdf' }),
  (error: unknown) => error instanceof DepositProofImageValidationError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
)
const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer()
await assert.rejects(
  validateDepositProofImage({ data: png, declaredMimeType: 'image/jpeg', filename: 'spoof.jpg' }),
  (error: unknown) => error instanceof DepositProofImageValidationError && error.code === 'MAGIC_MISMATCH'
)
await assert.rejects(
  validateDepositProofImage({ data: Buffer.alloc(DEPOSIT_PROOF_MAX_BYTES + 1), declaredMimeType: 'image/png' }),
  (error: unknown) => error instanceof DepositProofImageValidationError && error.code === 'TOO_LARGE'
)
assert.equal(sanitizeDepositProofFilename('..\\evil\u0000.jpg.exe', 'image/jpeg'), 'evil.jpg')

console.log('OK F8.4: JPEG/PNG/WebP magic, full decode/re-encode, bounded output, hashes, filename sanitisation and PDF rejection.')
