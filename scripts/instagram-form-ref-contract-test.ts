import assert from 'node:assert/strict'
import { createInstagramFormRef, verifyInstagramFormRef } from '../src/services/instagram-form-ref.js'
import { readFile } from 'node:fs/promises'
import { PrismaInstagramCommentWorkerStore } from '../src/services/instagram-comment-worker.js'

const secret = 'test-secret-more-than-32-characters'
const input = { businessId: 'bizA', formId: 'formA', executionId: 'execA', expiresAt: Date.now() + 60_000 }
const token = createInstagramFormRef(secret, input)
assert.deepEqual(verifyInstagramFormRef(secret, token, { businessId: 'bizA', formId: 'formA' }), input)
assert.equal(verifyInstagramFormRef(secret, token, { businessId: 'bizB', formId: 'formA' }), null)
assert.equal(verifyInstagramFormRef(secret, token + 'x', { businessId: 'bizA', formId: 'formA' }), null)
assert.equal(verifyInstagramFormRef(secret, token, { businessId: 'bizA', formId: 'formA' }, input.expiresAt + 1000), null)
const worker = await readFile('src/services/instagram-comment-worker.ts', 'utf8')
assert.match(worker, /weex_form:/)
assert.match(worker, /createInstagramFormRef/)
assert.doesNotMatch(worker, /createPipelineLeadInTransaction/)
const before = process.env.INSTAGRAM_FORM_REF_SECRET
process.env.INSTAGRAM_FORM_REF_SECRET = secret
const store = new PrismaInstagramCommentWorkerStore({
  instagramCommentExecution: { findFirst: async () => ({ publicationId: 'pubA', automationId: 'autoA', publication: { status: 'PUBLISHED' }, automation: { enabled: true, privateReplyText: 'Completá acá {{weex_form:oferta}}', keywords: [{ normalizedValue: 'precio' }] } }) },
  businessInstagramConfig: { findFirst: async () => ({ apiAccountId: 'igA', accessToken: 'token' }) },
  businessFeatureSettings: { findUnique: async () => ({ pipelineEnabled: true, leadCaptureFormsEnabled: true }) },
  leadCaptureForm: { findFirst: async () => ({ id: 'formA', business: { customerCode: 'WX-38N6UG' } }) }
} as any)
const configuration = await store.loadConfiguration({ id: 'execA', businessId: 'bizA', claimToken: 'claim', attempts: 1, maxAttempts: 5, providerCommentId: 'commentA', commenterInstagramUserId: 'userA', commenterUsername: 'ana', commentText: 'quiero precio' })
assert.ok(configuration)
assert.match(configuration.privateReplyText, /https:\/\/demo-barber\.weex\.com\.ar\/f\/oferta\?ref=v1\./)
assert.equal(verifyInstagramFormRef(secret, configuration.privateReplyText.split('?ref=')[1], { businessId: 'bizA', formId: 'formA' })?.executionId, 'execA')
if (before === undefined) delete process.env.INSTAGRAM_FORM_REF_SECRET
else process.env.INSTAGRAM_FORM_REF_SECRET = before
console.log('instagram form ref contract: PASS')
