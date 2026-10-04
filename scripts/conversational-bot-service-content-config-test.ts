import assert from 'node:assert/strict'
import { loadActiveServiceContent } from '../src/conversational-bot/prisma-service-content.js'
import { resolveConversationPolicy, type PolicyRow } from '../src/conversational-bot/runtime-policy.js'
const namespace = { version: 1, businessId: 'tenant', services: [] }
const definition = { conversation: { engine: 'conversational-booking-v1', schemaVersion: 1 }, serviceContent: namespace }
const row: PolicyRow = { businessId: 'tenant', deploymentId: 'deployment', generation: 1, configurationId: 'configuration', customerCode: 'WX-38N6UG', configurationBusinessId: 'tenant', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options', definition }
assert.deepEqual((resolveConversationPolicy(row) as unknown as { serviceContent?: unknown }).serviceContent, namespace, 'runtime must carry already scoped definition metadata')
const foreign = resolveConversationPolicy({ ...row, definition: { ...definition, serviceContent: { ...namespace, businessId: 'foreign' } } })
assert.equal((foreign as unknown as { serviceContent?: unknown }).serviceContent, undefined, 'foreign content falls back, never changes runtime admission')
let queries = 0
let rows: unknown[] = [{ id: 'configuration', businessId: 'tenant', definition }]
const client: any = { businessBotConfiguration: {}, $queryRaw: async (query: any) => {
  queries++
  assert.ok(query.values.includes('tenant'))
  return rows
} }
assert.deepEqual(await loadActiveServiceContent(client, 'tenant'), namespace)
await loadActiveServiceContent({ ...client, $queryRaw: async (query: any) => { assert.match(query.sql, /FOR SHARE/); return rows } }, 'tenant', true)
rows = [{ id: 'configuration', businessId: 'foreign', definition }]
assert.equal(await loadActiveServiceContent(client, 'tenant'), null)
rows = [{ id: 'one', businessId: 'tenant', definition }, { id: 'two', businessId: 'tenant', definition }]
assert.equal(await loadActiveServiceContent(client, 'tenant'), null, 'ambiguous active definitions cannot silently select one')
assert.equal(await loadActiveServiceContent({}, 'tenant'), null, 'partial legacy fake delegates do not trigger extra queries')
assert.equal(queries, 3)

const qaDefinition = { qaSimulator: true, serviceContent: namespace }
const qaClient: any = { businessBotConfiguration: {}, $queryRaw: async (query: any) => {
  assert.match(query.sql, /JOIN "Business"/, 'QA requires business scope in the same query')
  assert.match(query.sql, /"isDemo"/); assert.match(query.sql, /QA_SANDBOX/); assert.match(query.sql, /qaSimulator/); assert.match(query.sql, /LIMIT 2/)
  return [{ id: 'qa', businessId: 'tenant', definition: qaDefinition }]
} }
assert.deepEqual(await loadActiveServiceContent(qaClient, 'tenant', false, { qaPreview: true }), namespace)
await loadActiveServiceContent(qaClient, 'tenant', true, { qaPreview: true })
await loadActiveServiceContent({ ...client, $queryRaw: async (query: any) => {
  assert.doesNotMatch(query.sql, /qaSimulator/, 'default WhatsApp scope is unchanged')
  return [{ id: 'configuration', businessId: 'tenant', definition }]
} }, 'tenant')
console.log('PASS configured service content transport, tenant isolation, unique active definition and fresh locked read')
