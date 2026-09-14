import { randomUUID } from 'node:crypto'
import {
  INSTAGRAM_REEL_MIME_TYPES,
  INSTAGRAM_REEL_UPLOAD_TTL_SECONDS,
  instagramReelStorageConfig
} from '../config/instagram.js'

type ReelMimeType = (typeof INSTAGRAM_REEL_MIME_TYPES)[number]

export async function createInstagramReelUpload(input: {
  businessId: string
  mimeType: string
  sizeBytes: number
}) {
  const config = requiredConfig()
  const businessId = validateBusinessId(input.businessId)
  const mimeType = validateMimeType(input.mimeType)
  validateSize(input.sizeBytes, config.maxBytes)

  const extension = mimeType === 'video/quicktime' ? 'mov' : 'mp4'
  const objectPath = `${businessId}/instagram/reels/${randomUUID()}.${extension}`
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
}) {
  const config = requiredConfig()
  assertTenantObjectPath(input.businessId, input.objectPath)
  const expectedMimeType = validateMimeType(input.expectedMimeType)
  validateSize(input.expectedSizeBytes, config.maxBytes)

  const infoEndpoint = storageUrl(config.supabaseUrl, 'object/info', config.bucket, input.objectPath)
  const infoResponse = await fetch(infoEndpoint, { headers: serviceHeaders(config.serviceRoleKey) })
  const info = await parseStorageResponse<StorageObjectInfo>(infoResponse, 'verificar el video subido')
  const sizeBytes = metadataSize(info)
  const mimeType = metadataMimeType(info)

  if (sizeBytes !== input.expectedSizeBytes || mimeType !== expectedMimeType) {
    await deleteInstagramReelVideo({ businessId: input.businessId, objectPath: input.objectPath }).catch(() => undefined)
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

type StorageObjectInfo = {
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
  if (!objectPath.startsWith(`${businessId}/instagram/reels/`)) {
    throw new Error('El video no pertenece al comercio indicado.')
  }
  if (!/^[-a-z0-9_]+\/instagram\/reels\/[0-9a-f-]{36}\.(?:mp4|mov)$/i.test(objectPath)) {
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
  const size = Number(info.metadata?.size)
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Supabase Storage no devolvió un tamaño válido para el video.')
  }
  return size
}

function metadataMimeType(info: StorageObjectInfo) {
  const mimeType = normalizeMimeType(info.metadata?.mimetype || info.metadata?.contentType || '')
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
