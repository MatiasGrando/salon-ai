import assert from 'node:assert/strict'
import { InstagramApiRequestError } from '../src/integrations/instagram-api.js'
import {
  InstagramPublicationWorker,
  type InstagramPublicationJob,
  type InstagramPublicationWorkerRepository
} from '../src/services/instagram-publication-worker.js'

class MemoryWorkerRepository implements InstagramPublicationWorkerRepository {
  constructor(public job: InstagramPublicationJob | null) {}
  recovered: string[] = []

  async recoverExpiredAmbiguousPhases(now: Date) {
    if (this.job && ['CREATING_CONTAINER', 'PUBLISHING'].includes(this.job.status)
      && this.job.claimedUntil && this.job.claimedUntil <= now) {
      this.job.status = 'UNKNOWN'
      this.job.lastError = 'Lease vencido durante una operación externa ambigua.'
      this.recovered.push(this.job.id)
    }
    return this.recovered.length
  }

  async claimNext(input: { now: Date; leaseUntil: Date; claimToken: string }) {
    if (!this.job || !['READY', 'CREATING_CONTAINER', 'PROCESSING', 'PUBLISHING'].includes(this.job.status) || this.job.availableAt > input.now) return null
    this.job.claimToken = input.claimToken
    this.job.claimedUntil = input.leaseUntil
    return structuredClone(this.job)
  }

  async transition(input: Parameters<InstagramPublicationWorkerRepository['transition']>[0]) {
    if (!this.job || this.job.id !== input.id || this.job.claimToken !== input.claimToken || this.job.status !== input.from) return false
    this.job = {
      ...this.job,
      ...input.patch,
      status: input.to,
      claimToken: input.keepLease ? this.job.claimToken : null,
      claimedUntil: input.keepLease ? this.job.claimedUntil : null
    }
    return true
  }
}

const baseJob = (status: InstagramPublicationJob['status']): InstagramPublicationJob => ({
  id: 'publication-1', businessId: 'business-a', status,
  videoObjectPath: 'business-a/reels/a.mp4', videoMimeType: 'video/mp4', videoSizeBytes: 100,
  caption: 'Hola', shareToFeed: true,
  metaContainerId: status === 'PROCESSING' ? 'container-1' : null,
  attempts: 0, maxAttempts: 5, availableAt: new Date('2026-09-13T12:00:00.000Z'),
  claimToken: null, claimedUntil: null, lastError: null,
  instagramAccountId: 'ig-a', accessToken: 'secret'
})

const clock = { now: () => new Date('2026-09-13T12:00:00.000Z') }
const urls: string[] = []
const signedInputs: unknown[] = []
const apiCalls: string[] = []
const api = {
  async createReelContainer(input: { videoUrl: string }) { apiCalls.push('create'); urls.push(input.videoUrl); return { containerId: 'container-1' } },
  async getContainerStatus() { apiCalls.push('status'); return { statusCode: 'FINISHED' } },
  async publishContainer() { apiCalls.push('publish'); return { mediaId: 'media-1' } }
}
const signer = {
  async createTemporaryHttpsUrl(input: unknown) {
    signedInputs.push(input)
    return 'https://storage.example/reel.mp4?signature=x'
  }
}
const repository = new MemoryWorkerRepository(baseJob('READY'))
const worker = new InstagramPublicationWorker({ repository, api, videoUrls: signer, clock, randomToken: () => 'claim-1' })

assert.deepEqual(await worker.runOnce(), { outcome: 'processed', publicationId: 'publication-1', status: 'PROCESSING' })
assert.equal(repository.job?.metaContainerId, 'container-1')
assert.deepEqual(urls, ['https://storage.example/reel.mp4?signature=x'])
assert.deepEqual(signedInputs[0], {
  businessId: 'business-a',
  objectPath: 'business-a/reels/a.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 100
})
assert.deepEqual(await worker.runOnce(), { outcome: 'processed', publicationId: 'publication-1', status: 'PUBLISHED' })
assert.equal(repository.job?.metaMediaId, 'media-1')
assert.deepEqual(apiCalls, ['create', 'status', 'publish'])

