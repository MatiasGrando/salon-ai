import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  INSTAGRAM_REEL_MIME_TYPES,
  INSTAGRAM_REEL_UPLOAD_TTL_SECONDS,
  instagramReelStorageConfig
} from '../config/instagram.js'

type ReelMimeType = (typeof INSTAGRAM_REEL_MIME_TYPES)[number]

export async function createInstagramReelUpload(input: {
  publicationType?: 'REEL' | 'STORY'
  businessId: string
  mimeType: string
  sizeBytes: number
}) {
  const config = requiredConfig()
  const businessId = validateBusinessId(input.businessId)
  const story = input.publicationType === 'STORY'
  const mimeType = story && input.mimeType === 'image/jpeg' ? 'image/jpeg' : validateMimeType(input.mimeType)
  validateSize(input.sizeBytes, mimeType === 'image/jpeg' ? 8 * 1024 * 1024 : config.maxBytes)

  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'video/quicktime' ? 'mov' : 'mp4'
  const objectPath = `${businessId}/instagram/${story ? 'stories' : 'reels'}/${randomUUID()}.${extension}`
  const endpoint = storageUrl(config.supabaseUrl, 'object/upload/sign', config.bucket, objectPath)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: serviceHeaders(config.serviceRoleKey, true),
    body: '{}'
  })
  const data = await parseStorageResponse<{ url?: string }>(response, 'generar la URL firmada de subida')
  const uploadUrl = resolveStorageSignedUrl(config.supabaseUrl, data.url)
  const uploadToken = new URL(uploadUrl).searchParams.get('token')
  if (!uploadToken) throw new Error('Supabase Storage no devolvió el token de subida.')

  return {
    bucket: config.bucket,
    objectPath,
    uploadUrl,
    uploadToken,
    expiresInSeconds: INSTAGRAM_REEL_UPLOAD_TTL_SECONDS,
    uploadHeaders: {
      'cache-control': 'max-age=3600',
      'content-type': mimeType,
      'x-upsert': 'false'
    }
  }
}

export async function verifyAndSignInstagramReelVideo(input: {
  businessId: string
  objectPath: string
  expectedMimeType: string
  expectedSizeBytes: number
  readOnly?: boolean
}) {
  const config = requiredConfig()
  assertTenantObjectPath(input.businessId, input.objectPath)
  const image = input.objectPath.includes('/instagram/stories/') && input.expectedMimeType === 'image/jpeg'
  const expectedMimeType = image ? 'image/jpeg' : validateMimeType(input.expectedMimeType)
  validateSize(input.expectedSizeBytes, image ? 8 * 1024 * 1024 : config.maxBytes)

  const infoEndpoint = storageUrl(config.supabaseUrl, 'object/info', config.bucket, input.objectPath)
  const infoResponse = await fetch(infoEndpoint, { headers: serviceHeaders(config.serviceRoleKey) })
  const info = await parseStorageResponse<StorageObjectInfo>(infoResponse, 'verificar el video subido')
  const sizeBytes = metadataSize(info)
  const mimeType = metadataMimeType(info)

  if (sizeBytes !== input.expectedSizeBytes || mimeType !== expectedMimeType) {
    if (!input.readOnly) await deleteInstagramReelVideo({ businessId: input.businessId, objectPath: input.objectPath }).catch(() => undefined)
    throw new Error('El video subido no coincide con el tipo o tamaño declarado y fue descartado.')
  }

  const signEndpoint = storageUrl(config.supabaseUrl, 'object/sign', config.bucket, input.objectPath)
  const signResponse = await fetch(signEndpoint, {
    method: 'POST',
    headers: serviceHeaders(config.serviceRoleKey, true),
    body: JSON.stringify({ expiresIn: config.signedReadTtlSeconds })
  })
  const signed = await parseStorageResponse<{ signedURL?: string }>(signResponse, 'generar la URL temporal de lectura')
  const signedUrl = resolveStorageSignedUrl(config.supabaseUrl, signed.signedURL)

  const verification = await fetch(signedUrl, { method: 'HEAD' })
  if (!verification.ok) {
    throw new Error(`La URL temporal del video no respondió (${verification.status}).`)
  }
  const headSize = optionalHeaderInteger(verification.headers.get('content-length'))
  const headMime = normalizeMimeType(verification.headers.get('content-type'))
  if ((headSize !== null && headSize !== sizeBytes) || (headMime && headMime !== mimeType)) {
    throw new Error('La URL temporal del video devolvió metadata inconsistente.')
  }

  if (image) {
    const response = await fetch(signedUrl, { signal: AbortSignal.timeout(10000) })
    if (!response.ok || !response.body) throw new Error('No se pudo leer la foto para verificarla.')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 8 * 1024 * 1024 || total > sizeBytes) throw new Error('La foto supera el tamaño declarado.'); chunks.push(value) }
    } finally { await reader.cancel().catch(() => undefined) }
    if (total !== sizeBytes) throw new Error('La foto no coincide con el tamaño declarado.')
    const bytes = Buffer.concat(chunks)
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).metadata()
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) throw new Error('invalid')
      await sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).raw().toBuffer()
    } catch { throw new Error('La foto debe ser un JPEG válido de hasta 20 megapíxeles (política del CRM).') }
  }
  return {
    signedUrl,
    expiresInSeconds: config.signedReadTtlSeconds,
    expiresAt: new Date(Date.now() + config.signedReadTtlSeconds * 1000),
    sizeBytes,
    mimeType
  }
}

