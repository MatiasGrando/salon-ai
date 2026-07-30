import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/config/prisma.js'
import { professionalRoutes } from '../src/routes/professional.js'

const app = Fastify()
await app.register(professionalRoutes)

const professionalId = 'professional-test'
const businessId = 'business-test'
const serviceId = 'service-test'
const originalAvatar = 'data:image/jpeg;base64,existing-large-avatar'
const updatePayloads: Array<Record<string, unknown>> = []
let professionalHoursDeleteCount = 0
const existingWorkingHours = [
  { dayOfWeek: 1, startTime: '13:00', endTime: '20:00' },
  { dayOfWeek: 2, startTime: '13:00', endTime: '20:00' },
  { dayOfWeek: 3, startTime: '13:00', endTime: '20:00' },
  { dayOfWeek: 4, startTime: '13:00', endTime: '20:00' },
  { dayOfWeek: 5, startTime: '13:00', endTime: '20:00' },
  { dayOfWeek: 6, startTime: '09:00', endTime: '14:00' },
  { dayOfWeek: 0, startTime: '10:00', endTime: '13:00' }
]

const prismaClient = prisma as any
const originals = {
  findProfessional: prismaClient.professional.findUnique,
  findServices: prismaClient.service.findMany,
  transaction: prismaClient.$transaction
}

const professional = {
  id: professionalId,
  name: 'Lucas',
  description: null,
  avatarUrl: originalAvatar,
  isActive: true,
  deactivatedAt: null,
  businessId,
  createdAt: new Date(),
  updatedAt: new Date(),
  workingHours: existingWorkingHours,
  serviceLinks: [],
  _count: { appointments: 0 }
}

try {
  prismaClient.professional.findUnique = async () => professional
  prismaClient.service.findMany = async () => [{ id: serviceId }]
  prismaClient.$transaction = async (callback: (tx: any) => unknown) => callback({
    professional: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updatePayloads.push(data)
        return professional
      },
      findUnique: async () => professional
    },
    professionalService: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 })
    },
    professionalHours: {
      deleteMany: async () => {
        professionalHoursDeleteCount += 1
        return { count: 0 }
      },
      createMany: async () => ({ count: 0 })
    }
  })

  const servicesOnlyResponse = await app.inject({
    method: 'PATCH',
    url: `/professionals/${professionalId}`,
    payload: {
      name: 'Lucas',
      serviceIds: [serviceId],
      workingHours: existingWorkingHours
    }
  })

  assert.equal(servicesOnlyResponse.statusCode, 200)
  assert.equal(
    Object.prototype.hasOwnProperty.call(updatePayloads[0], 'avatarUrl'),
    false,
    'Editar servicios no debe reenviar ni reemplazar el avatar existente'
  )
  assert.equal(
    professionalHoursDeleteCount,
    0,
    'Editar servicios no debe reprocesar horarios que no cambiaron'
  )

  const removeAvatarResponse = await app.inject({
    method: 'PATCH',
    url: `/professionals/${professionalId}`,
    payload: {
      name: 'Lucas',
      avatarUrl: null
    }
  })

  assert.equal(removeAvatarResponse.statusCode, 200)
  assert.equal(updatePayloads[1]?.avatarUrl, null)
  console.log('OK: el PATCH conserva el avatar omitido y permite quitarlo explícitamente.')
} finally {
  prismaClient.professional.findUnique = originals.findProfessional
  prismaClient.service.findMany = originals.findServices
  prismaClient.$transaction = originals.transaction
  await app.close()
  await prisma.$disconnect()
}
