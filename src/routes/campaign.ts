import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'

const CAMPAIGN_TYPES = ['ONE_TIME', 'AUTOMATED'] as const
const CAMPAIGN_CHANNELS = ['WHATSAPP', 'EMAIL', 'BOTH'] as const
const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'FINISHED'] as const
const CAMPAIGN_SEGMENTS = [
  'ALL',
  'AT_RISK',
  'INACTIVE',
  'ONE_TIME_VISITOR',
  'NEW_CUSTOMER',
  'MANUAL',
  // Valores anteriores: se conservan para poder editar campanas ya creadas.
  'INACTIVE_90',
  'BIRTHDAY',
  'FREQUENT',
  'NO_FUTURE_APPOINTMENT'
] as const
const MARKETING_TEMPLATE_VARIABLES = ['nombre_cliente', 'fecha_ultima_visita'] as const
const REMINDER_TEMPLATE_VARIABLES = ['nombre_cliente', 'fecha_turno', 'hora_turno', 'servicio', 'profesional'] as const
const whatsappCloudApi = new WhatsAppCloudApi()

type CampaignInput = {
  businessId?: string
  name?: string
  type?: string
  channel?: string
  status?: string
  segment?: string
  segmentLabel?: string
  segmentDays?: number | string | null
  priority?: number | string
  maxAttempts?: number | string
  retryIntervalDays?: number | string
  cooldownDays?: number | string
  respectCooldown?: boolean
  stopOnBooking?: boolean
  stopOnReply?: boolean
  restartAfterVisit?: boolean
  manualCustomerIds?: string[]
  message?: string
  imageUrl?: string | null
  templateName?: string | null
  templateLanguage?: string | null
  templateId?: string | null
  templateStatus?: string | null
  templateRejectionReason?: string | null
  templateLastSyncedAt?: string | Date | null
  whatsappTemplateId?: string | null
  scheduleMode?: string
  scheduledAt?: string | Date | null
  budgetLimit?: number | string | null
}

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/whatsapp-templates', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    return prisma.whatsAppTemplate.findMany({
      where: { businessId },
      include: { _count: { select: { campaigns: true } } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    })
  })

  app.post('/whatsapp-templates', async (request, reply) => {
    const body = request.body as { businessId?: string; internalName?: string; metaName?: string; category?: string; language?: string; body?: string; examples?: Record<string, string>; imageUrl?: string | null }
    const businessId = body.businessId?.trim()
    const internalName = body.internalName?.trim()
    const metaName = normalizeTemplateName(body.metaName)
    const category = normalizeWhatsAppTemplateCategory(body.category)
    const language = body.language?.trim() || 'es_AR'
    const messageBody = body.body?.trim()
    const variables = extractNamedTemplateVariables(messageBody || '')
    const examples = normalizeTemplateExamples(body.examples, variables)
    const imageUrl = normalizeCampaignImage(body.imageUrl)
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    if (!internalName) return reply.status(400).send({ message: 'El nombre interno es requerido' })
    if (!metaName) return reply.status(400).send({ message: 'El nombre en Meta debe usar minusculas, numeros y guiones bajos' })
    if (!category) return reply.status(400).send({ message: 'La categoria debe ser Marketing o Recordatorio' })
    if (!messageBody) return reply.status(400).send({ message: 'El mensaje es requerido' })
    if (messageBody.length > 1024) return reply.status(400).send({ message: 'El mensaje no puede superar 1024 caracteres' })
    const unsupportedVariables = unsupportedTemplateVariables(category, variables)
    if (unsupportedVariables.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage(category, unsupportedVariables) })
    if (variables.some((variable) => !examples[variable])) return reply.status(400).send({ message: 'Completa un ejemplo para cada variable de la plantilla' })
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) return reply.status(400).send({ message: 'Idioma invalido' })
    if (body.imageUrl !== undefined && imageUrl === undefined) return reply.status(400).send({ message: 'La imagen debe ser PNG, JPG o WEBP y no superar 2 MB' })
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { businessId, metaName, language },
      select: { id: true }
    })
    if (existing) {
      return reply.status(409).send({ message: 'Ya existe una plantilla con ese Nombre en Meta e idioma. Elegí otro nombre.' })
    }
    try {
      return await prisma.whatsAppTemplate.create({
        data: { businessId, internalName, metaName, category, language, body: messageBody, exampleJson: JSON.stringify(examples), imageUrl }
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: 'Ya existe una plantilla con ese Nombre en Meta e idioma. Elegí otro nombre.' })
      }
      throw error
    }
  })

  app.patch('/whatsapp-templates/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (!['DRAFT', 'REJECTED'].includes(current.status)) {
      return reply.status(409).send({ message: 'Una plantilla enviada a Meta no puede editarse. Duplica la plantilla para crear otra version.' })
    }
    const body = request.body as { internalName?: string; metaName?: string; category?: string; language?: string; body?: string; examples?: Record<string, string>; imageUrl?: string | null }
    const internalName = body.internalName?.trim() || current.internalName
    const metaName = body.metaName === undefined ? current.metaName : normalizeTemplateName(body.metaName)
    const category = body.category === undefined ? current.category : normalizeWhatsAppTemplateCategory(body.category)
    const language = body.language?.trim() || current.language
    const messageBody = body.body?.trim() || current.body
    const variables = extractNamedTemplateVariables(messageBody)
    const examples = normalizeTemplateExamples(body.examples ?? parseTemplateExamples(current.exampleJson), variables)
    const imageUrl = body.imageUrl === undefined ? current.imageUrl : normalizeCampaignImage(body.imageUrl)
    if (!metaName) return reply.status(400).send({ message: 'Nombre en Meta invalido' })
    if (!category) return reply.status(400).send({ message: 'La categoria debe ser Marketing o Recordatorio' })
    if (messageBody.length > 1024) return reply.status(400).send({ message: 'El mensaje no puede superar 1024 caracteres' })
    const unsupportedVariables = unsupportedTemplateVariables(category, variables)
    if (unsupportedVariables.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage(category, unsupportedVariables) })
    if (variables.some((variable) => !examples[variable])) return reply.status(400).send({ message: 'Completa un ejemplo para cada variable de la plantilla' })
    if (body.imageUrl !== undefined && imageUrl === undefined) return reply.status(400).send({ message: 'La imagen debe ser PNG, JPG o WEBP y no superar 2 MB' })
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { businessId: current.businessId, metaName, language, id: { not: current.id } },
      select: { id: true }
    })
    if (existing) {
      return reply.status(409).send({ message: 'Ya existe una plantilla con ese Nombre en Meta e idioma. Elegí otro nombre.' })
    }
    try {
      return await prisma.whatsAppTemplate.update({
        where: { id: current.id },
        data: { internalName, metaName, category, language, body: messageBody, exampleJson: JSON.stringify(examples), imageUrl, status: 'DRAFT', rejectionReason: null }
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: 'Ya existe una plantilla con ese Nombre en Meta e idioma. Elegí otro nombre.' })
      }
      throw error
    }
  })

  app.delete('/whatsapp-templates/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const template = await prisma.whatsAppTemplate.findUnique({
      where: { id: params.id },
      include: { _count: { select: { campaigns: true } } }
    })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (template._count.campaigns > 0) {
      return reply.status(409).send({ message: 'No se puede eliminar porque esta plantilla esta usada por una o mas campanas' })
    }
    await prisma.whatsAppTemplate.delete({ where: { id: template.id } })
    return { deleted: true }
  })

  app.post('/whatsapp-templates/:id/submit', async (request, reply) => {
    const params = request.params as { id: string }
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (!['DRAFT', 'REJECTED'].includes(template.status)) return reply.status(409).send({ message: 'La plantilla ya fue enviada a Meta' })
    const examples = parseTemplateExamples(template.exampleJson)
    const variables = extractNamedTemplateVariables(template.body)
    const unsupportedVariables = unsupportedTemplateVariables(normalizeWhatsAppTemplateCategory(template.category) ?? 'MARKETING', variables)
    if (unsupportedVariables.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage(template.category, unsupportedVariables) })
    const missingExamples = variables.filter((variable) => !examples[variable])
    if (missingExamples.length) return reply.status(400).send({ message: 'Completa los ejemplos de Meta para: ' + missingExamples.join(', ') })
    const metaTemplate = buildMetaTemplateBody(template.body, examples)
    const result = await whatsappCloudApi.createMessageTemplate({
      name: template.metaName,
      languageCode: template.language,
      category: normalizeWhatsAppTemplateCategory(template.category) ?? 'MARKETING',
      bodyText: metaTemplate.bodyText,
      bodyExamples: metaTemplate.bodyExamples,
      headerImageDataUrl: template.imageUrl
    })
    if (!result.created) {
      return reply.status(502).send({ message: result.errorMessage || result.reason || 'Meta rechazo la solicitud', errorCode: result.errorCode })
    }
    return prisma.whatsAppTemplate.update({
      where: { id: template.id },
      data: {
        metaId: result.response?.id ?? null,
        status: normalizeTemplateStatus(result.response?.status || 'PENDING'),
        rejectionReason: null,
        submittedAt: new Date(),
        lastSyncedAt: new Date()
      }
    })
  })

  app.post('/whatsapp-templates/:id/sync', async (request, reply) => {
    const params = request.params as { id: string }
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (template.status === 'DRAFT') return reply.status(409).send({ message: 'Primero envia la plantilla a revision' })
    const result = await whatsappCloudApi.findMessageTemplate({ id: template.metaId, name: template.metaName, languageCode: template.language })
    if (!result.found || !result.template) {
      return reply.status(result.status === 404 ? 404 : 502).send({ message: result.errorMessage || result.reason || 'No pude consultar Meta' })
    }
    return prisma.whatsAppTemplate.update({
      where: { id: template.id },
      data: {
        metaId: result.template.id ?? template.metaId,
        status: normalizeTemplateStatus(result.template.status),
        rejectionReason: normalizeTemplateRejectionReason(result.template.rejected_reason),
        lastSyncedAt: new Date()
      }
    })
  })

  app.post('/whatsapp-templates/:id/test-send', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { phone?: string; confirmed?: boolean }
    const phone = String(body.phone || '').replace(/\D/g, '')
    if (!body.confirmed) return reply.status(400).send({ message: 'Confirma que el numero de destino es tuyo' })
    if (phone.length < 8 || phone.length > 15) return reply.status(400).send({ message: 'Ingresa el numero completo con codigo de pais' })
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (template.status !== 'APPROVED') return reply.status(409).send({ message: 'Meta debe aprobar la plantilla antes de probarla' })
    const examples = parseTemplateExamples(template.exampleJson)
    const variables = extractNamedTemplateVariables(template.body)
    const missingExamples = variables.filter((variable) => !examples[variable])
    if (missingExamples.length) return reply.status(400).send({ message: 'Faltan ejemplos para: ' + missingExamples.join(', ') })
    const result = await whatsappCloudApi.sendTemplateMessage({
      to: phone,
      templateName: template.metaName,
      languageCode: template.language,
      bodyParameters: variables.map((variable) => examples[variable]),
      headerImageDataUrl: template.imageUrl
    })
    if (!result.sent) {
      return reply.status(502).send({ message: result.errorMessage || result.reason || 'No pude enviar la prueba por WhatsApp', errorCode: result.errorCode })
    }
    return { sent: true, to: result.to }
  })

  app.post('/whatsapp-templates/:id/variable-preview', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { customerId?: string; appointmentId?: string }
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })
    if (template.status !== 'APPROVED') return reply.status(409).send({ message: 'La plantilla debe estar aprobada para usar datos reales' })

    const context = await buildTemplateVariableContext({
      businessId: template.businessId,
      customerId: body.customerId,
      appointmentId: body.appointmentId
    })
    const resolved = resolveWhatsAppTemplateVariables({
      body: template.body,
      category: template.category,
      context
    })
    if (resolved.unsupported.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage(template.category, resolved.unsupported) })
    return resolved
  })

  app.get('/whatsapp-reminder-automation', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const current = await prisma.whatsAppReminderAutomation.findUnique({ where: { businessId } })
    if (current) return current
    return prisma.whatsAppReminderAutomation.create({ data: { businessId } })
  })

  app.patch('/whatsapp-reminder-automation', async (request, reply) => {
    const body = request.body as { businessId?: string; templateId?: string | null; enabled?: boolean; sendBeforeMinutes?: number | string }
    const businessId = body.businessId?.trim()
    const templateId = body.templateId?.trim() || null
    const sendBeforeMinutes = Number(body.sendBeforeMinutes ?? 1440)
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    if (![60, 120, 1440, 2880].includes(sendBeforeMinutes)) {
      return reply.status(400).send({ message: 'Elegí un tiempo de recordatorio válido' })
    }
    if (templateId) {
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: templateId, businessId, status: 'APPROVED' } })
      if (!template) return reply.status(400).send({ message: 'Seleccioná una plantilla de recordatorio aprobada' })
      if (normalizeWhatsAppTemplateCategory(template.category) !== 'UTILITY') {
        return reply.status(400).send({ message: 'Los recordatorios solo pueden usar plantillas aprobadas de Recordatorio' })
      }
    }
    if (body.enabled && !templateId) {
      return reply.status(400).send({ message: 'Seleccioná una plantilla aprobada antes de activar recordatorios' })
    }
    return prisma.whatsAppReminderAutomation.upsert({
      where: { businessId },
      create: { businessId, templateId, enabled: Boolean(body.enabled), sendBeforeMinutes },
      update: { templateId, enabled: Boolean(body.enabled), sendBeforeMinutes }
    })
  })

  app.post('/whatsapp/message-templates', async (request, reply) => {
    const body = request.body as {
      name?: string
      languageCode?: string
      category?: string
      bodyText?: string
    }
    const name = normalizeTemplateName(body.name)
    const languageCode = body.languageCode?.trim() || 'es_AR'
    const category = body.category?.trim().toUpperCase() || 'MARKETING'
    const bodyText = body.bodyText?.trim()

    if (!name) return reply.status(400).send({ message: 'Indica un nombre valido para la plantilla' })
    if (!bodyText) return reply.status(400).send({ message: 'Escribi el texto de la plantilla' })
    if (bodyText.length > 1024) return reply.status(400).send({ message: 'La plantilla no puede superar 1024 caracteres' })
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(languageCode)) {
      return reply.status(400).send({ message: 'El idioma debe tener formato es_AR o en_US' })
    }
    if (!['MARKETING', 'UTILITY'].includes(category)) {
      return reply.status(400).send({ message: 'La categoria debe ser Marketing o Utilidad' })
    }

    const result = await whatsappCloudApi.createMessageTemplate({
      name,
      languageCode,
      category: category as 'MARKETING' | 'UTILITY',
      bodyText
    })

    if (!result.created) {
      return reply.status(502).send({
        message: result.errorMessage || result.reason || 'Meta rechazo la plantilla',
        errorCode: result.errorCode,
        status: result.status
      })
    }

    return {
      created: true,
      name,
      languageCode,
      category,
      status: result.response?.status ?? 'PENDING',
      id: result.response?.id ?? null
    }
  })

  app.post('/campaigns/:id/template/sync', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })
    if (!campaign.templateName) return reply.status(400).send({ message: 'La campana no tiene una plantilla asociada' })

    const result = await whatsappCloudApi.findMessageTemplate({
      id: campaign.templateId,
      name: campaign.templateName,
      languageCode: campaign.templateLanguage
    })
    if (!result.found || !result.template) {
      return reply.status(result.status === 404 ? 404 : 502).send({
        message: result.errorMessage || result.reason || 'No pude consultar el estado en Meta',
        errorCode: result.errorCode
      })
    }

    return prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        templateId: result.template.id ?? campaign.templateId,
        templateStatus: normalizeTemplateStatus(result.template.status),
        templateRejectionReason: normalizeTemplateRejectionReason(result.template.rejected_reason),
        templateLastSyncedAt: new Date()
      },
      include: { manualRecipients: { select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } } } }
    })
  })

  app.get('/campaigns', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })

    return prisma.campaign.findMany({
      where: { businessId },
      include: { manualRecipients: { select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } } } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    })
  })

  app.post('/campaigns', async (request, reply) => {
    const body = request.body as CampaignInput
    const normalized = normalizeCampaignInput(body, reply, true)
    if (!normalized) return

    const business = await prisma.business.findUnique({ where: { id: normalized.businessId } })
    if (!business) return reply.status(404).send({ message: 'No encontre ese comercio' })
    if (normalized.whatsappTemplateId) {
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: normalized.whatsappTemplateId, businessId: normalized.businessId, status: 'APPROVED' } })
      if (!template) return reply.status(400).send({ message: 'Selecciona una plantilla aprobada de este comercio' })
      if (normalizeWhatsAppTemplateCategory(template.category) !== 'MARKETING') return reply.status(400).send({ message: 'Las campanas de marketing solo pueden usar plantillas de Marketing aprobadas' })
      const unsupportedVariables = unsupportedTemplateVariables('MARKETING', extractNamedTemplateVariables(template.body))
      if (unsupportedVariables.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage('MARKETING', unsupportedVariables) })
      normalized.message = template.body
      normalized.templateName = template.metaName
      normalized.templateLanguage = template.language
      normalized.templateId = template.metaId
      normalized.templateStatus = template.status
      normalized.templateRejectionReason = template.rejectionReason
      normalized.templateLastSyncedAt = template.lastSyncedAt
      normalized.imageUrl = template.imageUrl
    }

    const campaign = await prisma.campaign.create({ data: normalized })
    await replaceManualRecipients(campaign.id, body.manualCustomerIds)
    return prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: { manualRecipients: { select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } } } }
    })
  })

  app.patch('/campaigns/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre esa campana' })

    const body = request.body as CampaignInput
    const normalized = normalizeCampaignInput({ ...current, ...body }, reply, true)
    if (!normalized) return
    if (normalized.whatsappTemplateId) {
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: normalized.whatsappTemplateId, businessId: normalized.businessId, status: 'APPROVED' } })
      if (!template) return reply.status(400).send({ message: 'Selecciona una plantilla aprobada de este comercio' })
      if (normalizeWhatsAppTemplateCategory(template.category) !== 'MARKETING') return reply.status(400).send({ message: 'Las campanas de marketing solo pueden usar plantillas de Marketing aprobadas' })
      const unsupportedVariables = unsupportedTemplateVariables('MARKETING', extractNamedTemplateVariables(template.body))
      if (unsupportedVariables.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage('MARKETING', unsupportedVariables) })
      normalized.message = template.body
      normalized.templateName = template.metaName
      normalized.templateLanguage = template.language
      normalized.templateId = template.metaId
      normalized.templateStatus = template.status
      normalized.templateRejectionReason = template.rejectionReason
      normalized.templateLastSyncedAt = template.lastSyncedAt
      normalized.imageUrl = template.imageUrl
    }

    const { businessId: _businessId, ...data } = normalized
    await prisma.campaign.update({ where: { id: params.id }, data })
    if (body.manualCustomerIds !== undefined) await replaceManualRecipients(params.id, body.manualCustomerIds)
    return prisma.campaign.findUnique({
      where: { id: params.id },
      include: { manualRecipients: { select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } } } }
    })
  })

  app.post('/campaigns/:id/duplicate', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre esa campana' })

    const duplicate = await prisma.campaign.create({
      data: {
        businessId: current.businessId,
        name: uniqueCopyName(current.name),
        type: current.type,
        channel: current.channel,
        status: 'DRAFT',
        segment: current.segment,
        segmentLabel: current.segmentLabel,
        segmentDays: current.segmentDays,
        priority: current.priority,
        maxAttempts: current.maxAttempts,
        retryIntervalDays: current.retryIntervalDays,
        cooldownDays: current.cooldownDays,
        respectCooldown: current.respectCooldown,
        stopOnBooking: true,
        stopOnReply: true,
        restartAfterVisit: true,
        message: current.message,
        imageUrl: current.imageUrl,
        templateName: current.templateName,
        templateLanguage: current.templateLanguage,
        templateId: current.templateId,
        templateStatus: current.templateStatus,
        templateRejectionReason: current.templateRejectionReason,
        templateLastSyncedAt: current.templateLastSyncedAt,
        whatsappTemplateId: current.whatsappTemplateId,
        scheduleMode: current.scheduleMode,
        scheduledAt: null,
        budgetLimit: current.budgetLimit
      }
    })
    const recipients = await prisma.campaignManualRecipient.findMany({ where: { campaignId: current.id } })
    if (recipients.length) {
      await prisma.campaignManualRecipient.createMany({
        data: recipients.map((recipient) => ({ campaignId: duplicate.id, customerId: recipient.customerId })),
        skipDuplicates: true
      })
    }
    return prisma.campaign.findUnique({
      where: { id: duplicate.id },
      include: { manualRecipients: { select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } } } }
    })
  })

  app.get('/campaign-customer-options', async (request, reply) => {
    const query = request.query as { businessId?: string; q?: string; page?: string; take?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const page = Math.max(1, Number(query.page) || 1)
    const take = Math.min(50, Math.max(10, Number(query.take) || 24))
    const search = query.q?.trim() || ''
    const where = {
      appointments: { some: { professional: { businessId } } },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } }
            ]
          }
        : {})
    }
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        select: { id: true, name: true, phone: true },
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * take,
        take
      })
    ])
    return {
      items: customers,
      pagination: { page, take, total, totalPages: Math.max(1, Math.ceil(total / take)) }
    }
  })

  app.get('/campaigns/:id/audience-preview', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        manualRecipients: {
          include: { customer: { select: { id: true, name: true, phone: true } } }
        }
      }
    })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })

    return calculateCampaignAudience(campaign)
  })

  app.get('/campaigns/:id/simulations/latest', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })

    const run = await prisma.campaignRun.findFirst({
      where: { campaignId: campaign.id, mode: 'SIMULATION' },
      include: {
        jobs: {
          include: { customer: { select: { id: true, name: true, phone: true } } },
          orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
          take: 100
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    return { run }
  })

  app.post('/campaigns/:id/simulate', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        manualRecipients: {
          include: { customer: { select: { id: true, name: true, phone: true } } }
        }
      }
    })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })

    const audience = await calculateCampaignAudience(campaign)
    const excludedCount = Object.values(audience.excluded).reduce((total, count) => total + Number(count || 0), 0)
    const candidateCount = audience.total + excludedCount
    const now = new Date()
    const latestDeliveries = audience.included.length
      ? await prisma.campaignDelivery.findMany({
          where: { campaignId: campaign.id, customerId: { in: audience.included.map((customer) => customer.id) } },
          orderBy: { sentAt: 'desc' }
        })
      : []
    const attemptsByCustomer = new Map<string, number>()
    for (const delivery of latestDeliveries) {
      if (!attemptsByCustomer.has(delivery.customerId)) attemptsByCustomer.set(delivery.customerId, delivery.attemptNumber)
    }

    const run = await prisma.$transaction(async (tx) => {
      const createdRun = await tx.campaignRun.create({
        data: {
          businessId: campaign.businessId,
          campaignId: campaign.id,
          mode: 'SIMULATION',
          status: 'COMPLETED',
          candidateCount,
          eligibleCount: audience.total,
          excludedCount,
          exclusionSummary: audience.excluded,
          configurationSnapshot: {
            type: campaign.type,
            channel: campaign.channel,
            segment: campaign.segment,
            segmentDays: campaign.segmentDays,
            priority: campaign.priority,
            maxAttempts: campaign.maxAttempts,
            retryIntervalDays: campaign.retryIntervalDays,
            cooldownDays: campaign.cooldownDays,
            respectCooldown: campaign.respectCooldown,
            budgetLimit: campaign.budgetLimit,
            scheduleMode: campaign.scheduleMode,
            scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
            templateName: campaign.templateName,
            templateLanguage: campaign.templateLanguage,
            templateId: campaign.templateId,
            templateStatus: campaign.templateStatus
          },
          completedAt: now
        }
      })
      if (audience.included.length) {
        await tx.campaignJob.createMany({
          data: audience.included.map((customer, index) => ({
            businessId: campaign.businessId,
            campaignId: campaign.id,
            runId: createdRun.id,
            customerId: customer.id,
            status: 'READY',
            attemptNumber: (attemptsByCustomer.get(customer.id) ?? 0) + 1,
            retryCount: 0,
            maxRetries: 3,
            nextAttemptAt: campaign.scheduleMode === 'SCHEDULED' && campaign.scheduledAt && campaign.scheduledAt > now
              ? campaign.scheduledAt
              : new Date(now.getTime() + index * 1000),
            idempotencyKey: 'simulation:' + createdRun.id + ':' + customer.id
          }))
        })
      }
      return createdRun
    })

    return prisma.campaignRun.findUnique({
      where: { id: run.id },
      include: {
        jobs: {
          include: { customer: { select: { id: true, name: true, phone: true } } },
          orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
          take: 100
        }
      }
    })
  })

  app.get('/campaigns/:id/deliveries', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })

    return prisma.campaignDelivery.findMany({
      where: { campaignId: campaign.id },
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: { sentAt: 'desc' },
      take: 500
    })
  })

  app.post('/campaigns/:id/deliveries', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { customerId?: string; providerMessageId?: string; sentAt?: string }
    const customerId = body.customerId?.trim()
    if (!customerId) return reply.status(400).send({ message: 'customerId es requerido' })

    const campaign = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })
    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) return reply.status(404).send({ message: 'No encontre ese cliente' })

    const sentAt = body.sentAt ? new Date(body.sentAt) : new Date()
    if (Number.isNaN(sentAt.getTime())) return reply.status(400).send({ message: 'Fecha de envio invalida' })

    const lastVisit = campaign.restartAfterVisit
      ? await prisma.appointment.findFirst({
          where: {
            customerId,
            professional: { businessId: campaign.businessId },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startAt: { lte: sentAt }
          },
          orderBy: { startAt: 'desc' },
          select: { startAt: true }
        })
      : null
    const previousAttempts = await prisma.campaignDelivery.count({
      where: {
        campaignId: campaign.id,
        customerId,
        status: { notIn: ['FAILED', 'CANCELLED'] },
        ...(lastVisit ? { sentAt: { gt: lastVisit.startAt } } : {})
      }
    })

    return prisma.campaignDelivery.create({
      data: {
        businessId: campaign.businessId,
        campaignId: campaign.id,
        customerId,
        status: 'SENT',
        attemptNumber: previousAttempts + 1,
        providerMessageId: body.providerMessageId?.trim() || null,
        sentAt
      }
    })
  })

  app.patch('/campaign-deliveries/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { status?: string }
    const status = body.status?.trim().toUpperCase()
    const allowed = ['SENT', 'DELIVERED', 'READ', 'RESPONDED', 'BOOKED', 'FAILED', 'CANCELLED']
    if (!status || !allowed.includes(status)) {
      return reply.status(400).send({ message: 'Estado de entrega invalido' })
    }
    const current = await prisma.campaignDelivery.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre ese envio' })

    const changedAt = new Date()
    return prisma.campaignDelivery.update({
      where: { id: current.id },
      data: {
        status,
        ...(status === 'DELIVERED' ? { deliveredAt: changedAt } : {}),
        ...(status === 'READ' ? { deliveredAt: current.deliveredAt ?? changedAt, readAt: changedAt } : {}),
        ...(status === 'RESPONDED' ? { respondedAt: changedAt } : {}),
        ...(status === 'BOOKED' ? { bookedAt: changedAt } : {})
      }
    })
  })

  app.patch('/customers/:customerId/marketing-preference', async (request, reply) => {
    const params = request.params as { customerId: string }
    const body = request.body as { businessId?: string; status?: string; source?: string }
    const businessId = body.businessId?.trim()
    const status = body.status?.trim().toUpperCase()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    if (!status || !['ACTIVE', 'NOT_AUTHORIZED', 'DECLINED', 'OPTED_OUT'].includes(status)) {
      return reply.status(400).send({ message: 'Estado de marketing invalido' })
    }

    const [business, customer] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.customer.findUnique({ where: { id: params.customerId } })
    ])
    if (!business || !customer) return reply.status(404).send({ message: 'No encontre el comercio o cliente' })

    return prisma.customerMarketingPreference.upsert({
      where: { businessId_customerId: { businessId, customerId: customer.id } },
      create: {
        businessId,
        customerId: customer.id,
        status,
        source: body.source?.trim().toUpperCase() || 'MANUAL',
        optedInAt: status === 'ACTIVE' ? new Date() : null,
        declinedAt: status === 'DECLINED' ? new Date() : null,
        optedOutAt: status === 'OPTED_OUT' ? new Date() : null
      },
      update: {
        status,
        source: body.source?.trim().toUpperCase() || 'MANUAL',
        ...(status === 'ACTIVE' ? { optedInAt: new Date() } : {}),
        declinedAt: status === 'DECLINED' ? new Date() : null,
        optedOutAt: status === 'OPTED_OUT' ? new Date() : null
      }
    })
  })

  app.get('/customers/:customerId/marketing-preference', async (request, reply) => {
    const params = request.params as { customerId: string }
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const preference = await prisma.customerMarketingPreference.findUnique({
      where: { businessId_customerId: { businessId, customerId: params.customerId } }
    })
    return {
      customerId: params.customerId,
      status: preference?.status ?? 'NOT_AUTHORIZED',
      source: preference?.source ?? 'DEFAULT',
      optedInAt: preference?.optedInAt ?? null,
      declinedAt: preference?.declinedAt ?? null,
      optedOutAt: preference?.optedOutAt ?? null,
      updatedAt: preference?.updatedAt ?? null
    }
  })

  app.delete('/campaigns/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.campaign.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre esa campana' })
    if (current.status === 'ACTIVE') {
      return reply.status(409).send({ message: 'Pausa la campana antes de eliminarla' })
    }

    await prisma.campaign.delete({ where: { id: params.id } })
    return { deleted: true }
  })
}

