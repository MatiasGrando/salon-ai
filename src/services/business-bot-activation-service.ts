import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { TAMARA_OPTIONS_BOT_KEY } from './tamara-options-bot.js'

export async function setTamaraOptionsBotEnabled(businessId: string, enabled: boolean) {
  const assigned = await prisma.businessBotConfiguration.findUnique({
    where: { businessId_botKey: { businessId, botKey: TAMARA_OPTIONS_BOT_KEY } },
    select: { id: true }
  })
  if (!assigned) throw new Error('El bot de Tamara todavía no está asignado a este perfil')

  if (!enabled) {
    return prisma.$transaction(async (tx) => {
      const configuration = await tx.businessBotConfiguration.update({
        where: { id: assigned.id },
        data: { status: 'DRAFT', channel: 'UNASSIGNED', phoneNumberId: null, displayPhoneNumber: null }
      })
      await tx.conversation.updateMany({
        where: { businessId, supportBotKey: TAMARA_OPTIONS_BOT_KEY, currentStep: { not: 'HUMAN_HANDOFF' } },
        data: { supportBotKey: null, supportBotState: Prisma.JsonNull, currentStep: 'START' }
      })
      await tx.business.update({ where: { id: businessId }, data: { botEnabled: false } })
      await tx.businessFeatureSettings.upsert({
        where: { businessId },
        create: { businessId, botEnabled: false },
        update: { botEnabled: false }
      })
      return configuration
    })
  }

  const connection = await prisma.businessWhatsAppConfig.findUnique({
    where: { businessId },
    select: { connectionStatus: true, phoneNumberId: true, displayPhoneNumber: true, accessToken: true, wabaId: true }
  })
  if (connection?.connectionStatus !== 'CONNECTED' || !connection.phoneNumberId || !connection.displayPhoneNumber || !connection.accessToken || !connection.wabaId) {
    throw new Error('Conectá WhatsApp completamente antes de habilitar este bot')
  }

  return prisma.$transaction(async (tx) => {
    await tx.businessBotConfiguration.updateMany({
      where: { businessId, id: { not: assigned.id } },
      data: { status: 'ARCHIVED', channel: 'UNASSIGNED' }
    })
    const configuration = await tx.businessBotConfiguration.update({
      where: { id: assigned.id },
      data: {
        status: 'ACTIVE',
        channel: 'WHATSAPP',
        routingMode: 'EXCLUSIVE',
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber
      }
    })
    await tx.business.update({ where: { id: businessId }, data: { botEnabled: true, aiEnabled: false } })
    await tx.businessFeatureSettings.upsert({
      where: { businessId },
      create: { businessId, botEnabled: true, aiEnabled: false, bookingV2Enabled: false, realWhatsappEnabled: true },
      update: { botEnabled: true, aiEnabled: false, bookingV2Enabled: false, realWhatsappEnabled: true }
    })
    await tx.conversation.updateMany({
      where: { businessId, currentStep: { not: 'HUMAN_HANDOFF' } },
      data: {
        currentStep: 'START',
        aiEnabled: true,
        misunderstandingCount: 0,
        supportBotKey: TAMARA_OPTIONS_BOT_KEY,
        supportBotState: Prisma.JsonNull
      }
    })
    return configuration
  })
}
