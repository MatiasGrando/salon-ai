import assert from 'node:assert/strict'
import { InstagramCommentAutomationService } from '../src/services/instagram-comment-automation-service.js'
import { InstagramCommentIngressService, PrismaInstagramCommentIngressStore } from '../src/services/instagram-comment-ingress-service.js'

let accountId = 'professional-a'
const publication: any = { id: 'pub-a', businessId: 'business-a', metaMediaId: 'provider-a', status: 'PUBLISHED' }
const media: any = { id: 'media-a', businessId: 'business-a', accountId, providerMediaId: 'provider-a', mediaProductType: 'REELS' }
let automations: any[] = [{ id: 'legacy-id', businessId: 'business-a', publicationId: 'pub-a', mediaId: null, accountId: null,
  enabled: true, privateReplyEnabled: true, privateReplyText: 'legacy private', publicReplyEnabled: false, publicReplyText: '', keywords: [{ value: 'precio', normalizedValue: 'precio' }] }]
const executions: any[] = []
const locks: string[] = []
let tail = Promise.resolve()
const tx: any = {
  async $queryRaw(strings: TemplateStringsArray) { locks.push(strings.join('?').match(/FROM "([^"]+)"/)![1]!); return [] },
  businessInstagramConfig: {
    async findUnique({ where }: any) { return where.businessId === 'business-a' ? { instagramAccountId: accountId } : null },
    async findFirst({ where }: any) {
      if (where.businessId && (typeof where.businessId === 'string' ? where.businessId !== 'business-a' : !where.businessId.in.includes('business-a'))) return null
      const match = where.instagramAccountId
      if (typeof match === 'string' ? match !== accountId : !match?.in?.includes(accountId)) return null
      return { businessId: 'business-a', instagramAccountId: accountId, apiAccountId: 'scoped-different', enabled: true, accessToken: 'fake' }
    }
  },
  instagramPublication: { async findFirst({ where }: any) {
    return where.businessId === publication.businessId && (!where.id || where.id === publication.id) &&
      (!where.metaMediaId || where.metaMediaId === publication.metaMediaId) && (!where.status || where.status === publication.status) ? publication : null
  } },
  instagramMedia: { async findFirst({ where }: any) {
    return where.businessId === media.businessId && where.accountId === media.accountId && (!where.id || where.id === media.id) &&
      (!where.providerMediaId || where.providerMediaId === media.providerMediaId) && (!where.mediaProductType || where.mediaProductType === media.mediaProductType) ? media : null
  } },
  instagramCommentAutomation: {
    async findMany({ where }: any) { return automations.filter((a) => a.businessId === where.businessId && where.OR.some((condition: any) => Object.entries(condition).every(([key,value]) => a[key] === value))) },
    async findFirst({ where }: any) { return automations.find((a) => a.id === where.id && a.businessId === where.businessId && a.enabled) },
    async update({ where, data }: any) { const row = automations.find((a) => a.id === where.id); Object.assign(row, data); return structuredClone(row) },
    async create({ data }: any) { const row = { ...data, id: 'created-' + automations.length, keywords: [] }; automations.push(row); return structuredClone(row) }
  },
  instagramAutomationKeyword: {
    async deleteMany({ where }: any) { automations.find((a) => a.id === where.automationId).keywords = [] },
    async createMany({ data }: any) { if (data.length) automations.find((a) => a.id === data[0].automationId).keywords = data }
  },
  instagramCommentAction: { async findMany() { return [] } },
  instagramCommentExecution: { async create({ data }: any) {
    if (executions.some((e) => e.businessId === data.businessId && e.providerCommentId === data.providerCommentId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' })
    executions.push(structuredClone(data))
  } }
}
const client = { ...tx, async $transaction(callback: any) {
  const previous = tail
  let release!: () => void
  tail = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await callback(tx) } finally { release() }
} }
const service = new InstagramCommentAutomationService(client)
const settings = { enabled: true, keywords: ['PRECIO', 'precio', '  turno  '], privateReplyEnabled: false, privateReplyText: '', publicReplyEnabled: true, publicReplyText: 'Gracias por comentar' }
const before = structuredClone(automations)
assert.equal((await service.get('business-a', { mediaId: 'media-a' })).automation?.id, 'legacy-id')
assert.deepEqual(automations, before, 'configuration GET is a read, without attaching target records')
const [imported, local] = await Promise.all([service.save('business-a', { mediaId: 'media-a' }, settings), service.save('business-a', { publicationId: 'pub-a' }, settings)])
assert.equal(imported.automation?.id, 'legacy-id'); assert.equal(local.automation?.id, 'legacy-id')
assert.equal(automations.length, 1); assert.equal(automations[0].mediaId, 'media-a')
assert.deepEqual(imported.automation?.keywords, ['precio', 'turno'])
assert.deepEqual(locks.slice(-3), ['BusinessInstagramConfig', 'InstagramMedia', 'InstagramPublication'])
for (const status of ['DRAFT', 'READY', 'PROCESSING', 'FAILED']) {
  publication.status = status
  for (const operation of [() => service.get('business-a', { publicationId: 'pub-a' }), () => service.save('business-a', { publicationId: 'pub-a' }, settings)]) await assert.rejects(operation, (e: any) => e.statusCode === 409)
}
publication.status = 'PUBLISHED'
await assert.rejects(() => service.get('business-b', { mediaId: 'media-a' }))
accountId = 'account-b'
await assert.rejects(() => service.get('business-a', { mediaId: 'media-a' }), (e: any) => e.statusCode === 404)
await assert.rejects(() => service.save('business-a', { publicationId: 'pub-a' }, settings), (e: any) => e.statusCode === 409)
accountId = 'professional-a'
const paused = await service.save('business-a', { mediaId: 'media-a' }, { ...settings, enabled: false, keywords: [], publicReplyEnabled: false,
  publicReplyText: '{{weex_form:retained-but-disabled}}' })
assert.equal(paused.automation?.enabled, false)
assert.deepEqual(paused.automation?.keywords, [], 'pausing must not require an active keyword/action')
await service.save('business-a', { mediaId: 'media-a' }, settings)
for (const patch of [{ publicReplyText: '{{weex_form:private}}' }, { publicReplyText: 'https://safe.example/f/x?ref=signed' },
  { publicReplyEnabled: false }, { keywords: [] }, { privateReplyEnabled: true, privateReplyText: '' }]) await assert.rejects(() => service.save('business-a', { mediaId: 'media-a' }, { ...settings, ...patch }), (e: any) => e.statusCode === 400)
automations = []
publication.metaMediaId = 'other'
const onlyImported = await service.save('business-a', { mediaId: 'media-a' }, settings)
assert.equal(onlyImported.publicationId, null)
assert.equal(automations[0].publicationId, null)
publication.metaMediaId = 'provider-a'
automations.push({ ...automations[0], id: 'incompatible', publicationId: 'pub-a', mediaId: null, accountId: null })
await assert.rejects(() => service.save('business-a', { mediaId: 'media-a' }, settings), (e: any) => e.statusCode === 409)
automations.pop()
await service.save('business-a', { mediaId: 'media-a' }, { ...settings, privateReplyEnabled: true, privateReplyText: 'Privado' })
const store = new PrismaInstagramCommentIngressStore(client, ['business-a'])
const ingress = new InstagramCommentIngressService(store)
const value = { id: 'comment-a', text: 'PRECIO', from: { id: 'user-a', username: 'ana' }, media: { id: 'provider-a', media_product_type: 'REELS' } }
const envelope = (direct: boolean, changes: any = {}) => ({ object: 'instagram', entry: [{ id: accountId, time: 1,
  ...(direct ? { field: 'comments', value: { ...value, ...changes } } : { changes: [{ field: 'comments', value: { ...value, ...changes } }] }) }] })
assert.equal((await ingress.ingest(envelope(false))).created, 1)
assert.equal(executions[0].receivedAccountId, 'professional-a')
assert.notEqual(executions[0].receivedAccountId, 'scoped-different')
assert.equal(executions[0].actions.create.length, 2)
assert.ok(executions[0].receivedAt.getTime() > 1_000_000, 'entry.time is not used as comment creation or reception time')
await service.save('business-a', { mediaId: 'media-a' }, { ...settings, publicReplyText: 'Edited after receipt' })
assert.equal((await ingress.ingest(envelope(true))).duplicates, 1)
assert.equal(executions.length, 1, 'replay after edit never creates an additional action')
assert.equal(executions[0].actions.create.find((a: any) => a.kind === 'PUBLIC_REPLY').body, settings.publicReplyText, 'delivery text is frozen at receipt')
for (const change of [{ parent_id: 'reply' }, { from: { id: accountId } }, { from: { id: 'user-a', self_ig_scoped_id: 'self' } }, { text: 'no match' }]) assert.equal((await ingress.ingest(envelope(true, change))).created, 0)
assert.equal(await store.resolveTarget({ instagramAccountIds: ['scoped-different'], mediaId: 'provider-a' }), null)
const captured = await store.resolveTarget({ instagramAccountIds: [accountId], mediaId: 'provider-a' })
accountId = 'new-professional'
assert.equal(await store.createExecutionIfAbsent({ ...captured!, providerCommentId: 'late', commenterInstagramUserId: 'user', commenterUsername: null,
  commentText: 'precio', matchedKeyword: 'precio', receivedAt: new Date() }), false, 'account switch between resolution and insertion cannot enqueue to a new account')
console.log('OK: actual target resolver preserves legacy IDs, serializes configuration races, imported-only scope, published-only controls and ingress replay/account isolation')