function normalizeCampaignInput(body: CampaignInput, reply: FastifyReply, requireBusiness: true) {
  const businessId = body.businessId?.trim()
  const name = body.name?.trim()
  const message = body.message?.trim()
  const imageUrl = normalizeCampaignImage(body.imageUrl)
  const templateName = normalizeTemplateName(body.templateName)
  const templateLanguage = body.templateLanguage?.trim() || 'es_AR'
  const templateId = body.templateId?.trim() || null
  const templateStatus = normalizeTemplateStatus(body.templateStatus)
  const templateRejectionReason = body.templateRejectionReason?.trim() || null
  const templateLastSyncedAt = body.templateLastSyncedAt ? new Date(body.templateLastSyncedAt) : null
  const whatsappTemplateId = body.whatsappTemplateId?.trim() || null
  const type = body.type?.trim().toUpperCase() || 'ONE_TIME'
  const channel = body.channel?.trim().toUpperCase() || 'WHATSAPP'
  const status = body.status?.trim().toUpperCase() || 'DRAFT'
  const segment = body.segment?.trim().toUpperCase() || 'ALL'
  const segmentLabel = body.segmentLabel?.trim() || 'Todos los clientes'
  const segmentDays = optionalInteger(body.segmentDays)
  const priority = integerOrDefault(body.priority, 2)
  const maxAttempts = integerOrDefault(body.maxAttempts, 2)
  const retryIntervalDays = integerOrDefault(body.retryIntervalDays, 30)
  const cooldownDays = integerOrDefault(body.cooldownDays, 30)
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
  const scheduleMode = body.scheduleMode?.trim().toUpperCase() || (scheduledAt ? 'SCHEDULED' : 'IMMEDIATE')
  const budgetLimit = body.budgetLimit === null || body.budgetLimit === undefined || body.budgetLimit === ''
    ? null
    : Number(body.budgetLimit)

  if (requireBusiness && !businessId) {
    reply.status(400).send({ message: 'businessId es requerido' })
    return null
  }
  if (!name) {
    reply.status(400).send({ message: 'El nombre de la campana es requerido' })
    return null
  }
  if (!message) {
    reply.status(400).send({ message: 'El mensaje es requerido' })
    return null
  }
  if (templateName === undefined) {
    reply.status(400).send({ message: 'El nombre de la plantilla debe usar minusculas, numeros y guiones bajos' })
    return null
  }
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLanguage)) {
    reply.status(400).send({ message: 'El idioma de la plantilla debe tener formato es_AR o en_US' })
    return null
  }
  if (body.templateLastSyncedAt && Number.isNaN(templateLastSyncedAt?.getTime())) {
    reply.status(400).send({ message: 'Fecha de sincronizacion de plantilla invalida' })
    return null
  }
  if (body.imageUrl !== undefined && imageUrl === undefined) {
    reply.status(400).send({ message: 'La imagen debe ser PNG, JPG o WEBP y pesar hasta 2 MB' })
    return null
  }
  if (!CAMPAIGN_TYPES.includes(type as (typeof CAMPAIGN_TYPES)[number])) {
    reply.status(400).send({ message: 'Tipo de campana invalido' })
    return null
  }
  if (!CAMPAIGN_CHANNELS.includes(channel as (typeof CAMPAIGN_CHANNELS)[number])) {
    reply.status(400).send({ message: 'Canal invalido' })
    return null
  }
  if (!CAMPAIGN_STATUSES.includes(status as (typeof CAMPAIGN_STATUSES)[number])) {
    reply.status(400).send({ message: 'Estado invalido' })
    return null
  }
  if (!CAMPAIGN_SEGMENTS.includes(segment as (typeof CAMPAIGN_SEGMENTS)[number])) {
    reply.status(400).send({ message: 'Segmento invalido' })
    return null
  }
  if (type === 'AUTOMATED' && ['INACTIVE', 'ONE_TIME_VISITOR', 'NEW_CUSTOMER'].includes(segment) && segmentDays === null) {
    reply.status(400).send({ message: 'Indica la cantidad de dias para este segmento' })
    return null
  }
  if (segmentDays !== null && (!Number.isInteger(segmentDays) || segmentDays < 1 || segmentDays > 730)) {
    reply.status(400).send({ message: 'Los dias del segmento deben estar entre 1 y 730' })
    return null
  }
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) {
    reply.status(400).send({ message: 'La prioridad debe ser baja, media o alta' })
    return null
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    reply.status(400).send({ message: 'La cantidad de intentos debe estar entre 1 y 10' })
    return null
  }
  if (!Number.isInteger(retryIntervalDays) || retryIntervalDays < 1 || retryIntervalDays > 365) {
    reply.status(400).send({ message: 'El tiempo entre intentos debe estar entre 1 y 365 dias' })
    return null
  }
  if (!Number.isInteger(cooldownDays) || cooldownDays < 0 || cooldownDays > 365) {
    reply.status(400).send({ message: 'El descanso entre promociones debe estar entre 0 y 365 dias' })
    return null
  }
  if (body.scheduledAt && Number.isNaN(scheduledAt?.getTime())) {
    reply.status(400).send({ message: 'Fecha de programacion invalida' })
    return null
  }
  if (!['IMMEDIATE', 'SCHEDULED'].includes(scheduleMode)) {
    reply.status(400).send({ message: 'Modo de programacion invalido' })
    return null
  }
  if (scheduleMode === 'SCHEDULED' && !scheduledAt) {
    reply.status(400).send({ message: 'Selecciona la fecha y hora de programacion' })
    return null
  }
  if (status === 'SCHEDULED' && scheduleMode !== 'SCHEDULED') {
    reply.status(400).send({ message: 'Una campana programada necesita fecha y hora' })
    return null
  }
  if (budgetLimit !== null && (!Number.isInteger(budgetLimit) || budgetLimit < 0)) {
    reply.status(400).send({ message: 'El presupuesto debe ser un numero entero mayor o igual a 0' })
    return null
  }

  return {
    businessId: businessId!,
    name,
    message,
    imageUrl,
    type,
    channel,
    status,
    segment,
    segmentLabel,
    segmentDays,
    priority,
    maxAttempts,
    retryIntervalDays,
    cooldownDays,
    respectCooldown: body.respectCooldown ?? true,
    stopOnBooking: true,
    stopOnReply: true,
    restartAfterVisit: true,
    templateName,
    templateLanguage,
    templateId,
    templateStatus: templateName ? templateStatus : 'NOT_CREATED',
    templateRejectionReason: templateName ? templateRejectionReason : null,
    templateLastSyncedAt: templateName ? templateLastSyncedAt : null,
    whatsappTemplateId,
    scheduleMode,
    scheduledAt,
    budgetLimit
  }
}

