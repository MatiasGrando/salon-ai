import { prisma } from '../config/prisma.js'
import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { assertBusinessCanSendWhatsApp } from './business-whatsapp-settings.js'
import { RecordCommunicationAttempt } from '../application/communications/record-communication-attempt.js'
import { PrismaCommunicationAttemptRepository } from '../infrastructure/communications/prisma-communication-attempt-repository.js'
import { assertReminderManualTransition, canAutomaticReminderSend, type ReminderManualStatus } from '../domain/communications/reminder.js'

const whatsappCloudApi = new WhatsAppCloudApi()
const recordCommunicationAttempt = new RecordCommunicationAttempt(new PrismaCommunicationAttemptRepository())

export async function prepareDueReminders(input: { businessId?: string; automationId?: string; limit?: number } = {}) {
  const now = new Date()
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  await prisma.reminderDelivery.updateMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.automationId ? { reminderAutomationId: input.automationId } : {}),
      status: { in: ['PENDING', 'FAILED'] },
      appointment: { OR: [{ status: { not: 'CONFIRMED' } }, { startAt: { lte: now } }] }
    },
    data: { status: 'CANCELLED', manualNote: 'El turno ya no est\u00e1 confirmado o su horario pas\u00f3' }
  })
  const automations = await prisma.reminderAutomation.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.automationId ? { id: input.automationId } : {}),
      channel: 'WHATSAPP',
      mode: { in: ['MANUAL_ASSISTED', 'AUTOMATIC_API'] }
    }
  })
  let prepared = 0
  let failed = 0
  let skipped = 0

  for (const automation of automations) {
    if (prepared + failed >= limit) break
    if (!automation.templateId) {
      skipped += 1
      continue
    }
    const template = await prisma.whatsAppTemplate.findFirst({
      where: { id: automation.templateId, businessId: automation.businessId }
    })
    if (!template) {
      skipped += 1
      continue
    }
    const maxStartAt = new Date(now.getTime() + automation.sendBeforeMinutes * 60_000)
    const appointments = await prisma.appointment.findMany({
      where: {
        startAt: { gt: now, lte: maxStartAt },
        status: 'CONFIRMED',
        professional: { businessId: automation.businessId }
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        service: { select: { name: true } },
        professional: { select: { name: true } }
      },
      orderBy: { startAt: 'asc' },
      take: Math.max(100, limit * 5)
    })

    for (const appointment of appointments) {
      if (prepared + failed >= limit) break
      const scheduledFor = new Date(appointment.startAt.getTime() - automation.sendBeforeMinutes * 60_000)
      if (scheduledFor > now) continue
      const existing = await prisma.reminderDelivery.findUnique({
        where: { reminderAutomationId_appointmentId: { reminderAutomationId: automation.id, appointmentId: appointment.id } }
      })
      if (existing && !['PENDING', 'FAILED', 'CANCELLED'].includes(existing.status)) continue
      if (existing && automation.mode === 'AUTOMATIC_API' && existing.attemptNumber >= 3) continue
      const resolved = resolveReminderTemplate(template.body, appointment)
      if (resolved.missing.length) {
        await saveFailedReminder({
          businessId: automation.businessId,
          reminderAutomationId: automation.id,
          appointmentId: appointment.id,
          customerId: appointment.customer.id,
          scheduledFor,
          mode: automation.mode === 'MANUAL_ASSISTED' ? 'WHATSAPP_MANUAL' : 'WHATSAPP_API',
          error: 'Faltan variables: ' + resolved.missing.join(', ')
        })
        failed += 1
        continue
      }
      const data = {
        mode: automation.mode === 'MANUAL_ASSISTED' ? 'WHATSAPP_MANUAL' : 'WHATSAPP_API',
        status: 'PENDING',
        messageSnapshot: resolved.previewText,
        scheduledFor,
        lastError: null,
        sentAt: null,
        ...(existing ? {} : { attemptNumber: 0 })
      }
      if (existing) {
        const refreshed = await prisma.reminderDelivery.updateMany({ where: { id: existing.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } }, data })
        prepared += refreshed.count
      } else {
        const created = await prisma.reminderDelivery.createMany({
          data: [{
            businessId: automation.businessId,
            reminderAutomationId: automation.id,
            appointmentId: appointment.id,
            customerId: appointment.customer.id,
            ...data
          }],
          skipDuplicates: true
        })
        prepared += created.count
      }
    }
  }
  return { prepared, failed, skipped, total: prepared + failed }
}

