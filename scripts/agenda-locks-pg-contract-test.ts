import assert from 'node:assert/strict'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsed = new URL(SAFE_DATABASE_URL)
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '54322' || parsed.pathname !== '/salon_ai_test') {
  throw new Error('Refusing unsafe F7 agenda-lock database')
}
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, locks, operations, appointmentModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/services/agenda-locks.js'),
  import('../src/services/booking-operations.js'),
  import('../src/services/appointment-service.js')
])
const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 6,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 3000
})
const prefix = `f7-${Date.now()}-${Math.random().toString(36).slice(2)}`
const businessA = `${prefix}-business-a`
const businessB = `${prefix}-business-b`
const professionalA1 = `${prefix}-professional-a1`
const professionalA2 = `${prefix}-professional-a2`
const professionalB = `${prefix}-professional-b`
const serviceA = `${prefix}-service-a`
const serviceB = `${prefix}-service-b`
const customerA = `${prefix}-customer-a`
const customerB = `${prefix}-customer-b`
const startAt = new Date('2026-08-31T12:00:00.000Z')

let releaseBusinessLock!: () => void
let businessLocked!: () => void
const businessLockedPromise = new Promise<void>((resolve) => { businessLocked = resolve })
const releaseBusinessLockPromise = new Promise<void>((resolve) => { releaseBusinessLock = resolve })