function optionalInteger(value?: number | string | null) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

function integerOrDefault(value: number | string | undefined, fallback: number) {
  if (value === undefined || value === '') return fallback
  return Number(value)
}

function normalizeCampaignImage(imageUrl?: string | null) {
  if (imageUrl === undefined) return undefined
  if (imageUrl === null || imageUrl.trim() === '') return null

  const normalized = imageUrl.trim()
  const isSupportedImage = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(normalized)
  return isSupportedImage && normalized.length <= 2_800_000 ? normalized : undefined
}

function normalizeTemplateName(templateName?: string | null) {
  if (templateName === undefined || templateName === null || templateName.trim() === '') return null
  const normalized = templateName.trim()
  return /^[a-z0-9_]{1,512}$/.test(normalized) ? normalized : undefined
}

function normalizeTemplateStatus(status?: string | null) {
  const normalized = status?.trim().toUpperCase() || 'NOT_CREATED'
  return /^[A-Z_]{2,40}$/.test(normalized) ? normalized : 'NOT_CREATED'
}

function normalizeWhatsAppTemplateCategory(category?: string | null): 'MARKETING' | 'UTILITY' | undefined {
  const normalized = category?.trim().toUpperCase()
  if (normalized === 'MARKETING') return 'MARKETING'
  if (normalized === 'UTILITY' || normalized === 'REMINDER' || normalized === 'RECORDATORIO') return 'UTILITY'
  return undefined
}