export async function processDueReminders(input: { businessId: string; limit?: number }) {
  const now = new Date()
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  await prisma.reminderDelivery.updateMany({
    where: {
      businessId: input.businessId,
      status: 'PROCESSING',
      updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) }
    },
    data: { status: 'FAILED', lastError: 'El procesamiento anterior se interrumpi\u00f3. Se reintentar\u00e1.' }
  })
  await prisma.reminderDelivery.updateMany({
    where: {
      businessId: input.businessId,
      status: { in: ['PENDING', 'FAILED'] },
      appointment: { OR: [{ status: { not: 'CONFIRMED' } }, { startAt: { lte: now } }] }
    },
    data: { status: 'CANCELLED', manualNote: 'El turno ya no est\u00e1 confirmado o su horario pas\u00f3' }
  })
  const preparation = await prepareDueReminders({ businessId: input.businessId, limit })
  const automations = await prisma.reminderAutomation.findMany({
    where: { businessId: input.businessId, channel: 'WHATSAPP', mode: 'AUTOMATIC_API' }
  })
  let sent = 0
  let failed = 0
  let skipped = preparation.skipped

  if (automations.length) {
    const gate = await assertBusinessCanSendWhatsApp(input.businessId, 'REMINDER')
    if (!gate.allowed) return { ...preparation, sent, failed, skipped: skipped + 1, blocked: true, message: gate.message }
  }

  for (const automation of automations) {
    if (sent + failed >= limit || !automation.templateId) break
    const template = await prisma.whatsAppTemplate.findFirst({
      where: { id: automation.templateId, businessId: input.businessId, status: 'APPROVED', category: 'UTILITY' }
    })
    if (!template) {
      skipped += 1
      continue
    }
    const deliveries = await prisma.reminderDelivery.findMany({
      where: {
        reminderAutomationId: automation.id,
        status: { in: ['PENDING', 'FAILED'] },
        attemptNumber: { lt: 3 },
        scheduledFor: { lte: now },
        appointment: {
          status: 'CONFIRMED',
          startAt: {
            gt: now,
            lte: new Date(now.getTime() + automation.sendBeforeMinutes * 60_000)
          }
        }
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        appointment: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            service: { select: { name: true } },
            professional: { select: { name: true } }
          }
        }
      },
      orderBy: { scheduledFor: 'asc' },
      take: limit - sent - failed
    })
    for (const delivery of deliveries) {
      if (!canAutomaticReminderSend(delivery.status)) continue
      const claim = await prisma.reminderDelivery.updateMany({
        where: { id: delivery.id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING', mode: 'WHATSAPP_API', lastError: null }
      })
      if (!claim.count) continue
      const resolved = resolveReminderTemplate(template.body, delivery.appointment)
      if (resolved.missing.length) {
        await prisma.reminderDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', lastError: 'Faltan variables: ' + resolved.missing.join(', ') }
        })
        failed += 1
        continue
      }
      const result = await whatsappCloudApi.sendTemplateMessage({
        businessId: input.businessId,
        to: delivery.customer.phone,
        templateName: template.metaName,
        languageCode: template.language,
        bodyParameters: resolved.bodyParameters,
        headerImageDataUrl: template.imageUrl
      })
      const occurredAt = new Date()
      const status = result.sent ? 'SENT' : 'FAILED'
      const lastError = result.sent
        ? null
        : ('errorMessage' in result ? result.errorMessage : undefined) ||
          ('reason' in result ? result.reason : undefined) ||
          'No se pudo enviar el recordatorio'
      const updated = await prisma.reminderDelivery.update({
        where: { id: delivery.id },
        data: {
          mode: 'WHATSAPP_API',
          status,
          messageSnapshot: resolved.previewText,
          providerMessageId: result.sent ? extractProviderMessageId(result.response) : null,
          attemptNumber: { increment: 1 },
          lastError,
          sentAt: result.sent ? occurredAt : null
        }
      })
      await recordCommunicationAttempt.execute({
        businessId: input.businessId,
        customerId: delivery.customer.id,
        customerName: delivery.customer.name,
        phone: delivery.customer.phone,
        message: resolved.previewText,
        sourceType: 'REMINDER',
        sourceId: automation.id,
        sourceDeliveryId: delivery.id,
        purpose: 'OPERATIONAL',
        mode: 'WHATSAPP_API',
        status,
        providerMessageId: updated.providerMessageId,
        failureReason: lastError,
        occurredAt,
        metadata: { appointmentId: delivery.appointmentId, scheduledFor: delivery.scheduledFor.toISOString() }
      })
      if (result.sent) sent += 1
      else failed += 1
    }
  }
  return { ...preparation, sent, failed, skipped, total: preparation.prepared + preparation.failed + sent + failed }
}

