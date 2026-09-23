import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const response = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(response.statusCode, 200)
assert.match(response.body, /<title>Weex<\/title>/)
assert.match(response.body, /Administr&aacute; tu negocio/)
assert.doesNotMatch(response.body, /CRM Salon AI|Juan Sal&oacute;n|Salon AI/)

const scripts = [...response.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
assert.ok(scripts.length > 0, 'CRM should include inline scripts')
assert.match(response.body, /escapeHtml\(manualCurrent\.whatsappAppUrl\)/, 'manual campaign should deep-link into WhatsApp app')
assert.doesNotMatch(response.body, /escapeHtml\(manualCurrent\.whatsappUrl\) \+ '" target="_blank"/, 'manual campaign should not open a new web tab')
const manualUpdate = response.body.match(/async function updateManualCampaignRecipient\([\s\S]*?\n    \}/)?.[0] || ''
assert.match(manualUpdate, /state\.campaignManualExecutions\[campaign\.id\] = execution\s+renderCampaignDetail\(\)\s+if \(status === 'SENT'\)/, 'the next recipient should render before refreshing delivery history')
assert.doesNotMatch(manualUpdate, /await getJson\('\/campaigns\/' \+ campaign\.id \+ '\/deliveries'\)/, 'delivery history should not block moving to the next recipient')
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script)
  } catch (error) {
    throw new Error(`CRM inline script ${index} does not compile: ${error instanceof Error ? error.message : error}`)
  }
}

await app.close()
console.log(`CRM inline scripts compile: OK (${scripts.length})`)
