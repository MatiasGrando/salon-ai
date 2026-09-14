import 'dotenv/config'

export const instagramConfig = {
  verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? 'salon_ai_instagram_verify_95',
  apiVersion: process.env.INSTAGRAM_API_VERSION ?? 'v25.0',
  appSecret: process.env.META_APP_SECRET?.trim() || null
}

const DEFAULT_REEL_BUCKET = 'instagram-reels'
const DEFAULT_REEL_MAX_BYTES = 300 * 1024 * 1024
const DEFAULT_REEL_SIGNED_READ_TTL_SECONDS = 6 * 60 * 60

export const INSTAGRAM_REEL_UPLOAD_TTL_SECONDS = 2 * 60 * 60
export const INSTAGRAM_REEL_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const

export function instagramReelStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '') || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const bucket = process.env.SUPABASE_INSTAGRAM_REELS_BUCKET?.trim() || DEFAULT_REEL_BUCKET
  const maxBytes = positiveInteger(process.env.INSTAGRAM_REEL_MAX_BYTES, DEFAULT_REEL_MAX_BYTES)
  const signedReadTtlSeconds = positiveInteger(
    process.env.INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS,
    DEFAULT_REEL_SIGNED_READ_TTL_SECONDS
  )

  if (!supabaseUrl || !serviceRoleKey || !bucket) return null
  return { supabaseUrl, serviceRoleKey, bucket, maxBytes, signedReadTtlSeconds }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
