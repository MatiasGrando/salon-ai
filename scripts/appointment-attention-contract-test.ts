import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeAppointmentAttentionColor } from '../src/services/appointment-service.js'

const [schema, migration, route, service, ui] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260904150000_add_appointment_attention_color/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
])

assert.match(schema, /enum AppointmentAttentionColor\s*{[\s\S]*NONE[\s\S]*YELLOW[\s\S]*ORANGE[\s\S]*}/)
assert.match(schema, /attentionColor\s+AppointmentAttentionColor\s+@default\(NONE\)/)
assert.match(migration, /CREATE TYPE "AppointmentAttentionColor" AS ENUM \('NONE', 'YELLOW', 'ORANGE'\)/)
assert.match(migration, /ADD COLUMN "attentionColor" "AppointmentAttentionColor" NOT NULL DEFAULT 'NONE'/)

assert.match(route, /attentionColor\?: 'NONE' \| 'YELLOW' \| 'ORANGE'/)
assert.match(route, /attentionColor: body\.attentionColor/)
assert.match(service, /normalizeAppointmentAttentionColor/)
assert.match(service, /attentionColor: attentionColor\.value/)

assert.match(ui, /id="appointment-attention-toggle"/)
assert.match(ui, /const canSetAttention = state\.editingAppointmentId\s*\? canEditAppointments\(\)\s*:\s*canCreateAppointments\(\)/)
assert.match(ui, /data-appointment-attention="NONE"/)
assert.match(ui, /data-appointment-attention="YELLOW"/)
assert.match(ui, /data-appointment-attention="ORANGE"/)
assert.match(ui, /attentionColor,/)
assert.match(ui, /agendaAttentionMeta\(appointment\.attentionColor\)/)
assert.match(ui, /agenda-attention-badge[^>]*>Atenci&oacute;n</)
assert.match(ui, /\.agenda-gcal-event\.attention-yellow[\s\S]*background:\s*#fde047/)
assert.match(ui, /\.agenda-gcal-event\.attention-orange[\s\S]*background:\s*#fb923c/)
assert.match(ui, /left\.name\.localeCompare\(right\.name, 'es'/)
const professionalColorFunction = ui.slice(ui.indexOf('function agendaProfessionalColor'), ui.indexOf('function agendaAttentionMeta'))
assert.doesNotMatch(professionalColorFunction, /#f97316|#ef4444|#eab308/)

assert.deepEqual(normalizeAppointmentAttentionColor(undefined), { ok: true, value: 'NONE' })
assert.deepEqual(normalizeAppointmentAttentionColor('YELLOW'), { ok: true, value: 'YELLOW' })
assert.deepEqual(normalizeAppointmentAttentionColor('ORANGE'), { ok: true, value: 'ORANGE' })
assert.equal(normalizeAppointmentAttentionColor('RED').ok, false)

console.log('Appointment attention color contract: OK')