export async function deleteInstagramReelVideo(input: { businessId: string; objectPath: string }) {
  const config = requiredConfig()
  assertTenantObjectPath(input.businessId, input.objectPath)
  const endpoint = storageUrl(config.supabaseUrl, 'object', config.bucket)
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: serviceHeaders(config.serviceRoleKey, true),
    body: JSON.stringify({ prefixes: [input.objectPath] })
  })
  await parseStorageResponse<unknown>(response, 'eliminar el video')
}

export async function copyInstagramReelVideo(input: {
  businessId: string; sourceObjectPath: string; destinationObjectPath: string; expectedMimeType: string; expectedSizeBytes: number
}) {
  const config = requiredConfig()
  assertTenantObjectPath(input.businessId, input.sourceObjectPath)
  assertTenantObjectPath(input.businessId, input.destinationObjectPath)
  if (input.sourceObjectPath === input.destinationObjectPath) throw new Error('La copia requiere un archivo independiente.')
  const image = input.sourceObjectPath.includes('/instagram/stories/') && input.expectedMimeType === 'image/jpeg'
  const mimeType = image ? 'image/jpeg' : validateMimeType(input.expectedMimeType)
  validateSize(input.expectedSizeBytes, image ? 8 * 1024 * 1024 : config.maxBytes)
  // Read-only validation: the upload verifier intentionally deletes bad inputs.
  const response = await fetch(storageUrl(config.supabaseUrl, 'object/info', config.bucket, input.sourceObjectPath), { headers: serviceHeaders(config.serviceRoleKey) })
  const metadata = await parseStorageResponse<StorageObjectInfo>(response, 'leer el archivo original')
  if (metadataSize(metadata) !== input.expectedSizeBytes || metadataMimeType(metadata) !== mimeType) throw new Error('El archivo original no coincide con su metadata.')
  await parseStorageResponse(await fetch(config.supabaseUrl + '/storage/v1/object/copy', {
    method: 'POST', headers: { ...serviceHeaders(config.serviceRoleKey, true), 'x-upsert': 'false' },
    body: JSON.stringify({ bucketId: config.bucket, sourceKey: input.sourceObjectPath, destinationKey: input.destinationObjectPath, copyMetadata: true })
  }), 'copiar el video')
  // Only the new object may be discarded by destructive upload validation.
  try {
    await verifyAndSignInstagramReelVideo({ businessId: input.businessId, objectPath: input.destinationObjectPath,
      expectedMimeType: mimeType, expectedSizeBytes: input.expectedSizeBytes })
  } catch (error) {
    // A successful no-overwrite copy establishes ownership; a failed POST does not.
    await deleteInstagramReelVideo({ businessId: input.businessId, objectPath: input.destinationObjectPath }).catch(() => undefined)
    throw error
  }
}