function supportedTemplateVariables(category?: string | null) {
  return normalizeWhatsAppTemplateCategory(category) === 'UTILITY'
    ? REMINDER_TEMPLATE_VARIABLES
    : MARKETING_TEMPLATE_VARIABLES
}

function unsupportedTemplateVariables(category: string | null | undefined, variables: string[]) {
  const allowed = new Set<string>(supportedTemplateVariables(category))
  return variables.filter((variable) => !allowed.has(variable))
}

function unsupportedTemplateVariablesMessage(category: string | null | undefined, variables: string[]) {
  const label = normalizeWhatsAppTemplateCategory(category) === 'UTILITY' ? 'Recordatorio' : 'Marketing'
  return 'Variables no compatibles para ' + label + ': ' + variables.map((variable) => '{{' + variable + '}}').join(', ')
}

function extractNamedTemplateVariables(text: string) {
  const variables = new Set<string>()
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) variables.add(match[1])
  return Array.from(variables)
}

function normalizeTemplateExamples(examples: Record<string, string> | undefined, variables: string[]) {
  const normalized: Record<string, string> = {}
  for (const variable of variables) {
    const value = examples?.[variable]?.trim()
    if (value) normalized[variable] = value.slice(0, 120)
  }
  return normalized
}

function parseTemplateExamples(exampleJson?: string | null) {
  if (!exampleJson) return {}
  try {
    const parsed = JSON.parse(exampleJson) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

function buildMetaTemplateBody(body: string, examples: Record<string, string>) {
  const variables = extractNamedTemplateVariables(body)
  const indexByVariable = new Map(variables.map((variable, index) => [variable, String(index + 1)]))
  const bodyText = body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable: string) => {
    return '{{' + (indexByVariable.get(variable) || variable) + '}}'
  })
  return {
    bodyText,
    bodyExamples: variables.map((variable) => examples[variable]).filter(Boolean)
  }
}

