import assert from 'node:assert/strict'
import { InstagramApiRequestError } from '../src/integrations/instagram-api.js'
import {
  InstagramCommentIngressService,
  type InstagramCommentIngressStore
} from '../src/services/instagram-comment-ingress-service.js'
import {
  InstagramCommentWorker,
  type ClaimedInstagramComment,
  type InstagramCommentWorkerStore,
  PrismaInstagramCommentWorkerStore
} from '../src/services/instagram-comment-worker.js'

const commentPayload = (overrides: Record<string, unknown> = {}) => ({
  object: 'instagram',
  entry: [{
    id: 'ig-account-a',
    time: 1000,
    changes: [{
      field: 'comments',
      value: {
        id: 'comment-shared', text: 'Necesito PRECIO',
        from: { id: 'commenter-1', username: 'ana' },
        media: { id: 'reel-a', media_product_type: 'REELS' },
        ...overrides
      }
    }]
  }]
})

class IngressStore implements InstagramCommentIngressStore {
  rows = new Set<string>()
  creates: Array<{ businessId: string; providerCommentId: string; matchedKeyword: string }> = []
  constructor(private readonly businessId = 'business-a') {}
  async resolveTarget(input: { instagramAccountIds: string[]; mediaId: string }) {
    if (!input.instagramAccountIds.includes('ig-account-a') || input.mediaId !== 'reel-a') return null
    return {
      businessId: this.businessId,
      publicationId: `publication-${this.businessId}`,
      automationId: `automation-${this.businessId}`,
      keywords: ['precio', 'turno']
    }
  }
  async createExecutionIfAbsent(input: Parameters<InstagramCommentIngressStore['createExecutionIfAbsent']>[0]) {
    const key = `${input.businessId}:${input.providerCommentId}`
    if (this.rows.has(key)) return false
    this.rows.add(key)
    this.creates.push(input)
    return true
  }
}

const ingressStore = new IngressStore()
const ingress = new InstagramCommentIngressService(ingressStore)
assert.deepEqual(await ingress.ingest(commentPayload()), { received: true, parsed: 1, created: 1, duplicates: 0 })
assert.deepEqual(await ingress.ingest(commentPayload()), { received: true, parsed: 1, created: 0, duplicates: 1 })
assert.equal(ingressStore.creates[0]?.matchedKeyword, 'precio')
assert.equal(ingressStore.creates[0]?.businessId, 'business-a')

for (const payload of [
  commentPayload({ verb: 'remove' }),
  commentPayload({ parent_id: 'parent-1' }),
  commentPayload({ media: { id: 'reel-a', media_product_type: 'FEED' } }),
  commentPayload({ from: { id: 'ig-account-a', username: 'propia' } }),
  commentPayload({ text: 'No coincide' }),
  commentPayload({ id: '' })
]) await ingress.ingest(payload)
assert.equal(ingressStore.creates.length, 1)

// Idempotency is tenant scoped: the same provider id may exist for another business.
const tenantBStore = new IngressStore('business-b')
await new InstagramCommentIngressService(tenantBStore).ingest(commentPayload())
assert.equal(tenantBStore.creates[0]?.businessId, 'business-b')

const claimed: ClaimedInstagramComment = {
  id: 'execution-1', businessId: 'business-a', claimToken: 'claim-1', attempts: 1, maxAttempts: 3,
  providerCommentId: 'comment-1', commenterInstagramUserId: 'commenter-1', commenterUsername: 'ana',
  commentText: 'precio'
}

class WorkerStore implements InstagramCommentWorkerStore {
  status = 'READY'
  sent: unknown = null
  constructor(readonly valid = true) {}
  async claim() {
    if (this.status !== 'READY') return null
    this.status = 'CLAIMED'
    return claimed
  }
  async loadConfiguration() {
    return this.valid ? {
      privateReplyText: 'Te paso la info', accountId: 'ig-account-a', accessToken: 'token',
      publicationId: 'publication-a', automationId: 'automation-a'
    } : null
  }
  async markSending() { this.status = 'SENDING'; return true }
  async completeSent(input: unknown) { this.status = 'SENT'; this.sent = input; return true }
  async markRetry() { this.status = 'RETRY'; return true }
  async markUnknown() { this.status = 'UNKNOWN'; return true }
  async markFailed() { this.status = 'FAILED'; return true }
  async markSkipped() { this.status = 'SKIPPED'; return true }
}

