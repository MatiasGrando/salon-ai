import { Prisma } from '../src/generated/prisma/client.js'
import { prisma } from '../src/config/prisma.js'

const email = process.argv[2]?.trim().toLowerCase()

if (!email) throw new Error('Indicá el email del administrador del negocio')

const user = await prisma.user.findUnique({
  where: { email },
  select: {
    isActive: true,
    business: {
      select: {
        id: true,
        name: true,
        whatsappConfig: {
          select: {
            connectionStatus: true,
            phoneNumberId: true,
            displayPhoneNumber: true,
            accessToken: true,
            wabaId: true
          }
        },
        botConfigurations: {
          where: { botKey: 'weex-support-v1' },
          select: { id: true }
        }
      }
    }
  }
})

if (!user?.isActive) throw new Error('No existe un usuario activo con ese email')
if (!user.business) throw new Error('El usuario no tiene un negocio asociado')

const connection = user.business.whatsappConfig
if (
  connection?.connectionStatus !== 'CONNECTED' ||
  !connection.phoneNumberId ||
  !connection.displayPhoneNumber ||
  !connection.accessToken ||
  !connection.wabaId
) {
  throw new Error('El negocio no tiene una conexión de WhatsApp completa y activa')
}

const configuration = user.business.botConfigurations[0]
if (!configuration) throw new Error('Primero cargá el Bot de atención Weex V1 en el negocio')

const result = await prisma.$transaction(async (tx) => {
  await tx.businessBotConfiguration.updateMany({
    where: {
      businessId: user.business!.id,
      id: { not: configuration.id }
    },
    data: { status: 'ARCHIVED', channel: 'UNASSIGNED' }
  })

  const activeConfiguration = await tx.businessBotConfiguration.update({
    where: { id: configuration.id },
    data: {
      status: 'ACTIVE',
      channel: 'WHATSAPP',
      routingMode: 'EXCLUSIVE',
      phoneNumberId: connection.phoneNumberId,
      displayPhoneNumber: connection.displayPhoneNumber
    }
  })

  await tx.business.update({
    where: { id: user.business!.id },
    data: { botEnabled: true, aiEnabled: false }
  })

  await tx.businessFeatureSettings.upsert({
    where: { businessId: user.business!.id },
    create: {
      businessId: user.business!.id,
      botEnabled: true,
      aiEnabled: false,
      bookingV2Enabled: false,
      realWhatsappEnabled: true
    },
    update: {
      botEnabled: true,
      aiEnabled: false,
      bookingV2Enabled: false,
      realWhatsappEnabled: true
    }
  })

  await tx.conversation.updateMany({
    where: {
      businessId: user.business!.id,
      currentStep: { not: 'HUMAN_HANDOFF' }
    },
    data: {
      currentStep: 'START',
      aiEnabled: true,
      misunderstandingCount: 0,
      supportBotKey: activeConfiguration.botKey,
      supportBotState: Prisma.JsonNull
    }
  })

  await tx.conversation.updateMany({
    where: {
      businessId: user.business!.id,
      currentStep: 'HUMAN_HANDOFF'
    },
    data: { aiEnabled: false }
  })

  return activeConfiguration
})

console.log(JSON.stringify({
  email,
  business: user.business.name,
  bot: result.name,
  status: result.status,
  channel: result.channel,
  routingMode: result.routingMode,
  displayPhoneNumber: result.displayPhoneNumber,
  previousAiEnabled: false,
  activated: true
}, null, 2))

await prisma.$disconnect()