type TemplateVariableContext = {
  customer?: { id: string; name: string; phone: string } | null
  lastVisitAt?: Date | null
  appointment?: {
    id: string
    startAt: Date
    customer: { id: string; name: string; phone: string }
    service: { name: string }
    professional: { name: string }
  } | null
}

async function buildTemplateVariableContext(input: { businessId: string; customerId?: string; appointmentId?: string }): Promise<TemplateVariableContext> {
  const appointment = input.appointmentId
    ? await prisma.appointment.findFirst({
        where: { id: input.appointmentId, professional: { businessId: input.businessId } },
        select: {
          id: true,
          startAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { name: true } },
          professional: { select: { name: true } }
        }
      })
    : null
  const customerId = input.customerId || appointment?.customer.id
  const customer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, phone: true }
      })
    : null
  const lastVisit = customer
    ? await prisma.appointment.findFirst({
        where: {
          customerId: customer.id,
          professional: { businessId: input.businessId },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lte: new Date() }
        },
        select: { startAt: true },
        orderBy: { startAt: 'desc' }
      })
    : null
  return { customer: customer || appointment?.customer || null, lastVisitAt: lastVisit?.startAt ?? null, appointment }
}

function resolveWhatsAppTemplateVariables(input: { body: string; category?: string | null; context: TemplateVariableContext }) {
  const variables = extractNamedTemplateVariables(input.body)
  const unsupported = unsupportedTemplateVariables(input.category, variables)
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const variable of variables) {
    const value = resolveTemplateVariableValue(variable, input.context)
    if (value) values[variable] = value
    else if (!unsupported.includes(variable)) missing.push(variable)
  }
  const previewText = input.body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable: string) => {
    return values[variable] || '{{' + variable + '}}'
  })
  return {
    variables,
    values,
    missing,
    unsupported,
    previewText,
    bodyParameters: variables.map((variable) => values[variable] || '')
  }
}

