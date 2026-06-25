import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '../config/prisma.js'
import { whatsappPricingRates } from '../config/whatsapp-pricing.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from '../services/business-whatsapp-settings.js'

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
const MARKETING_TEMPLATE_VARIABLES = ['nombre_cliente', 'usuario', 'fecha_ultima_visita'] as const
const REMINDER_TEMPLATE_VARIABLES = ['nombre_cliente', 'usuario', 'fecha_turno', 'hora_turno', 'servicio', 'profesional'] as const
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
  app.get('/whatsapp-pricing', async () => {
    return {
      rates: whatsappPricingRates,
      defaultCountry: 'AR',
      disclaimer: 'Costos estimados por mensaje de plantilla. El costo final depende de la tarifa vigente de Meta, pais, categoria y posibles cambios comerciales.'
    }
  })

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
        data: {
          businessId,
          internalName,
          metaName,
          category,
          language,
          body: messageBody,
          exampleJson: JSON.stringify(examples),
          ...(imageUrl !== undefined ? { imageUrl } : {})
        }
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
        data: {
          internalName,
          metaName,
          category,
          language,
          body: messageBody,
          exampleJson: JSON.stringify(examples),
          ...(imageUrl !== undefined ? { imageUrl } : {}),
          status: 'DRAFT',
          rejectionReason: null
        }
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
    const gate = await assertBusinessCanSendWhatsApp(template.businessId, 'TEMPLATE')
    if (!gate.allowed) return reply.status(409).send({ message: gate.message })
    const metaTemplate = buildMetaTemplateBody(template.body, examples)
    const result = await whatsappCloudApi.createMessageTemplate({
      businessId: template.businessId,
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
    const result = await whatsappCloudApi.findMessageTemplate({ businessId: template.businessId, id: template.metaId, name: template.metaName, languageCode: template.language })
    if (!result.found || !result.template) {
      return reply.status(result.status === 404 ? 404 : 502).send({ message: result.errorMessage || result.reason || 'No pude consultar Meta' })
    }
    const listed = await whatsappCloudApi.listMessageTemplates({ businessId: template.businessId, name: template.metaName })
    const preferred = listed.listed ? preferredMetaTemplate(listed.templates, template.language) : null
    const selectedTemplate = preferred && isApprovedMetaTemplate(preferred.status) ? preferred : result.template
    return prisma.whatsAppTemplate.update({
      where: { id: template.id },
      data: {
        metaId: selectedTemplate.id ?? template.metaId,
        metaName: selectedTemplate.name ?? template.metaName,
        category: normalizeWhatsAppTemplateCategory(selectedTemplate.category) ?? template.category,
        language: selectedTemplate.language ?? template.language,
        status: normalizeTemplateStatus(selectedTemplate.status),
        rejectionReason: normalizeTemplateRejectionReason(selectedTemplate.rejected_reason),
        lastSyncedAt: new Date()
      }
    })
  })

  app.get('/whatsapp-templates/:id/meta-diagnosis', async (request, reply) => {
    const params = request.params as { id: string }
    const template = await prisma.whatsAppTemplate.findUnique({ where: { id: params.id } })
    if (!template) return reply.status(404).send({ message: 'No encontre esa plantilla' })

    const listed = await whatsappCloudApi.listMessageTemplates({ businessId: template.businessId, name: template.metaName })
    if (!listed.listed) {
      return reply.status(listed.status === 404 ? 404 : 502).send({ message: listed.errorMessage || listed.reason || 'No pude consultar Meta' })
    }
    const recommended = preferredMetaTemplate(listed.templates, template.language)
    return {
      local: {
        id: template.id,
        internalName: template.internalName,
        metaName: template.metaName,
        metaId: template.metaId,
        language: template.language,
        category: template.category,
        status: template.status
      },
      meta: listed.templates.map((item) => ({
        id: item.id,
        name: item.name,
        language: item.language,
        category: item.category,
        status: item.status,
        rejectedReason: item.rejected_reason
      })),
      recommended: recommended ? {
        id: recommended.id,
        name: recommended.name,
        language: recommended.language,
        category: recommended.category,
        status: recommended.status,
        reason: isApprovedMetaTemplate(recommended.status) ? 'Es la version aprobada/activa que conviene usar para enviar.' : 'No encontre una version aprobada/activa; esta es la mejor coincidencia disponible.'
      } : null
    }
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
    const gate = await assertBusinessCanSendWhatsApp(template.businessId, 'TEST')
    if (!gate.allowed) return reply.status(409).send({ message: gate.message })
    const examples = parseTemplateExamples(template.exampleJson)
    const variables = extractNamedTemplateVariables(template.body)
    const missingExamples = variables.filter((variable) => !examples[variable])
    if (missingExamples.length) return reply.status(400).send({ message: 'Faltan ejemplos para: ' + missingExamples.join(', ') })
    let metaTemplate = template.metaId
      ? await whatsappCloudApi.findMessageTemplate({ businessId: template.businessId, id: template.metaId, name: template.metaName, languageCode: template.language })
      : null
    if (!metaTemplate?.found) {
      metaTemplate = await whatsappCloudApi.findMessageTemplate({ businessId: template.businessId, id: null, name: template.metaName })
    }
    const listed = await whatsappCloudApi.listMessageTemplates({ businessId: template.businessId, name: template.metaName })
    const preferred = listed.listed ? preferredMetaTemplate(listed.templates, template.language) : null
    const selectedMetaTemplate = preferred && isApprovedMetaTemplate(preferred.status) ? preferred : metaTemplate?.template
    const templateName = selectedMetaTemplate?.name || template.metaName
    const languageCode = selectedMetaTemplate?.language || template.language
    if (selectedMetaTemplate && (templateName !== template.metaName || languageCode !== template.language || selectedMetaTemplate.id !== template.metaId)) {
      await prisma.whatsAppTemplate.update({
        where: { id: template.id },
        data: {
          metaName: templateName,
          language: languageCode,
          metaId: selectedMetaTemplate.id ?? template.metaId,
          category: normalizeWhatsAppTemplateCategory(selectedMetaTemplate.category) ?? template.category,
          status: normalizeTemplateStatus(selectedMetaTemplate.status),
          lastSyncedAt: new Date()
        }
      })
    }
    const result = await whatsappCloudApi.sendTemplateMessage({
      businessId: template.businessId,
      to: phone,
      templateName,
      languageCode,
      bodyParameters: variables.map((variable) => examples[variable] ?? ''),
      headerImageDataUrl: template.imageUrl
    })
    if (!result.sent) {
      if (String(result.errorCode) === '132001') {
        return reply.status(502).send({
          message: 'Meta no encuentra esta plantilla para el numero configurado. Revisa que WHATSAPP_PHONE_NUMBER_ID pertenezca a la misma cuenta de WhatsApp que aprobo la plantilla.',
          errorCode: result.errorCode
        })
      }
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
      ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      ...(body.appointmentId !== undefined ? { appointmentId: body.appointmentId } : {})
    })
    const resolved = resolveWhatsAppTemplateVariables({
      body: template.body,
      category: template.category,
      context
    })
    if (resolved.unsupported.length) return reply.status(400).send({ message: unsupportedTemplateVariablesMessage(template.category, resolved.unsupported) })
    return resolved
  })

  app.get('/reminder-automations', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    return prisma.reminderAutomation.findMany({ where: { businessId }, orderBy: [{ sendBeforeMinutes: 'desc' }, { createdAt: 'desc' }] })
  })

  app.post('/reminder-automations', async (request, reply) => {
    const body = request.body as { businessId?: string; name?: string; channel?: string; templateId?: string | null; enabled?: boolean; sendBeforeMinutes?: number | string }
    const businessId = body.businessId?.trim()
    const normalized = await normalizeReminderAutomationInput(body, reply, businessId)
    if (!normalized) return
    return prisma.reminderAutomation.create({ data: normalized })
  })

  app.patch('/reminder-automations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.reminderAutomation.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre ese recordatorio' })
    const body = request.body as { name?: string; channel?: string; templateId?: string | null; enabled?: boolean; sendBeforeMinutes?: number | string }
    const normalized = await normalizeReminderAutomationInput({ ...current, ...body, businessId: current.businessId }, reply, current.businessId)
    if (!normalized) return
    const { businessId: _businessId, ...data } = normalized
    return prisma.reminderAutomation.update({ where: { id: current.id }, data })
  })

  app.delete('/reminder-automations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const current = await prisma.reminderAutomation.findUnique({ where: { id: params.id } })
    if (!current) return reply.status(404).send({ message: 'No encontre ese recordatorio' })
    await prisma.reminderAutomation.delete({ where: { id: current.id } })
    return { deleted: true }
  })

  async function normalizeReminderAutomationInput(
    body: { businessId?: string; name?: string; channel?: string; templateId?: string | null; enabled?: boolean; sendBeforeMinutes?: number | string },
    reply: FastifyReply,
    fallbackBusinessId?: string
  ) {
    const businessId = body.businessId?.trim() || fallbackBusinessId
    const name = body.name?.trim()
    const channel = body.channel?.trim().toUpperCase() || 'WHATSAPP'
    const templateId = body.templateId?.trim() || null
    const sendBeforeMinutes = Number(body.sendBeforeMinutes ?? 1440)
    if (!businessId) {
      reply.status(400).send({ message: 'businessId es requerido' })
      return null
    }
    if (!name) {
      reply.status(400).send({ message: 'El nombre del recordatorio es requerido' })
      return null
    }
    if (!['WHATSAPP', 'EMAIL'].includes(channel)) {
      reply.status(400).send({ message: 'Canal de recordatorio invalido' })
      return null
    }
    if (![60, 120, 1440, 2880].includes(sendBeforeMinutes)) {
      reply.status(400).send({ message: 'Elegi un tiempo de recordatorio valido' })
      return null
    }
    if (channel === 'WHATSAPP') {
      if (templateId) {
        const template = await prisma.whatsAppTemplate.findFirst({ where: { id: templateId, businessId, status: 'APPROVED' } })
        if (!template) {
          reply.status(400).send({ message: 'Selecciona una plantilla de recordatorio aprobada' })
          return null
        }
        if (normalizeWhatsAppTemplateCategory(template.category) !== 'UTILITY') {
          reply.status(400).send({ message: 'Los recordatorios solo pueden usar plantillas aprobadas de Recordatorio' })
          return null
        }
      }
      if (body.enabled && !templateId) {
        reply.status(400).send({ message: 'Selecciona una plantilla aprobada antes de activar recordatorios' })
        return null
      }
    } else if (body.enabled) {
      reply.status(400).send({ message: 'Recordatorios por email quedan preparados para mas adelante' })
      return null
    }
    return {
      businessId,
      name,
      channel,
      templateId,
      enabled: Boolean(body.enabled),
      sendBeforeMinutes
    }
  }

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
      businessId: campaign.businessId,
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

  app.post('/campaigns/:id/execute-one-time', async (request, reply) => {
    const params = request.params as { id: string }
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        whatsappTemplate: true,
        manualRecipients: {
          include: { customer: { select: { id: true, name: true, phone: true } } }
        }
      }
    })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })
    if (campaign.type !== 'ONE_TIME') return reply.status(400).send({ message: 'Solo las campanas puntuales pueden ejecutarse una sola vez' })
    if (campaign.scheduleMode === 'SCHEDULED' && campaign.scheduledAt && campaign.scheduledAt > new Date()) {
      return reply.status(409).send({ message: 'La campana todavia no alcanzo su fecha programada' })
    }
    if (!campaign.whatsappTemplateId || !campaign.whatsappTemplate) return reply.status(400).send({ message: 'Selecciona una plantilla aprobada antes de enviar' })
    if (campaign.whatsappTemplate.status !== 'APPROVED') return reply.status(400).send({ message: 'La plantilla debe estar aprobada por Meta' })
    const gate = await assertBusinessCanSendWhatsApp(campaign.businessId, 'CAMPAIGN')
    if (!gate.allowed) return reply.status(409).send({ message: gate.message })

    const previousRealDeliveries = await prisma.campaignDelivery.count({
      where: { campaignId: campaign.id, status: { notIn: ['FAILED', 'CANCELLED'] } }
    })
    if (previousRealDeliveries > 0 || campaign.status === 'FINISHED') {
      return reply.status(409).send({ message: 'Esta campana puntual ya fue ejecutada' })
    }

    const audience = await calculateCampaignAudience(campaign)
    if (!audience.included.length) return reply.status(400).send({ message: 'No hay destinatarios habilitados para enviar' })
    const budgetLimit = budgetLimitedQuantity(campaign.budgetLimit, campaign.whatsappTemplate.category, audience.included.length)
    if (budgetLimit === 0) return reply.status(400).send({ message: 'El presupuesto no alcanza para enviar ni un mensaje' })
    const recipients = audience.included.slice(0, budgetLimit ?? audience.included.length)
    if (audience.included.length > recipients.length) {
      return reply.status(400).send({ message: 'El presupuesto solo alcanza para ' + recipients.length + ' de ' + audience.included.length + ' destinatarios. Ajusta el presupuesto antes de enviar.' })
    }

    const now = new Date()
    let sent = 0
    let failed = 0
    const results: Array<{ customerId: string; name: string; phone: string; status: 'SENT' | 'FAILED'; message?: string }> = []

    for (const customer of recipients) {
      const context = await buildTemplateVariableContext({ businessId: campaign.businessId, customerId: customer.id })
      const resolved = resolveWhatsAppTemplateVariables({
        body: campaign.whatsappTemplate.body,
        category: campaign.whatsappTemplate.category,
        context
      })
      if (resolved.unsupported.length || resolved.missing.length) {
        failed += 1
        await prisma.campaignDelivery.create({
          data: {
            businessId: campaign.businessId,
            campaignId: campaign.id,
            customerId: customer.id,
            status: 'FAILED',
            attemptNumber: 1,
            sentAt: now
          }
        })
        results.push({ customerId: customer.id, name: customer.name, phone: customer.phone, status: 'FAILED', message: 'Faltan variables: ' + [...resolved.unsupported, ...resolved.missing].join(', ') })
        continue
      }

      const result = await whatsappCloudApi.sendTemplateMessage({
        businessId: campaign.businessId,
        to: customer.phone,
        templateName: campaign.whatsappTemplate.metaName,
        languageCode: campaign.whatsappTemplate.language,
        bodyParameters: resolved.bodyParameters,
        headerImageDataUrl: campaign.whatsappTemplate.imageUrl
      })
      const providerMessageId = result.sent ? extractProviderMessageId(result.response) : null
      await prisma.campaignDelivery.create({
        data: {
          businessId: campaign.businessId,
          campaignId: campaign.id,
          customerId: customer.id,
          status: result.sent ? 'SENT' : 'FAILED',
          attemptNumber: 1,
          providerMessageId,
          sentAt: now
        }
      })
      if (result.sent) sent += 1
      else failed += 1
      const failureMessage = !result.sent
        ? ('errorMessage' in result ? result.errorMessage : undefined) || ('reason' in result ? result.reason : undefined) || 'No se pudo enviar'
        : undefined
      results.push({
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        status: result.sent ? 'SENT' : 'FAILED',
        ...(failureMessage !== undefined ? { message: failureMessage } : {})
      })
    }

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'FINISHED' }
    })

    return { status: 'FINISHED', sent, failed, total: recipients.length, results }
  })

  app.post('/campaigns/:id/process-automated', async (request, reply) => {
    const params = request.params as { id: string }
    const body = (request.body ?? {}) as { limit?: number | string }
    const requestedLimit = Math.max(1, Math.min(100, Number(body.limit ?? 25) || 25))
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        whatsappTemplate: true,
        manualRecipients: {
          include: { customer: { select: { id: true, name: true, phone: true } } }
        }
      }
    })
    if (!campaign) return reply.status(404).send({ message: 'No encontre esa campana' })
    if (campaign.type !== 'AUTOMATED') return reply.status(400).send({ message: 'Solo las campanas automaticas usan este procesador' })
    if (campaign.status !== 'ACTIVE') return reply.status(400).send({ message: 'La campana automatica debe estar activa' })
    if (campaign.scheduleMode === 'SCHEDULED' && campaign.scheduledAt && campaign.scheduledAt > new Date()) {
      return reply.status(409).send({ message: 'La campana todavia no alcanzo su fecha programada' })
    }
    if (!campaign.whatsappTemplateId || !campaign.whatsappTemplate) return reply.status(400).send({ message: 'Selecciona una plantilla aprobada antes de enviar' })
    if (campaign.whatsappTemplate.status !== 'APPROVED') return reply.status(400).send({ message: 'La plantilla debe estar aprobada por Meta' })
    const gate = await assertBusinessCanSendWhatsApp(campaign.businessId, 'CAMPAIGN')
    if (!gate.allowed) return reply.status(409).send({ message: gate.message })

    const audience = await calculateCampaignAudience(campaign)
    if (!audience.included.length) return { status: 'COMPLETED', sent: 0, failed: 0, total: 0, message: 'No hay destinatarios listos' }
    const budgetLimit = budgetLimitedQuantity(campaign.budgetLimit, campaign.whatsappTemplate.category, audience.included.length)
    if (budgetLimit === 0) return reply.status(400).send({ message: 'El presupuesto no alcanza para enviar ni un mensaje' })
    const recipients = audience.included.slice(0, Math.min(requestedLimit, budgetLimit ?? audience.included.length))
    const excludedCount = Object.values(audience.excluded).reduce((total, count) => total + Number(count || 0), 0)
    const now = new Date()

    const run = await prisma.campaignRun.create({
      data: {
        businessId: campaign.businessId,
        campaignId: campaign.id,
        mode: 'REAL',
        status: 'RUNNING',
        candidateCount: audience.total + excludedCount,
        eligibleCount: recipients.length,
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
          templateName: campaign.whatsappTemplate.metaName,
          templateLanguage: campaign.whatsappTemplate.language,
          templateId: campaign.whatsappTemplate.metaId
        }
      }
    })

    const summary = await sendCampaignRecipients({ campaign, template: campaign.whatsappTemplate, recipients, runId: run.id, now })
    await prisma.campaignRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
    return { status: 'COMPLETED', runId: run.id, ...summary }
  })

  app.post('/campaign-jobs/process-retries', async (request) => {
    const body = (request.body ?? {}) as { limit?: number | string }
    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 100) || 100))
    const now = new Date()
    const jobs = await prisma.campaignJob.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: 3 },
        nextAttemptAt: { lte: now },
        campaign: { type: 'AUTOMATED', status: 'ACTIVE', whatsappTemplate: { status: 'APPROVED' } }
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        campaign: { include: { whatsappTemplate: true } }
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit
    })
    let sent = 0
    let failed = 0
    for (const job of jobs) {
      if (job.retryCount >= job.maxRetries || !job.campaign.whatsappTemplate) continue
      const gate = await assertBusinessCanSendWhatsApp(job.businessId, 'CAMPAIGN')
      if (!gate.allowed) {
        failed += 1
        continue
      }
      const template = job.campaign.whatsappTemplate
      const context = await buildTemplateVariableContext({ businessId: job.businessId, customerId: job.customerId })
      const resolved = resolveWhatsAppTemplateVariables({ body: template.body, category: template.category, context })
      const invalid = [...resolved.unsupported, ...resolved.missing]
      const result = invalid.length
        ? { sent: false as const, reason: 'Faltan variables: ' + invalid.join(', '), to: job.customer.phone }
        : await whatsappCloudApi.sendTemplateMessage({
            businessId: job.businessId,
            to: job.customer.phone,
            templateName: template.metaName,
            languageCode: template.language,
            bodyParameters: resolved.bodyParameters,
            headerImageDataUrl: template.imageUrl
          })
      const nextRetryCount = job.retryCount + 1
      const status = result.sent ? 'SENT' : 'FAILED'
      await prisma.$transaction([
        prisma.campaignJob.update({
          where: { id: job.id },
          data: {
            status,
            retryCount: nextRetryCount,
            nextAttemptAt: result.sent ? now : new Date(now.getTime() + retryDelayMinutes(nextRetryCount) * 60_000)
          }
        }),
        prisma.campaignDelivery.create({
          data: {
            businessId: job.businessId,
            campaignId: job.campaignId,
            customerId: job.customerId,
            status,
            attemptNumber: job.attemptNumber,
            providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
            sentAt: now
          }
        })
      ])
      if (result.sent) sent += 1
      else failed += 1
    }
    return { sent, failed, total: sent + failed }
  })

  app.post('/reminder-automations/process-due', async (request, reply) => {
    const body = request.body as { businessId?: string; limit?: number | string }
    const businessId = body.businessId?.trim()
    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 25) || 25))
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const gate = await assertBusinessCanSendWhatsApp(businessId, 'REMINDER')
    if (!gate.allowed) return reply.status(409).send({ message: gate.message })

    const automations = await prisma.reminderAutomation.findMany({ where: { businessId, enabled: true, channel: 'WHATSAPP' } })
    const now = new Date()
    let sent = 0
    let failed = 0
    const results: Array<{ reminderId: string; appointmentId: string; customerId: string; status: 'SENT' | 'FAILED'; message?: string }> = []

    for (const automation of automations) {
      if (sent + failed >= limit) break
      if (!automation.templateId) continue
      const template = await prisma.whatsAppTemplate.findFirst({ where: { id: automation.templateId, businessId, status: 'APPROVED' } })
      if (!template || normalizeWhatsAppTemplateCategory(template.category) !== 'UTILITY') continue
      const maxStartAt = new Date(now.getTime() + automation.sendBeforeMinutes * 60_000)
      const appointments = await prisma.appointment.findMany({
        where: {
          startAt: { gt: now, lte: maxStartAt },
          status: { in: ['CONFIRMED'] },
          professional: { businessId },
          reminderDeliveries: {
            none: {
              reminderAutomationId: automation.id,
              OR: [
                { status: { in: ['SENT', 'DELIVERED', 'READ'] } },
                { attemptNumber: { gte: 3 } }
              ]
            }
          }
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          service: { select: { name: true } },
          professional: { select: { name: true } }
        },
        orderBy: { startAt: 'asc' },
        take: Math.max(0, limit - sent - failed)
      })
      for (const appointment of appointments) {
        const scheduledFor = new Date(appointment.startAt.getTime() - automation.sendBeforeMinutes * 60_000)
        if (scheduledFor > now) continue
        const resolved = resolveWhatsAppTemplateVariables({
          body: template.body,
          category: template.category,
          context: {
            customer: appointment.customer,
            appointment: {
              id: appointment.id,
              startAt: appointment.startAt,
              customer: appointment.customer,
              service: appointment.service,
              professional: appointment.professional
            }
          }
        })
        const invalid = [...resolved.unsupported, ...resolved.missing]
        const result = invalid.length
          ? { sent: false as const, reason: 'Faltan variables: ' + invalid.join(', '), to: appointment.customer.phone }
          : await whatsappCloudApi.sendTemplateMessage({
              businessId,
              to: appointment.customer.phone,
              templateName: template.metaName,
              languageCode: template.language,
              bodyParameters: resolved.bodyParameters,
              headerImageDataUrl: template.imageUrl
            })
        const failureMessage = !result.sent
          ? ('errorMessage' in result ? result.errorMessage : undefined) || ('reason' in result ? result.reason : undefined) || 'No se pudo enviar'
          : null
        await prisma.reminderDelivery.upsert({
          where: {
            reminderAutomationId_appointmentId: {
              reminderAutomationId: automation.id,
              appointmentId: appointment.id
            }
          },
          create: {
            businessId,
            reminderAutomationId: automation.id,
            appointmentId: appointment.id,
            customerId: appointment.customer.id,
            status: result.sent ? 'SENT' : 'FAILED',
            providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
            attemptNumber: 1,
            lastError: failureMessage,
            scheduledFor,
            sentAt: now
          },
          update: {
            status: result.sent ? 'SENT' : 'FAILED',
            providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
            attemptNumber: { increment: 1 },
            lastError: failureMessage,
            sentAt: now
          }
        })
        if (result.sent) sent += 1
        else failed += 1
        const message = failureMessage || undefined
        results.push({
          reminderId: automation.id,
          appointmentId: appointment.id,
          customerId: appointment.customer.id,
          status: result.sent ? 'SENT' : 'FAILED',
          ...(message !== undefined ? { message } : {})
        })
      }
    }

    return { sent, failed, total: sent + failed, results }
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
    ...(imageUrl !== undefined ? { imageUrl } : {}),
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

