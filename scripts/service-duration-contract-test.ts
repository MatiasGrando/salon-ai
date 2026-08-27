import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  customerDurationRange,
  formatCustomerDuration,
  normalizeCustomerDuration,
  reservationDurationLimits,
  reservationFitsAvailabilityWindow
} from '../src/services/service-duration.js'

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

const colorService = { duration: 60, customerDurationMin: 120, customerDurationMax: 120 }
assert.deepEqual(reservationDurationLimits(colorService), { professional: 60, business: 120 })
assert.equal(reservationFitsAvailabilityWindow({
  service: colorService,
  startMinutes: 14 * 60,
  professionalEndMinutes: 15 * 60,
  businessEndMinutes: 16 * 60
}), true)
assert.equal(reservationFitsAvailabilityWindow({
  service: colorService,
  startMinutes: 14 * 60 + 30,
  professionalEndMinutes: 15 * 60,
  businessEndMinutes: 16 * 60
}), false)
assert.equal(reservationFitsAvailabilityWindow({
  service: colorService,
  startMinutes: 19 * 60,
  professionalEndMinutes: 20 * 60,
  businessEndMinutes: 20 * 60
}), false)

const appointmentSource = await readFile('src/services/appointment-service.ts', 'utf8')
assert.equal(
  appointmentSource.match(/const professionalEndAt = addMinutes\(startAt, professionalDuration\)/g)?.length,
  2
)
assert.ok((appointmentSource.match(/endAt: customerEndAt/g)?.length ?? 0) >= 2)
assert.ok((appointmentSource.match(/endAt: professionalEndAt/g)?.length ?? 0) >= 6)
assert.match(
  appointmentSource,
  /totalDurationMinutes: validation\.professionalDuration/
)
assert.match(appointmentSource, /total \+ reservationDurationLimits\(service\)\.professional/)

const crmSource = await readFile('src/routes/crm-ui.ts', 'utf8')
assert.match(crmSource, /Duraci&oacute;n en agenda/)
assert.match(crmSource, /service-customer-duration-different/)
assert.match(crmSource, /La agenda seguir&aacute; usando el tiempo operativo/)

const publicBookingSource = await readFile('src/routes/public-booking.ts', 'utf8')
assert.match(publicBookingSource, /displayDuration: formatCustomerDuration\(service\)/)

const knowledgeSource = await readFile('src/services/business-knowledge-service.ts', 'utf8')
assert.match(knowledgeSource, /Duración: \$\{formatCustomerDuration\(service\)\}/)

const postSaleSource = await readFile('src/services/post-sale-service.ts', 'utf8')
assert.match(postSaleSource, /customerDurationRange\(appointment\.service\)\.max/)

console.log('OK: agenda usa el tiempo operativo y el cierre contempla la duración máxima del cliente.')
