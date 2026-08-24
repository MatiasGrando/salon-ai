import { prisma } from '../config/prisma.js'
import { WEEX_SUPPORT_BOT_V1_DEFINITION } from './weex-support-bot-v1.js'
import { Prisma } from '../generated/prisma/client.js'
import { TAMARA_OPTIONS_BOT_DEFINITION, TAMARA_OPTIONS_BOT_KEY } from './tamara-options-bot.js'

export async function assignWeexSupportBotV1ToBusiness(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true }
  })

  if (!business) throw new Error('El negocio indicado no existe')

  return prisma.businessBotConfiguration.upsert({
    where: {
      businessId_botKey: {
        businessId,
        botKey: WEEX_SUPPORT_BOT_V1_DEFINITION.botKey
      }
    },
    create: {
      businessId,
      botKey: WEEX_SUPPORT_BOT_V1_DEFINITION.botKey,
      name: WEEX_SUPPORT_BOT_V1_DEFINITION.name,
      version: WEEX_SUPPORT_BOT_V1_DEFINITION.version,
      mode: WEEX_SUPPORT_BOT_V1_DEFINITION.mode,
      status: 'DRAFT',
      channel: 'UNASSIGNED',
      definition: WEEX_SUPPORT_BOT_V1_DEFINITION
    },
    update: {
      name: WEEX_SUPPORT_BOT_V1_DEFINITION.name,
      version: WEEX_SUPPORT_BOT_V1_DEFINITION.version,
      mode: WEEX_SUPPORT_BOT_V1_DEFINITION.mode,
      status: 'DRAFT',
      channel: 'UNASSIGNED',
      definition: WEEX_SUPPORT_BOT_V1_DEFINITION
    }
  })
}

export async function assignTamaraOptionsBotToBusiness(businessId: string, professionalId?: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } })
  if (!business) throw new Error('El negocio indicado no existe')

  const professional = professionalId
    ? await prisma.professional.findFirst({
        where: { id: professionalId, businessId, isActive: true },
        select: { id: true, name: true }
      })
    : await prisma.professional.findFirst({
        where: { businessId, isActive: true, name: { equals: 'Tamara Grando', mode: 'insensitive' } },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' }
      })
  if (!professional) throw new Error('No encontré el perfil profesional activo de Tamara en este negocio')

  const definition = {
    ...TAMARA_OPTIONS_BOT_DEFINITION,
    professionalId: professional.id,
    professionalName: professional.name
  } as unknown as Prisma.InputJsonValue

  return prisma.businessBotConfiguration.upsert({
    where: { businessId_botKey: { businessId, botKey: TAMARA_OPTIONS_BOT_KEY } },
    create: {
      businessId,
      botKey: TAMARA_OPTIONS_BOT_KEY,
      name: TAMARA_OPTIONS_BOT_DEFINITION.name,
      version: TAMARA_OPTIONS_BOT_DEFINITION.version,
      mode: TAMARA_OPTIONS_BOT_DEFINITION.mode,
      status: 'DRAFT',
      channel: 'UNASSIGNED',
      routingMode: 'EXCLUSIVE',
      definition
    },
    update: {
      name: TAMARA_OPTIONS_BOT_DEFINITION.name,
      version: TAMARA_OPTIONS_BOT_DEFINITION.version,
      mode: TAMARA_OPTIONS_BOT_DEFINITION.mode,
      definition
    }
  })
}

export async function getTamaraOptionsBotProfile(businessId: string) {
  const [professional, configuration] = await Promise.all([
    prisma.professional.findFirst({
      where: { businessId, isActive: true, name: { equals: 'Tamara Grando', mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.businessBotConfiguration.findUnique({
      where: { businessId_botKey: { businessId, botKey: TAMARA_OPTIONS_BOT_KEY } },
      select: { id: true, status: true, channel: true }
    })
  ])
  return {
    available: Boolean(professional),
    professional,
    assigned: Boolean(configuration),
    enabled: configuration?.status === 'ACTIVE' && configuration.channel === 'WHATSAPP'
  }
}
