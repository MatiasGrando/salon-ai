import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { requirePipelineAccess } from '../plugins/auth-guard.js'
import { PipelineDomainError, PipelineError, parseRequiredId, toPipelineDto, toPipelineErrorDto } from '../services/pipeline-domain.js'
import { PipelineService, PipelineServiceError, asPipelineServiceError } from '../services/pipeline-service.js'

type PipelineRouteService = Pick<
  PipelineService,
  | 'getPipeline'
  | 'renamePipeline'
  | 'createStage'
  | 'reorderStages'
  | 'updateStage'
  | 'archiveStage'
  | 'listLeads'
  | 'getLead'
  | 'createLead'
  | 'updateLead'
  | 'assignLead'
  | 'moveLead'
  | 'changeLifecycle'
  | 'addActivity'
  | 'archiveLead'
  | 'listResponsibles'
  | 'listTasks'
  | 'createTask'
  | 'updateTask'
  | 'archiveTask'
  | 'reorderTasks'
>
type PipelineAccessGuard = typeof requirePipelineAccess

export type PipelineRouteOptions = {
  service?: PipelineRouteService
  accessGuard?: PipelineAccessGuard
}

type BusinessPayload = { businessId?: unknown }
type StagePayload = BusinessPayload & { name?: unknown; color?: unknown }
type ReorderPayload = BusinessPayload & { stageIds?: unknown; expectedRevision?: unknown }
type LeadQuery = BusinessPayload & {
  search?: unknown
  lifecycle?: unknown
  stageId?: unknown
  assigneeUserId?: unknown
  priority?: unknown
  cursor?: unknown
  limit?: unknown
}
type LeadPayload = BusinessPayload & Record<string, unknown>
type TaskPayload = BusinessPayload & Record<string, unknown>

