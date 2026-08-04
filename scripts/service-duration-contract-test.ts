import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { customerDurationRange, formatCustomerDuration, normalizeCustomerDuration } from '../src/services/service-duration.js'

const inherited = customerDurationRange({ duration: 60 })
assert.deepEqual(inherited, { min: 60, max: 60, differsFromAgenda: false })
assert.equal(formatCustomerDuration({ duration: 60 }), '60 min')

const exact = customerDurationRange({
  duration: 60,
  customerDurationMin: 120,
  customerDurationMax: 120
})
assert.deepEqual(exact, { min: 120, max: 120, differsFromAgenda: true })
assert.equal(formatCustomerDuration({ duration: 60, customerDurationMin: 120 }), '120 min')
assert.equal(formatCustomerDuration({
  duration: 60,
  customerDurationMin: 90,
  customerDurationMax: 120
}), '90 a 120 min')

assert.deepEqual(normalizeCustomerDuration(null, null), { ok: true, min: null, max: null })
assert.deepEqual(normalizeCustomerDuration('120', ''), { ok: true, min: 120, max: 120 })
assert.equal(normalizeCustomerDuration(0, 120).ok, false)
assert.equal(normalizeCustomerDuration(120, 90).ok, false)
assert.equal(normalizeCustomerDuration(90.5, 120).ok, false)

const appointmentSource = await readFile('src/services/appointment-service.ts', 'utf8')
assert.match(appointmentSource, /addMinutes\(startAt, service\.duration\)/)
assert.match(appointmentSource, /slotStartMinutes \+ service\.duration <= window\.end/)
assert.doesNotMatch(appointmentSource, /customerDuration/)

const crmSource = await readFile('src/routes/crm-ui.ts', 'utf8')
assert.match(crmSource, /Tiempo que bloquea la agenda/)
assert.match(crmSource, /service-customer-duration-different/)
assert.match(crmSource, /La agenda seguir&aacute; usando el tiempo operativo/)

const publicBookingSource = await readFile('src/routes/public-booking.ts', 'utf8')
assert.match(publicBookingSource, /displayDuration: formatCustomerDuration\(service\)/)

const rendererSource = await readFile('src/services/booking-v2-response-renderer.ts', 'utf8')
assert.match(rendererSource, /formatCustomerDuration\(service\)/)

const postSaleSource = await readFile('src/services/post-sale-service.ts', 'utf8')
assert.match(postSaleSource, /customerDurationRange\(appointment\.service\)\.max/)

console.log('OK: agenda conserva el tiempo operativo y los canales al cliente usan la duración real configurada.')