const ambiguousRepository = new MemoryWorkerRepository(baseJob('READY'))
const ambiguousWorker = new InstagramPublicationWorker({
  repository: ambiguousRepository,
  api: { ...api, async createReelContainer() { throw new InstagramApiRequestError({ message: 'timeout', httpStatus: null, transient: true, ambiguous: true }) } },
  videoUrls: signer, clock, randomToken: () => 'claim-2'
})
await ambiguousWorker.runOnce()
assert.equal(ambiguousRepository.job?.status, 'UNKNOWN')

const retryCreateRepository = new MemoryWorkerRepository(baseJob('READY'))
const retryCreateWorker = new InstagramPublicationWorker({
  repository: retryCreateRepository,
  api: { ...api, async createReelContainer() { throw new InstagramApiRequestError({ message: 'rate limit', httpStatus: 429, transient: true, ambiguous: false }) } },
  videoUrls: signer, clock, randomToken: () => 'claim-retry-create'
})
await retryCreateWorker.runOnce()
assert.equal(retryCreateRepository.job?.status, 'CREATING_CONTAINER')
assert.ok(retryCreateRepository.job!.availableAt > clock.now())

const publishAmbiguousRepository = new MemoryWorkerRepository(baseJob('PROCESSING'))
const publishAmbiguousWorker = new InstagramPublicationWorker({
  repository: publishAmbiguousRepository,
  api: { ...api, async publishContainer() { throw new InstagramApiRequestError({ message: 'socket closed', httpStatus: null, transient: true, ambiguous: true }) } },
  videoUrls: signer, clock, randomToken: () => 'claim-3'
})
await publishAmbiguousWorker.runOnce()
assert.equal(publishAmbiguousRepository.job?.status, 'UNKNOWN')

const retryPublishRepository = new MemoryWorkerRepository(baseJob('PROCESSING'))
const retryPublishWorker = new InstagramPublicationWorker({
  repository: retryPublishRepository,
  api: { ...api, async publishContainer() { throw new InstagramApiRequestError({ message: 'rate limit', httpStatus: 429, transient: true, ambiguous: false }) } },
  videoUrls: signer, clock, randomToken: () => 'claim-retry-publish'
})
await retryPublishWorker.runOnce()
assert.equal(retryPublishRepository.job?.status, 'PUBLISHING')
assert.ok(retryPublishRepository.job!.availableAt > clock.now())

const stale = baseJob('READY')
stale.status = 'PUBLISHING'
stale.claimToken = 'dead-worker'
stale.claimedUntil = new Date('2026-09-13T11:59:00.000Z')
const staleRepository = new MemoryWorkerRepository(stale)
const noRetryCalls: string[] = []
const staleWorker = new InstagramPublicationWorker({
  repository: staleRepository,
  api: {
    async createReelContainer() { noRetryCalls.push('create'); return { containerId: 'x' } },
    async getContainerStatus() { noRetryCalls.push('status'); return { statusCode: 'FINISHED' } },
    async publishContainer() { noRetryCalls.push('publish'); return { mediaId: 'x' } }
  },
  videoUrls: signer, clock, randomToken: () => 'claim-4'
})
assert.deepEqual(await staleWorker.runOnce(), { outcome: 'idle' })
assert.equal(staleRepository.job?.status, 'UNKNOWN')
assert.deepEqual(noRetryCalls, [])

const processingRepository = new MemoryWorkerRepository(baseJob('PROCESSING'))
const processingWorker = new InstagramPublicationWorker({
  repository: processingRepository,
  api: { ...api, async getContainerStatus() { return { statusCode: 'IN_PROGRESS' } }, async publishContainer() { throw new Error('no debe publicar') } },
  videoUrls: signer, clock, randomToken: () => 'claim-5'
})
await processingWorker.runOnce()
assert.equal(processingRepository.job?.status, 'PROCESSING')
assert.equal(processingRepository.job?.metaContainerId, 'container-1')
assert.ok(processingRepository.job!.availableAt > clock.now())

console.log('Instagram publication worker contract: OK')
