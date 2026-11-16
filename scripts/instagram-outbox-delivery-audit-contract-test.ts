import assert from 'node:assert/strict'
import { instagramOutboxDeliveryAudit } from '../src/bot-options/infrastructure/instagram-outbox-provider.js'

const recipientId = '17841400000000000'
const accessToken = 'never-log-this-access-token'

const accepted = instagramOutboxDeliveryAudit({
  outcome: 'accepted',
  businessId: 'business-a',
  accountId: '17841400000000001',
  recipientId,
  providerMessageId: 'mid.abc'
})
assert.deepEqual(accepted, {
  outcome: 'accepted',
  businessId: 'business-a',
  accountId: '17841400000000001',
  recipientSuffix: '0000',
  providerMessageId: 'mid.abc'
})

const rejected = instagramOutboxDeliveryAudit({
  outcome: 'rejected',
  businessId: 'business-a',
  accountId: '17841400000000001',
  recipientId,
  httpStatus: 403,
  metaCode: 10,
  metaSubcode: 2534037,
  retryable: false,
  accessToken
})
assert.deepEqual(rejected, {
  outcome: 'rejected',
  businessId: 'business-a',
  accountId: '17841400000000001',
  recipientSuffix: '0000',
  httpStatus: 403,
  metaCode: 10,
  metaSubcode: 2534037,
  retryable: false
})

const serialized = JSON.stringify({ accepted, rejected })
assert.ok(!serialized.includes(accessToken), 'audit MUST never contain the access token')
assert.ok(!serialized.includes(recipientId), 'audit MUST never contain the full recipient id')
console.log('Instagram outbox delivery audit contract: OK')