type StorageObjectInfo = {
  size?: number | string
  content_type?: string
  contentType?: string
  metadata?: {
    size?: number | string
    mimetype?: string
    contentType?: string
  }
}

function requiredConfig() {
  const config = instagramReelStorageConfig()
  if (!config) {
    throw new Error('Supabase Storage para Reels no está configurado. Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
  }
  return config
}

function validateBusinessId(value: string) {
  const businessId = value.trim()
  if (!/^[a-z0-9_-]+$/i.test(businessId)) {
    throw new Error('El identificador del comercio no es válido para almacenar el Reel.')
  }
  return businessId
}

function assertTenantObjectPath(businessIdValue: string, objectPath: string) {
  const businessId = validateBusinessId(businessIdValue)
  if (!objectPath.startsWith(`${businessId}/instagram/reels/`) && !objectPath.startsWith(`${businessId}/instagram/stories/`)) {
    throw new Error('El video no pertenece al comercio indicado.')
  }
  if (!/^[-a-z0-9_]+\/instagram\/(?:reels\/[0-9a-f-]{36}\.(?:mp4|mov)|stories\/[0-9a-f-]{36}\.(?:jpg|mp4|mov))$/i.test(objectPath)) {
    throw new Error('La ruta del video de Instagram no es válida.')
  }
}

function validateMimeType(value: string): ReelMimeType {
  const mimeType = normalizeMimeType(value)
  if (!INSTAGRAM_REEL_MIME_TYPES.some(candidate => candidate === mimeType)) {
    throw new Error('El tipo de video no está permitido para un Reel.')
  }
  return mimeType as ReelMimeType
}

function validateSize(sizeBytes: number, maxBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
    throw new Error(`El tamaño declarado del video debe estar entre 1 y ${maxBytes} bytes.`)
  }
}

function metadataSize(info: StorageObjectInfo) {
  const size = Number(info.size ?? info.metadata?.size)
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Supabase Storage no devolvió un tamaño válido para el video.')
  }
  return size
}

function metadataMimeType(info: StorageObjectInfo) {
  const mimeType = normalizeMimeType(
    info.content_type
      || info.contentType
      || info.metadata?.mimetype
      || info.metadata?.contentType
      || ''
  )
  if (!mimeType) throw new Error('Supabase Storage no devolvió el tipo de contenido del video.')
  return mimeType
}

function normalizeMimeType(value: string | null) {
  return (value || '').split(';', 1)[0]?.trim().toLowerCase() || ''
}

function optionalHeaderInteger(value: string | null) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function storageUrl(supabaseUrl: string, operation: string, bucket: string, objectPath?: string) {
  const segments = [bucket, ...(objectPath ? objectPath.split('/') : [])].map(encodeURIComponent).join('/')
  return `${supabaseUrl}/storage/v1/${operation}/${segments}`
}

function serviceHeaders(serviceRoleKey: string, json = false) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...(json ? { 'content-type': 'application/json' } : {})
  }
}

function resolveStorageSignedUrl(supabaseUrl: string, value: string | undefined) {
  if (!value) throw new Error('Supabase Storage no devolvió una URL firmada.')
  const storageBase = new URL('/storage/v1/', `${supabaseUrl}/`)
  const storageRelativeValue = value.startsWith('/object/') ? `/storage/v1${value}` : value
  const resolved = new URL(storageRelativeValue, storageBase)
  if (resolved.origin !== storageBase.origin || !resolved.pathname.startsWith('/storage/v1/object/')) {
    throw new Error('Supabase Storage devolvió una URL firmada inválida.')
  }
  return resolved.toString()
}

async function parseStorageResponse<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`No pude ${action} en Supabase Storage (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new Error(`Supabase Storage devolvió una respuesta inválida al intentar ${action}.`)
  }
}
