import assert from 'node:assert/strict'
import { prisma } from '../src/config/prisma.js'
import { AppointmentService } from '../src/services/appointment-service.js'

const prismaClient = prisma as any
const originalFindMany = prismaClient.appointment.findMany
let capturedQuery: any

try {
  prismaClient.appointment.findMany = async (query: unknown) => {
    capturedQuery = query
    return []
  }

  await new AppointmentService().findAll({
    businessId: 'business-test',
    from: '2026-07-30T00:00:00.000Z',
    to: '2026-09-30T00:00:00.000Z'
  })

  assert.equal(capturedQuery.include.professional.select.name, true)
  assert.equal(capturedQuery.include.professional.select.avatarUrl, undefined)
  assert.equal(capturedQuery.include.service.select.imageUrl, undefined)
  assert.equal(capturedQuery.include.customer.select.phone, true)
  console.log('OK: el listado de turnos excluye avatares e imágenes pesadas.')
} finally {
  prismaClient.appointment.findMany = originalFindMany
  await prisma.$disconnect()
}
