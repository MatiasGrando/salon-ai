import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {
  InstagramPublicationConflictError,
  InstagramPublicationNotFoundError,
  InstagramPublicationValidationError
} from '../src/services/instagram-publication-service.js'
import { instagramPublicationRoutes } from '../src/routes/instagram-publications.js'

const calls: Array<{ name: string; args: unknown[] }> = []
const publication = {
  id: 'pub-1', businessId: 'business-a', status: 'PUBLISHED',
  videoObjectPath: 'business-a/instagram/reels/11111111-1111-4111-8111-111111111111.mp4',
  videoAvailable: true
}
const service = {
  async createDraft(input: unknown) { calls.push({ name: 'create', args: [input] }); return publication },
  async list(businessId: string) { calls.push({ name: 'list', args: [businessId] }); return [publication] },
  async get(businessId: string, id: string) { calls.push({ name: 'get', args: [businessId, id] }); return publication },
  async updateDraft(businessId: string, id: string, patch: unknown) { calls.push({ name: 'update', args: [businessId, id, patch] }); return publication },
  async publish(businessId: string, id: string) { calls.push({ name: 'publish', args: [businessId, id] }); return { ...publication, status: 'READY' } }
  ,async markVideoDeleted(businessId: string, id: string) { calls.push({ name: 'delete', args: [businessId, id] }); return { ...publication, status: 'PUBLISHED', videoAvailable: false } }
}

const app = Fastify()
await app.register(instagramPublicationRoutes, {
  service,
  storage: {
    async createUpload() { return {} },
    async verifyUpload() { return { mimeType: 'video/mp4', sizeBytes: 100 } },
    async deleteVideo(input) { calls.push({ name: 'delete-video', args: [input] }) }
  }
})

const created = await app.inject({
  method: 'POST', url: '/businesses/business-a/instagram-publications',
  payload: {
    videoObjectPath: 'business-a/reels/a.mp4', videoMimeType: 'video/mp4', videoSizeBytes: 100,
    caption: 'Hola', shareToFeed: true,
    automation: { enabled: true, privateReplyText: 'Info', keywords: ['precio'] }
  }
})
assert.equal(created.statusCode, 201)
assert.equal((calls[0]!.args[0] as { businessId: string }).businessId, 'business-a')

assert.equal((await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-publications' })).statusCode, 200)
assert.equal((await app.inject({ method: 'GET', url: '/businesses/business-a/instagram-publications/pub-1' })).statusCode, 200)
assert.equal((await app.inject({ method: 'PATCH', url: '/businesses/business-a/instagram-publications/pub-1', payload: { caption: 'Editado' } })).statusCode, 200)
const accepted = await app.inject({ method: 'POST', url: '/businesses/business-a/instagram-publications/pub-1/publish' })
assert.equal(accepted.statusCode, 202)
assert.equal(accepted.json().status, 'READY')
const deleted = await app.inject({ method: 'DELETE', url: '/businesses/business-a/instagram-publications/pub-1/video' })
assert.equal(deleted.statusCode, 200)
assert.deepEqual(calls.slice(-2).map((call) => call.name), ['delete-video', 'delete'])

const errors = Fastify()
await errors.register(instagramPublicationRoutes, {
  service: {
    ...service,
    async createDraft() { throw new InstagramPublicationValidationError(['dato inválido']) },
    async get() { throw new InstagramPublicationNotFoundError() },
    async updateDraft() { throw new InstagramPublicationConflictError() }
  }
})
assert.equal((await errors.inject({ method: 'POST', url: '/businesses/b/instagram-publications', payload: {} })).statusCode, 400)
assert.equal((await errors.inject({ method: 'GET', url: '/businesses/b/instagram-publications/x' })).statusCode, 404)
assert.equal((await errors.inject({ method: 'PATCH', url: '/businesses/b/instagram-publications/x', payload: {} })).statusCode, 409)

await app.close()
await errors.close()
console.log('Instagram publication routes contract: OK')
