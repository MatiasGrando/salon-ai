import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeAppointmentNotes } from '../src/services/appointment-service.js'

const [schema, migration, route, ui, appointmentService] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260822120000_add_appointment_notes/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
])

assert.match(schema, /notes\s+String\?/)
assert.match(migration, /ADD COLUMN "notes" TEXT/)
assert.match(route, /notes: body\.notes/)
assert.match(appointmentService, /notes: notes\.value/)
assert.match(appointmentService, /notes\?\.ok \? \{ notes: notes\.value \}/)

assert.match(ui, /id="appointment-notes" maxlength="2000"/)
assert.match(ui, /els\.appointmentNotes\.value = appointment\.notes \|\| ''/)
assert.match(ui, /notes: notes \|\| null/)

const desktopEvent = ui.slice(ui.indexOf('function renderAgendaEvents'), ui.indexOf('function enableAgendaDragAndDrop'))
assert.ok(desktopEvent.indexOf("'<strong>' + escapeHtml(service)") < desktopEvent.indexOf("escapeHtml(customer"))
assert.doesNotMatch(desktopEvent, /event\.innerHTML = '<strong>' \+ escapeHtml\(formatTimeOnly/)

const mobileEvent = ui.slice(ui.indexOf('function renderAgendaMobileEvent'), ui.indexOf('function agendaDepositIndicator'))
assert.ok(mobileEvent.indexOf("'<strong>' + escapeHtml(service)") < mobileEvent.indexOf("escapeHtml(customer"))

assert.deepEqual(normalizeAppointmentNotes(undefined), { ok: true, value: null })
assert.deepEqual(normalizeAppointmentNotes('  Indicacion especial  '), { ok: true, value: 'Indicacion especial' })
assert.deepEqual(normalizeAppointmentNotes('   '), { ok: true, value: null })
assert.equal(normalizeAppointmentNotes('x'.repeat(2001)).ok, false)
assert.equal(normalizeAppointmentNotes({} as never).ok, false)

console.log('Appointment notes and service-first display contract: OK')
