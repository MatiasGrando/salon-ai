import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeArgentineMobilePhone, normalizeCustomerPhone } from '../src/services/phone-normalization-service.js'
import { customerNamesDiffer, normalizeCustomerEmail } from '../src/services/customer-identity-service.js'

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
assert.equal(normalizeCustomerEmail(' Cliente@Email.COM '), 'cliente@email.com', 'el correo debe normalizarse')
assert.equal(normalizeCustomerEmail(''), null, 'el correo opcional debe poder quitarse')
assert.throws(() => normalizeCustomerEmail('correo-invalido'), /correo electronico valido/, 'un correo invalido debe rechazarse')

const customersByBusinessAndPhone = new Map<string, { id: string; name: string; businessId: string }>()
const appointments: Array<{ customerId: string; businessId: string }> = []
function simulateNewCustomerAppointment(businessId: string, name: string, phone: string, defaultAreaCode = '11') {
  const normalized = normalizeCustomerPhone(phone, { defaultAreaCode })
  assert.equal(normalized.ok, true)
  if (!normalized.ok) throw new Error('El telefono de prueba debe ser valido')
  const identityKey = businessId + ':' + normalized.phone
  let customer = customersByBusinessAndPhone.get(identityKey)
  if (!customer) {
    customer = { id: `customer-${customersByBusinessAndPhone.size + 1}`, name, businessId }
    customersByBusinessAndPhone.set(identityKey, customer)
  }
  appointments.push({ customerId: customer.id, businessId })
  return customer
}

const first = simulateNewCustomerAppointment('business-a', 'Tamara', '11 1234-5678')
const second = simulateNewCustomerAppointment('business-a', 'Nombre equivocado', '+54 9 11 1234-5678')
assert.equal(first.id, second.id, 'dos turnos del mismo local y teléfono deben apuntar a la misma ficha')
assert.equal(second.name, 'Tamara', 'el segundo alta del local no debe renombrar silenciosamente al cliente')
assert.equal(customersByBusinessAndPhone.size, 1, 'no debe crearse un segundo cliente dentro del mismo local')

const samePhoneOtherBusiness = simulateNewCustomerAppointment('business-b', 'Otra ficha local', '11 1234-5678')
assert.notEqual(samePhoneOtherBusiness.id, first.id, 'el mismo teléfono en otro local debe crear una ficha independiente')
assert.equal(customersByBusinessAndPhone.size, 2, 'cada local debe conservar su propia identidad de cliente')
assert.equal(appointments.length, 3, 'los turnos de ambos locales pueden existir')

const anotherAreaCode = simulateNewCustomerAppointment('business-a', 'Otra persona', '351 123-4567', '351')
assert.notEqual(anotherAreaCode.id, first.id, 'dos números nacionales con distinta característica pertenecen a identidades diferentes')

const service = readFileSync(new URL('../src/services/customer-identity-service.ts', import.meta.url), 'utf8')
assert.ok(service.includes('pg_advisory_xact_lock'), 'las altas concurrentes deben serializarse por teléfono')
assert.equal(service.includes('SELECT pg_advisory_xact_lock'), false, 'Prisma no debe intentar deserializar el valor void del bloqueo')
assert.equal((service.match(/SELECT 1 AS "locked"/g) || []).length, 2, 'creación y edición deben devolver un entero compatible desde el bloqueo')
assert.ok(service.includes('const lockKey = `${businessId}:${canonicalPhone}`'), 'el bloqueo concurrente debe estar aislado por local y teléfono')
assert.ok((service.match(/businessId,/g) || []).length >= 4, 'las búsquedas y altas deben incluir el local')
assert.ok(service.includes('WHERE "businessId" = ${businessId}'), 'la búsqueda compatible por dígitos debe limitarse al local')
assert.ok(service.includes('normalizedPhone: canonicalPhone'), 'la identidad canónica debe persistirse')
assert.ok(service.includes('data: { businessId, name, phone: canonicalPhone'), 'una ficha nueva debe guardar su local')
assert.ok(service.includes('customerMarketingPreference.upsert'), 'reutilizar un cliente local debe conservar la preferencia del negocio')
assert.ok(service.includes('defaultAreaCodeForBusiness'), 'los números locales deben usar la característica del local')
assert.ok(service.includes('...(email && !customer.email ? { email } : {})'), 'el correo web debe completar una ficha existente sin pisar otro correo')
assert.ok(service.includes('updateCustomerIdentity'), 'la edición debe pasar por la identidad normalizada')
assert.ok(service.includes('CustomerPhoneConflictError'), 'editar hacia un teléfono ocupado debe bloquearse')
assert.ok(service.includes('id: { not: input.customerId }'), 'la edición no debe confundirse consigo misma')

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.ok(schema.includes('businessId      String?'), 'la ficha debe declarar el local propietario')
assert.ok(schema.includes('@@unique([businessId, normalizedPhone])'), 'la base debe impedir teléfonos duplicados solo dentro del mismo local')
assert.equal(schema.includes('normalizedPhone String? @unique'), false, 'el teléfono no debe ser único globalmente')
assert.match(schema, /\bemail\s+String\?(?:\s|$)/, 'la ficha de cliente debe guardar un correo opcional')

