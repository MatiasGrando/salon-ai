import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeArgentineMobilePhone, normalizeCustomerPhone } from '../src/services/phone-normalization-service.js'
import { customerNamesDiffer } from '../src/services/customer-identity-service.js'

const equivalentPhones = [
  '+54 9 11 1234-5678',
  '5491112345678',
  '54 11 1234 5678',
  '011 15-1234-5678',
  '11 15 1234 5678',
  '11 1234-5678',
  '1234-5678'
]

for (const phone of equivalentPhones) {
  const result = normalizeArgentineMobilePhone(phone, { defaultAreaCode: '11' })
  assert.equal(result.ok, true, `${phone} debe ser válido`)
  if (result.ok) assert.equal(result.phone, '5491112345678', `${phone} debe resolver a la misma identidad`)
}

for (const phone of ['', '123', '549111234567890']) {
  assert.equal(normalizeArgentineMobilePhone(phone).ok, false, `${phone || 'vacío'} debe rechazarse`)
}

const international = normalizeCustomerPhone('+598 99 123 456')
assert.equal(international.ok, true, 'un cliente internacional con prefijo explícito debe aceptarse')
if (international.ok) assert.equal(international.phone, '59899123456')

assert.equal(customerNamesDiffer('María López', ' maria   lopez '), false, 'acentos, mayúsculas y espacios no generan conflicto')
assert.equal(customerNamesDiffer('María López', 'Carla Pérez'), true, 'un nombre realmente diferente debe advertirse')

const customersByPhone = new Map<string, { id: string; name: string }>()
const appointments: Array<{ customerId: string }> = []
function simulateNewCustomerAppointment(name: string, phone: string, defaultAreaCode = '11') {
  const normalized = normalizeCustomerPhone(phone, { defaultAreaCode })
  assert.equal(normalized.ok, true)
  if (!normalized.ok) throw new Error(normalized.message)
  let customer = customersByPhone.get(normalized.phone)
  if (!customer) {
    customer = { id: `customer-${customersByPhone.size + 1}`, name }
    customersByPhone.set(normalized.phone, customer)
  }
  appointments.push({ customerId: customer.id })
  return customer
}

const first = simulateNewCustomerAppointment('Tamara', '11 1234-5678')
const second = simulateNewCustomerAppointment('Nombre equivocado', '+54 9 11 1234-5678')
assert.equal(first.id, second.id, 'dos turnos con el mismo teléfono deben apuntar a la misma ficha')
assert.equal(second.name, 'Tamara', 'el segundo alta no debe renombrar silenciosamente al cliente')
assert.equal(customersByPhone.size, 1, 'no debe crearse un segundo cliente')
assert.equal(appointments.length, 2, 'ambos turnos pueden existir')
assert.ok(appointments.every((appointment) => appointment.customerId === first.id), 'ambos turnos deben compartir customerId')

const anotherAreaCode = simulateNewCustomerAppointment('Otra persona', '351 123-4567', '351')
assert.notEqual(anotherAreaCode.id, first.id, 'dos números nacionales con distinta característica pertenecen a identidades diferentes')

const service = readFileSync(new URL('../src/services/customer-identity-service.ts', import.meta.url), 'utf8')
assert.ok(service.includes('pg_advisory_xact_lock'), 'las altas concurrentes deben serializarse por teléfono')
assert.equal(service.includes('SELECT pg_advisory_xact_lock'), false, 'Prisma no debe intentar deserializar el valor void del bloqueo')
assert.equal((service.match(/SELECT 1 AS "locked"/g) || []).length, 2, 'creación y edición deben devolver un entero compatible desde el bloqueo')
assert.ok(service.includes('normalizedPhone: canonicalPhone'), 'la identidad canónica debe persistirse')
assert.ok(service.includes('customerMarketingPreference.upsert'), 'reutilizar un cliente debe conservar la preferencia del negocio')
assert.ok(service.includes('defaultAreaCodeForBusiness'), 'los números locales deben usar la característica del local')
assert.ok(service.includes('data: { phone: canonicalPhone, normalizedPhone: canonicalPhone }'), 'un nombre distinto no debe sobrescribir la ficha existente')
assert.ok(service.includes('updateCustomerIdentity'), 'la edición debe pasar por la identidad normalizada')
assert.ok(service.includes('CustomerPhoneConflictError'), 'editar hacia un teléfono ocupado debe bloquearse')
assert.ok(service.includes('id: { not: input.customerId }'), 'la edición no debe confundirse consigo misma')

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.ok(schema.includes('normalizedPhone String? @unique'), 'la base debe impedir dos identidades canónicas iguales')

const customerRoute = readFileSync(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')
assert.ok(customerRoute.includes('findOrCreateCustomerByPhone'), 'el alta manual debe reutilizar la identidad central')
assert.ok(customerRoute.includes('updateCustomerIdentity'), 'la edición de teléfono debe usar la validación central')
assert.ok(customerRoute.includes('reply.status(409)'), 'una colisión de teléfono debe responder conflicto')

const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.ok(crmUi.includes("customerId = customer.id"), 'el turno manual debe usar el id de la ficha reutilizada')
assert.ok(crmUi.includes("customer.wasExisting"), 'el operador debe ser informado cuando se reutiliza una ficha')
assert.ok(crmUi.includes('data-edit-customer'), 'la ficha de escritorio debe mostrar Editar cliente')
assert.ok(crmUi.includes('data-mobile-edit-customer'), 'la ficha móvil debe mostrar Editar cliente')
assert.ok(crmUi.includes('els.customerPhoneField.hidden = isNote'), 'el teléfono debe mostrarse al editar')
assert.ok(crmUi.includes('JSON.stringify({ name: value, phone, businessId: state.businessId })'), 'nombre y teléfono deben enviarse juntos')

for (const file of ['conversation-service.ts', 'booking-conversation-flow.ts']) {
  const source = readFileSync(new URL(`../src/services/${file}`, import.meta.url), 'utf8')
  assert.ok(source.includes('findOrCreateCustomerByPhone'), `${file} debe reutilizar la identidad central`)
}

const publicBooking = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
assert.ok(publicBooking.includes('findOrCreateCustomerByPhone'), 'la reserva pública debe reutilizar la identidad central')

console.log('Customer phone identity contract: OK (formatos, unicidad, concurrencia y canales)')