export async function pipelineRoutes(app: FastifyInstance, options: PipelineRouteOptions = {}) {
  const pipelineService = options.service ?? new PipelineService(prisma)
  const accessGuard = options.accessGuard ?? requirePipelineAccess
  app.get('/pipeline', async (request, reply) => executePipelineRequest(request, reply, accessGuard, undefined, async (businessId) => {
    const pipeline = await pipelineService.getPipeline(businessId)
    if (!pipeline) throw new PipelineServiceError('PIPELINE_RESOURCE_NOT_FOUND', 404)
    return pipeline
  }))

  app.patch('/pipeline', async (request, reply) => {
    const body = (request.body ?? {}) as BusinessPayload & { name?: unknown }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.renamePipeline({ businessId, name: body.name })
    )
  })

  app.post('/pipeline/stages', async (request, reply) => {
    const body = (request.body ?? {}) as StagePayload
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.createStage({ businessId, name: body.name, color: body.color }),
      201
    )
  })

  app.post('/pipeline/stages/reorder', async (request, reply) => {
    const body = (request.body ?? {}) as ReorderPayload
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.reorderStages({ businessId, stageIds: body.stageIds, expectedRevision: body.expectedRevision })
    )
  })

  app.patch('/pipeline/stages/:id', async (request, reply) => {
    const body = (request.body ?? {}) as StagePayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.updateStage({ businessId, stageId: id, name: body.name, color: body.color })
    )
  })

  app.delete('/pipeline/stages/:id', async (request, reply) => {
    const body = (request.body ?? {}) as BusinessPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.archiveStage({ businessId, stageId: id })
    )
  })

  app.get('/pipeline/leads', async (request, reply) => {
    const query = (request.query ?? {}) as LeadQuery
    return executePipelineRequest(request, reply, accessGuard, query.businessId, (businessId) =>
      pipelineService.listLeads({ ...query, businessId })
    )
  })

  app.post('/pipeline/leads', async (request, reply) => {
    const body = (request.body ?? {}) as LeadPayload
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.createLead({
        businessId,
        actorUserId: pipelineActorId(request),
        stageId: String(body.stageId ?? ''),
        title: body.title,
        contactName: body.contactName,
        companyName: body.companyName,
        email: body.email,
        phone: body.phone,
        estimatedValue: body.estimatedValue,
        priority: body.priority,
        source: body.source,
        externalReference: body.externalReference,
        assigneeUserId: body.assigneeUserId
      }),
      201
    )
  })

  app.get('/pipeline/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, undefined, (businessId) =>
      pipelineService.getLead({ businessId, leadId: id })
    )
  })

  app.patch('/pipeline/leads/:id', async (request, reply) => {
    const body = (request.body ?? {}) as LeadPayload
    const { id } = request.params as { id: string }
    const { businessId: _businessId, ...changes } = body
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.updateLead({
        businessId,
        actorUserId: pipelineActorId(request),
        leadId: id,
        changes
      })
    )
  })

  app.delete('/pipeline/leads/:id', async (request, reply) => {
    const body = (request.body ?? {}) as BusinessPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.archiveLead({ businessId, actorUserId: pipelineActorId(request), leadId: id })
    )
  })

  app.post('/pipeline/leads/:id/assign', async (request, reply) => {
    const body = (request.body ?? {}) as LeadPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.assignLead({
        businessId,
        actorUserId: pipelineActorId(request),
        leadId: id,
        assigneeUserId: body.assigneeUserId
      })
    )
  })

  app.post('/pipeline/leads/:id/transition', async (request, reply) => {
    const body = (request.body ?? {}) as LeadPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) => {
      const hasStage = body.stageId !== undefined
      const hasLifecycle = body.lifecycle !== undefined
      if (hasStage === hasLifecycle) throw new PipelineDomainError('INVALID_LEAD_TRANSITION', 400)
      return hasStage
        ? pipelineService.moveLead({
            businessId,
            actorUserId: pipelineActorId(request),
            leadId: id,
            stageId: String(body.stageId ?? ''),
            expectedRevision: body.expectedRevision
          })
        : pipelineService.changeLifecycle({
            businessId,
            actorUserId: pipelineActorId(request),
            leadId: id,
            lifecycle: body.lifecycle,
            expectedRevision: body.expectedRevision
          })
    })
  })

  app.post('/pipeline/leads/:id/activities', async (request, reply) => {
    const body = (request.body ?? {}) as LeadPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.addActivity({
        businessId,
        actorUserId: pipelineActorId(request),
        leadId: id,
        kind: body.kind,
        body: body.body
      }),
      201
    )
  })

  app.get('/pipeline/responsibles', async (request, reply) => {
    const query = (request.query ?? {}) as BusinessPayload
    return executePipelineRequest(request, reply, accessGuard, query.businessId, (businessId) =>
      pipelineService.listResponsibles({ businessId })
    )
  })

  app.get('/pipeline/tasks', async (request, reply) => {
    const query = (request.query ?? {}) as BusinessPayload & { status?: unknown }
    return executePipelineRequest(request, reply, accessGuard, query.businessId, (businessId) =>
      pipelineService.listTasks({ businessId, status: query.status })
    )
  })

  app.post('/pipeline/tasks', async (request, reply) => {
    const body = (request.body ?? {}) as TaskPayload
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.createTask({
        businessId,
        title: body.title,
        category: body.category,
        notes: body.notes,
        dueAt: body.dueAt,
        status: body.status,
        assigneeUserId: body.assigneeUserId,
        leadId: body.leadId
      }),
      201
    )
  })

  app.patch('/pipeline/tasks/:id', async (request, reply) => {
    const body = (request.body ?? {}) as TaskPayload
    const { id } = request.params as { id: string }
    const { businessId: _businessId, expectedRevision, ...changes } = body
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.updateTask({ businessId, taskId: id, changes, expectedRevision })
    )
  })

  app.delete('/pipeline/tasks/:id', async (request, reply) => {
    const body = (request.body ?? {}) as BusinessPayload
    const { id } = request.params as { id: string }
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.archiveTask({ businessId, taskId: id })
    )
  })

  app.post('/pipeline/tasks/reorder', async (request, reply) => {
    const body = (request.body ?? {}) as TaskPayload
    return executePipelineRequest(request, reply, accessGuard, body.businessId, (businessId) =>
      pipelineService.reorderTasks({
        businessId,
        status: body.status,
        taskIds: body.taskIds,
        expectedRevision: body.expectedRevision
      })
    )
  })
}

async function executePipelineRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  accessGuard: PipelineAccessGuard,
  explicitBusinessId: unknown,
  operation: (businessId: string) => Promise<unknown>,
  successStatus = 200
) {
  try {
    const businessId = resolvePipelineBusinessId(request, explicitBusinessId)
    const authorized = await accessGuard(request, reply, businessId)
    if (!authorized) return reply
    const result = await operation(businessId)
    return reply.status(successStatus).send(toPipelineDto(result))
  } catch (error) {
    const resolved = asPipelineServiceError(error)
    return reply.status(resolved.statusCode).send(toPipelineErrorDto(resolved))
  }
}

function resolvePipelineBusinessId(request: FastifyRequest, explicitBusinessId: unknown) {
  const queryBusinessId = (request.query as BusinessPayload | undefined)?.businessId
  const candidate = explicitBusinessId ?? queryBusinessId
  try {
    return parseRequiredId(candidate, 'INVALID_BUSINESS_ID')
  } catch (error) {
    if (error instanceof PipelineError || error instanceof PipelineDomainError) {
      throw new PipelineDomainError('INVALID_BUSINESS_ID', 400)
    }
    throw error
  }
}

function pipelineActorId(request: FastifyRequest) {
  return parseRequiredId(request.auth?.user.id, 'INVALID_ACTOR_ID')
}
