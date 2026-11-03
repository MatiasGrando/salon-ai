import assert from 'node:assert/strict'
import { InstagramCommentWorker as ProductionInstagramCommentWorker } from '../src/services/instagram-comment-worker.js'
import { PrismaInstagramCommentWorkerStore } from '../src/services/instagram-comment-worker.js'
import { InstagramApi, InstagramApiRequestError } from '../src/integrations/instagram-api.js'

const now = new Date('2026-10-26T12:00:00Z')
class InstagramCommentWorker extends ProductionInstagramCommentWorker {
  constructor(store: ConstructorParameters<typeof ProductionInstagramCommentWorker>[0], api: ConstructorParameters<typeof ProductionInstagramCommentWorker>[1]) {
    super(store, api, 30_000, () => now)
  }
}
const action: any = { id: 'action-public', executionId: 'execution-1', kind: 'PUBLIC_REPLY', businessId: 'business-a',
  claimToken: 'claim-a', attempts: 1, maxAttempts: 3, providerCommentId: 'comment-a',
  commenterInstagramUserId: 'user-a', commenterUsername: 'ana', commentText: 'precio' }
let publicCalls = 0
let privateCalls = 0
let completed: any
const store: any = {
  async claim() { return action },
  async loadConfiguration() { return { accountId: 'professional-a', accessToken: 'fake-token',
    publicationId: null, providerMediaId: 'media-a', automationId: 'automation-a', publicReplyText: 'Te respondemos por acá', privateReplyText: 'Privado' } },
  async markSending() { return true },
  async completeSent(input: any) { completed = input; return true },
  async markSkipped() { return true }, async markFailed() { return true }, async markUnknown() { return true }
}
const api: any = {
  async sendPrivateReply() { privateCalls++; return { messageId: 'dm-a', recipientId: 'user-a' } },
  async replyToComment() { publicCalls++; return { replyId: 'public-a' } },
  async getComment() { return { id: 'comment-a', from: { id: 'user-a' }, media: { id: 'media-a' } } }
}
assert.equal(await new InstagramCommentWorker(store, api).processOne(now), 'SENT')
assert.equal(publicCalls, 1, 'a PUBLIC_REPLY action must use the public comment endpoint')
assert.equal(privateCalls, 0, 'a public action must not send a private message')
assert.equal(completed.providerMessageId, 'public-a')
console.log('OK: public actions use public delivery without private side effects')

class Actions {
  rows = ['PUBLIC_REPLY', 'PRIVATE_REPLY'].map((kind) => ({ ...action, id: kind, kind, status: 'READY', attempts: 0, availableAt: now }))
  completions: any[] = []
  loseFence = false
  failPersistence = false
  async claim(time: Date) {
    const row = this.rows.find((r) => ['READY', 'RETRY'].includes(r.status) && r.availableAt <= time)
    if (!row) return null
    row.status = 'CLAIMED'; row.attempts++
    return row
  }
  async loadConfiguration() { return { accountId: 'account-a', accessToken: 'fake', publicationId: null,
    automationId: 'automation-a', privateReplyText: 'Privado', publicReplyText: 'Publico', providerMediaId: 'media-a' } }
  async markSending(row: any) { if (this.loseFence) return false; row.status = 'SENDING'; return true }
  async completeSent(input: any) { if (this.failPersistence) throw new Error('DB did not commit'); input.execution.status = 'SENT'; this.completions.push(input); return true }
  async markUnknown(row: any) { row.status = 'UNKNOWN'; return true }
  async markFailed(row: any) { row.status = 'FAILED'; return true }
  async markSkipped(row: any) { row.status = 'SKIPPED'; return true }
  async markRetry(row: any, _: string, at: Date) { row.status = 'RETRY'; row.availableAt = at; return true }
  async markPreparationRetry(row: any, error: string, at: Date) { return this.markRetry(row, error, at) }
}
const metadata = { id: 'comment-a', timestamp: '2026-10-25T12:00:00Z', from: { id: 'user-a' }, media: { id: 'media-a' } }
for (const altered of [{ ...metadata, parent_id: 'parent' }, { ...metadata, from: { id: 'professional-a' } }, { ...metadata, media: { id: 'foreign-media' } }]) {
  const rows = new Actions(); rows.rows.pop()
  let sends = 0
  const result = await new InstagramCommentWorker(rows as any, { async getComment() { return altered },
    async replyToComment() { sends++; return { replyId: 'unexpected' } }, async sendPrivateReply() { throw new Error('unexpected') } }).processOne(now)
  assert.equal(result, 'SKIPPED', 'public delivery must verify root comment and identity rather than trust omitted webhook parent')
  assert.equal(sends, 0)
}
let publicSent = 0, privateSent = 0, retryPrivate = true
const independent = new Actions()
const worker = new InstagramCommentWorker(independent as any, {
  async getComment() { return metadata },
  async replyToComment() { publicSent++; return { replyId: 'reply-a' } },
  async sendPrivateReply() {
    privateSent++
    if (retryPrivate) throw new InstagramApiRequestError({ message: 'secret', httpStatus: 429, transient: true, ambiguous: false })
    return { messageId: 'dm-a', recipientId: 'user-a' }
  }
})
assert.equal(await worker.processOne(now), 'SENT')
assert.equal(await worker.processOne(now), 'RETRY')
retryPrivate = false
assert.equal(await worker.processOne(new Date(now.getTime() + 60_000)), 'SENT')
assert.equal(await worker.processOne(new Date(now.getTime() + 120_000)), 'IDLE')
assert.equal(publicSent, 1)
assert.equal(privateSent, 2)
assert.equal(independent.completions[0].publicationId, null, 'imported delivery never invents a CRM publication')

