import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_editor_no_dotenv__'
const { InstagramPublicationService, PrismaInstagramPublicationRepository } = await import('../src/services/instagram-publication-service.js')
const created: any[] = []
const repository: any = { async createDraft(input: any) { created.push(input); return { ...input, id: 'draft-1', status: 'DRAFT', revision: 0 } } }
const service = new InstagramPublicationService(repository)
const input = { businessId: 'a', videoObjectPath: 'a/instagram/reels/11111111-1111-4111-8111-111111111111.mp4',
  videoMimeType: 'video/mp4', videoSizeBytes: 100, caption: 'Sólo publicar', shareToFeed: true }
await assert.doesNotReject(service.createDraft({ ...input, automation: { enabled: false, privateReplyText: '', keywords: [] } }),
  'publishing a valid video must not require an inactive private reply or keyword')
assert.equal(created[0].automation.enabled, false)
await service.createDraft(input)
assert.equal(created[1].automation.enabled, false)
await assert.rejects(service.createDraft({ ...input, automation: { enabled: true, privateReplyText: '', keywords: [] } }), /acciones activas/)
const row: any = { publicationType: 'REEL', deliveryMode: 'AUTO', mediaKind: 'VIDEO', ...input, id: 'p', revision: 0, status: 'CANCELLED', metaContainerId: null, metaMediaId: null, claimToken: null, claimedUntil: null,
  videoDeletedAt: null, videoDeleteRequestedAt: null, automation: { enabled: true, privateReplyEnabled: false, privateReplyText: 'Texto privado apagado', publicReplyEnabled: true, publicReplyText: 'Comentario', keywords: [{ value: 'info', normalizedValue: 'info' }] } }
let updated: any
const draftService = new InstagramPublicationService({ ...repository, async findByBusinessAndId(businessId: string) { return businessId === 'a' ? row : null },
  async updateDraft(args: any) { updated = args; return { ...row, ...args.patch, automation: args.automation } } })
await draftService.updateDraft('a', 'p', { caption: 'Nuevo texto', expectedRevision: 0 })
assert.equal(updated.automation.publicReplyEnabled, true)
assert.equal(updated.automation.privateReplyEnabled, false)
assert.equal(updated.automation.privateReplyText, 'Texto privado apagado')
assert.equal(updated.automation.publicReplyText, 'Comentario')
await assert.rejects(draftService.updateDraft('a', 'p', { caption: 'Sin revisión' }), /revisión/)
for (const status of ['SCHEDULED', 'READY', 'UNKNOWN', 'PUBLISHED']) {
  row.status = status
  await assert.rejects(draftService.updateDraft('a', 'p', { expectedRevision: 0 }), /editar/)
  await assert.rejects(draftService.publish('a', 'p', 0), /revisión manual/)
}
function matches(where: any) {
  return Object.entries(where).every(([key, value]: [string, any]) => value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value)
}
const tx: any = { instagramPublication: { async updateMany({ where, data }: any) { if (!matches(where)) return { count: 0 }; Object.assign(row, data); return { count: 1 } },
  async findFirstOrThrow() { return row } } }
const repo = new PrismaInstagramPublicationRepository({ $transaction: (fn: Function) => fn(tx) })
for (const patch of [{ revision: 1 }, { claimToken: 'worker' }, { claimedUntil: new Date() }, { metaContainerId: 'remote' }, { metaMediaId: 'remote' }, { videoDeleteRequestedAt: new Date() }]) {
  row.status = 'DRAFT'; row.revision = 0; row.claimToken = null; row.claimedUntil = null; row.metaContainerId = null; row.metaMediaId = null; row.videoDeleteRequestedAt = null
  Object.assign(row, patch)
  assert.equal(await repo.updateDraft({ businessId: 'a', id: 'p', expectedRevision: 0, patch: { caption: 'Unsafe' } }), null)
}
console.log('OK: an inactive automation does not prevent a valid publication draft')
