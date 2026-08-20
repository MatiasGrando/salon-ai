import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const crmRoute = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const conversationListStart = crmRoute.indexOf("app.get('/crm/conversations'")
const conversationSummaryStart = crmRoute.indexOf("app.get('/crm/conversations/summary'", conversationListStart)
const conversationListRoute = crmRoute.slice(conversationListStart, conversationSummaryStart)
const latestDepositStart = crmRoute.indexOf('async function conversationWithLatestDeposit')
const automatedMessageStart = crmRoute.indexOf('async function sendCrmAutomatedMessage', latestDepositStart)
const latestDepositHelper = crmRoute.slice(latestDepositStart, automatedMessageStart)
const conversationDepositSelectStart = crmRoute.indexOf('const conversationDepositSelect')
const depositAppointmentSelectStart = crmRoute.indexOf('const crmDepositAppointmentSelect')
const depositAppointmentSelectEnd = crmRoute.indexOf('\n\nfunction conversationStepForPersistedBookingState', depositAppointmentSelectStart)
const conversationDepositSelect = crmRoute.slice(conversationDepositSelectStart, depositAppointmentSelectStart)
const depositAppointmentSelect = crmRoute.slice(depositAppointmentSelectStart, depositAppointmentSelectEnd)

assert.ok(conversationListStart >= 0, 'debe existir el listado de conversaciones')
assert.ok(conversationSummaryStart > conversationListStart, 'debe poder aislarse la ruta del listado')
assert.ok(
  conversationListRoute.includes('select: conversationDepositSelect'),
  'el listado debe devolver sólo el resumen de la seña y no el comprobante binario'
)
assert.ok(conversationDepositSelectStart >= 0, 'debe existir una selección compacta de señas')
assert.equal(
  conversationDepositSelect.includes('proofData'),
  false,
  'el resumen de seña no debe transferir el archivo del comprobante'
)
assert.ok(depositAppointmentSelectStart >= 0, 'debe existir una selección compacta de turnos con seña')
assert.equal(
  depositAppointmentSelect.includes('imageUrl') || depositAppointmentSelect.includes('avatarUrl'),
  false,
  'la revisión de señas no debe transferir imágenes de servicios o profesionales'
)
assert.ok(
  conversationListRoute.includes('latestMessagesByConversationId('),
  'el listado debe cargar los últimos mensajes con la consulta acotada'
)
assert.equal(
  /messages:\s*\{[\s\S]*?take:\s*1/.test(conversationListRoute),
  false,
  'el listado no debe usar take: 1 dentro de la relación messages porque transfiere el historial completo'
)
assert.ok(
  crmRoute.includes('SELECT DISTINCT ON ("conversationId") "Message".*'),
  'la consulta debe devolver como máximo un mensaje por conversación'
)
assert.ok(
  crmRoute.includes('ORDER BY "conversationId", "createdAt" DESC, "id" DESC'),
  'la selección del último mensaje debe ser determinística'
)
assert.ok(
  latestDepositHelper.includes('prisma.message.findFirst({'),
  'la actualización de una conversación debe consultar el último mensaje con LIMIT en la consulta principal'
)
assert.equal(
  /messages:\s*\{[\s\S]*?take:\s*1/.test(latestDepositHelper),
  false,
  'la actualización individual tampoco debe cargar el historial completo como relación'
)

console.log('CRM egress contract tests passed')
