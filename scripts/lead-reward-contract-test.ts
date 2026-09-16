import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRewardAccessToken, verifyRewardAccessToken, encryptRewardPayload, decryptRewardPayload, LeadRewardService, LeadRewardError, createSupabaseRewardStorageFromEnv } from '../src/services/lead-reward-service.js'

const secret = 'reward-test-secret-at-least-32-bytes-long'
const key = 'a'.repeat(64)
const now = new Date('2026-09-15T20:00:00.000Z')
const subject = { claimId: 'claim_1', businessId: 'tenant_1', formId: 'form_1', accessVersion: 1, expiresAt: new Date(now.getTime() + 60000) }
const token = createRewardAccessToken(secret, subject)
assert.deepEqual(verifyRewardAccessToken(secret, token, now), subject)
assert.equal(verifyRewardAccessToken(secret, token + 'x', now), null)
assert.equal(verifyRewardAccessToken(secret, token, new Date(now.getTime() + 61000)), null)
for (const type of ['LINK', 'DISCOUNT', 'TEXT'] as const) {
  const encrypted = encryptRewardPayload(key, { ...subject, rewardId: 'reward_1', type }, type === 'LINK' ? 'https://example.com/regalo' : 'Secreto')
  assert.equal(decryptRewardPayload(key, { ...subject, rewardId: 'reward_1', type }, encrypted), type === 'LINK' ? 'https://example.com/regalo' : 'Secreto')
  assert.throws(() => decryptRewardPayload(key, { ...subject, businessId: 'tenant_2', rewardId: 'reward_1', type }, encrypted))
}
assert.throws(() => encryptRewardPayload(key, { ...subject, rewardId: 'reward_1', type: 'LINK' }, 'http://example.com'), LeadRewardError)
assert.equal(createSupabaseRewardStorageFromEnv({}), undefined)
const routes = readFileSync(new URL('../src/routes/public-lead-forms.ts', import.meta.url), 'utf8')
const authGuard = readFileSync(new URL('../src/plugins/auth-guard.ts', import.meta.url), 'utf8')
assert.match(routes, /POST.*reward-claims|app\.post\('\/public\/reward-claims\/:id\/access'/)
assert.match(routes, /publicHeaders\(reply\)/)
assert.match(routes, /createPublicSubmissionResponse/)
assert.match(routes, /benefitAvailable: true, rewardClaim: \{ id: claim\.id, accessToken \}/)
assert.doesNotMatch(routes, /objectPath.*reply\.send|payloadEncrypted.*reply\.send/)
assert.match(authGuard, /public\\\/reward-claims/)

for (const type of ['FILE', 'LINK', 'DISCOUNT', 'TEXT'] as const) {
  let accessCount = 0
  let signed = 0
  const reward = { id: 'reward_1', businessId: subject.businessId, formId: subject.formId, type, enabled: true, version: 1, objectPath: `${subject.businessId}/lead-rewards/gift.pdf`, payloadEncrypted: type === 'FILE' ? null : encryptRewardPayload(key, { ...subject, rewardId: 'reward_1', type }, type === 'LINK' ? 'https://example.com/gift' : 'Secreto') }
  const row = { ...subject, id: subject.claimId, revokedAt: null as Date | null, firstAccessAt: null as Date | null, accessCount, submission: { status: 'ACCEPTED', leadId: 'lead_1', businessId: subject.businessId, formId: subject.formId }, reward }
  const fake = {
    rewardClaim: {
      async findFirst() { return row },
      async updateMany(input: { where: { businessId: string; revokedAt?: null }; data: { accessCount?: unknown } }) {
        if (row.revokedAt || input.where.businessId !== row.businessId) return { count: 0 }
        if (input.data.accessCount) accessCount++
        return { count: 1 }
      }
    }
  }
  const service = new LeadRewardService(fake as never, { tokenSecret: secret, encryptionKey: key, now: () => now, storage: { async signRead(input) { signed++; assert.equal(input.businessId, subject.businessId); assert.equal(input.expiresInSeconds, 300); return 'https://storage.example.com/file?token=signed' } } })
  const result = await service.access(subject.claimId, token, subject.businessId)
  assert.equal(result.type, type)
  assert.equal(result.type === 'FILE' ? result.url : result.value, type === 'FILE' ? 'https://storage.example.com/file?token=signed' : type === 'LINK' ? 'https://example.com/gift' : 'Secreto')
  assert.equal(accessCount, 1)
  assert.equal(signed, type === 'FILE' ? 1 : 0)
  await service.access(subject.claimId, token, subject.businessId)
  assert.equal(accessCount, 2)
  await assert.rejects(service.access(subject.claimId, token, 'tenant_2'), LeadRewardError)
  await assert.rejects(service.access('claim_other', token, subject.businessId), LeadRewardError)
  await assert.rejects(service.access(subject.claimId, token + 'x', subject.businessId), LeadRewardError)
  reward.version = 2
  await assert.rejects(service.access(subject.claimId, token, subject.businessId), LeadRewardError)
  reward.version = 1
  row.revokedAt = now
  await assert.rejects(service.access(subject.claimId, token, subject.businessId), LeadRewardError)
  row.revokedAt = null
  row.submission.leadId = null as never
  await assert.rejects(service.access(subject.claimId, token, subject.businessId), LeadRewardError)
  row.submission.leadId = 'lead_1'
  row.expiresAt = new Date(now.getTime() - 1)
  await assert.rejects(service.access(subject.claimId, token, subject.businessId), LeadRewardError)
}
console.log('lead reward contract PASS')