function resolveTemplateVariableValue(variable: string, context: TemplateVariableContext) {
  if (variable === 'nombre_cliente') return context.customer?.name?.trim() || null
  if (variable === 'fecha_ultima_visita') return context.lastVisitAt ? formatTemplateDate(context.lastVisitAt) : null
  if (variable === 'fecha_turno') return context.appointment?.startAt ? formatTemplateDate(context.appointment.startAt) : null
  if (variable === 'hora_turno') return context.appointment?.startAt ? formatTemplateTime(context.appointment.startAt) : null
  if (variable === 'servicio') return context.appointment?.service.name?.trim() || null
  if (variable === 'profesional') return context.appointment?.professional.name?.trim() || null
  return null
}

function formatTemplateDate(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(date)
}

function formatTemplateTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }).format(date)
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

function normalizeTemplateRejectionReason(reason?: string | null) {
  const normalized = reason?.trim()
  if (!normalized || normalized.toUpperCase() === 'NONE') return null
  return normalized
}

function uniqueCopyName(name: string) {
  const suffix = ' (copia)'
  return name.endsWith(suffix) ? name + ' 2' : name + suffix
}

async function replaceManualRecipients(campaignId: string, customerIds?: string[]) {
  const uniqueCustomerIds = Array.from(new Set((customerIds ?? []).map((id) => id.trim()).filter(Boolean)))
  await prisma.$transaction([
    prisma.campaignManualRecipient.deleteMany({ where: { campaignId } }),
    ...(uniqueCustomerIds.length
      ? [prisma.campaignManualRecipient.createMany({
          data: uniqueCustomerIds.map((customerId) => ({ campaignId, customerId })),
          skipDuplicates: true
        })]
      : [])
  ])
}

