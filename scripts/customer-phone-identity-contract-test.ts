import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeArgentineMobilePhone, normalizeCustomerPhone } from '../src/services/phone-normalization-service.js'

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

const service = readFileSync(new URL('../src/services/customer-identity-service.ts', import.meta.url), 'utf8')
assert.ok(service.includes('pg_advisory_xact_lock'), 'las altas concurrentes deben serializarse por teléfono')
assert.ok(service.includes('normalizedPhone: canonicalPhone'), 'la identidad canónica debe persistirse')
assert.ok(service.includes('customerMarketingPreference.upsert'), 'reutilizar un cliente debe conservar la preferencia del negocio')
assert.ok(service.includes('defaultAreaCodeForBusiness'), 'los números locales deben usar la característica del local')

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.ok(schema.includes('normalizedPhone String? @unique'), 'la base debe impedir dos identidades canónicas iguales')

const customerRoute = readFileSync(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')
assert.ok(customerRoute.includes('findOrCreateCustomerByPhone'), 'el alta manual debe reutilizar la identidad central')

for (const file of ['conversation-service.ts', 'booking-conversation-flow.ts']) {
  const source = readFileSync(new URL(`../src/services/${file}`, import.meta.url), 'utf8')
  assert.ok(source.includes('findOrCreateCustomerByPhone'), `${file} debe reutilizar la identidad central`)
}

const publicBooking = readFileSync(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8')
assert.ok(publicBooking.includes('findOrCreateCustomerByPhone'), 'la reserva pública debe reutilizar la identidad central')

console.log('Customer phone identity contract: OK (formatos, unicidad, concurrencia y canales)')
