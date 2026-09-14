import assert from 'node:assert/strict'
import {
  INSTAGRAM_REEL_VIDEO_RETENTION_MS,
  InstagramVideoRetentionWorker,
  type InstagramVideoRetentionJob,
  type InstagramVideoRetentionRepository
} from '../src/services/instagram-video-retention-worker.js'

class MemoryRetentionRepository implements InstagramVideoRetentionRepository {
  constructor(public jobs: InstagramVideoRetentionJob[]) {}
  completed: string[] = []
  released: string[] = []

  async claimNext(input: { cutoff: Date; now: Date; leaseUntil: Date; claimToken: string }) {
    const job = this.jobs
      .filter((candidate) => candidate.publishedAt <= input.cutoff && candidate.videoDeletedAt === null)
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())[0]
    if (!job) return null
    job.claimToken = input.claimToken
    job.claimedUntil = input.leaseUntil
    return structuredClone(job)
  }

  async complete(input: { id: string; businessId: string; claimToken: string; deletedAt: Date }) {
    const job = this.jobs.find((candidate) => candidate.id === input.id
      && candidate.businessId === input.businessId
      && candidate.claimToken === input.claimToken
      && candidate.videoDeletedAt === null)
    if (!job) return false
    job.videoDeletedAt = input.deletedAt
    job.claimToken = null
    job.claimedUntil = null
    this.completed.push(job.id)
    return true
  }

  async release(input: { id: string; businessId: string; claimToken: string }) {
    const job = this.jobs.find((candidate) => candidate.id === input.id
      && candidate.businessId === input.businessId
      && candidate.claimToken === input.claimToken)
    if (!job) return false
    job.claimToken = null
    job.claimedUntil = null
    this.released.push(job.id)
    return true
  }
}

const now = new Date('2026-09-15T18:00:00.000Z')
const makeJob = (id: string, publishedAt: string): InstagramVideoRetentionJob => ({
  id,
  businessId: 'business-a',
  objectPath: `business-a/instagram/reels/00000000-0000-4000-8000-00000000000${id}.mp4`,
  publishedAt: new Date(publishedAt),
  videoDeletedAt: null,
  claimToken: null,
  claimedUntil: null
})

assert.equal(INSTAGRAM_REEL_VIDEO_RETENTION_MS, 24 * 60 * 60 * 1000)

const repository = new MemoryRetentionRepository([
  makeJob('1', '2026-09-14T17:59:59.999Z'),
  makeJob('2', '2026-09-14T18:00:00.001Z')
])
const deleted: string[] = []
const changed: string[] = []
const worker = new InstagramVideoRetentionWorker({
  repository,
  storage: { async delete(job) { deleted.push(job.objectPath) } },
  clock: { now: () => now },
  randomToken: () => 'retention-claim',
  onVideoDeleted: (event) => changed.push(event.publicationId)
})

assert.deepEqual(await worker.runOnce(), { outcome: 'deleted', publicationId: '1' })
assert.equal(repository.jobs[0]?.videoDeletedAt?.toISOString(), now.toISOString())
assert.equal(repository.jobs[1]?.videoDeletedAt, null, 'no debe borrar antes de cumplir 24 horas')
assert.deepEqual(deleted, [repository.jobs[0]?.objectPath])
assert.deepEqual(changed, ['1'])
assert.deepEqual(await worker.runOnce(), { outcome: 'idle' })

const failingRepository = new MemoryRetentionRepository([makeJob('3', '2026-09-13T18:00:00.000Z')])
const failingWorker = new InstagramVideoRetentionWorker({
  repository: failingRepository,
  storage: { async delete() { throw new Error('storage-secret') } },
  clock: { now: () => now },
  randomToken: () => 'failed-claim'
})
await assert.rejects(() => failingWorker.runOnce(), /No se pudo eliminar el video almacenado/i)
assert.equal(failingRepository.jobs[0]?.videoDeletedAt, null, 'un fallo de almacenamiento no debe marcarlo como borrado')
assert.deepEqual(failingRepository.released, ['3'], 'debe liberar el trabajo para reintentarlo')

console.log('Instagram video retention worker contract: OK')
