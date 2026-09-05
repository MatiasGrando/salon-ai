import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const loadAgendaSource = source.slice(
  source.indexOf('async function loadAgenda'),
  source.indexOf('function renderAgenda()')
)
const deleteAppointmentSource = source.slice(
  source.indexOf('async function deleteManualAppointment'),
  source.indexOf('async function toggleManualAppointmentNoShow')
)

assert.match(source, /agendaDeletingAppointmentIds: new Set\(\)/, 'la agenda debe registrar eliminaciones pendientes por turno')
assert.match(loadAgendaSource, /agendaDeletingAppointmentIds\.has\(appointment\.id\)/, 'una recarga no debe reinsertar un turno mientras se elimina')
assert.ok(
  deleteAppointmentSource.indexOf('state.agendaAppointments = state.agendaAppointments.filter') <
    deleteAppointmentSource.indexOf("method: 'DELETE'"),
  'el turno debe desaparecer antes de esperar la respuesta del servidor'
)
assert.ok(
  deleteAppointmentSource.indexOf('closeAppointmentDialog()') <
    deleteAppointmentSource.indexOf("method: 'DELETE'"),
  'el diálogo debe cerrarse antes de esperar la respuesta del servidor'
)
assert.match(deleteAppointmentSource, /Turno eliminado · sincronizando/, 'la eliminación optimista debe tener feedback inmediato')
assert.match(deleteAppointmentSource, /agendaAppointments\.splice\(appointmentIndex, 0, appointment\)/, 'un error debe restaurar el turno en su posición')
assert.match(deleteAppointmentSource, /No se pudo eliminar el turno\. Lo restauramos\./, 'el rollback debe explicarse claramente')
assert.match(deleteAppointmentSource, /void Promise\.allSettled\(refreshes\)/, 'las recargas posteriores no deben bloquear la respuesta visual')

console.log('OK: eliminar un turno es inmediato, resiste recargas intermedias y revierte ante error.')
