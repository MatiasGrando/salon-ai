import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { isInstagramPublicationWorkspaceRoute } from '../src/plugins/auth-guard.js'
import { instagramPublicationRoutes } from '../src/routes/instagram-publications.js'

const calls: Array<{ name: string; input: Record<string, unknown> }> = []
const storage = {
  async createUpload(input: Record<string, unknown>) {
    calls.push({ name: 'createUpload', input })
    return {
      bucket: 'private-reels',
      objectPath: 'business-a/instagram/reels/reel.mp4',
      uploadUrl: 'https://example.supabase.co/storage/v1/object/upload/sign/private-reels/reel.mp4?token=upload-token',
      uploadToken: 'upload-token',
      expiresInSeconds: 7200,
      uploadHeaders: { 'content-type': 'video/mp4', 'x-upsert': 'false' }
    }
  },
  async verifyUpload(input: Record<string, unknown>) {
    calls.push({ name: 'verifyUpload', input })
    return {
      signedUrl: 'https://example.supabase.co/storage/v1/object/sign/private-reels/reel.mp4?token=read-token',
      expiresInSeconds: 21600,
      expiresAt: new Date('2026-09-13T12:00:00.000Z'),
      sizeBytes: 345678,
      mimeType: 'video/mp4'
    }
  }
}

const publicationService = {
  async createDraft() { return { id: 'publication-1' } },
  async list() { return [] },
  async get() {
    return {
      id: 'publication-1', businessId: 'business-a',
      videoObjectPath: 'business-a/instagram/reels/reel.mp4',
      videoMimeType: 'video/mp4', videoSizeBytes: 345678,
      caption: 'Reel', shareToFeed: true,
      automation: { enabled: true, privateReplyText: 'Hola', keywords: ['precio'] }
    }
  },
  async updateDraft() { return { id: 'publication-1' } },
  async publish() { return { id: 'publication-1' } }
}

const app = Fastify()
await app.register(instagramPublicationRoutes, { service: publicationService, storage })

const created = await app.inject({
  method: 'POST',
  url: '/businesses/business-a/instagram-publications/uploads',
  payload: { mimeType: 'video/mp4', sizeBytes: 345678 }
})
assert.equal(created.statusCode, 201)
assert.deepEqual(calls[0], {
  name: 'createUpload',
  input: { businessId: 'business-a', mimeType: 'video/mp4', sizeBytes: 345678 }
})
assert.equal(created.json().uploadToken, 'upload-token')
assert.doesNotMatch(created.body, /service.role|service-role|SUPABASE_SERVICE_ROLE_KEY/i)

const verified = await app.inject({
  method: 'POST',
  url: '/businesses/business-a/instagram-publications/uploads/verify',
  payload: {
    objectPath: 'business-a/instagram/reels/reel.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 345678
  }
})
assert.equal(verified.statusCode, 200)
assert.deepEqual(calls[1], {
  name: 'verifyUpload',
  input: {
    businessId: 'business-a',
    objectPath: 'business-a/instagram/reels/reel.mp4',
    expectedMimeType: 'video/mp4',
    expectedSizeBytes: 345678
  }
})
assert.equal(verified.json().mimeType, 'video/mp4')
assert.equal(verified.json().sizeBytes, 345678)
assert.equal(verified.json().verified, true)
assert.equal(verified.json().objectPath, 'business-a/instagram/reels/reel.mp4')
assert.equal('signedUrl' in verified.json(), false, 'la URL privada firmada para Meta no debe salir al navegador')

const draft = await app.inject({
  method: 'POST',
  url: '/businesses/business-a/instagram-publications',
  payload: {
    videoObjectPath: 'business-a/instagram/reels/reel.mp4',
    videoMimeType: 'video/mp4',
    videoSizeBytes: 345678,
    caption: 'Reel verificado',
    automation: { enabled: true, privateReplyText: 'Hola', keywords: ['precio'] }
  }
})
assert.equal(draft.statusCode, 201)
assert.deepEqual(calls[2], {
  name: 'verifyUpload',
  input: {
    businessId: 'business-a',
    objectPath: 'business-a/instagram/reels/reel.mp4',
    expectedMimeType: 'video/mp4',
    expectedSizeBytes: 345678
  }
}, 'crear un draft debe volver a verificar metadata real del storage')

const updated = await app.inject({
  method: 'PATCH',
  url: '/businesses/business-a/instagram-publications/publication-1',
  payload: { videoSizeBytes: 345678 }
})
assert.equal(updated.statusCode, 200)
assert.equal(calls[3]?.name, 'verifyUpload', 'actualizar metadata del video debe verificar storage nuevamente')

const invalid = await app.inject({
  method: 'POST',
  url: '/businesses/business-a/instagram-publications/uploads',
  payload: { mimeType: '', sizeBytes: 0 }
})
assert.equal(invalid.statusCode, 400)
assert.equal(calls.length, 4, 'un payload inválido no debe llegar al storage')

assert.equal(isInstagramPublicationWorkspaceRoute('POST', '/businesses/business-a/instagram-publications/uploads'), true)
assert.equal(isInstagramPublicationWorkspaceRoute('POST', '/businesses/business-a/instagram-publications/uploads/verify'), true)
assert.equal(isInstagramPublicationWorkspaceRoute('GET', '/businesses/business-a/instagram-publications/uploads'), false)
assert.equal(isInstagramPublicationWorkspaceRoute('POST', '/businesses/business-a/instagram-publications/uploads/verify/extra'), false)
assert.equal(isInstagramPublicationWorkspaceRoute('POST', '/businesses/business-a/instagram-publications/not-a-route/verify'), false)
assert.equal(isInstagramPublicationWorkspaceRoute('DELETE', '/businesses/business-a/instagram-publications/publication-1/video'), true)
assert.equal(isInstagramPublicationWorkspaceRoute('POST', '/businesses/business-a/instagram-publications/publication-1/video'), false)

await app.close()
console.log('Instagram Reel upload routes contract: OK')