for (const [meta, expected] of [
  [{ ...metadata, timestamp: '2026-10-19T12:00:00Z' }, 'SKIPPED'],
  [{ ...metadata, timestamp: '2026-10-19T12:00:00.001Z' }, 'SENT'],
  [{ ...metadata, from: undefined }, 'SKIPPED'],
  [{ ...metadata, media: undefined }, 'SKIPPED'],
  [{ ...metadata, id: 'different-comment' }, 'SKIPPED'],
  [{}, 'SKIPPED'], [{ timestamp: '2026-10-27T12:00:00Z' }, 'SKIPPED'],
  [{ ...metadata, parent_id: 'parent' }, 'SKIPPED'],
  [{ ...metadata, from: { id: 'other' } }, 'SKIPPED'],
  [{ ...metadata, media: { id: 'other' } }, 'SKIPPED']
] as const) {
  const rows = new Actions(); rows.rows.shift()
  let sends = 0
  const outcome = await new InstagramCommentWorker(rows as any, { async getComment() { return meta as any },
    async sendPrivateReply() { sends++; return { messageId: 'dm', recipientId: null } } }).processOne(now)
  assert.equal(outcome, expected)
  assert.equal(sends, expected === 'SENT' ? 1 : 0)
}
for (const variant of ['unknown-post', 'persistence', 'fence', 'missing-id']) {
  const rows = new Actions(); rows.rows.pop()
  rows.failPersistence = variant === 'persistence'; rows.loseFence = variant === 'fence'
  let sends = 0
  const processor = new InstagramCommentWorker(rows as any, { async sendPrivateReply() { throw new Error('unexpected DM') },
    async getComment() { return metadata },
    async replyToComment() { sends++; if (variant === 'unknown-post') throw new Error('socket lost with secret'); return { replyId: variant === 'missing-id' ? '' : 'reply' } } })
  assert.equal(await processor.processOne(now), 'UNKNOWN')
  assert.equal(sends, variant === 'fence' ? 0 : 1)
  if (variant !== 'fence') assert.equal(await processor.processOne(now), 'IDLE', 'UNKNOWN is terminal, never retry a possibly accepted POST')
}
for (const kind of ['PUBLIC_REPLY', 'PRIVATE_REPLY']) for (const error of [
  new InstagramApiRequestError({ message: 'read rate', httpStatus: 429, transient: true, ambiguous: false }),
  new InstagramApiRequestError({ message: 'read server', httpStatus: 503, transient: true, ambiguous: false }),
  new InstagramApiRequestError({ message: 'read timeout', httpStatus: null, transient: true, ambiguous: false })
]) {
  const rows = new Actions(); rows.rows = rows.rows.filter((row) => row.kind === kind)
  let sends = 0
  const outcome = await new InstagramCommentWorker(rows as any, { async getComment() { throw error },
    async replyToComment() { sends++; return { replyId: 'unexpected' } }, async sendPrivateReply() { sends++; return { messageId: 'unexpected', recipientId: null } } }).processOne(now)
  assert.equal(outcome, 'RETRY', 'transient metadata GET failures are retryable before any POST')
  assert.equal(sends, 0)
  assert.equal(rows.rows[0]!.status, 'RETRY')
}

// The real persistence adapter shares legacy form rendering only with private actions.
const parent: any = { receivedAccountId: 'professional-a', providerMediaId: 'provider-a', publicationId: null,
  automationId: 'automation-a', publication: null, automation: { enabled: true, accountId: 'professional-a',
    privateReplyEnabled: true, publicReplyEnabled: true, keywords: [{ normalizedValue: 'precio' }] } }
