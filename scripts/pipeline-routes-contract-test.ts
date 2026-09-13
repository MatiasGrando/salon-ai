import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Fastify from 'fastify'
import { pipelineRoutes } from '../src/routes/pipeline.js'
import {
  authorizedPipelineBusinessWhere,
  canUsePipelineRole
} from '../src/services/tenant-resource-authorization.js'

const superAdmin = { id: 'super', role: 'SUPER_ADMIN', businessId: null, canCreateBusinesses: true } as const
const accountAdmin = { id: 'account', role: 'ACCOUNT_ADMIN', businessId: null, canCreateBusinesses: true } as const
const businessAdmin = { id: 'business-admin', role: 'BUSINESS_ADMIN', businessId: 'business-a', canCreateBusinesses: false } as const
const staff = { id: 'staff', role: 'STAFF', businessId: 'business-a', canCreateBusinesses: false } as const

assert.equal(canUsePipelineRole(superAdmin), true)
assert.equal(canUsePipelineRole(accountAdmin), true)
assert.equal(canUsePipelineRole(businessAdmin), true)
assert.equal(canUsePipelineRole(staff), false)

assert.deepEqual(authorizedPipelineBusinessWhere(staff, 'business-a'), null)
assert.deepEqual(authorizedPipelineBusinessWhere(businessAdmin, 'business-b'), {
  AND: [
    { AND: [{ id: 'business-b' }, { id: 'business-a' }] },
    { featureSettings: { is: { pipelineEnabled: true } } }
  ]
})
assert.deepEqual(authorizedPipelineBusinessWhere(superAdmin, 'business-a'), {
  AND: [
    { id: 'business-a' },
    { featureSettings: { is: { pipelineEnabled: true } } }
  ]
})

const app = Fastify()
app.addHook('preHandler', async (request) => {
  request.auth = { user: superAdmin } as never
})
const fakePipeline = { id: 'pipeline-a', businessId: 'business-a', name: 'Ventas', revision: 2n, stages: [] }
const fakeService = {
  getPipeline: async () => fakePipeline,
  renamePipeline: async () => fakePipeline,
  createStage: async () => ({ stage: { id: 'stage-a' }, revision: 3n }),
  reorderStages: async () => ({ stages: [], revision: 3n }),
  updateStage: async () => ({ stage: { id: 'stage-a' }, revision: 3n }),
  archiveStage: async () => ({ archivedAt: new Date('2026-09-13T15:00:00.000Z'), revision: 3n }),
  listLeads: async () => ({ items: [{ id: 'lead-a' }], nextCursor: null, metrics: { count: 1, estimatedValue: 25000 }, revision: 3n }),
  getLead: async () => ({ id: 'lead-a', activities: [], events: [] }),
  createLead: async () => ({ lead: { id: 'lead-a' }, revision: 3n }),
  updateLead: async () => ({ lead: { id: 'lead-a' }, revision: 4n }),
  assignLead: async () => ({ lead: { id: 'lead-a' }, revision: 4n }),
  moveLead: async () => ({ lead: { id: 'lead-a' }, revision: 4n }),
  changeLifecycle: async () => ({ lead: { id: 'lead-a', lifecycle: 'WON' }, revision: 4n }),
  addActivity: async () => ({ activity: { id: 'activity-a' }, revision: 4n }),
  archiveLead: async () => ({ archivedAt: new Date('2026-09-13T15:00:00.000Z'), revision: 4n })
}
await app.register(pipelineRoutes, {
  service: fakeService as never,
  accessGuard: (async (_request, reply, businessId) => {
    if (businessId === 'disabled') {
      reply.status(404).send({ message: 'Recurso no encontrado', code: 'PIPELINE_RESOURCE_NOT_FOUND' })
      return null
    }
    return { id: businessId }
  }) as never
})

const enabled = await app.inject({ method: 'GET', url: '/pipeline?businessId=business-a' })
assert.equal(enabled.statusCode, 200)
assert.equal(enabled.json().revision, '2')
const leads = await app.inject({ method: 'GET', url: '/pipeline/leads?businessId=business-a' })
assert.equal(leads.statusCode, 200)
assert.equal(leads.json().revision, '3')
assert.equal(leads.json().metrics.count, 1)
const leadDetail = await app.inject({ method: 'GET', url: '/pipeline/leads/lead-a?businessId=business-a' })
assert.equal(leadDetail.statusCode, 200)
assert.deepEqual(leadDetail.json().events, [])
const disabled = await app.inject({ method: 'GET', url: '/pipeline?businessId=disabled' })
assert.equal(disabled.statusCode, 404)
assert.equal(disabled.json().code, 'PIPELINE_RESOURCE_NOT_FOUND')
const missingBusiness = await app.inject({ method: 'GET', url: '/pipeline' })
assert.equal(missingBusiness.statusCode, 400)
assert.equal(missingBusiness.json().code, 'INVALID_BUSINESS_ID')
await app.close()

const read = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), 'utf8')
const [routes, guard, server, service] = await Promise.all([
  read('src/routes/pipeline.ts'),
  read('src/plugins/auth-guard.ts'),
  read('src/server.ts'),
  read('src/services/pipeline-service.ts')
])

for (const signature of [
  /app\.get\('\/pipeline'/,
  /app\.patch\('\/pipeline'/,
  /app\.post\('\/pipeline\/stages'/,
  /app\.patch\('\/pipeline\/stages\/:id'/,
  /app\.delete\('\/pipeline\/stages\/:id'/,
  /app\.post\('\/pipeline\/stages\/reorder'/
  ,/app\.get\('\/pipeline\/leads'/
  ,/app\.post\('\/pipeline\/leads'/
  ,/app\.get\('\/pipeline\/leads\/:id'/
  ,/app\.patch\('\/pipeline\/leads\/:id'/
  ,/app\.delete\('\/pipeline\/leads\/:id'/
  ,/app\.post\('\/pipeline\/leads\/:id\/assign'/
  ,/app\.post\('\/pipeline\/leads\/:id\/transition'/
  ,/app\.post\('\/pipeline\/leads\/:id\/activities'/
]) assert.match(routes, signature)

assert.match(routes, /requirePipelineAccess/)
assert.match(routes, /PIPELINE_RESOURCE_NOT_FOUND/)
assert.match(routes, /toPipelineErrorDto/)
assert.match(routes, /toPipelineDto/)
assert.match(guard, /path\.startsWith\('\/pipeline\/'/)
assert.match(guard, /'pipeline'/)
assert.match(server, /import \{ pipelineRoutes \}/)
assert.match(server, /app\.register\(pipelineRoutes\)/)
assert.match(service, /reorderStages/)
assert.match(service, /parseExpectedRevision/)
assert.match(service, /PIPELINE_REVISION_CONFLICT/)
assert.match(service, /listLeads/)
assert.match(service, /getLead/)
assert.match(service, /updateLead/)
assert.match(service, /events:\s*\{\s*orderBy/)
assert.match(service, /lastActivityAt:\s*now/)
assert.match(service, /archivedAt:\s*null/)
assert.doesNotMatch(service, /pipelineLeadEvent\.(?:update|delete)/)

console.log('pipeline-routes-contract-test: ok')
