import type { FastifyInstance } from 'fastify'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { ConversationService } from '../services/conversation-service.js'
import { BusinessService } from '../services/business-service.js'
import { reopenClosedConversationOpportunity } from '../services/conversation-opportunity-service.js'
import {
  publishConversationUpdated,
  publishIncomingConversationMessage
} from '../services/crm-realtime-events.js'
import { renderLanding } from './landing-ui.js'
import type {} from '../plugins/auth-guard.js'

const conversationService = new ConversationService()
const businessService = new BusinessService()

export type DemoType = 'NAILS' | 'BARBERSHOP' | 'HAIR_SALON' | 'BEAUTY' | 'PILATES'
const SHARED_SALES_DEMO_TYPES = ['NAILS', 'HAIR_SALON', 'BARBERSHOP', 'PILATES'] as const

const DEMO_TEMPLATES: Record<DemoType, {
  label: string
  assistantName: string
  professionals: string[]
  services: Array<{ name: string; category: string; duration: number; price: number; depositMode?: 'FIXED'; depositValue?: number }>
  emojis: string[]
}> = {
  NAILS: {
    label: 'Nails',
    assistantName: 'Mia',
    professionals: ['Sofi', 'Mica'],
    services: [
      { name: 'Manicuria semipermanente', category: 'Manos', duration: 60, price: 22000 },
      { name: 'Kapping gel', category: 'Manos', duration: 90, price: 30000, depositMode: 'FIXED', depositValue: 10000 },
      { name: 'Soft gel', category: 'Extensiones', duration: 120, price: 38000, depositMode: 'FIXED', depositValue: 12000 }
    ],
    emojis: ['💅', '✨']
  },
  BARBERSHOP: {
    label: 'Barberia',
    assistantName: 'Tomi',
    professionals: ['Lucas'],
    services: [
      { name: 'Corte clasico', category: 'Cabello', duration: 45, price: 16000 },
      { name: 'Corte y barba', category: 'Combos', duration: 75, price: 25000 },
      { name: 'Perfilado de barba', category: 'Barba', duration: 30, price: 11000 }
    ],
    emojis: ['✂️', '🙌']
  },
  HAIR_SALON: {
    label: 'Peluqueria',
    assistantName: 'Cami',
    professionals: ['Tamara', 'Agus'],
    services: [
      { name: 'Corte y brushing', category: 'Cabello', duration: 60, price: 28000 },
      { name: 'Color', category: 'Coloracion', duration: 120, price: 65000, depositMode: 'FIXED', depositValue: 18000 },
      { name: 'Balayage', category: 'Coloracion', duration: 180, price: 95000, depositMode: 'FIXED', depositValue: 25000 }
    ],
    emojis: ['✨', '😊']
  },
  BEAUTY: {
    label: 'Estetica',
    assistantName: 'Lola',
    professionals: ['Juli', 'Flor'],
    services: [
      { name: 'Limpieza facial', category: 'Facial', duration: 60, price: 32000 },
      { name: 'Lifting de pestanas', category: 'Mirada', duration: 75, price: 29000, depositMode: 'FIXED', depositValue: 9000 },
      { name: 'Perfilado de cejas', category: 'Mirada', duration: 30, price: 14000 }
    ],
    emojis: ['✨', '🌸']
  },
  PILATES: {
    label: 'Pilates',
    assistantName: 'Vale',
    professionals: ['Carla', 'Meli'],
    services: [
      { name: 'Clase de Pilates Reformer', category: 'Clases', duration: 50, price: 18000 },
      { name: 'Clase individual', category: 'Personalizado', duration: 50, price: 28000 },
      { name: 'Evaluacion postural', category: 'Evaluaciones', duration: 40, price: 16000 }
    ],
    emojis: ['🧘', '✨']
  }
}