type AudienceAppointment = {
  customerId: string
  startAt: Date
  status: string
  customer: { id: string; name: string; phone: string }
}

type AudienceCampaign = {
  type: string
  segment: string
  segmentDays: number | null
  stopOnBooking: boolean
  manualRecipients?: Array<{ customer: { id: string; name: string; phone: string } }>
}

type EligibilityCampaign = AudienceCampaign & {
  id: string
  priority: number
  maxAttempts: number
  retryIntervalDays: number
  cooldownDays: number
  respectCooldown: boolean
  stopOnReply: boolean
  restartAfterVisit: boolean
}

type MarketingPreferenceRow = {
  customerId: string
  status: string
}

type CampaignDeliveryRow = {
  campaignId: string
  customerId: string
  sentAt: Date
  respondedAt: Date | null
  bookedAt: Date | null
}

async function calculateCampaignAudience(campaign: EligibilityCampaign & {
  businessId: string
  createdAt: Date
  manualRecipients?: Array<{ customer: { id: string; name: string; phone: string } }>
}) {
  const appointments = await prisma.appointment.findMany({
    where: { professional: { businessId: campaign.businessId } },
    select: {
      customerId: true,
      startAt: true,
      status: true,
      customer: { select: { id: true, name: true, phone: true } }
    },
    orderBy: { startAt: 'asc' }
  })

  const baseAudience = buildAudiencePreview(campaign, appointments)
  const candidateIds = baseAudience.included.map((customer) => customer.id)
  if (!candidateIds.length) return {
    ...baseAudience,
    excluded: {
      ...baseAudience.excluded,
      marketingNotAuthorized: 0,
      higherPriorityCampaign: 0,
      promotionCooldown: 0,
      retryWindow: 0,
      attemptLimit: 0,
      replied: 0,
      booked: 0
    }
  }

  const [preferences, deliveries, competingCampaigns] = await Promise.all([
    prisma.customerMarketingPreference.findMany({
      where: { businessId: campaign.businessId, customerId: { in: candidateIds } }
    }),
    prisma.campaignDelivery.findMany({
      where: {
        businessId: campaign.businessId,
        customerId: { in: candidateIds },
        status: { notIn: ['FAILED', 'CANCELLED'] }
      },
      orderBy: { sentAt: 'desc' }
    }),
    prisma.campaign.findMany({
      where: {
        businessId: campaign.businessId,
        type: 'AUTOMATED',
        status: 'ACTIVE',
        id: { not: campaign.id }
      }
    })
  ])

  const higherPriorityCustomerIds = new Set<string>()
  for (const competitor of competingCampaigns) {
    const competitorWins = competitor.priority > campaign.priority ||
      (competitor.priority === campaign.priority && competitor.createdAt < campaign.createdAt)
    if (!competitorWins) continue
    const competitorBaseAudience = buildAudiencePreview(competitor, appointments)
    const eligibleCompetitorAudience = applyCampaignEligibility({
      campaign: competitor,
      baseAudience: competitorBaseAudience,
      preferences,
      deliveries,
      higherPriorityCustomerIds: new Set<string>()
    })
    for (const customer of eligibleCompetitorAudience.included) {
      higherPriorityCustomerIds.add(customer.id)
    }
  }

  return applyCampaignEligibility({ campaign, baseAudience, preferences, deliveries, higherPriorityCustomerIds })
}