let persistedAction: any = { body: '{{weex_form:invalid}}', execution: parent }
let configMatch = true
const effects: string[] = []
const client: any = {
  instagramCommentAction: { async findFirst() { return persistedAction }, async updateMany() { effects.push('action'); return { count: 1 } } },
  businessInstagramConfig: { async findFirst({ where }: any) { assert.equal(where.instagramAccountId, 'professional-a'); return configMatch ? { instagramAccountId: 'professional-a', apiAccountId: 'scoped-different', accessToken: 'fake' } : null } },
  instagramLead: { async upsert() { effects.push('lead'); return { id: 'lead' } } },
  instagramMessage: { async create() { effects.push('message') } },
  async $queryRaw() { return [] },
  async $transaction(callback: any) { return callback(this) }
}
const repository = new PrismaInstagramCommentWorkerStore(client, undefined, () => now)
assert.equal(await repository.loadConfiguration({ ...action, kind: 'PRIVATE_REPLY' }), null, 'invalid private form fails closed')
persistedAction = { body: 'Respuesta publica', execution: parent }
assert.equal((await repository.loadConfiguration(action))?.publicReplyText, 'Respuesta publica', 'invalid private template cannot suppress public action')
assert.equal(await repository.completeSent({ execution: action, publicationId: null, automationId: 'automation-a',
  body: 'Publica', providerMessageId: 'reply', recipientId: null }), true)
assert.deepEqual(effects, ['action'], 'public completion creates neither DM message nor lead')
persistedAction.body = 'https://example.test/f/form?ref=signed-private-value'
assert.equal(await repository.loadConfiguration(action), null, 'private signed links never become public replies')
persistedAction.body = 'Publica'; configMatch = false
assert.equal(await repository.loadConfiguration(action), null, 'queued actions cannot rebind to a new configured professional account')
configMatch = true
for (const change of ['pause', 'action-disabled', 'keywords-removed', 'publication-unpublished', 'account-rotation']) {
  parent.automation.enabled = true; parent.automation.publicReplyEnabled = true
  parent.automation.keywords = [{ normalizedValue: 'precio' }]; parent.publication = null; configMatch = true
  let sends = 0
  const guarded = new PrismaInstagramCommentWorkerStore(client, undefined, () => now)
  guarded.claim = async () => action
  const result = await new InstagramCommentWorker(guarded, { async getComment() {
    if (change === 'pause') parent.automation.enabled = false
    else if (change === 'action-disabled') parent.automation.publicReplyEnabled = false
    else if (change === 'keywords-removed') parent.automation.keywords = []
    else if (change === 'publication-unpublished') parent.publication = { status: 'FAILED' }
    else configMatch = false
    return { id: 'comment-a', from: { id: 'user-a' }, media: { id: 'provider-a' } }
  }, async replyToComment() { sends++; return { replyId: 'must-not-send' } }, async sendPrivateReply() { throw new Error('unexpected DM') } }).processOne(now)
  assert.equal(sends, 0, 'pausing/disabling an action while metadata is loading must fence the subsequent POST')
  assert.notEqual(result, 'SENT')
}

const calls: Array<{ url: URL; init: RequestInit }> = []
const adapter = new InstagramApi((async (url: any, init: any) => {
  calls.push({ url: new URL(url), init })
  return new Response(JSON.stringify(init.method === 'POST' ? { id: 'reply-id' } : { id: 'comment-a', timestamp: metadata.timestamp }))
}) as any)
assert.equal((await adapter.replyToComment({ commentId: 'comment-a', accessToken: 'fake', text: 'Hola' })).replyId, 'reply-id')
assert.match(calls[0]!.url.pathname, /\/comment-a\/replies$/)
assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { message: 'Hola' })
assert.ok(!calls[0]!.url.href.includes('fake'))
assert.equal((await adapter.getComment({ commentId: 'comment-a', accessToken: 'fake' })).timestamp, metadata.timestamp)
assert.match(calls[1]!.url.searchParams.get('fields')!, /timestamp/)
for (const commentId of ['..', '../other', 'https://evil.test/', 'comment?fields=token']) {
  await assert.rejects(() => adapter.getComment({ commentId, accessToken: 'fake' }))
  await assert.rejects(() => adapter.replyToComment({ commentId, accessToken: 'fake', text: 'Hola' }))
}
assert.equal(calls.length, 2, 'malformed IDs never reach the provider')
console.log('OK: independent private retries, actual creation window, ambiguous/fenced outcomes, public persistence and account/form isolation')
