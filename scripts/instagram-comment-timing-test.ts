import assert from 'node:assert/strict'
import { InstagramCommentWorker, PrismaInstagramCommentWorkerStore } from '../src/services/instagram-comment-worker.js'

const start = new Date('2026-10-26T12:00:00Z')
const week = 7 * 24 * 60 * 60 * 1000
async function scenario(input: { kind: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'; metadataDelay?: number; lockDelay?: number; lease?: number; age?: number }): Promise<{
  sends: number; row: any; outcome: string; now: Date; sendingLease: Date | null
}> {
  let milliseconds = start.getTime()
  const clock = () => new Date(milliseconds)
  let inTransaction = false, sends = 0
  let sendingLease: Date | null = null
  const row: any = { id: 'action-a', businessId: 'business-a', executionId: 'parent-a', kind: input.kind,
    body: 'Respuesta', status: 'CLAIMED', claimToken: 'owner-a', claimedUntil: new Date(milliseconds + (input.lease ?? 30_000)),
    execution: { receivedAccountId: 'professional-a', providerMediaId: 'media-a', publicationId: null, automationId: 'automation-a',
      publication: null, automation: { enabled: true, accountId: 'professional-a', privateReplyEnabled: true, publicReplyEnabled: true,
        keywords: [{ normalizedValue: 'precio' }] } } }
  const claim: any = { id: row.id, businessId: row.businessId, executionId: row.executionId, kind: row.kind,
    claimToken: row.claimToken, attempts: 1, maxAttempts: 3, providerCommentId: 'comment-a',
    commenterInstagramUserId: 'user-a', commenterUsername: null, commentText: 'precio' }
  const client: any = {
    instagramCommentAction: {
      async findFirst() { return row },
      async updateMany({ where, data }: any) {
        if (where.status !== row.status || where.claimToken !== row.claimToken ||
          (where.claimedUntil?.gt && row.claimedUntil <= where.claimedUntil.gt)) return { count: 0 }
        if (data.status === 'SENDING') sendingLease = data.claimedUntil
        Object.assign(row, data); return { count: 1 }
      }
    },
    businessInstagramConfig: { async findFirst() { return { instagramAccountId: 'professional-a', accessToken: 'fake' } } },
    instagramLead: { async upsert() { return { id: 'lead' } } }, instagramMessage: { async create() {} },
    instagramCommentExecution: { async updateMany() { return { count: 1 } } },
    async $queryRaw() { milliseconds += input.lockDelay ?? 0; return [] },
    async $transaction(callback: any) { inTransaction = true; try { return await callback(client) } finally { inTransaction = false } }
  }
  const repository = new PrismaInstagramCommentWorkerStore(client, undefined, clock)
  repository.claim = async () => claim
  const created = new Date(start.getTime() - (input.age ?? 86_400_000)).toISOString()
  const api = {
    async getComment() { assert.equal(inTransaction, false); milliseconds += input.metadataDelay ?? 0
      return { id: 'comment-a', timestamp: created, from: { id: 'user-a' }, media: { id: 'media-a' } } },
    async replyToComment() { assert.equal(inTransaction, false); sends++; return { replyId: 'reply' } },
    async sendPrivateReply() { assert.equal(inTransaction, false); sends++; return { messageId: 'dm', recipientId: 'user-a' } }
  }
  const worker = new InstagramCommentWorker(repository, api, 30_000, clock)
  const outcome = await worker.processOne(start)
  return { sends, row, outcome, now: clock(), sendingLease }
}

const cases = process.argv[2] ? [process.argv[2]] : ['metadata', 'lock', 'window', 'positive', 'identity']
for (const test of cases) {
  if (test === 'metadata') {
    assert.equal((await scenario({ kind: 'PUBLIC_REPLY', metadataDelay: 30_001 })).sends, 0, 'a claim expired during metadata must not dispatch')
    assert.equal((await scenario({ kind: 'PUBLIC_REPLY', metadataDelay: 30_000 })).sends, 0, 'a claim at its exact lease boundary is expired')
    assert.equal((await scenario({ kind: 'PRIVATE_REPLY', metadataDelay: 1000, age: week - 1000 })).sends, 0, 'the private cutoff is refreshed after metadata too')
  }
  if (test === 'lock') assert.equal((await scenario({ kind: 'PUBLIC_REPLY', lockDelay: 30_001 })).sends, 0, 'time must be read after a blocking configuration lock')
  if (test === 'window') assert.equal((await scenario({ kind: 'PRIVATE_REPLY', lease: 60_000, lockDelay: 1000, age: week - 1000 })).sends, 0, 'private eligibility must be checked at the exact dispatch boundary after the lock')
  if (test === 'positive') {
    for (const kind of ['PUBLIC_REPLY', 'PRIVATE_REPLY'] as const) {
      const result = await scenario({ kind, metadataDelay: 1000, lockDelay: 1000 })
      assert.equal(result.sends, 1)
      assert.equal(result.sendingLease?.getTime(), start.getTime() + 32_000, 'SENDING lease renews from fresh time after the lock')
    }
    assert.equal((await scenario({ kind: 'PUBLIC_REPLY', age: week + 1000 })).sends, 1, 'public replies have no private seven-day cutoff')
    assert.equal((await scenario({ kind: 'PRIVATE_REPLY', age: week - 1 })).sends, 1, 'one millisecond before cutoff is still eligible')
  }
  if (test === 'identity') {
    for (const invalid of [{ executionId: undefined }, { executionId: '' }, { kind: undefined }, { kind: 'INVALID_ACTION' }]) {
      const malformed: any = { id: 'action', businessId: 'business', claimToken: 'owner', executionId: 'parent', kind: 'PRIVATE_REPLY', ...invalid }
      let effects = 0
      const store: any = { async claim() { return malformed }, async loadConfiguration() { effects++; return null } }
      const api: any = { async sendPrivateReply() { effects++ }, async getComment() { effects++ } }
      assert.equal(await new InstagramCommentWorker(store, api).processOne(), 'SKIPPED')
      assert.equal(effects, 0, 'malformed actions fail before template signing or provider access')
      const client: any = { async $transaction() { effects++; throw new Error('must not persist') },
        instagramCommentAction: { async findFirst() { effects++; throw new Error('must not load') } } }
      const repository = new PrismaInstagramCommentWorkerStore(client)
      assert.equal(await repository.loadConfiguration(malformed), null)
      assert.equal(await repository.markSending(malformed, 30_000, start), false)
      assert.equal(await repository.completeSent({ execution: malformed, publicationId: null, automationId: 'automation', body: 'test', providerMessageId: 'dm', recipientId: null }), false)
      assert.equal(effects, 0, 'missing parent IDs never permit a broad parent update')
    }
  }
}
console.log('OK: real worker/repository use fresh metadata/lock time for leases and private dispatch windows')
