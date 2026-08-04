import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const crmRoute = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const conversationListStart = crmRoute.indexOf("app.get('/crm/conversations'")
const conversationSummaryStart = crmRoute.indexOf("app.get('/crm/conversations/summary'", conversationListStart)
const conversationListRoute = crmRoute.slice(conversationListStart, conversationSummaryStart)
const latestDepositStart = crmRoute.indexOf('async function conversationWithLatestDeposit')
const automatedMessageStart = crmRoute.indexOf('async function sendCrmAutomatedMessage', latestDepositStart)
const latestDepositHelper = crmRoute.slice(latestDepositStart, automatedMessageStart)

assert.ok(conversationListStart >= 0, 'debe existir el listado de conversaciones')
assert.ok(conversationSummaryStart > conversationListStart, 'debe poder aislarse la ruta del listado')
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
