import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prisma } from '../src/config/prisma.js'
import { InternalBookingProvider } from '../src/providers/internal-booking-provider.js'

const db = prisma as any
const originals = {
  professionalFindMany: db.professional.findMany,
  serviceFindMany: db.service.findMany,
  businessHoursFindMany: db.businessHours.findMany,
  professionalHoursFindMany: db.professionalHours.findMany,
  scheduleBlockFindMany: db.scheduleBlock.findMany,
  appointmentFindMany: db.appointment.findMany
}
const calls = {
  professionals: 0,
  services: 0,
  businessHours: 0,
  professionalHours: 0,
  blocks: 0,
  appointments: 0
}
const date = '2030-01-15'
const dayOfWeek = new Date(2030, 0, 15).getDay()

try {
  db.professional.findMany = async () => {
    calls.professionals += 1
    return ['professional-1', 'professional-2'].map((id) => ({
      id,
      name: id === 'professional-1' ? 'Ana' : 'Luis',
      businessId: 'business-1',
      isActive: true,
      serviceLinks: [{ serviceId: 'service-1' }]
    }))
  }
  db.service.findMany = async () => {
    calls.services += 1
    return [{
      id: 'service-1',
      businessId: 'business-1',
      duration: 30,
      customerDurationMin: null,
      customerDurationMax: null
    }]
  }
  db.businessHours.findMany = async () => {
    calls.businessHours += 1
    return [{ businessId: 'business-1', dayOfWeek, startTime: '09:00', endTime: '12:00' }]
  }
  db.professionalHours.findMany = async () => {
    calls.professionalHours += 1
    return ['professional-1', 'professional-2'].map((professionalId) => ({
      professionalId,
      dayOfWeek,
      startTime: '09:00',
      endTime: '12:00'
    }))
  }
  db.scheduleBlock.findMany = async () => {
    calls.blocks += 1
    return []
  }
  db.appointment.findMany = async () => {
    calls.appointments += 1
    return [{
      professionalId: 'professional-1',
      startAt: new Date(2030, 0, 15, 10, 0),
      totalDurationMinutes: 30
    }]
  }

  const provider = new InternalBookingProvider()
  const [first, second] = await Promise.all([
    provider.getAvailability({ professionalId: 'professional-1', serviceId: 'service-1', date }),
    provider.getAvailability({ professionalId: 'professional-2', serviceId: 'service-1', date })
  ])

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (first.ok && second.ok) {
    assert.equal(first.slots.includes('10:00'), false, 'el turno existente debe bloquear solo a su profesional')
    assert.equal(second.slots.includes('10:00'), true, 'el otro profesional debe conservar el horario')
  }
  assert.deepEqual(calls, {
    professionals: 1,
    services: 1,
    businessHours: 1,
    professionalHours: 1,
    blocks: 1,
    appointments: 1
  }, 'las consultas simultaneas deben resolverse con un unico lote de seis lecturas')

  const [serviceSource, providerSource, publicRouteSource, schema, migration] = await Promise.all([
    readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/providers/internal-booking-provider.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8'),
    readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../prisma/migrations/20260818010000_optimize_booking_availability/migration.sql', import.meta.url), 'utf8')
  ])
  assert.equal(serviceSource.includes('await bookingDepositService.expireOverdue()\n    const dayStart'), false)
  assert.match(serviceSource, /bookingDeposit:\s*\{\s*is:\s*\{ status: 'PENDING_PROOF'/)
  assert.match(providerSource, /pendingAvailability/)
  assert.match(publicRouteSource, /appointmentService\.findAvailabilityMany/)
  assert.match(publicRouteSource, /availabilityProvider\.getAvailability/)
  for (const index of [
    '@@index([professionalId, startAt])',
    '@@index([businessId, dayOfWeek])',
    '@@index([professionalId, dayOfWeek])',
    '@@index([businessId, professionalId, startAt])'
  ]) assert.ok(schema.includes(index), `falta el indice ${index}`)
  assert.equal((migration.match(/CREATE INDEX/g) || []).length, 4)
  console.log('OK: web y bot agrupan disponibilidad en seis lecturas indexadas sin escrituras de mantenimiento.')
} finally {
  db.professional.findMany = originals.professionalFindMany
  db.service.findMany = originals.serviceFindMany
  db.businessHours.findMany = originals.businessHoursFindMany
  db.professionalHours.findMany = originals.professionalHoursFindMany
  db.scheduleBlock.findMany = originals.scheduleBlockFindMany
  db.appointment.findMany = originals.appointmentFindMany
  await prisma.$disconnect()
}
