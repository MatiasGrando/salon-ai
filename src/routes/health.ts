import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { whatsappConfig } from '../config/whatsapp.js'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return {
      status: 'ok',
      service: 'salon-ai'
    }
  })

  app.get('/health', async (request, reply) => {
    const checks = {
      database: await checkDatabase(),
      whatsapp: checkWhatsAppConfig()
    }

    const isHealthy = Object.values(checks).every((check) => check.status === 'ok')

    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'salon-ai',
      checks
    })
  })
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`

    return {
      status: 'ok'
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Database check failed'
    }
  }
}

function checkWhatsAppConfig() {
  const missingVariables = [
    ['WHATSAPP_VERIFY_TOKEN', whatsappConfig.verifyToken],
    ['WHATSAPP_ACCESS_TOKEN', whatsappConfig.accessToken],
    ['WHATSAPP_PHONE_NUMBER_ID', whatsappConfig.phoneNumberId],
    ['WHATSAPP_API_VERSION', whatsappConfig.apiVersion],
    ['WHATSAPP_PHONE_NUMBER_MODE', whatsappConfig.phoneNumberMode]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missingVariables.length > 0) {
    return {
      status: 'error',
      missingVariables
    }
  }

  return {
    status: 'ok',
    apiVersion: whatsappConfig.apiVersion,
    phoneNumberMode: whatsappConfig.phoneNumberMode
  }
}
