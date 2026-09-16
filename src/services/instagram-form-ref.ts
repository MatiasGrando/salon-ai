import { createHmac, timingSafeEqual } from 'node:crypto'

export type InstagramFormRef = {
  businessId: string
  formId: string
  executionId: string
  expiresAt: number
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function createInstagramFormRef(secret: string, input: InstagramFormRef) {
  if (secret.length < 32 || ![input.businessId, input.formId, input.executionId].every(id => SAFE_ID.test(id)) ||
      !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + MAX_AGE_MS) {
    throw new Error('INVALID_INSTAGRAM_FORM_REF')
  }
  const payload = Buffer.from(JSON.stringify(input)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url')
  return `v1.${payload}.${signature}`
}

export function verifyInstagramFormRef(secret: string, token: string, scope: { businessId: string; formId: string }, now = Date.now()): InstagramFormRef | null {
  if (secret.length < 32 || typeof token !== 'string' || token.length > 700) return null
  const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return null
  const expected = createHmac('sha256', secret).update(`v1.${match[1]}`).digest()
  const actual = Buffer.from(match[2], 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const input = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as InstagramFormRef
    if (!input || input.businessId !== scope.businessId || input.formId !== scope.formId ||
        !SAFE_ID.test(input.executionId) || !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= now || input.expiresAt > now + MAX_AGE_MS) return null
    return input
  } catch { return null }
}