function buildAudiencePreview(campaign: AudienceCampaign, appointments: AudienceAppointment[]) {
  const now = new Date()
  const customers = new Map<string, {
    id: string
    name: string
    phone: string
    visits: Date[]
    hasFutureAppointment: boolean
  }>()

  if (campaign.segment === 'MANUAL') {
    for (const recipient of campaign.manualRecipients ?? []) {
      customers.set(recipient.customer.id, {
        id: recipient.customer.id,
        name: recipient.customer.name,
        phone: recipient.customer.phone,
        visits: [],
        hasFutureAppointment: false
      })
    }
  }

  for (const appointment of appointments) {
    if (campaign.segment === 'MANUAL' && !customers.has(appointment.customerId)) continue
    const customer = customers.get(appointment.customerId) ?? {
      id: appointment.customer.id,
      name: appointment.customer.name,
      phone: appointment.customer.phone,
      visits: [],
      hasFutureAppointment: false
    }
    const active = appointment.status !== 'CANCELLED' && appointment.status !== 'NO_SHOW'
    if (active && appointment.startAt > now) customer.hasFutureAppointment = true
    if (active && (appointment.status === 'COMPLETED' || appointment.startAt <= now)) {
      customer.visits.push(appointment.startAt)
    }
    customers.set(appointment.customerId, customer)
  }

  let missingPhone = 0
  let withFutureAppointment = 0
  const included = Array.from(customers.values()).filter((customer) => {
    if (!isUsableCampaignPhone(customer.phone)) {
      missingPhone += 1
      return false
    }

    const visits = customer.visits.sort((left, right) => left.getTime() - right.getTime())
    const lastVisit = visits.at(-1)
    const firstVisit = visits[0]
    const daysSinceLastVisit = lastVisit ? daysBetween(lastVisit, now) : null
    const daysSinceFirstVisit = firstVisit ? daysBetween(firstVisit, now) : null
    const mustExcludeFuture = ['AT_RISK', 'INACTIVE', 'ONE_TIME_VISITOR'].includes(campaign.segment) ||
      (campaign.type === 'AUTOMATED' && campaign.stopOnBooking)
    if (mustExcludeFuture && customer.hasFutureAppointment) {
      withFutureAppointment += 1
      return false
    }

    if (campaign.segment === 'ALL') return visits.length > 0
    if (campaign.segment === 'MANUAL') return true
    if (campaign.segment === 'INACTIVE' || campaign.segment === 'INACTIVE_90') {
      const requiredDays = campaign.segment === 'INACTIVE_90' ? 90 : campaign.segmentDays ?? 45
      return daysSinceLastVisit !== null && daysSinceLastVisit >= requiredDays
    }
    if (campaign.segment === 'ONE_TIME_VISITOR') {
      return visits.length === 1 && daysSinceLastVisit !== null && daysSinceLastVisit >= (campaign.segmentDays ?? 45)
    }
    if (campaign.segment === 'NEW_CUSTOMER') {
      return visits.length > 0 && daysSinceFirstVisit !== null && daysSinceFirstVisit <= (campaign.segmentDays ?? 30)
    }
    if (campaign.segment === 'AT_RISK' || campaign.segment === 'FREQUENT') {
      if (visits.length < 2 || daysSinceLastVisit === null) return false
      const gaps = visits.slice(1).map((visit, index) => daysBetween(visits[index]!, visit))
      const averageGap = Math.round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length)
      const expectedReturnDays = Math.max(14, Math.round(averageGap * 1.25))
      return campaign.segment === 'AT_RISK'
        ? daysSinceLastVisit > expectedReturnDays
        : daysSinceLastVisit <= expectedReturnDays
    }
    if (campaign.segment === 'NO_FUTURE_APPOINTMENT') return visits.length > 0 && !customer.hasFutureAppointment
    return false
  })

  return {
    total: included.length,
    included: included.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      lastVisitAt: customer.visits.at(-1)?.toISOString() ?? null
    })),
    excluded: {
      missingPhone,
      withFutureAppointment
    },
    note: 'Vista previa calculada con visitas realizadas y proximos turnos.'
  }
}

function applyCampaignEligibility(input: {
  campaign: EligibilityCampaign
  baseAudience: ReturnType<typeof buildAudiencePreview>
  preferences: MarketingPreferenceRow[]
  deliveries: CampaignDeliveryRow[]
  higherPriorityCustomerIds: Set<string>
}) {
  const now = new Date()
  const preferenceByCustomer = new Map(input.preferences.map((preference) => [preference.customerId, preference.status]))
  const deliveriesByCustomer = new Map<string, CampaignDeliveryRow[]>()
  for (const delivery of input.deliveries) {
    const rows = deliveriesByCustomer.get(delivery.customerId) ?? []
    rows.push(delivery)
    deliveriesByCustomer.set(delivery.customerId, rows)
  }

  const excluded = {
    ...input.baseAudience.excluded,
    marketingNotAuthorized: 0,
    higherPriorityCampaign: 0,
    promotionCooldown: 0,
    retryWindow: 0,
    attemptLimit: 0,
    replied: 0,
    booked: 0
  }

  const included = input.baseAudience.included.filter((customer) => {
    if (preferenceByCustomer.get(customer.id) !== 'ACTIVE') {
      excluded.marketingNotAuthorized += 1
      return false
    }
    const deliveries = deliveriesByCustomer.get(customer.id) ?? []
    const respectsCooldown = input.campaign.respectCooldown
    const cooldownDelivery = input.campaign.type === 'AUTOMATED'
      ? deliveries.find((delivery) => delivery.campaignId !== input.campaign.id)
      : deliveries[0]
    if (respectsCooldown && cooldownDelivery && daysBetween(cooldownDelivery.sentAt, now) < input.campaign.cooldownDays) {
      excluded.promotionCooldown += 1
      return false
    }
    if (input.campaign.type !== 'AUTOMATED') return true

    const lastVisitAt = customer.lastVisitAt ? new Date(customer.lastVisitAt) : null
    const sameCampaignDeliveries = deliveries.filter((delivery) => {
      if (delivery.campaignId !== input.campaign.id) return false
      return !input.campaign.restartAfterVisit || !lastVisitAt || delivery.sentAt > lastVisitAt
    })
    if (input.campaign.stopOnBooking && sameCampaignDeliveries.some((delivery) => delivery.bookedAt)) {
      excluded.booked += 1
      return false
    }
    if (input.campaign.stopOnReply && sameCampaignDeliveries.some((delivery) => delivery.respondedAt)) {
      excluded.replied += 1
      return false
    }
    if (sameCampaignDeliveries.length >= input.campaign.maxAttempts) {
      excluded.attemptLimit += 1
      return false
    }
    const lastSameCampaignDelivery = sameCampaignDeliveries[0]
    if (lastSameCampaignDelivery && daysBetween(lastSameCampaignDelivery.sentAt, now) < input.campaign.retryIntervalDays) {
      excluded.retryWindow += 1
      return false
    }
    if (input.campaign.type === 'AUTOMATED' && input.higherPriorityCustomerIds.has(customer.id)) {
      excluded.higherPriorityCampaign += 1
      return false
    }
    return true
  })

  return {
    ...input.baseAudience,
    total: included.length,
    included,
    excluded,
    note: 'Se aplicaron autorizaciones, descansos, contactos, respuestas y reservas; luego se resolvieron coincidencias por prioridad.'
  }
}

function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

function isUsableCampaignPhone(phone: string) {
  return phone.replace(/\D/g, '').length >= 8
}
