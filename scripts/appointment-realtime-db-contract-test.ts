import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { dispatchAppointmentDatabaseNotification } from '../src/services/appointment-realtime-listener.js'
import { subscribeToCrmRealtimeEvents } from '../src/services/crm-realtime-events.js'

const migrationSource = readFileSync(
  new URL('../prisma/migrations/20260903210000_add_appointment_realtime_notifications/migration.sql', import.meta.url),
  'utf8'
)
const appointmentServiceSource = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
const bookingOperationsSource = readFileSync(new URL('../src/services/booking-operations.ts', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const crmUiSource = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(migrationSource, /AFTER INSERT OR UPDATE OR DELETE ON "Appointment"/)
assert.match(migrationSource, /professional_id := COALESCE\(NEW\."professionalId", OLD\."professionalId"\)/)
assert.match(migrationSource, /SELECT "businessId"[\s\S]*?FROM "Professional"/)
assert.match(migrationSource, /pg_notify\(\s*'appointment_changed'/)
assert.match(bookingOperationsSource, /INSERT INTO "Appointment"/, 'el writer SQL del bot debe quedar cubierto por el trigger')
assert.doesNotMatch(appointmentServiceSource, /publishAppointmentChanged\(/, 'el servicio no debe duplicar el evento del trigger')
assert.match(serverSource, /startAppointmentRealtimeListener\(/, 'cada replica debe iniciar un listener dedicado')
assert.match(serverSource, /appointmentRealtimeListener\.stop\(\)/, 'el listener debe cerrarse con la app')
assert.match(
  crmUiSource,
  /source\.addEventListener\('open',[\s\S]*?queueAgendaRealtimeRefresh\(\)/,
  'al reconectar SSE debe reconciliar la Agenda visible'
)
assert.match(
  crmUiSource,
  /function startCrmRealtimeFallback[\s\S]*?currentSection === 'agenda'\) queueAgendaRealtimeRefresh\(\)/,
  'el sondeo de respaldo debe refrescar Agenda solo mientras SSE esta desconectado y Agenda visible'
)

const dispatched: Array<{ businessId: string; appointmentId: string; updatedAt: string }> = []
assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify({
  businessId: 'tenant-a', appointmentId: 'appointment-a', updatedAt: '2026-09-03T21:00:00.000Z'
}), (event) => dispatched.push(event)), true)
assert.equal(dispatchAppointmentDatabaseNotification('{bad-json', (event) => dispatched.push(event)), false)
assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify({
  businessId: '', appointmentId: 'appointment-b', updatedAt: '2026-09-03T21:00:00.000Z'
}), (event) => dispatched.push(event)), false)
assert.deepEqual(dispatched.map(({ businessId, appointmentId }) => ({ businessId, appointmentId })), [
  { businessId: 'tenant-a', appointmentId: 'appointment-a' }
])

const fanoutA: string[] = []
const fanoutB: string[] = []
const unsubscribeA = subscribeToCrmRealtimeEvents({
  businessId: 'tenant-a',
  send: (event) => { if (event.type === 'appointment_changed') fanoutA.push(event.appointmentId) }
})
const unsubscribeB = subscribeToCrmRealtimeEvents({
  businessId: 'tenant-b',
  send: (event) => { if (event.type === 'appointment_changed') fanoutB.push(event.appointmentId) }
})
dispatchAppointmentDatabaseNotification(JSON.stringify({
  businessId: 'tenant-a', appointmentId: 'appointment-fanout', updatedAt: '2026-09-03T21:00:00.000Z'
}))
assert.deepEqual(fanoutA, ['appointment-fanout'])
assert.deepEqual(fanoutB, [], 'el fan-out SSE nunca debe cruzar tenants')
unsubscribeA()
unsubscribeB()

// PostgreSQL delivers NOTIFY only at commit. PGlite exercises the migration's
// trigger semantics without touching any configured/shared database.
const db = new PGlite()
try {
  await db.exec(`
    CREATE TABLE "Professional" ("id" text PRIMARY KEY, "businessId" text NOT NULL);
    CREATE TABLE "Appointment" ("id" text PRIMARY KEY, "professionalId" text NOT NULL);
    ${migrationSource}
  `)
  await db.query(`INSERT INTO "Professional" ("id", "businessId") VALUES ('pro-a', 'tenant-a'), ('pro-b', 'tenant-b')`)
  const received: string[] = []
  const unlisten = await db.listen('appointment_changed', (payload) => received.push(payload))

  await db.exec(`BEGIN; INSERT INTO "Appointment" VALUES ('appointment-insert', 'pro-a');`)
  assert.deepEqual(received, [], 'INSERT no debe notificarse antes del commit')
  await db.exec('COMMIT;')
  assert.equal(JSON.parse(received.at(-1)!).businessId, 'tenant-a')

  await db.exec(`BEGIN; UPDATE "Appointment" SET "professionalId" = 'pro-b' WHERE "id" = 'appointment-insert'; ROLLBACK;`)
  assert.equal(received.length, 1, 'un UPDATE revertido no debe notificarse')

  await db.exec(`UPDATE "Appointment" SET "professionalId" = 'pro-b' WHERE "id" = 'appointment-insert';`)
  assert.equal(JSON.parse(received.at(-1)!).businessId, 'tenant-b')

  await db.exec(`DELETE FROM "Appointment" WHERE "id" = 'appointment-insert';`)
  const deleted = JSON.parse(received.at(-1)!)
  assert.equal(deleted.appointmentId, 'appointment-insert')
  assert.equal(deleted.businessId, 'tenant-b')
  await unlisten()
} finally {
  await db.close()
}

console.log('Appointment database realtime contract: OK')