function extractProviderMessageId(response: unknown) {
  if (!response || typeof response !== 'object') return null
  const messages = (response as { messages?: Array<{ id?: unknown }> }).messages
  const id = Array.isArray(messages) ? messages[0]?.id : null
  return typeof id === 'string' ? id : null
}

function retryDelayMinutes(retryNumber: number) {
  return [15, 30, 60][Math.max(0, Math.min(2, retryNumber - 1))] ?? 60
}

function budgetLimitedQuantity(budgetLimit: number | null | undefined, category: string | null | undefined, requestedQuantity: number) {
  if (budgetLimit === null || budgetLimit === undefined || budgetLimit <= 0) return null
  const normalizedCategory = normalizeWhatsAppTemplateCategory(category) === 'UTILITY' ? 'UTILITY' : 'MARKETING'
  const rate = whatsappPricingRates.find((item) => item.country === 'AR' && item.category === normalizedCategory)
  const unitPrice = Number(rate?.estimatedUnitPrice || 0)
  if (unitPrice <= 0) return requestedQuantity
  return Math.min(requestedQuantity, Math.floor(budgetLimit / unitPrice))
}

async function sendCampaignRecipients(input: {
  campaign: {
    id: string
    businessId: string
    whatsappTemplateId: string | null
    restartAfterVisit: boolean
  }
  template: {
    id: string
    metaName: string
    language: string
    body: string
    category: string
    imageUrl: string | null
  }
  recipients: Array<{ id: string; name: string; phone: string }>
  runId?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  let sent = 0
  let failed = 0
  const results: Array<{ customerId: string; name: string; phone: string; status: 'SENT' | 'FAILED'; message?: string }> = []
  const previousDeliveries = input.recipients.length
    ? await prisma.campaignDelivery.findMany({
        where: { campaignId: input.campaign.id, customerId: { in: input.recipients.map((customer) => customer.id) } },
        orderBy: { sentAt: 'desc' }
      })
    : []
  const attemptsByCustomer = new Map<string, number>()
  for (const delivery of previousDeliveries) {
    if (!attemptsByCustomer.has(delivery.customerId)) attemptsByCustomer.set(delivery.customerId, delivery.attemptNumber)
  }

  for (const customer of input.recipients) {
    const context = await buildTemplateVariableContext({ businessId: input.campaign.businessId, customerId: customer.id })
    const resolved = resolveWhatsAppTemplateVariables({
      body: input.template.body,
      category: input.template.category,
      context
    })
    const invalid = [...resolved.unsupported, ...resolved.missing]
    const result = invalid.length
      ? { sent: false as const, to: customer.phone, reason: 'Faltan variables: ' + invalid.join(', ') }
      : await whatsappCloudApi.sendTemplateMessage({
          businessId: input.campaign.businessId,
          to: customer.phone,
          templateName: input.template.metaName,
          languageCode: input.template.language,
          bodyParameters: resolved.bodyParameters,
          headerImageDataUrl: input.template.imageUrl
        })
    const status = result.sent ? 'SENT' : 'FAILED'
    const providerMessageId = result.sent ? extractProviderMessageId(result.response) : null
    const attemptNumber = (attemptsByCustomer.get(customer.id) ?? 0) + 1
    await prisma.campaignDelivery.create({
      data: {
        businessId: input.campaign.businessId,
        campaignId: input.campaign.id,
        customerId: customer.id,
        status,
        attemptNumber,
        providerMessageId,
        sentAt: now
      }
    })
    if (input.runId) {
      await prisma.campaignJob.create({
        data: {
          businessId: input.campaign.businessId,
          campaignId: input.campaign.id,
          runId: input.runId,
          customerId: customer.id,
          status,
          attemptNumber,
          retryCount: 0,
          maxRetries: 3,
          nextAttemptAt: status === 'FAILED' ? new Date(now.getTime() + retryDelayMinutes(1) * 60_000) : now,
          idempotencyKey: 'real:' + input.runId + ':' + customer.id
        }
      })
    }
    if (result.sent) sent += 1
    else failed += 1
    const message = !result.sent
      ? ('errorMessage' in result ? result.errorMessage : undefined) || ('reason' in result ? result.reason : undefined) || 'No se pudo enviar'
      : undefined
    results.push({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      status,
      ...(message !== undefined ? { message } : {})
    })
  }

  return { sent, failed, total: input.recipients.length, results }
}

function isApprovedMetaTemplate(status?: string | null) {
  const normalized = normalizeTemplateStatus(status)
  return normalized === 'APPROVED' || normalized === 'ACTIVE'
}

function preferredMetaTemplate<T extends { status?: string | null; language?: string | null }>(templates: T[], preferredLanguage?: string | null) {
  return [...templates].sort((a, b) => {
    const statusDiff = metaTemplateStatusRank(a.status) - metaTemplateStatusRank(b.status)
    if (statusDiff !== 0) return statusDiff
    const aLanguageMatch = preferredLanguage && a.language === preferredLanguage ? 0 : 1
    const bLanguageMatch = preferredLanguage && b.language === preferredLanguage ? 0 : 1
    return aLanguageMatch - bLanguageMatch
  })[0]
}

function metaTemplateStatusRank(status?: string | null) {
  const normalized = normalizeTemplateStatus(status)
  if (normalized === 'APPROVED' || normalized === 'ACTIVE') return 0
  if (normalized === 'PAUSED') return 1
  if (normalized === 'PENDING' || normalized === 'IN_APPEAL') return 2
  if (normalized === 'REJECTED' || normalized === 'DISABLED') return 3
  return 4
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
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
    const variable = match[1]
    if (variable) variables.add(variable)
  }
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
    bodyExamples: variables
      .map((variable) => examples[variable])
      .filter((example): example is string => Boolean(example))
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
  if (variable === 'nombre_cliente' || variable === 'usuario') return context.customer?.name?.trim() || null
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
