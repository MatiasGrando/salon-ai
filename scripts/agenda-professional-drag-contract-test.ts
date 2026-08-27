import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prisma } from '../src/config/prisma.js'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'
import { AppointmentService } from '../src/services/appointment-service.js'

const prismaClient = prisma as any
const originals = {
  appointmentFindUnique: prismaClient.appointment.findUnique,
  appointmentUpdate: prismaClient.appointment.update,
  transaction: prismaClient.$transaction,
  professionalFindUnique: prismaClient.professional.findUnique,
  professionalFindFirst: prismaClient.professional.findFirst,
  professionalFindMany: prismaClient.professional.findMany,
  professionalServiceCount: prismaClient.professionalService.count,
  serviceFindMany: prismaClient.service.findMany,
  customerFindUnique: prismaClient.customer.findUnique,
  businessHoursFindMany: prismaClient.businessHours.findMany,
  professionalHoursFindMany: prismaClient.professionalHours.findMany,
  scheduleBlockFindFirst: prismaClient.scheduleBlock.findFirst,
  appointmentFindMany: prismaClient.appointment.findMany,
  queryRaw: prismaClient.$queryRaw
}

const services = [
  { id: 'cut', businessId: 'business-1', name: 'Corte', duration: 30, price: 12000 },
  { id: 'color', businessId: 'business-1', name: 'Color', duration: 60, price: 30000 }
]
const existingAppointment = {
  id: 'appointment-1',
  status: 'CONFIRMED',
  customerId: 'customer-1',
  professionalId: 'professional-1',
  professional: { businessId: 'business-1' },
  serviceId: 'cut',
  startAt: new Date('2026-08-14T13:00:00.000Z'),
  serviceItems: [
    { serviceId: 'cut', sortOrder: 0 },
    { serviceId: 'color', sortOrder: 1 }
  ]
}