const migration = readFileSync(new URL('../prisma/migrations/20260814160000_scope_customers_by_business/migration.sql', import.meta.url), 'utf8')
assert.ok(migration.includes('CREATE TEMP TABLE "_CustomerBusinessTarget"'), 'la migración debe mapear cada ficha y local antes de reasignar relaciones')
assert.ok(migration.includes('target."position" > 1'), 'solo las fichas compartidas deben generar copias')
assert.ok(migration.includes('BEGIN;') && migration.includes('COMMIT;'), 'la separación debe ejecutarse de forma transaccional')
assert.ok(migration.includes('Customer_businessId_normalizedPhone_key'), 'la migración debe instalar la nueva unicidad compuesta')
assert.ok(migration.includes('Notes have no legacy businessId'), 'las notas ambiguas no deben copiarse entre locales')

const customerRoute = readFileSync(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')
assert.ok(customerRoute.includes('findOrCreateCustomerByPhone'), 'el alta manual debe reutilizar la identidad central')
assert.ok(customerRoute.includes('updateCustomerIdentity'), 'la edición de teléfono debe usar la validación central')
assert.ok(customerRoute.includes('where: { businessId }'), 'los listados deben consultar clientes del local actual')
assert.ok(customerRoute.includes('reply.status(409)'), 'una colisión de teléfono debe responder conflicto')

const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.ok(crmUi.includes("customerId = customer.id"), 'el turno manual debe usar el id de la ficha reutilizada')
assert.ok(crmUi.includes("customer.wasExisting"), 'el operador debe ser informado cuando se reutiliza una ficha')
assert.ok(crmUi.includes('data-edit-customer'), 'la ficha de escritorio debe mostrar Editar cliente')
assert.ok(crmUi.includes('data-mobile-edit-customer'), 'la ficha móvil debe mostrar Editar cliente')
assert.ok(crmUi.includes('els.customerPhoneField.hidden = isNote'), 'el teléfono debe mostrarse al editar')
assert.ok(crmUi.includes('els.customerEmailField.hidden = isNote'), 'el correo debe mostrarse al crear o editar')
assert.ok(crmUi.includes('JSON.stringify({ name: value, phone, email, businessId: state.businessId })'), 'nombre, teléfono y correo deben enviarse juntos')

for (const file of ['conversation-service.ts', 'booking-conversation-flow.ts']) {
  const source = readFileSync(new URL(`../src/services/${file}`, import.meta.url), 'utf8')
  assert.ok(source.includes('findOrCreateCustomerByPhone'), `${file} debe reutilizar la identidad central`)
  assert.ok(source.includes('if (!businessId)'), `${file} no debe crear una ficha sin local`)
}

const appointmentService = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
assert.ok(appointmentService.includes('customer.businessId !== professional.businessId'), 'un turno debe rechazar clientes de otro local')

const campaignRoute = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
assert.ok(campaignRoute.includes('id: customerId, businessId: campaign.businessId'), 'una campaña no debe aceptar un cliente de otro local')
assert.ok(campaignRoute.includes('where: { id: { in: uniqueCustomerIds }, businessId }'), 'los destinatarios manuales deben filtrarse por local')

const whatsappWebhook = readFileSync(new URL('../src/services/whatsapp-webhook-service.ts', import.meta.url), 'utf8')
assert.ok(whatsappWebhook.includes('where: { businessId: input.businessId }'), 'la baja de marketing debe buscar la ficha del local receptor')

const publicBooking = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
assert.ok(publicBooking.includes('findOrCreateCustomerByPhone'), 'la reserva pública debe reutilizar la identidad central')
assert.ok(publicBooking.includes('weexAuth?.account.emailVerified ? weexAuth.account.email : null'), 'la reserva pública debe copiar solo correos verificados')

const weexAccount = readFileSync(new URL('../src/services/weex-account-service.ts', import.meta.url), 'utf8')
assert.ok(weexAccount.includes('email: account.email.trim().toLowerCase()'), 'vincular una cuenta por teléfono debe completar el correo del cliente')
assert.ok(weexAccount.includes('email: null'), 'la vinculación no debe sobrescribir un correo ya cargado')

console.log('Customer phone identity contract: OK (formato, aislamiento por local, migración, concurrencia y canales)')
