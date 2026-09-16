import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'

type RewardType = 'FILE' | 'LINK' | 'DISCOUNT' | 'TEXT'
type TokenSubject = { claimId: string; businessId: string; formId: string; accessVersion: number; expiresAt: Date }
type PayloadSubject = { businessId: string; formId: string; rewardId: string; accessVersion: number; type: Exclude<RewardType, 'FILE'> }
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/

export class LeadRewardError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) { super(code); this.name = 'LeadRewardError' }
}

function keyBytes(hex: string) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new LeadRewardError('REWARD_CONFIG_UNAVAILABLE', 503)
  return Buffer.from(hex, 'hex')
}

function aad(subject: PayloadSubject) {
  return Buffer.from(JSON.stringify([subject.businessId, subject.formId, subject.rewardId, subject.accessVersion, subject.type]), 'utf8')
}

function validLink(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password }
  catch { return false }
}

export function encryptRewardPayload(hexKey: string, subject: PayloadSubject, value: string) {
  if (!value || value.length > 8192 || (subject.type === 'LINK' && !validLink(value))) throw new LeadRewardError('INVALID_REWARD', 422)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(hexKey), nonce)
  cipher.setAAD(aad(subject))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${nonce.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

export function decryptRewardPayload(hexKey: string, subject: PayloadSubject, encrypted: string) {
  const parts = encrypted.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(hexKey), Buffer.from(parts[1]!, 'base64url'))
    decipher.setAAD(aad(subject))
    decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'))
    const value = Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString('utf8')
    if (subject.type === 'LINK' && !validLink(value)) throw new Error('Invalid HTTPS reward')
    return value
  } catch { throw new LeadRewardError('REWARD_UNAVAILABLE', 503) }
}