try {
  prismaClient.appointment.findUnique = async () => existingAppointment
  prismaClient.professional.findUnique = async () => ({
    id: 'professional-2',
    businessId: 'business-1',
    isActive: true
  })
  prismaClient.professional.findFirst = async () => ({
    id: 'professional-2',
    businessId: 'business-1',
    isActive: true
  })
  prismaClient.professional.findMany = async (input: any) =>
    input.where.id.in.map((id: string) => ({ id }))
  prismaClient.service.findMany = async () => services
  prismaClient.customer.findUnique = async () => ({
    id: 'customer-1',
    businessId: 'business-1'
  })

  let updateInput: any = null
  let offersServices = false
  let insideBusinessHours = true
  let insideProfessionalHours = true
  let hasBlock = false
  let hasOverlap = false
  prismaClient.professionalService.count = async () => offersServices ? 2 : 0
  prismaClient.businessHours.findMany = async () => insideBusinessHours
    ? [{ startTime: '00:00', endTime: '23:59' }]
    : []
  prismaClient.professionalHours.findMany = async () => insideProfessionalHours
    ? [{ startTime: '00:00', endTime: '23:59' }]
    : []
  prismaClient.scheduleBlock.findFirst = async () => hasBlock ? { id: 'block' } : null
  prismaClient.appointment.findMany = async () => hasOverlap
    ? [{ startAt: new Date('2026-08-14T14:00:00.000Z'), totalDurationMinutes: 30 }]
    : []
  prismaClient.$queryRaw = async (query: any) => query.strings.join('').includes('FROM "Appointment"')
    ? [{ id: 'appointment-1', professionalId: 'professional-1' }]
    : [{ locked: 1 }]
  prismaClient.appointment.update = async (input: any) => {
    updateInput = input
    return { ...existingAppointment, ...input.data }
  }

  const service = new AppointmentService() as any
  prismaClient.$transaction = async (callback: (transaction: any) => unknown) => callback(prismaClient)
  service.lockProfessionalAgenda = async () => undefined
  service.professionalOffersServices = async () => false
  service.isInsideBusinessHours = async () => true
  service.isInsideProfessionalHours = async () => true
  service.hasScheduleBlockOverlap = async () => false
  service.hasAppointmentOverlap = async () => false

  const incompatible = await service.update({
    id: 'appointment-1',
    customerId: 'customer-1',
    professionalId: 'professional-2',
    serviceId: 'cut',
    serviceIds: ['cut', 'color'],
    startAt: '2026-08-14T14:00:00.000Z',
    force: true
  })
  assert.equal(incompatible.ok, false)
  assert.equal(incompatible.code, 'PROFESSIONAL_SERVICE_MISMATCH')
  assert.equal(incompatible.forceable, false)
  assert.equal(updateInput, null)

  service.professionalOffersServices = async () => true
  offersServices = true
  insideBusinessHours = false
  insideProfessionalHours = false
  hasBlock = true
  hasOverlap = true
  service.isInsideBusinessHours = async () => false
  service.isInsideProfessionalHours = async () => false
  service.hasScheduleBlockOverlap = async () => true
  service.hasAppointmentOverlap = async () => true

  const conflicted = await service.update({
    id: 'appointment-1',
    customerId: 'customer-1',
    professionalId: 'professional-2',
    serviceId: 'cut',
    serviceIds: ['cut', 'color'],
    startAt: '2026-08-14T14:00:00.000Z'
  })
  assert.equal(conflicted.ok, false)
  assert.equal(conflicted.code, 'APPOINTMENT_AVAILABILITY_CONFLICT')
  assert.equal(conflicted.forceable, true)
  assert.deepEqual(
    conflicted.conflicts.map((conflict: { code: string }) => conflict.code),
    ['OUTSIDE_BUSINESS_HOURS', 'OUTSIDE_PROFESSIONAL_HOURS', 'SCHEDULE_BLOCK', 'APPOINTMENT_OVERLAP']
  )
  assert.equal(updateInput, null)

  const forced = await service.update({
    id: 'appointment-1',
    customerId: 'customer-1',
    professionalId: 'professional-2',
    serviceId: 'cut',
    serviceIds: ['cut', 'color'],
    startAt: '2026-08-14T14:00:00.000Z',
    force: true
  })
  assert.equal(forced.ok, true)
  const forcedUpdateInput: any = updateInput
  assert.equal(forcedUpdateInput.data.professionalId, 'professional-2')
  assert.equal(forcedUpdateInput.data.totalDurationMinutes, 90)
  assert.deepEqual(
    forcedUpdateInput.data.serviceItems.create.map((item: { serviceId: string }) => item.serviceId),
    ['cut', 'color']
  )

  const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
  assert.match(crmUiSource, /targetCell\.dataset\.cellProfessionalId \|\| undefined/)
  assert.match(crmUiSource, /document\.elementsFromPoint\(clientX, clientY\)/)
  assert.match(crmUiSource, /window\.addEventListener\('pointerup', handleAgendaPointerEnd, true\)/)
  assert.match(crmUiSource, /window\.addEventListener\('blur', handleAgendaPointerCancel\)/)
  assert.match(crmUiSource, /document\.querySelectorAll\('\.agenda-drag-ghost'\)\.forEach/)
  assert.match(crmUiSource, /title: 'El cambio tiene conflictos'/)
  assert.match(crmUiSource, /title: 'Confirmar sobreturno o excepción'/)
  assert.match(crmUiSource, /body: JSON\.stringify\(\{ \.\.\.payload, force: true \}\)/)
  assert.match(crmUiSource, /renderAgendaMobileBlock\(block, day, hourHeight\)/)
  assert.match(crmUiSource, /const segmentStart = new Date\(Math\.max\(blockStart\.getTime\(\), dayStart\.getTime\(\)\)\)/)
  assert.match(crmUiSource, /const segmentEnd = new Date\(Math\.min\(blockEnd\.getTime\(\), dayEnd\.getTime\(\)\)\)/)
  assert.match(crmUiSource, /\? 'Todo el d&iacute;a'/)

  let crmHandler: ((request: unknown, reply: any) => Promise<unknown>) | null = null
  await crmUiRoutes({
    get(path: string, handler: typeof crmHandler) {
      if (path === '/crm') crmHandler = handler
    }
  } as any, { pollingMarker: DISABLED_POLLING_MARKER })
  assert.ok(crmHandler)
  const activeCrmHandler = crmHandler as unknown as (
    (request: unknown, reply: any) => Promise<unknown>
  )
  let generatedHtml = ''
  await activeCrmHandler({}, {
    type() {
      return this
    },
    send(value: string) {
      generatedHtml = value
      return value
    }
  })
  const inlineScripts = [...generatedHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] || '')
  assert.ok(inlineScripts.length > 0)
  for (const script of inlineScripts) {
    assert.doesNotThrow(() => new Function(script))
  }

  console.log('OK: la agenda cambia de profesional, bloquea servicios incompatibles y exige doble confirmacion para excepciones.')
} finally {
  prismaClient.appointment.findUnique = originals.appointmentFindUnique
  prismaClient.appointment.update = originals.appointmentUpdate
  prismaClient.$transaction = originals.transaction
  prismaClient.professional.findUnique = originals.professionalFindUnique
  prismaClient.professional.findFirst = originals.professionalFindFirst
  prismaClient.professional.findMany = originals.professionalFindMany
  prismaClient.professionalService.count = originals.professionalServiceCount
  prismaClient.service.findMany = originals.serviceFindMany
  prismaClient.customer.findUnique = originals.customerFindUnique
  prismaClient.businessHours.findMany = originals.businessHoursFindMany
  prismaClient.professionalHours.findMany = originals.professionalHoursFindMany
  prismaClient.scheduleBlock.findFirst = originals.scheduleBlockFindFirst
  prismaClient.appointment.findMany = originals.appointmentFindMany
  prismaClient.$queryRaw = originals.queryRaw
  await prisma.$disconnect()
}
