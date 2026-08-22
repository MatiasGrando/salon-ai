import { createHash } from 'node:crypto'
import sharp from 'sharp'

const DEFAULT_BUCKET = 'business-media'
const DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i

export type BusinessMediaKind = 'services' | 'professionals' | 'logos' | 'covers' | 'gallery'

export async function storeBusinessImage(input: {
  businessId: string
  kind: BusinessMediaKind
  value: string
  maxBytes: number
}): Promise<string> {
  const value = input.value.trim()
  if (!value) throw new Error('La imagen está vacía.')
  if (/^https:\/\//i.test(value)) return value

  const parsed = parseImageDataUrl(value)
  if (!parsed || parsed.bytes.length > input.maxBytes) {
    throw new Error('La imagen no tiene un formato válido o supera el tamaño permitido.')
  }

  const config = mediaStorageConfig()
  if (!config) {
    throw new Error('Supabase Storage no está configurado. Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
  }

  const optimizedBytes = await optimizeImage(parsed.bytes, input.kind)
  const digest = createHash('sha256').update(optimizedBytes).digest('hex').slice(0, 24)
  const objectPath = `${safeSegment(input.businessId)}/${input.kind}/${digest}.webp`
  const objectUrl = `${config.supabaseUrl}/storage/v1/object/${encodeObjectPath(config.bucket, objectPath)}`
  const response = await fetch(objectUrl, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'image/webp',
      'cache-control': 'max-age=31536000, immutable',
      'x-upsert': 'true'
    },
    body: optimizedBytes
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`No pude subir la imagen a Supabase Storage (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/${encodeObjectPath(config.bucket, objectPath)}`
  const verification = await fetch(publicUrl, { method: 'HEAD' })
  if (!verification.ok) {
    throw new Error(`La imagen se subió, pero su URL pública no respondió (${verification.status}).`)
  }
  return publicUrl
}

export function isStoredBusinessImageUrl(value: string) {
  const config = mediaStorageConfig()
  if (!config) return /^https:\/\//i.test(value)
  return value.startsWith(`${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/`)
}

export function mediaStorageConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || inferSupabaseUrl(process.env.DATABASE_URL)).replace(/\/$/, '')
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() || DEFAULT_BUCKET
  if (!supabaseUrl || !serviceRoleKey || !bucket) return null
  return { supabaseUrl, serviceRoleKey, bucket }
}

export function parseImageDataUrl(value: string) {
  const match = DATA_IMAGE_PATTERN.exec(value.trim())
  if (!match?.[1] || !match[2]) return null
  return {
    mimeType: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], 'base64')
  }
}

function inferSupabaseUrl(connectionString?: string) {
  if (!connectionString) return ''
  try {
    const url = new URL(connectionString)
    const directMatch = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)
    if (directMatch?.[1]) return `https://${directMatch[1]}.supabase.co`
    const poolerUser = decodeURIComponent(url.username)
    const poolerMatch = /^postgres\.([a-z0-9]+)$/i.exec(poolerUser)
    return poolerMatch?.[1] ? `https://${poolerMatch[1]}.supabase.co` : ''
  } catch {
    return ''
  }
}

async function optimizeImage(bytes: Buffer, kind: BusinessMediaKind) {
  const maxDimension = {
    services: 1000,
    professionals: 800,
    logos: 512,
    covers: 1600,
    gallery: 1200
  }[kind]
  return sharp(bytes, { animated: true, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()
}

function safeSegment(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, '_')
}

function encodeObjectPath(bucket: string, objectPath: string) {
  return [bucket, ...objectPath.split('/')].map(encodeURIComponent).join('/')
}
