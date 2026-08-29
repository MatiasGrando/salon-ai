import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const DEPOSIT_PROOF_MAX_BYTES = 3 * 1024 * 1024
export const DEPOSIT_PROOF_VALIDATOR_VERSION = 'f8-image-v1'

const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
} as const

export type DepositProofImageMimeType = typeof MIME_BY_FORMAT[keyof typeof MIME_BY_FORMAT]

export type DepositProofImageValidationResult = {
  sourceData: Buffer
  sourceMimeType: DepositProofImageMimeType
  sourceFilename: string
  sourceByteSize: number
  sourceSha256: string
  derivedData: Buffer
  derivedMimeType: 'image/webp'
  derivedByteSize: number
  derivedSha256: string
  validatorVersion: typeof DEPOSIT_PROOF_VALIDATOR_VERSION
}

export class DepositProofImageValidationError extends Error {
  constructor(readonly code: 'UNSUPPORTED_MEDIA_TYPE' | 'TOO_LARGE' | 'MAGIC_MISMATCH' | 'INVALID_IMAGE' | 'DERIVED_TOO_LARGE') {
    super(code)
  }
}

/**
 * Pure byte validation for a future proof writer. It deliberately performs no
 * I/O and emits no logs: callers may record only safe identifiers and error
 * codes, never receipt bytes, names or hashes.
 */
export async function validateDepositProofImage(input: {
  data: Uint8Array
  declaredMimeType?: string | null
  filename?: string | null
}): Promise<DepositProofImageValidationResult> {
  const sourceData = Buffer.from(input.data)
  if (!sourceData.length || sourceData.length > DEPOSIT_PROOF_MAX_BYTES) {
    throw new DepositProofImageValidationError('TOO_LARGE')
  }

  const sourceMimeType = mimeTypeFromMagic(sourceData)
  if (!sourceMimeType) throw new DepositProofImageValidationError('UNSUPPORTED_MEDIA_TYPE')
  if (normaliseMimeType(input.declaredMimeType) !== sourceMimeType) {
    throw new DepositProofImageValidationError('MAGIC_MISMATCH')
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  let derivedData: Buffer
  try {
    const image = sharp(sourceData, { animated: false, limitInputPixels: 40_000_000, failOn: 'error' })
    metadata = await image.metadata()
    if (!metadata.format || MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT] !== sourceMimeType || (metadata.pages ?? 1) !== 1) {
      throw new DepositProofImageValidationError('INVALID_IMAGE')
    }
    // rotate() applies EXIF orientation; toBuffer without withMetadata strips
    // source metadata. The fixed encoder parameters make this deterministic
    // for a fixed sharp/libvips version.
    derivedData = await image.rotate().webp({ quality: 82, effort: 4 }).toBuffer()
  } catch (error) {
    if (error instanceof DepositProofImageValidationError) throw error
    throw new DepositProofImageValidationError('INVALID_IMAGE')
  }

  if (!derivedData.length || derivedData.length > DEPOSIT_PROOF_MAX_BYTES) {
    throw new DepositProofImageValidationError('DERIVED_TOO_LARGE')
  }
  if (mimeTypeFromMagic(derivedData) !== 'image/webp') {
    throw new DepositProofImageValidationError('INVALID_IMAGE')
  }

  return {
    sourceData,
    sourceMimeType,
    sourceFilename: sanitizeDepositProofFilename(input.filename, sourceMimeType),
    sourceByteSize: sourceData.length,
    sourceSha256: sha256(sourceData),
    derivedData,
    derivedMimeType: 'image/webp',
    derivedByteSize: derivedData.length,
    derivedSha256: sha256(derivedData),
    validatorVersion: DEPOSIT_PROOF_VALIDATOR_VERSION
  }
}

export function sanitizeDepositProofFilename(value: string | null | undefined, mimeType: DepositProofImageMimeType) {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)
  const fallback = `comprobante.${extension}`
  const basename = String(value ?? '').replace(/\\/g, '/').split('/').pop() ?? ''
  const stem = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/(?:\.[^.]+)+$/, '')
    .replace(/[^a-zA-Z0-9 _.-]/g, '_')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, '')
  return stem ? `${stem}.${extension}` : fallback
}

function normaliseMimeType(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function sha256(data: Buffer) {
  return createHash('sha256').update(data).digest('hex')
}

function mimeTypeFromMagic(data: Buffer): DepositProofImageMimeType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}
