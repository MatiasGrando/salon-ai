import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { Client } from 'pg'
import {
  publishCashChanged,
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'
import { dispatchCashDatabaseNotification } from '../src/services/cash-realtime-listener.js'
import { resolveCrmRealtimeBusinessId } from '../src/routes/crm.js'

const migration = readFileSync(new URL('../prisma/migrations/20260906170000_add_cash_realtime_notifications/migration.sql', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const cashRoutes = readFileSync(new URL('../src/routes/cash-register.ts', import.meta.url), 'utf8')
const cashPermissions = readFileSync(new URL('../src/services/staff-permission-service.ts', import.meta.url), 'utf8')

assert.match(migration, /pg_notify\(\s*'cash_changed'/)
assert.match(migration, /AFTER INSERT[\s\S]*?ON "CashEntry"/)
assert.match(migration, /AFTER INSERT OR UPDATE[\s\S]*?ON "CashRegisterDay"/)
assert.match(migration, /AFTER INSERT OR UPDATE[\s\S]*?ON "CashSession"/)
assert.match(migration, /AFTER UPDATE[\s\S]*?ON "AppointmentAccount"/)
assert.match(server, /startCashRealtimeListener/)
const crmRoutes = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
assert.match(crmRoutes, /registerRealtimeRoute\('\/crm\/cash-events', true\)/)
assert.match(crmRoutes, /cashOnly !== \(event\.type === 'cash_changed'\)/, 'cada evento debe viajar por un solo stream SSE')
assert.match(crmRoutes, /resolveCrmRealtimeBusinessId\(request\.auth\?\.user, query\.businessId\)/)
assert.match(shell, /cashRegisterStyles[\s\S]*?cashRegisterMarkup[\s\S]*?appointmentFinanceMarkup[\s\S]*?cashRegisterScript/)
assert.match(ui, /\.app\[data-section="cash"\][^\n]*:not\(\.cash-dialog-backdrop\)/, 'los dialogos de Caja no deben quedar ocultos por el selector de seccion')
assert.match(ui, /\.cash-dialog-backdrop\[hidden\]\s*\{\s*display:\s*none/, 'el atributo hidden debe cerrar explicitamente los dialogos de Caja')
assert.match(ui, /\.cash-dialog-form select\s*\{[^}]*height:\s*42px[^}]*padding:\s*0 36px 0 12px[^}]*line-height:\s*normal/s, 'los selectores de los tres dialogos de Caja deben centrar el texto sin recortarlo')
assert.match(ui, /id="cash-session-help"/, 'el dialogo de sesion debe explicar por que solicita importes de caja')
assert.match(ui, /Solo se usa en la primera apertura/, 'el efectivo inicial debe aclarar que luego se hereda automaticamente')
assert.match(ui, /inheritedOpeningCash[\s\S]*?openingField\.hidden = mode !== 'open' \|\| inheritedOpeningCash !== null/, 'una reapertura no debe volver a pedir un efectivo inicial que el sistema ya hereda')
assert.match(ui, /compararlo con el efectivo esperado/, 'el cierre debe explicar la conciliacion del efectivo contado')
assert.match(ui, /id="cash-session-expected"/, 'el dialogo debe mostrar el efectivo esperado antes de cerrar o cambiar responsable')
assert.match(ui, /id="cash-session-difference"/, 'el dialogo debe calcular y mostrar la diferencia en vivo')
assert.match(ui, /id="cash-difference-confirm"/, 'una diferencia debe requerir confirmacion explicita')
assert.match(ui, /difference !== 0 && !cashUi\.differenceConfirm\.checked/, 'no debe permitirse cerrar una diferencia sin reconocerla')
assert.match(ui, /id="cash-reconciliation"/, 'la jornada cerrada debe destacar su conciliacion')
assert.match(ui, /id="cash-session-history"/, 'la jornada debe mostrar el historial de responsables y diferencias')
assert.match(ui, /countedClosingCash/, 'la vista cerrada y la siguiente apertura deben usar el efectivo contado')
assert.match(ui, /renderCashSummary\(result\.day, result\.summary, result\.sessions/, 'el resumen historico debe renderizar las sesiones conciliadas')
assert.doesNotMatch(ui, /cashDifference[\s\S]{0,220}type:\s*['"]ADJUSTMENT['"]/, 'una diferencia reconocida no debe crear un ajuste automatico')
assert.match(ui, /cashUi\.sessionForm\.reset\(\)/, 'cada apertura del dialogo debe limpiar importes anteriores')
assert.match(shell, /loadCashRegister\(\{ preserve: Boolean\(state\.cashRegister\?\.loaded\) \}\)/, 'volver a Caja debe refrescar sin borrar los datos visibles')
assert.match(ui, /!options\.append && !options\.preserve/, 'el refresco preservado no debe reemplazar movimientos por un estado de carga')
for (const marker of [
  'data-section="cash"', 'cash-register/current', 'cash-register/days', 'cash-register/entries',
  'new-session', "mode === 'close'", 'cash-next-page', 'cash-empty-state',
  'appointment-finance', 'appointments/', 'estimated-total', 'discount', 'payments',
  'Abrir caja'
]) assert.ok(ui.includes(marker), `falta contrato UI: ${marker}`)
assert.ok(ui.includes('cash_changed'), 'la UI debe escuchar cambios financieros')
assert.doesNotMatch(ui, /\b(?:alert|confirm|prompt)\s*\(/)
assert.doesNotMatch(ui, /\.textContent\s*=\s*['"`][^'"`]*&(?:aacute|eacute|iacute|oacute|uacute|ntilde);/, 'textContent debe recibir UTF-8, no entidades visibles')
assert.match(ui, /function returnToAppointmentDraft\([\s\S]*?setSection\('agenda'\)[\s\S]*?appointmentDialog\.hidden = false/, 'cancelar Abrir caja debe restaurar el turno y su borrador')
assert.match(ui, /timeZone:\s*state\.business\?\.timezone/, 'las fechas de Caja deben usar la zona canónica del negocio')
assert.match(ui, /current\.day\?\.id === state\.cashRegister\.selectedDayId[\s\S]*?selectCashDay\(state\.cashRegister\.selectedDayId\)/, 'una jornada histórica debe cargar su propio resumen')
assert.match(cashRoutes, /'\/cash-register\/responsibles'/, 'Caja debe listar responsables activos tenant-scoped')
assert.match(cashPermissions, /path === '\/cash-register\/responsibles'[\s\S]*?canManageCashSessions/, 'administrar sesiones debe permitir consultar responsables sin conceder vista de Caja')

const own: string[] = []
const foreign: string[] = []
const stopOwn = subscribeToCrmRealtimeEvents({ businessId: 'cash-a', send: (event) => { if (event.type === 'cash_changed') own.push(event.entityId) } })
const stopForeign = subscribeToCrmRealtimeEvents({ businessId: 'cash-b', send: (event) => { if (event.type === 'cash_changed') foreign.push(event.entityId) } })
publishCashChanged({ businessId: 'cash-a', entity: 'ENTRY', entityId: 'entry-1', updatedAt: '2026-09-06T12:00:00.000Z' })
assert.deepEqual(own, ['entry-1'])
assert.deepEqual(foreign, [])
stopOwn()
stopForeign()

const dispatched: Array<{ businessId: string; entityId: string }> = []
assert.equal(dispatchCashDatabaseNotification(JSON.stringify({ businessId: 'cash-a', entity: 'SESSION', entityId: 'session-1', updatedAt: '2026-09-06T12:00:00.000Z' }), (event) => dispatched.push(event)), true)
assert.equal(dispatchCashDatabaseNotification(JSON.stringify({ businessId: 'cash-a', entity: 'SESSION' }), () => {}), false)
assert.deepEqual(dispatched.map(({ businessId, entityId }) => ({ businessId, entityId })), [{ businessId: 'cash-a', entityId: 'session-1' }])

const tenantApp = Fastify()
tenantApp.addHook('preHandler', async (request) => {
  const role = String(request.headers['x-role'] ?? 'STAFF')
  request.auth = { user: { role, businessId: request.headers['x-business'] ? String(request.headers['x-business']) : null } as never }
})
tenantApp.get('/crm/cash-events', async (request, reply) => {
  const query = request.query as { businessId?: string }
  const businessId = resolveCrmRealtimeBusinessId(request.auth?.user, query.businessId)
  return businessId ? { businessId } : reply.status(400).send({ code: 'BUSINESS_REQUIRED' })
})
assert.deepEqual((await tenantApp.inject({ method: 'GET', url: '/crm/cash-events?businessId=foreign', headers: { 'x-role': 'BUSINESS_ADMIN', 'x-business': 'own-admin' } })).json(), { businessId: 'own-admin' })
assert.deepEqual((await tenantApp.inject({ method: 'GET', url: '/crm/cash-events?businessId=foreign', headers: { 'x-role': 'STAFF', 'x-business': 'own-staff' } })).json(), { businessId: 'own-staff' })
assert.deepEqual((await tenantApp.inject({ method: 'GET', url: '/crm/cash-events?businessId=foreign', headers: { 'x-role': 'SUPER_ADMIN' } })).json(), { businessId: 'foreign' })
assert.equal((await tenantApp.inject({ method: 'GET', url: '/crm/cash-events', headers: { 'x-role': 'SUPER_ADMIN' } })).statusCode, 400)
await tenantApp.close()

const connectionString = process.env.TEST_DATABASE_URL
if (!connectionString) {
  console.log('OK Caja realtime/UI static: tenant, listener, navegación, sesiones, operaciones y Agenda. SKIP PG: falta TEST_DATABASE_URL.')
  process.exit(0)
}
if (!/(?:test|testing|contract)/i.test(new URL(connectionString).pathname)) {
  throw new Error('Refusing unsafe Caja realtime database: TEST_DATABASE_URL debe apuntar a una base de prueba')
}

const listener = new Client({ connectionString })
const writer = new Client({ connectionString })
await listener.connect()
await writer.connect()
try {
  await listener.query('LISTEN cash_changed')
  const notifications: string[] = []
  listener.on('notification', (message) => { if (message.channel === 'cash_changed' && message.payload) notifications.push(message.payload) })
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const businessId = `cash-rt-${suffix}`
  const dayId = `cash-day-${suffix}`
  await writer.query('BEGIN')
  await writer.query('INSERT INTO "Business" ("id", "customerCode", "name", "timezone") VALUES ($1,$2,$3,$4)', [businessId, `CRT-${suffix}`, 'Caja realtime', 'UTC'])
  await writer.query('INSERT INTO "CashRegisterDay" ("id","businessId","openedAt","openingCash") VALUES ($1,$2,clock_timestamp(),0)', [dayId, businessId])
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(notifications.length, 0, 'NOTIFY no debe ser visible antes de COMMIT')
  await writer.query('ROLLBACK')
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(notifications.length, 0, 'ROLLBACK no debe emitir estado confirmado')

  await writer.query('BEGIN')
  await writer.query('INSERT INTO "CashRegisterDay" ("id","businessId","openedAt","openingCash") VALUES ($1,$2,clock_timestamp(),0)', [`${dayId}-committed`, businessId])
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(notifications.length, 0, 'NOTIFY confirmado tampoco debe adelantarse al COMMIT')
  await writer.query('COMMIT')
  for (let attempt = 0; attempt < 20 && notifications.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(notifications.length, 1, 'COMMIT debe publicar exactamente un cambio de jornada')
  assert.deepEqual(JSON.parse(notifications[0]!), {
    businessId,
    entity: 'DAY',
    entityId: `${dayId}-committed`,
    updatedAt: JSON.parse(notifications[0]!).updatedAt
  })
  console.log('OK Caja realtime/UI PG: rollback silencioso y COMMIT tenant-scoped.')
} finally {
  await writer.end()
  await listener.end()
}