try {
  await prisma.business.createMany({ data: [
    { id: businessA, customerCode: `${prefix}-A`, name: 'F7 A' },
    { id: businessB, customerCode: `${prefix}-B`, name: 'F7 B' }
  ] })
  await prisma.professional.createMany({ data: [
    { id: professionalA1, businessId: businessA, name: 'A1' },
    { id: professionalA2, businessId: businessA, name: 'A2' },
    { id: professionalB, businessId: businessB, name: 'B' }
  ] })
  await prisma.service.createMany({ data: [
    { id: serviceA, businessId: businessA, name: 'Servicio A', duration: 30 },
    { id: serviceB, businessId: businessB, name: 'Servicio B', duration: 30 }
  ] })
  await prisma.customer.createMany({ data: [
    { id: customerA, businessId: businessA, name: 'Cliente A', phone: `${prefix}-phone-a` },
    { id: customerB, businessId: businessB, name: 'Cliente B', phone: `${prefix}-phone-b` }
  ] })
  await prisma.professionalService.createMany({ data: [
    { professionalId: professionalA1, serviceId: serviceA },
    { professionalId: professionalA2, serviceId: serviceA },
    { professionalId: professionalB, serviceId: serviceB }
  ] })
  await prisma.businessHours.createMany({ data: [
    { businessId: businessA, dayOfWeek: 1, startTime: '00:00', endTime: '23:59' },
    { businessId: businessB, dayOfWeek: 1, startTime: '00:00', endTime: '23:59' }
  ] })
  await prisma.professionalHours.createMany({ data: [
    { professionalId: professionalA1, dayOfWeek: 1, startTime: '00:00', endTime: '23:59' },
    { professionalId: professionalA2, dayOfWeek: 1, startTime: '00:00', endTime: '23:59' },
    { professionalId: professionalB, dayOfWeek: 1, startTime: '00:00', endTime: '23:59' }
  ] })

  const holder = prisma.$transaction(async (tx) => {
    await locks.acquireAgendaHierarchy(tx, { businessId: businessA, professionalIds: [professionalA1] })
    businessLocked()
    await releaseBusinessLockPromise
  }, { timeout: 5000 })
  await businessLockedPromise

  const sameStarted = Date.now()
  const sameBusiness = prisma.$transaction(async (tx) => {
    await locks.acquireAgendaHierarchy(tx, { businessId: businessA, professionalIds: [professionalA2] })
    return Date.now() - sameStarted
  }, { timeout: 5000 })
  const crossStarted = Date.now()
  const crossBusiness = await prisma.$transaction(async (tx) => {
    await locks.acquireAgendaHierarchy(tx, { businessId: businessB, professionalIds: [professionalB] })
    return Date.now() - crossStarted
  }, { timeout: 5000 })
  assert.ok(crossBusiness < 500, `otro negocio no debe esperar el lock (${crossBusiness}ms)`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  releaseBusinessLock()
  await holder
  assert.ok(await sameBusiness >= 200, 'writers del mismo negocio deben serializarse')

  await Promise.all([
    prisma.$transaction(async (tx) => {
      await locks.acquireAgendaHierarchy(tx, {
        businessId: businessA,
        professionalIds: [professionalA2, professionalA1]
      })
      await new Promise((resolve) => setTimeout(resolve, 75))
    }, { timeout: 5000 }),
    prisma.$transaction(async (tx) => {
      await locks.acquireAgendaHierarchy(tx, {
        businessId: businessA,
        professionalIds: [professionalA1, professionalA2]
      })
    }, { timeout: 5000 })
  ])

  let releaseBlockWriter!: () => void
  let blockWriterLocked!: () => void
  const blockWriterLockedPromise = new Promise<void>((resolve) => { blockWriterLocked = resolve })
  const releaseBlockWriterPromise = new Promise<void>((resolve) => { releaseBlockWriter = resolve })
  const blockWriter = prisma.$transaction(async (tx) => {
    await locks.acquireAgendaHierarchy(tx, { businessId: businessA, professionalIds: [professionalA1] })
    blockWriterLocked()
    await releaseBlockWriterPromise
    await tx.scheduleBlock.create({
      data: {
        businessId: businessA,
        professionalId: professionalA1,
        reason: 'OTHER',
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000)
      }
    })
  }, { timeout: 5000 })
  await blockWriterLockedPromise
  const blockedValidation = prisma.$transaction((tx) => operations.revalidateBookingWrite(tx, {
    businessId: businessA,
    professionalId: professionalA1,
    serviceIds: [serviceA],
    startAt
  }), { timeout: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  releaseBlockWriter()
  await blockWriter
  assert.ok((await blockedValidation).conflicts.includes('SCHEDULE_BLOCK'), 'la revalidación final debe ver el bloqueo ganador')

  await prisma.scheduleBlock.deleteMany({ where: { businessId: businessA } })
  const legacy = new appointmentModule.AppointmentService()
  const legacyInput = {
    customerId: customerA,
    professionalId: professionalA1,
    serviceId: serviceA,
    startAt: startAt.toISOString(),
    status: 'CONFIRMED' as const
  }
  const legacyResults = await Promise.all([legacy.create(legacyInput), legacy.create(legacyInput)])
  assert.equal(legacyResults.filter((result) => result.ok).length, 1)
  assert.equal(legacyResults.filter((result) => !result.ok && result.statusCode === 409).length, 1)

  await assert.rejects(prisma.$transaction((tx) => locks.acquireAgendaHierarchy(tx, {
    businessId: businessA,
    professionalIds: [professionalB]
  })), locks.AgendaLockScopeError)
  console.log('OK F7 PG: same-business serialization, cross-business isolation, block revalidation, tenant scope and legacy writer compatibility.')
} finally {
  await prisma.appointmentServiceItem.deleteMany({ where: { appointment: { professional: { businessId: { in: [businessA, businessB] } } } } }).catch(() => undefined)
  await prisma.appointment.deleteMany({ where: { professional: { businessId: { in: [businessA, businessB] } } } }).catch(() => undefined)
  await prisma.scheduleBlock.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.professionalHours.deleteMany({ where: { professional: { businessId: { in: [businessA, businessB] } } } }).catch(() => undefined)
  await prisma.businessHours.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.professionalService.deleteMany({ where: { professional: { businessId: { in: [businessA, businessB] } } } }).catch(() => undefined)
  await prisma.customerMarketingPreference.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.customer.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.service.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.professional.deleteMany({ where: { businessId: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.business.deleteMany({ where: { id: { in: [businessA, businessB] } } }).catch(() => undefined)
  await prisma.$disconnect()
}