export async function demoProfileRoutes(app: FastifyInstance) {
  app.get('/admin/demo-profiles', async (request, reply) => {
    const user = request.auth?.user
    if (!user || !canUseCommercialDemos(user)) {
      return reply.status(403).send({ message: 'No tenes permiso para usar perfiles demo' })
    }
    const select = {
      id: true,
      name: true,
      customerCode: true,
      demoType: true,
      logoUrl: true,
      slug: true,
      landingTemplate: true
    } as const
    if (user.role !== 'SUPER_ADMIN') {
      const profiles = await Promise.all(SHARED_SALES_DEMO_TYPES.map((demoType) => prisma.business.findFirst({
        where: { isDemo: true, demoType },
        orderBy: { name: 'asc' },
        select
      })))
      return profiles.filter((profile) => profile !== null)
    }
    return prisma.business.findMany({
      where: {
        isDemo: true,
        OR: [
          { createdByUserId: user.id },
          { demoType: 'QA_SANDBOX' }
        ]
      },
      orderBy: { name: 'asc' },
      select
    })
  })

  app.get('/admin/demo-profiles/:id/preview', async (request, reply) => {
    const params = request.params as { id: string }
    const business = await findAccessibleDemo(request.auth?.user, params.id)
    if (!business?.slug) return reply.status(404).send({ message: 'No encontre esa demo comercial' })
    const publicBusiness = await businessService.findPublicBySlug(business.slug)
    if (!publicBusiness) return reply.status(404).send({ message: 'No encontre esa demo comercial' })
    return reply.type('text/html').send(renderLanding(publicBusiness, `/${business.slug}`, business.landingTemplate, true))
  })

  app.get('/admin/demo-profiles/:id/access', async (request, reply) => {
    const params = request.params as { id: string }
    const business = await findAccessibleDemo(request.auth?.user, params.id)
    if (!business) return reply.status(404).send({ message: 'No encontre esa demo comercial' })
    return prisma.business.findUnique({ where: { id: business.id } })
  })

  app.post('/admin/demo-profiles', async (request, reply) => {
    if (request.auth?.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede crear perfiles demo' })
    const body = request.body as { name?: string; type?: string }
    const name = body.name?.trim()
    const type = normalizeDemoType(body.type)
    if (!name || !type) return reply.status(400).send({ message: 'Completa el nombre y el tipo de demo' })

    const business = await createDemoProfileBusiness(name, type, request.auth.user.id)

    return reply.status(201).send(await prisma.business.findUnique({ where: { id: business.id } }))
  })

  app.delete('/admin/demo-profiles/:id', async (request, reply) => {
    if (request.auth?.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede eliminar perfiles demo' })
    const params = request.params as { id: string }
    const business = await prisma.business.findFirst({
      where: { id: params.id, isDemo: true, createdByUserId: request.auth.user.id },
      include: { professionals: { select: { id: true } }, conversations: { select: { id: true }, take: 1 } }
    })
    if (!business) return reply.status(404).send({ message: 'No encontre ese perfil demo' })
    if (business.conversations.length) {
      return reply.status(409).send({ message: 'Este perfil ya tiene conversaciones. Por seguridad no se puede eliminar desde esta primera version.' })
    }
    const professionalIds = business.professionals.map((professional) => professional.id)
    await prisma.$transaction(async (tx) => {
      await tx.professionalHours.deleteMany({ where: { professionalId: { in: professionalIds } } })
      await tx.professionalService.deleteMany({ where: { professionalId: { in: professionalIds } } })
      await tx.businessHours.deleteMany({ where: { businessId: business.id } })
      await tx.professional.deleteMany({ where: { businessId: business.id } })
      await tx.service.deleteMany({ where: { businessId: business.id } })
      await tx.business.delete({ where: { id: business.id } })
    })
    return { ok: true }
  })

  app.post('/admin/demo-profiles/:id/chat', async (request, reply) => {
    const user = request.auth?.user
    if (!user || !canUseCommercialDemos(user)) {
      return reply.status(403).send({ message: 'No tenes permiso para usar perfiles demo' })
    }
    const params = request.params as { id: string }
    const body = request.body as { message?: string; sessionId?: string; interactiveReplyId?: string }
    const message = body.message?.trim()
    const sessionId = cleanSessionId(body.sessionId)
    const interactiveReplyId = body.interactiveReplyId?.trim() || undefined
    if (!message || !sessionId) return reply.status(400).send({ message: 'Falta el mensaje o la sesion demo' })
    const business = await findAccessibleDemo(user, params.id)
    if (!business) return reply.status(404).send({ message: 'No encontre ese perfil demo' })
    const phone = `demo:${user.id}:${sessionId}`
    const conversation = await prisma.conversation.upsert({
      where: { businessId_phone: { businessId: business.id, phone } },
      update: {},
      create: { businessId: business.id, phone }
    })
    const inboundMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        phone,
        direction: 'INBOUND',
        body: message,
        status: 'received',
        metadata: {
          provider: 'demo_simulator',
          ...(interactiveReplyId ? { interactiveReplyId } : {})
        }
      }
    })
    publishIncomingConversationMessage({
      businessId: business.id,
      conversationId: conversation.id,
      messageId: inboundMessage.id,
      receivedAt: inboundMessage.createdAt.toISOString()
    })
    await reopenClosedConversationOpportunity(conversation.id)
    if (!business.botEnabled) return { reply: null, skipped: true, reason: 'Bot desactivado' }
    const result = await conversationService.handleMessage({
      phone,
      message,
      businessId: business.id,
      useAi: business.aiEnabled,
      ...(interactiveReplyId ? { interactiveReplyId } : {})
    })
    await prisma.message.create({ data: { conversationId: conversation.id, phone, direction: 'OUTBOUND', body: result.reply, status: 'sent', metadata: { provider: 'demo_simulator' } } })
    publishConversationUpdated({
      businessId: business.id,
      conversationId: conversation.id,
      updatedAt: new Date().toISOString()
    })
    return { ...result, conversationId: conversation.id }
  })
}

