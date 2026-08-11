import { prisma } from '../src/config/prisma.js'
import { assignWeexSupportBotV1ToBusiness } from '../src/services/business-bot-configuration-service.js'

const email = process.argv[2]?.trim().toLowerCase()

if (!email) throw new Error('Indicá el email del administrador del negocio')

const user = await prisma.user.findUnique({
  where: { email },
  select: {
    email: true,
    isActive: true,
    business: {
      select: {
        id: true,
        name: true,
        whatsappConfig: {
          select: {
            connectionStatus: true,
            displayPhoneNumber: true
          }
        }
      }
    }
  }
})

if (!user?.isActive) throw new Error('No existe un usuario activo con ese email')
if (!user.business) throw new Error('El usuario no tiene un negocio asociado')

const configuration = await assignWeexSupportBotV1ToBusiness(user.business.id)

console.log(JSON.stringify({
  email: user.email,
  business: user.business.name,
  businessId: user.business.id,
  bot: configuration.name,
  version: configuration.version,
  status: configuration.status,
  channel: configuration.channel,
  whatsappConnectionStatus: user.business.whatsappConfig?.connectionStatus ?? 'NOT_CONNECTED',
  displayPhoneNumber: user.business.whatsappConfig?.displayPhoneNumber ?? null,
  activated: false
}, null, 2))

await prisma.$disconnect()
