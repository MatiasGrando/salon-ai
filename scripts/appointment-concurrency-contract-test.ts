import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prisma } from '../src/config/prisma.js'
import { AppointmentService } from '../src/services/appointment-service.js'

const db = prisma as any
const originals = {
  transaction: db.$transaction,
  queryRaw: db.$queryRaw,
  appointmentFindMany: db.appointment.findMany,
  appointmentCreate: db.appointment.create,
  professionalFindUnique: db.professional.findUnique,
  professionalFindFirst: db.professional.findFirst,
  professionalFindMany: db.professional.findMany,
  professionalServiceCount: db.professionalService.count,
  serviceFindMany: db.service.findMany,
  customerFindUnique: db.customer.findUnique,
  customerMarketingPreferenceUpsert: db.customerMarketingPreference.upsert,
  businessHoursFindMany: db.businessHours.findMany,
  professionalHoursFindMany: db.professionalHours.findMany,
  scheduleBlockFindFirst: db.scheduleBlock.findFirst,
  bookingDepositFindMany: db.bookingDeposit.findMany
}

const appointments: Array<{
  id: string
  professionalId: string
  startAt: Date
  totalDurationMinutes: number
  status: string
  service: { duration: number }
}> = []

let transactionTail = Promise.resolve()

try {
  db.bookingDeposit.findMany = async () => []
  db.professional.findUnique = async () => ({
    id: 'professional-1',
    businessId: 'business-1',
    isActive: true
  })
  db.professional.findFirst = db.professional.findUnique
  db.professional.findMany = async (input: any) =>
    input.where.id.in.map((id: string) => ({ id }))
  db.service.findMany = async () => [{
    id: 'service-1',
    businessId: 'business-1',
    name: 'Corte',
    duration: 30,
    customerDurationMin: null,
    customerDurationMax: null,
    price: 12000
  }]
  db.customer.findUnique = async () => ({
    id: 'customer-1',
    businessId: 'business-1',
    phone: '5491112345678'
  })
  db.professionalService.count = async () => 1
  db.businessHours.findMany = async () => [{ startTime: '09:00', endTime: '18:00' }]
  db.professionalHours.findMany = async () => [{ startTime: '09:00', endTime: '18:00' }]
  db.scheduleBlock.findFirst = async () => null
  db.customerMarketingPreference.upsert = async () => ({})
  db.$queryRaw = async (query: any) => query.strings.join('').includes('FROM "Appointment"')
    ? [{ id: 'appointment-target', professionalId: 'professional-1' }]
    : [{ locked: 1 }]

  db.appointment.findMany = async () => appointments.slice()
  db.appointment.create = async (input: any) => {
    const appointment = {
      id: `appointment-${appointments.length + 1}`,
      professionalId: input.data.professionalId,
      startAt: input.data.startAt,
      totalDurationMinutes: input.data.totalDurationMinutes,
      status: input.data.status,
      service: { duration: 30 },
      serviceItems: []
    }
    appointments.push(appointment)
    return appointment
  }
  db.$transaction = async (callback: (transaction: any) => Promise<unknown>) => {
    const previous = transactionTail
    let release!: () => void
    transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await callback(db)
    } finally {
      release()
    }
  }

  const service = new AppointmentService()
  const input = {
    customerId: 'customer-1',
    professionalId: 'professional-1',
    serviceId: 'service-1',
    startAt: '2026-08-18T15:00:00.000Z',
    status: 'PENDING' as const
  }
  const results = await Promise.all([
    service.create(input),
    service.create(input)
  ])

  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.filter((result) => !result.ok && result.statusCode === 409).length, 1)
  assert.equal(appointments.length, 1, 'solo una reserva debe ocupar el horario disputado')

  const lockSource = await readFile(new URL('../src/services/agenda-locks.ts', import.meta.url), 'utf8')
  const operationSource = await readFile(new URL('../src/services/booking-operations.ts', import.meta.url), 'utf8')
  assert.match(lockSource, /pg_advisory_xact_lock\(hashtextextended/)
  assert.match(operationSource, /acquireAgendaHierarchy/)
  assert.match(operationSource, /hasAppointmentOverlap/)
  console.log('OK: dos reservas simultaneas dejan un solo turno y la segunda recibe conflicto 409.')
} finally {
  db.$transaction = originals.transaction
  db.$queryRaw = originals.queryRaw
  db.appointment.findMany = originals.appointmentFindMany
  db.appointment.create = originals.appointmentCreate
  db.professional.findUnique = originals.professionalFindUnique
  db.professional.findFirst = originals.professionalFindFirst
  db.professional.findMany = originals.professionalFindMany
  db.professionalService.count = originals.professionalServiceCount
  db.service.findMany = originals.serviceFindMany
  db.customer.findUnique = originals.customerFindUnique
  db.customerMarketingPreference.upsert = originals.customerMarketingPreferenceUpsert
  db.businessHours.findMany = originals.businessHoursFindMany
  db.professionalHours.findMany = originals.professionalHoursFindMany
  db.scheduleBlock.findFirst = originals.scheduleBlockFindFirst
  db.bookingDeposit.findMany = originals.bookingDepositFindMany
  await prisma.$disconnect()
}
