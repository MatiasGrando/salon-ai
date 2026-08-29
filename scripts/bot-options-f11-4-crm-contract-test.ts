import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { canStaffAccessRoute } from '../src/services/staff-permission-service.js'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { businessBotRoutingRoutes } from '../src/routes/business-bot-routing.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const calls: string[] = []
const routingService = {
  async state() {
    calls.push('state')
    return { businessId: 'business', engineKey: 'legacy-whatsapp', generation: 3, activeConfigurationId: null, paused: false, configurations: [{ id: 'configuration', name: 'Bot de opciones', version: 'v1' }], audits: [] }
  },
  async preflight() {
    calls.push('preflight')
    return { kind: 'CLEAN', targetConfigurationId: 'configuration', handle: { businessId: 'business', deploymentId: 'deployment', generation: 3, fenceEpoch: 4, pausedAt: new Date('2026-08-29T00:00:00.000Z') }, snapshot: { counts: { drafts: 1n, legacyDrafts: 0n, legacyProtected: 0n, inbox: 0n, jobs: 0n, outbox: 0n, holds: 0n, deposits: 0n, handoffs: 0n, unknown: 0n }, drafts: [], legacyDrafts: [], legacyProtected: [], inbox: [], jobs: [], outbox: [], holds: [], deposits: [], handoffs: [], unknown: [] } }
  },
  async commit() { calls.push('commit'); return { kind: 'SWITCHED', generation: 4 } },
  async abort() { calls.push('abort') }
}

const app = Fastify()
app.addHook('preHandler', async (request) => {
  ;(request as any).auth = { user: { id: 'admin', role: 'BUSINESS_ADMIN', businessId: 'business' } }
})
await app.register(businessBotRoutingRoutes, { service: routingService as never })

const stateResponse = await app.inject({ method: 'GET', url: '/crm/bot-routing?businessId=business' })
assert.equal(stateResponse.statusCode, 200)
assert.equal(stateResponse.json().generation, 3)
const preflightResponse = await app.inject({ method: 'POST', url: '/crm/bot-routing/preflight', payload: { businessId: 'business', expectedGeneration: 3, target: 'configuration' } })
assert.equal(preflightResponse.statusCode, 200)
assert.equal(preflightResponse.json().snapshot.counts.drafts, '1', 'BigInt counts must be JSON-safe')
const commitWithoutConfirmation = await app.inject({ method: 'POST', url: '/crm/bot-routing/commit', payload: { businessId: 'business' } })
assert.equal(commitWithoutConfirmation.statusCode, 400)
const commitResponse = await app.inject({ method: 'POST', url: '/crm/bot-routing/commit', payload: { businessId: 'business', confirmation: 'CONFIRM_ROUTING_CHANGE', target: 'configuration', handle: { businessId: 'business', deploymentId: 'deployment', generation: 3, fenceEpoch: 4, pausedAt: '2026-08-29T00:00:00.000Z' } } })
assert.equal(commitResponse.statusCode, 200)
assert.deepEqual(calls, ['state', 'preflight', 'commit'])
await app.close()

const staff = { role: 'STAFF', staffProfile: 'SECRETARY', professionalId: null, agendaScope: 'ALL', canViewConversations: true, canReplyConversations: true, canViewCustomers: true, canCreateCustomers: false, canEditCustomers: false, canManageCustomerNotes: false, canManageCustomerMarketing: false, canManageDeposits: false }
assert.equal(canStaffAccessRoute(staff as never, 'POST', '/crm/bot-routing/preflight'), false)

const ui = Fastify()
await ui.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const html = (await ui.inject('/crm')).body
assert.match(html, /id="bot-routing-selector"/)
assert.match(html, /id="bot-routing-preflight"/)
assert.match(html, /CONFIRM_ROUTING_CHANGE/)
assert.doesNotMatch(html, /id="tamara-options-bot-toggle"/)
for (const [index, script] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).entries()) {
  assert.doesNotThrow(() => new Function(script), `CRM inline script ${index} must compile`)
}
await ui.close()

console.log('OK F11.4 CRM: authenticated routing API, staff denial, JSON-safe preflight evidence, explicit integrated confirmation and exclusive selector without a routing checkbox.')
