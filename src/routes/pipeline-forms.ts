import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { requirePipelineAccess } from '../plugins/auth-guard.js'
import { parseRequiredId } from '../services/pipeline-domain.js'
import { PipelineFormsService, PipelineFormsError } from '../services/pipeline-forms-service.js'

type Service = Pick<PipelineFormsService, 'list' | 'create' | 'update' | 'publish' | 'disable' | 'configureReward'>
export type PipelineFormsRoutesOptions = { service?: Service; accessGuard?: typeof requirePipelineAccess }

export async function pipelineFormsRoutes(app: FastifyInstance, options: PipelineFormsRoutesOptions = {}) {
  const service = options.service ?? new PipelineFormsService(prisma)
  const guard = options.accessGuard ?? requirePipelineAccess

  async function execute(request: FastifyRequest, reply: FastifyReply, operation: (businessId: string) => Promise<unknown>, successStatus = 200) {
    const input = ((request.method === 'GET' ? request.query : request.body) ?? {}) as { businessId?: unknown }
    let businessId: string
    try { businessId = parseRequiredId(input.businessId, 'INVALID_BUSINESS_ID') }
    catch { return reply.status(400).send({ code: 'INVALID_BUSINESS_ID' }) }
    const authorized = await guard(request, reply, businessId)
    if (!authorized) return reply
    try { return reply.status(successStatus).send(await operation(businessId)) }
    catch (error) {
      if (error instanceof PipelineFormsError) return reply.status(error.statusCode).send({ code: error.code, issues: error.issues })
      request.log.error({ code: (error as { code?: string }).code }, 'Pipeline form administration failed')
      return reply.status(503).send({ code: 'FORM_ADMIN_UNAVAILABLE' })
    }
  }

  app.get('/pipeline/forms', (request, reply) => execute(request, reply, businessId => service.list(businessId)))
  app.post('/pipeline/forms', (request, reply) => execute(request, reply, businessId => service.create({ ...(request.body as object), businessId }), 201))
  app.patch('/pipeline/forms/:id', (request, reply) => execute(request, reply, businessId => service.update({ ...(request.body as object), businessId, formId: (request.params as { id: string }).id })))
  app.post('/pipeline/forms/:id/publish', (request, reply) => execute(request, reply, businessId => service.publish({ businessId, formId: (request.params as { id: string }).id })))
  app.post('/pipeline/forms/:id/disable', (request, reply) => execute(request, reply, businessId => service.disable({ businessId, formId: (request.params as { id: string }).id })))
  app.post('/pipeline/forms/:id/reward', (request, reply) => execute(request, reply, businessId => service.configureReward({ ...(request.body as object), businessId, formId: (request.params as { id: string }).id })))
}