export function createRewardAccessToken(secret: string, subject: TokenSubject) {
  if (secret.length < 32 || ![subject.claimId, subject.businessId, subject.formId].every(id => SAFE_ID.test(id)) || !Number.isSafeInteger(subject.accessVersion) || subject.accessVersion < 1 || !Number.isFinite(subject.expiresAt.getTime())) throw new LeadRewardError('REWARD_CONFIG_UNAVAILABLE', 503)
  const payload = Buffer.from(JSON.stringify(['v1', subject.claimId, subject.businessId, subject.formId, subject.accessVersion, subject.expiresAt.getTime()]), 'utf8').toString('base64url')
  const mac = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

export function verifyRewardAccessToken(secret: string, token: string, now = new Date()): TokenSubject | null {
  if (secret.length < 32 || token.length > 700 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null
  const [payload, mac] = token.split('.')
  const expected = createHmac('sha256', secret).update(payload!).digest()
  const supplied = Buffer.from(mac!, 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    if (!Array.isArray(data) || data.length !== 6 || data[0] !== 'v1' || ![data[1], data[2], data[3]].every(id => typeof id === 'string' && SAFE_ID.test(id)) || !Number.isSafeInteger(data[4]) || data[4] < 1 || !Number.isSafeInteger(data[5]) || data[5] <= now.getTime()) return null
    return { claimId: data[1], businessId: data[2], formId: data[3], accessVersion: data[4], expiresAt: new Date(data[5]) }
  } catch { return null }
}

export type PrivateRewardStorage = { signRead(input: { businessId: string; objectPath: string; expiresInSeconds: number }): Promise<string> }

export function createSupabaseRewardStorageFromEnv(env: NodeJS.ProcessEnv = process.env): PrivateRewardStorage | undefined {
  const baseValue = env.SUPABASE_URL?.trim()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const bucket = env.SUPABASE_LEAD_REWARDS_BUCKET?.trim()
  if (!baseValue || !serviceRoleKey || !bucket || !/^[a-zA-Z0-9_-]{1,80}$/.test(bucket)) return undefined
  let base: URL
  try { base = new URL(baseValue) } catch { return undefined }
  if (base.protocol !== 'https:' || base.username || base.password) return undefined
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' }
  return {
    async signRead({ businessId, objectPath, expiresInSeconds }) {
      if (!SAFE_ID.test(businessId) || !objectPath.startsWith(`${businessId}/lead-rewards/`) || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 600) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const bucketInfo = await fetch(new URL(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, base), { headers })
      if (!bucketInfo.ok) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const bucketData = await bucketInfo.json() as { public?: unknown }
      if (bucketData.public !== false) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const path = [bucket, ...objectPath.split('/')].map(encodeURIComponent).join('/')
      const response = await fetch(new URL(`/storage/v1/object/sign/${path}`, base), { method: 'POST', headers, body: JSON.stringify({ expiresIn: expiresInSeconds }) })
      if (!response.ok) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const data = await response.json() as { signedURL?: unknown }
      if (typeof data.signedURL !== 'string') throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const signed = new URL(data.signedURL.startsWith('/object/') ? `/storage/v1${data.signedURL}` : data.signedURL, base)
      if (signed.origin !== base.origin || !signed.pathname.startsWith(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/`) || !signed.searchParams.has('token')) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      return signed.toString()
    }
  }
}

export class LeadRewardService {
  constructor(private readonly client: Pick<Prisma.TransactionClient, 'rewardClaim'>, private readonly options: { tokenSecret: string; encryptionKey: string; storage?: PrivateRewardStorage; now?: () => Date }) {}

  async access(claimId: string, bearer: string, expectedBusinessId?: string) {
    const now = this.options.now?.() ?? new Date()
    const subject = verifyRewardAccessToken(this.options.tokenSecret, bearer, now)
    if (!subject || subject.claimId !== claimId || (expectedBusinessId && subject.businessId !== expectedBusinessId)) throw new LeadRewardError('REWARD_NOT_AVAILABLE', 404)
    const claim = await this.client.rewardClaim.findFirst({ where: { id: claimId, businessId: subject.businessId, formId: subject.formId }, include: { submission: true, reward: true } })
    if (!claim || claim.accessVersion !== subject.accessVersion || claim.revokedAt || (claim.expiresAt && claim.expiresAt <= now) || claim.submission.status !== 'ACCEPTED' || !claim.submission.leadId || claim.submission.businessId !== subject.businessId || claim.submission.formId !== subject.formId || !claim.reward.enabled || claim.reward.version !== claim.accessVersion || claim.reward.businessId !== subject.businessId || claim.reward.formId !== subject.formId) throw new LeadRewardError('REWARD_NOT_AVAILABLE', 404)
    const tokenExpiry = subject.expiresAt.getTime()
    if (claim.expiresAt && tokenExpiry > claim.expiresAt.getTime()) throw new LeadRewardError('REWARD_NOT_AVAILABLE', 404)
    let result: { type: RewardType; value?: string; url?: string; expiresInSeconds?: number }
    if (claim.reward.type === 'FILE') {
      if (!this.options.storage || !claim.reward.objectPath) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const objectPath = claim.reward.objectPath
      if (!objectPath.startsWith(`${subject.businessId}/lead-rewards/`) || !/^[a-zA-Z0-9_-]+\/lead-rewards\/[a-zA-Z0-9_./-]{1,240}$/.test(objectPath) || objectPath.includes('..')) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const url = await this.options.storage.signRead({ businessId: subject.businessId, objectPath, expiresInSeconds: 300 })
      if (!validLink(url)) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      result = { type: 'FILE', url, expiresInSeconds: 300 }
    } else {
      if (!claim.reward.payloadEncrypted) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
      const value = decryptRewardPayload(this.options.encryptionKey, { ...subject, rewardId: claim.reward.id, type: claim.reward.type }, claim.reward.payloadEncrypted)
      result = { type: claim.reward.type, value }
    }
    const updated = await this.client.rewardClaim.updateMany({ where: { id: claim.id, businessId: subject.businessId, formId: subject.formId, accessVersion: subject.accessVersion, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, data: { accessCount: { increment: 1 } } })
    if (updated.count !== 1) throw new LeadRewardError('REWARD_NOT_AVAILABLE', 404)
    if (!claim.firstAccessAt) await this.client.rewardClaim.updateMany({ where: { id: claim.id, businessId: subject.businessId, firstAccessAt: null }, data: { firstAccessAt: now } })
    return result
  }
}
