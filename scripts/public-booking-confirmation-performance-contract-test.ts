import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
const appointmentServiceSource = await readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
const singleBooking = source.slice(
  source.indexOf("app.post('/public/booking/:slug/book'"),
  source.indexOf("app.post('/public/booking/:slug/book-coordinated'")
)
const coordinatedBooking = source.slice(
  source.indexOf("app.post('/public/booking/:slug/book-coordinated'"),
  source.indexOf("app.post('/public/booking/:slug/deposits/:depositId/proof'")
)
const appointmentCreate = appointmentServiceSource.slice(
  appointmentServiceSource.indexOf('  async create('),
  appointmentServiceSource.indexOf('  async replacePendingDepositServices(')
)
const overlapCheck = appointmentServiceSource.slice(
  appointmentServiceSource.indexOf('  private async hasAppointmentOverlap('),
  appointmentServiceSource.indexOf('  private async professionalOffersService(')
)

assert.match(
  singleBooking,
  /const \[business, weexAuth\] = await Promise\.all/,
  'la carga del negocio y la sesión debe resolverse en paralelo'
)
assert.match(
  singleBooking,
  /const \[professionals, customer\] = await Promise\.all/,
  'la validación del profesional y la resolución del cliente deben compartir la misma espera'
)
assert.match(
  singleBooking,
  /appointmentService\.createPublicBooking\(/,
  'la reserva web simple debe usar el camino transaccional sin repetir el preflight genérico'
)
assert.doesNotMatch(
  singleBooking,
  /appointmentService\.create\(/,
  'la reserva web simple no debe ejecutar la carga y validación previa del flujo genérico'
)
assert.doesNotMatch(
  singleBooking,
  /prisma\.bookingDeposit\.create|appointmentService\.cancel\(/,
  'el turno y su seña deben persistirse juntos, sin escritura separada ni compensación'
)
assert.match(
  singleBooking,
  /request\.log\.info\([\s\S]*public_booking_confirmation_timing/,
  'la confirmación debe registrar tiempos por etapa para verificar la mejora en producción'
)
assert.doesNotMatch(
  singleBooking,
  /prisma\.appointment\.findUnique/,
  'la confirmación simple no debe releer el turno que acaba de crear'
)
assert.match(
  singleBooking,
  /const appointment = \{[\s\S]*\.\.\.result\.appointment,[\s\S]*service,[\s\S]*professional,[\s\S]*customer/,
  'la respuesta debe reutilizar los datos ya validados en memoria'
)
assert.match(
  singleBooking,
  /if \(deposit\) \{[\s\S]*void linkExistingCustomersByPhone\([\s\S]*\.catch/,
  'con seña, la vinculación histórica de clientes debe continuar fuera del camino crítico'
)
assert.match(
  singleBooking,
  /else \{[\s\S]*await linkExistingCustomersByPhone/,
  'sin seña, la vinculación debe conservarse antes de mostrar la confirmación final'
)
assert.ok(
  singleBooking.indexOf('deposit = await prisma.bookingDeposit.create') <
    singleBooking.indexOf('void linkExistingCustomersByPhone'),
  'la seña debe crearse antes de iniciar trabajo secundario'
)

assert.match(
  coordinatedBooking,
  /const \[business, weexAuth\] = await Promise\.all/,
  'la reserva coordinada también debe cargar negocio y sesión en paralelo'
)
assert.match(
  coordinatedBooking,
  /if \(deposit\) \{[\s\S]*void linkExistingCustomersByPhone\([\s\S]*\.catch/,
  'la reserva coordinada con seña tampoco debe esperar la vinculación histórica'
)
assert.match(
  coordinatedBooking,
  /else \{[\s\S]*await linkExistingCustomersByPhone/,
  'la reserva coordinada sin seña debe conservar la vinculación previa a la confirmación final'
)
assert.doesNotMatch(
  appointmentCreate,
  /bookingDepositService\.expireOverdue/,
  'crear un turno no debe ejecutar mantenimiento global de señas antes de responder'
)
assert.match(
  overlapCheck,
  /NOT:[\s\S]*status: 'PENDING'[\s\S]*bookingDeposit:[\s\S]*status: 'PENDING_PROOF'[\s\S]*expiresAt: \{ lte: now \}/,
  'la validación previa debe ignorar retenciones vencidas sin mutar datos globales'
)

console.log('OK: las reservas web con seña difieren trabajo secundario y la simple evita una relectura.')
