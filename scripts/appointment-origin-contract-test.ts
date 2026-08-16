import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schema, migration, appointmentRoute, publicBooking, conversationService, internalProvider, ui] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260816210000_add_appointment_origin/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/public-booking.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/providers/internal-booking-provider.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
])

assert.match(schema, /enum AppointmentOrigin\s*{[\s\S]*BOT[\s\S]*WEB[\s\S]*MANUAL[\s\S]*UNKNOWN[\s\S]*}/)
assert.match(schema, /origin\s+AppointmentOrigin\s+@default\(UNKNOWN\)/)
assert.match(migration, /CREATE TYPE "AppointmentOrigin" AS ENUM \('BOT', 'WEB', 'MANUAL', 'UNKNOWN'\)/)
assert.match(migration, /deposit\."source" = 'WEB'/)
assert.match(migration, /deposit\."source" = 'WHATSAPP'/)
assert.match(migration, /conversation\."opportunityAppointmentId" = appointment\."id"/)

assert.match(appointmentRoute, /origin: 'MANUAL'/)
assert.equal((publicBooking.match(/origin: 'WEB'/g) || []).length, 2)
assert.equal((conversationService.match(/origin: 'BOT'/g) || []).length, 2)
assert.match(internalProvider, /origin: 'BOT'/)

for (const [code, label] of [
  ['B', 'Bot de WhatsApp'],
  ['W', 'Sitio web'],
  ['M', 'Carga manual'],
  ['\\?', 'Origen anterior sin identificar']
]) {
  assert.match(ui, new RegExp(`code: '${code}'.*label: '${label}'`))
}
assert.match(ui, /appointmentOriginBadgeHtml\(origin\)/)
assert.match(ui, /id="appointment-origin-row" hidden/)
assert.match(ui, /appointmentOriginLabel\.textContent = origin\.label/)

console.log('Appointment origin contract: OK')