export async function createDemoProfileBusiness(name: string, type: DemoType, ownerUserId: string) {
  const template = DEMO_TEMPLATES[type]
  const business = await businessService.create(name, undefined, {
    accountAdminId: ownerUserId,
    createdByUserId: ownerUserId
  })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: business.id },
        data: { isDemo: true, demoType: type, landingEnabled: false }
      })
      await tx.businessFeatureSettings.update({
        where: { businessId: business.id },
        data: {
          bookingV2Enabled: true,
          assistantPersonality: {
            preset: type === 'BARBERSHOP' ? 'relaxed' : 'warm',
            name: template.assistantName,
            role: `recepcionista virtual de ${template.label.toLowerCase()}`,
            treatment: 'vos',
            emojiLevel: 'moderate',
            responseLength: 'short',
            preferredEmojis: template.emojis,
            customInstructions: `Representa a ${name}. Responde siempre como parte de este negocio demo.`
          } as Prisma.InputJsonValue
        }
      })
      await tx.businessHours.createMany({
        data: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: business.id, dayOfWeek, startTime: '09:00', endTime: '20:00' }))
      })
      const professionals: Array<{ id: string }> = []
      for (const professionalName of template.professionals) {
        professionals.push(await tx.professional.create({ data: { businessId: business.id, name: professionalName } }))
      }
      const services: Array<{ id: string }> = []
      for (const [sortOrder, service] of template.services.entries()) {
        services.push(await tx.service.create({
          data: {
            businessId: business.id,
            name: service.name,
            category: service.category,
            duration: service.duration,
            price: service.price,
            sortOrder,
            depositMode: service.depositMode ?? 'NONE',
            depositValue: service.depositValue ?? null
          }
        }))
      }
      await tx.professionalService.createMany({
        data: professionals.flatMap((professional) => services.map((service) => ({ professionalId: professional.id, serviceId: service.id })))
      })
      await tx.professionalHours.createMany({
        data: professionals.flatMap((professional) => [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ professionalId: professional.id, dayOfWeek, startTime: '09:00', endTime: '20:00' })))
      })
      await tx.businessPaymentSettings.upsert({
        where: { businessId: business.id },
        create: { businessId: business.id, transferEnabled: true, alias: `${slugAlias(name)}.demo`, accountHolder: name },
        update: {}
      })
    })
  } catch (error) {
    await prisma.business.delete({ where: { id: business.id } }).catch(() => null)
    throw error
  }

  return business
}

async function findAccessibleDemo(
  user: { id: string; role: string; canCreateBusinesses: boolean } | undefined,
  businessId: string
) {
  if (!user || !canUseCommercialDemos(user)) return null
  return prisma.business.findFirst({
    where: {
      id: businessId,
      isDemo: true,
      ...(user.role === 'SUPER_ADMIN'
        ? {
            OR: [
              { createdByUserId: user.id },
              { demoType: 'QA_SANDBOX' }
            ]
          }
        : { demoType: { in: [...SHARED_SALES_DEMO_TYPES] } })
    },
    select: {
      id: true,
      name: true,
      customerCode: true,
      isDemo: true,
      demoType: true,
      slug: true,
      landingTemplate: true,
      botEnabled: true,
      aiEnabled: true
    }
  })
}

function canUseCommercialDemos(
  user: { role: string; canCreateBusinesses: boolean } | undefined
) {
  return Boolean(user && (
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ACCOUNT_ADMIN' ||
    user.canCreateBusinesses
  ))
}

function normalizeDemoType(value: string | undefined): DemoType | null {
  return value && value in DEMO_TEMPLATES ? value as DemoType : null
}

function cleanSessionId(value: string | undefined) {
  const clean = value?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  return clean || null
}

function slugAlias(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'demo'
}
