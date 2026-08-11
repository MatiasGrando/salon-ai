import { prisma } from '../config/prisma.js'
import { WEEX_SUPPORT_BOT_V1_DEFINITION } from './weex-support-bot-v1.js'

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
