import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prisma } from '../src/config/prisma.js'
import { AppointmentService } from '../src/services/appointment-service.js'

const prismaClient = prisma as any
const originals = {
  professionalFindFirst: prismaClient.professional.findFirst,
  serviceFindFirst: prismaClient.service.findFirst,
  appointmentFindFirst: prismaClient.appointment.findFirst
}

try {
  prismaClient.professional.findFirst = async () => ({
    id: 'professional-1',
    businessId: 'business-1',
    isActive: true
  })
  prismaClient.service.findFirst = async () => ({
    id: 'service-1',
    businessId: 'business-1',
    duration: 60,
    customerDurationMin: null,
    customerDurationMax: null
  })
  prismaClient.appointment.findFirst = async () => null

  const service = new AppointmentService() as any
  service.professionalOffersServices = async () => true
  service.isInsideBusinessHours = async () => false
  service.isInsideProfessionalHours = async () => false
  service.hasScheduleBlockOverlap = async () => true
  service.hasAppointmentOverlap = async () => true

  const result = await service.checkManualAvailability({
    professionalId: 'professional-1',
    serviceId: 'service-1',
    startAt: new Date(2026, 8, 1, 21, 30).toISOString()
  }, {
    id: 'admin-1',
    role: 'BUSINESS_ADMIN',
    businessId: 'business-1',
    canCreateBusinesses: false
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.conflicts.map((conflict: { code: string }) => conflict.code), [
    'OUTSIDE_BUSINESS_HOURS',
    'OUTSIDE_PROFESSIONAL_HOURS',
    'SCHEDULE_BLOCK',
    'APPOINTMENT_OVERLAP'
  ])

  const [crmUiSource, appointmentRouteSource] = await Promise.all([
    readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
  ])
  const saveManualAppointmentSource = crmUiSource.slice(
    crmUiSource.indexOf('async function saveManualAppointment'),
    crmUiSource.indexOf('async function deleteManualAppointment')
  )
  assert.doesNotMatch(crmUiSource, /id="appointment-force"/, 'la casilla excepcional debe eliminarse del formulario')
  assert.doesNotMatch(crmUiSource, /appointmentForce/, 'el flujo no debe depender de una casilla excepcional')
  assert.match(crmUiSource, /\/appointments\/check-availability/, 'la UI debe validar antes de mutar al cliente')
  assert.ok(
    saveManualAppointmentSource.indexOf("'/appointments/check-availability'") < saveManualAppointmentSource.indexOf("'/customers'"),
    'la validacion de disponibilidad debe ocurrir antes de crear un cliente'
  )
  assert.match(crmUiSource, /title: 'Confirmar turno excepcional'/)
  assert.match(crmUiSource, /confirmLabel: 'Crear como excepción'/)
  assert.match(appointmentRouteSource, /app\.post\('\/appointments\/check-availability'/)

  console.log('OK: la excepción se detecta automáticamente, explica conflictos y se confirma antes de mutar al cliente.')
} finally {
  prismaClient.professional.findFirst = originals.professionalFindFirst
  prismaClient.service.findFirst = originals.serviceFindFirst
  prismaClient.appointment.findFirst = originals.appointmentFindFirst
  await prisma.$disconnect()
}
