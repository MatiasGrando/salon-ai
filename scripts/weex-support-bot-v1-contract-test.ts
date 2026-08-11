import assert from 'node:assert/strict'
import {
  WEEX_SUPPORT_BOT_V1_DEFINITION,
  WeexSupportBotV1,
  type WeexSupportBotResult
} from '../src/services/weex-support-bot-v1.js'

const bot = new WeexSupportBotV1()

assert.equal(WEEX_SUPPORT_BOT_V1_DEFINITION.status, 'DRAFT')
assert.equal(WEEX_SUPPORT_BOT_V1_DEFINITION.channel, 'UNASSIGNED')
assert.equal(WEEX_SUPPORT_BOT_V1_DEFINITION.connected, false)
assert.equal(WEEX_SUPPORT_BOT_V1_DEFINITION.published, false)

function send(result: WeexSupportBotResult, input: string) {
  return bot.handle(input, result.state)
}

const start = bot.start()
assert.equal(start.version, 'v1')
assert.equal(start.connected, false)
assert.equal(start.state.node, 'MAIN_MENU')
assert.deepEqual(start.options.map((option) => option.value), ['1', '2', '3', '4', '5'])

const client = send(start, '1')
assert.equal(client.state.node, 'CLIENT_MENU')
assert.ok(client.options.some((option) => option.value === '9'), 'los submenús deben ofrecer asesor')
assert.ok(client.options.some((option) => option.value === '0'), 'los submenús deben permitir volver')

const problem = send(client, '1')
assert.equal(problem.state.node, 'CLIENT_PROBLEM')
const problemHandoff = send(problem, '3')
assert.equal(problemHandoff.state.node, 'HANDOFF_NAME')
assert.equal(problemHandoff.state.context.sector, 'soporte')
assert.equal(problemHandoff.state.context.category, 'Problema con WhatsApp')

const withName = send(problemHandoff, 'María López')
assert.equal(withName.state.node, 'HANDOFF_REASON')
assert.equal(withName.state.context.customerName, 'María López')

const withReason = send(withName, 'No puedo vincular mi número de WhatsApp')
assert.equal(withReason.state.node, 'HANDOFF_CONFIRM')
assert.equal(withReason.status, 'handoff_ready')

const completed = send(withReason, '1')
assert.equal(completed.state.node, 'HANDOFF_DONE')
assert.equal(completed.status, 'completed')
assert.equal(completed.connected, false)
assert.deepEqual(completed.handoff && {
  name: completed.handoff.name,
  sector: completed.handoff.sector,
  category: completed.handoff.category
}, {
  name: 'María López',
  sector: 'soporte',
  category: 'Problema con WhatsApp'
})

const services = send(start, '2')
assert.equal(services.state.node, 'SERVICES_MENU')
const crm = send(services, '3')
assert.equal(crm.state.node, 'SERVICE_DETAIL')
assert.match(crm.message, /Centraliza clientes/)
const crmPrice = send(crm, '1')
assert.equal(crmPrice.state.node, 'PRICE_DETAIL')
assert.match(crmPrice.message, /pendientes de aprobación/)

const prices = send(start, '3')
assert.equal(prices.state.node, 'PRICES_MENU')
const whatsappPrice = send(prices, '2')
assert.equal(whatsappPrice.state.context.sector, 'comercial')
assert.equal(whatsappPrice.state.node, 'PRICE_DETAIL')

const faq = send(start, '4')
assert.equal(faq.state.node, 'FAQ_MENU')
const faqAnswer = send(faq, '3')
assert.equal(faqAnswer.state.node, 'FAQ_MENU')
assert.match(faqAnswer.message, /tiempo de implementación/i)

const universalAdvisor = send(services, '9')
assert.equal(universalAdvisor.state.node, 'HANDOFF_NAME')
assert.equal(universalAdvisor.state.context.sector, 'general')

let invalid = send(start, '77')
invalid = send(invalid, '77')
invalid = send(invalid, '77')
assert.equal(invalid.state.invalidAttempts, 3)
assert.deepEqual(invalid.options.map((option) => option.value), ['9', '0'])

const backToMain = send(client, '0')
assert.equal(backToMain.state.node, 'MAIN_MENU')

const canceledHandoff = send(problemHandoff, '0')
assert.equal(canceledHandoff.state.node, 'MAIN_MENU')

console.log('Weex support bot V1 contract: OK (menús, errores, retornos y derivación sin conexión)')
