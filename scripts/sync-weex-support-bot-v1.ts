import { WEEX_SUPPORT_BOT_V1_DEFINITION } from '../src/services/weex-support-bot-v1.js'
import { prisma } from '../src/config/prisma.js'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) throw new Error('Indicá el email del administrador del negocio')

const user = await prisma.user.findUnique({
  where: { email },
  select: {
    business: {
      select: { id: true, name: true }
    }
  }
})

if (!user?.business) throw new Error('El usuario no tiene un comercio asociado')

const configuration = await prisma.businessBotConfiguration.update({
  where: {
    businessId_botKey: {
      businessId: user.business.id,
      botKey: WEEX_SUPPORT_BOT_V1_DEFINITION.botKey
    }
  },
  data: {
    name: WEEX_SUPPORT_BOT_V1_DEFINITION.name,
    version: WEEX_SUPPORT_BOT_V1_DEFINITION.version,
    mode: WEEX_SUPPORT_BOT_V1_DEFINITION.mode,
    definition: WEEX_SUPPORT_BOT_V1_DEFINITION
  }
})

console.log(JSON.stringify({
  email,
  business: user.business.name,
  bot: configuration.name,
  status: configuration.status,
  commercialInformationUpdated: true
}, null, 2))

await prisma.$disconnect()