export async function transitionManualReminder(input: {
  businessId: string
  deliveryId: string
  status: ReminderManualStatus
  note?: string | null
}) {
  const delivery = await prisma.reminderDelivery.findFirst({
    where: { id: input.deliveryId, businessId: input.businessId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      reminderAutomation: { select: { mode: true, sendBeforeMinutes: true } },
      appointment: { select: { status: true, startAt: true } }
    }
  })
  if (!delivery) throw new Error('No encontr\u00e9 ese recordatorio')
  if (delivery.mode !== 'WHATSAPP_MANUAL' && delivery.reminderAutomation.mode !== 'MANUAL_ASSISTED') {
    throw new Error('Este recordatorio est\u00e1 configurado para env\u00edo autom\u00e1tico')
  }
  if (['OPENED', 'SENT'].includes(input.status) && (delivery.appointment.status !== 'CONFIRMED' || delivery.appointment.startAt <= new Date())) {
    throw new Error('El turno ya no est\u00e1 confirmado o su horario pas\u00f3')
  }
  if (['OPENED', 'SENT'].includes(input.status) && delivery.appointment.startAt.getTime() - delivery.reminderAutomation.sendBeforeMinutes * 60_000 > Date.now()) {
    throw new Error('Todav\u00eda no se cumpli\u00f3 la anticipaci\u00f3n configurada')
  }
  assertReminderManualTransition(delivery.status, input.status)
  const now = new Date()
  const transition = await prisma.reminderDelivery.updateMany({
    where: { id: delivery.id, status: delivery.status },
    data: {
      status: input.status,
      mode: input.status === 'PENDING' ? delivery.mode : 'WHATSAPP_MANUAL',
      manualNote: input.note?.trim().slice(0, 500) || null,
      ...(input.status === 'OPENED' ? { openedAt: now } : {}),
      ...(input.status === 'SENT' ? { sentAt: now } : {}),
      ...(input.status === 'SENT' && delivery.attemptNumber < 1 ? { attemptNumber: 1 } : {}),
      ...(input.status === 'SKIPPED' ? { skippedAt: now } : {}),
      ...(input.status === 'PENDING' ? { lastError: null } : {})
    }
  })
  if (!transition.count) throw new Error('El recordatorio cambi\u00f3 mientras lo estabas gestionando. Actualiz\u00e1 la lista.')
  if (input.status === 'SENT') {
    await recordCommunicationAttempt.execute({
      businessId: delivery.businessId,
      customerId: delivery.customer.id,
      customerName: delivery.customer.name,
      phone: delivery.customer.phone,
      message: delivery.messageSnapshot || 'Recordatorio de turno',
      sourceType: 'REMINDER',
      sourceId: delivery.reminderAutomationId,
      sourceDeliveryId: delivery.id,
      purpose: 'OPERATIONAL',
      mode: 'WHATSAPP_MANUAL',
      status: 'SENT',
      occurredAt: now,
      metadata: { appointmentId: delivery.appointmentId, scheduledFor: delivery.scheduledFor.toISOString() }
    })
  }
  return prisma.reminderDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
}

function resolveReminderTemplate(
  body: string,
  appointment: {
    startAt: Date
    customer: { name: string }
    service: { name: string }
    professional: { name: string }
  }
) {
  const variables = Array.from(body.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
  const values: Record<string, string> = {
    nombre_cliente: appointment.customer.name,
    usuario: appointment.customer.name,
    fecha_turno: formatDate(appointment.startAt),
    hora_turno: formatTime(appointment.startAt),
    servicio: appointment.service.name,
    profesional: appointment.professional.name
  }
  const missing = variables.filter((variable) => !values[variable])
  return {
    missing,
    bodyParameters: variables.map((variable) => values[variable] || ''),
    previewText: body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable: string) => values[variable] || '{{' + variable + '}}')
  }
}

async function saveFailedReminder(input: {
  businessId: string
  reminderAutomationId: string
  appointmentId: string
  customerId: string
  scheduledFor: Date
  mode: string
  error: string
}) {
  const { error, ...delivery } = input
  await prisma.reminderDelivery.upsert({
    where: {
      reminderAutomationId_appointmentId: {
        reminderAutomationId: input.reminderAutomationId,
        appointmentId: input.appointmentId
      }
    },
    create: { ...delivery, status: 'FAILED', attemptNumber: 0, lastError: error, sentAt: null },
    update: { mode: input.mode, status: 'FAILED', lastError: error, scheduledFor: input.scheduledFor, sentAt: null }
  })
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires'
  }).format(date)
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires'
  }).format(date)
}

function extractProviderMessageId(response: unknown) {
  if (!response || typeof response !== 'object') return null
  const messages = (response as { messages?: Array<{ id?: unknown }> }).messages
  const id = Array.isArray(messages) ? messages[0]?.id : null
  return typeof id === 'string' ? id : null
}