const deliveredStore = new WorkerStore()
const apiCalls: unknown[] = []
const delivered = await new InstagramCommentWorker(deliveredStore, {
  async sendPrivateReply(input) { apiCalls.push(input); return { messageId: 'message-1', recipientId: 'commenter-1' } }
}).processOne(new Date('2026-09-13T00:00:00Z'))
assert.equal(delivered, 'SENT')
assert.equal(apiCalls.length, 1)
assert.deepEqual(deliveredStore.sent, {
  execution: claimed,
  publicationId: 'publication-a',
  automationId: 'automation-a',
  body: 'Te paso la info',
  providerMessageId: 'message-1',
  recipientId: 'commenter-1'
})

const invalidStore = new WorkerStore(false)
assert.equal(await new InstagramCommentWorker(invalidStore, { async sendPrivateReply() { throw new Error('must not send') } }).processOne(), 'SKIPPED')

for (const [error, expected] of [
  [new InstagramApiRequestError({ message: 'rate', httpStatus: 429, transient: true, ambiguous: false }), 'RETRY'],
  [new InstagramApiRequestError({ message: 'server', httpStatus: 503, transient: true, ambiguous: false }), 'RETRY'],
  [new InstagramApiRequestError({ message: 'timeout', httpStatus: null, transient: true, ambiguous: true }), 'UNKNOWN'],
  [new InstagramApiRequestError({ message: 'ambiguous response', httpStatus: 200, transient: false, ambiguous: true }), 'UNKNOWN'],
  [new InstagramApiRequestError({ message: 'bad request', httpStatus: 400, transient: false, ambiguous: false }), 'FAILED']
] as const) {
  const store = new WorkerStore()
  const outcome = await new InstagramCommentWorker(store, { async sendPrivateReply() { throw error } }).processOne()
  assert.equal(outcome, expected)
  assert.equal(store.status, expected)
  assert.equal(await new InstagramCommentWorker(store, { async sendPrivateReply() { throw new Error('must not resend') } }).processOne(), 'IDLE')
}

console.log('Instagram comment services contract: OK')

const updateCalls: any[] = []
const messageCreates: any[] = []
const prismaStore = new PrismaInstagramCommentWorkerStore({
  instagramCommentExecution: {
    async findMany() {
      return [{
        id: 'execution-db', businessId: 'business-db', status: 'READY', claimToken: null,
        attempts: 0, maxAttempts: 3, providerCommentId: 'comment-db',
        commenterInstagramUserId: 'user-db', commenterUsername: null, commentText: 'precio'
      }]
    },
    async findFirst() { return null },
    async updateMany(input: any) { updateCalls.push(input); return { count: 1 } }
  },
  businessInstagramConfig: { async findFirst() { return null } },
  instagramLead: { async upsert() { return { id: 'lead-db' } } },
  instagramMessage: { async create(input: any) { messageCreates.push(input) } },
  async $transaction(callback: (tx: any) => Promise<unknown>) { return callback(this) }
} as any)
const dbClaim = await prismaStore.claim(new Date('2026-09-13T00:00:00Z'), 45_000)
assert.ok(dbClaim)
assert.equal(updateCalls[0].where.businessId, 'business-db')
assert.equal(updateCalls[0].data.status, 'CLAIMED')
assert.equal(typeof updateCalls[0].data.claimToken, 'string')
await prismaStore.markSending(dbClaim, new Date('2026-09-13T00:00:00Z'), 45_000)
assert.deepEqual(
  { businessId: updateCalls[1].where.businessId, claimToken: updateCalls[1].where.claimToken, status: updateCalls[1].where.status },
  { businessId: 'business-db', claimToken: dbClaim.claimToken, status: 'CLAIMED' }
)
assert.equal(await prismaStore.completeSent({
  execution: dbClaim,
  publicationId: 'publication-db',
  automationId: 'automation-db',
  body: 'Te paso la info',
  providerMessageId: 'message-db',
  recipientId: 'user-db'
}), true)
assert.equal(messageCreates[0].data.direction, 'OUTBOUND')
assert.equal(messageCreates[0].data.metadata.origin, 'REEL_COMMENT_AUTOMATION')
assert.equal(messageCreates[0].data.metadata.providerCommentId, 'comment-db')
assert.equal(messageCreates[0].data.metadata.publicationId, 'publication-db')
assert.equal(messageCreates[0].data.metadata.automationId, 'automation-db')

console.log('Instagram comment Prisma fencing contract: OK')
