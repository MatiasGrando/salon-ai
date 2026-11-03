import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { loadActiveServiceContent } from '../src/conversational-bot/prisma-service-content.js'
import { loadConversationPolicy, resolveConversationPolicy, type PolicyRow } from '../src/conversational-bot/runtime-policy.js'
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

// Commercial eligibility is explicit per-tenant opt-in, not a customer-code allowlist.
for (const tenant of ['tenant-a', 'tenant-b']) {
  const scoped = { ...row, businessId: tenant, configurationBusinessId: tenant, customerCode: 'WX-' + tenant,
    definition: { conversation: definition.conversation } }
  assert.deepEqual(resolveConversationPolicy(scoped), { businessId: tenant, deploymentId: 'deployment', generation: 1, configurationId: 'configuration' },
    'a second business with its own ACTIVE configuration can opt in')
}
const glowOptions = { ...row, businessId: 'glow', configurationBusinessId: 'glow', customerCode: 'WX-GLOW', definition: {} }
const unchangedGlow = structuredClone(glowOptions)
assert.equal(resolveConversationPolicy(glowOptions), null, 'a marker-free options business stays on options')
assert.deepEqual(glowOptions, unchangedGlow, 'eligibility does not rewrite the existing business configuration')
for (const definition of [null, [], {}, { options: true }]) {
  assert.equal(resolveConversationPolicy({ ...row, definition }), null, 'absence of a conversation claim opts out')
}
for (const wrong of [
  { configurationBusinessId: 'other' }, { configurationStatus: 'DRAFT' }, { configurationStatus: 'INACTIVE' },
  { engineKey: 'booking-v2' }, { businessId: '' }, { deploymentId: '' }, { configurationId: '' },
  ...[0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1].map(generation => ({ generation })),
  ...[null, [], {}, { schemaVersion: 2, engine: 'conversational-booking-v1' },
    { schemaVersion: 1, engine: 'other' }, { schemaVersion: 1, engine: 'conversational-booking-v1', extra: true }]
    .map(conversation => ({ definition: { conversation } }))
]) {
  assert.throws(() => resolveConversationPolicy({ ...row, ...wrong }), /invalid conversational runtime policy/,
    'a claimed but invalid policy must fail closed instead of routing to the legacy engine')
}

// Execute the real load query in isolated, in-memory SQL: no .env, remote DB, or business data.
const policyDb = new PGlite()
try {
  await policyDb.exec(`
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM');
    CREATE TABLE "Business" (id TEXT PRIMARY KEY, "customerCode" TEXT NOT NULL);
    CREATE TABLE "BusinessBotConfiguration" (id TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, status TEXT NOT NULL, definition JSONB NOT NULL);
    CREATE TABLE "BotChannelDeployment" (id TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, generation INTEGER NOT NULL,
      "engineKey" TEXT NOT NULL, "activeConfigurationId" TEXT NOT NULL, channel "BotChannel" NOT NULL, "claimsPausedAt" TIMESTAMPTZ);
  `)
  for (const [id, customerCode, policyDefinition] of [
    ['tenant-a', 'WX-A', { conversation: definition.conversation }],
    ['tenant-b', 'WX-B', { conversation: definition.conversation }],
    ['glow', 'WX-GLOW', {}]
  ] as const) {
    await policyDb.query('INSERT INTO "Business" VALUES ($1,$2)', [id, customerCode])
    await policyDb.query('INSERT INTO "BusinessBotConfiguration" VALUES ($1,$2,$3,$4::jsonb)', ['cfg-' + id, id, 'ACTIVE', JSON.stringify(policyDefinition)])
    await policyDb.query('INSERT INTO "BotChannelDeployment" VALUES ($1,$2,5,$3,$4,$5,NULL)', ['dep-' + id, id, 'deterministic-options', 'cfg-' + id, 'WHATSAPP'])
  }
  const policyClient = { $queryRaw: async (query: { text: string; values: unknown[] }): Promise<PolicyRow[]> =>
    (await policyDb.query<PolicyRow>(query.text, query.values)).rows } as never
  for (const businessId of ['tenant-a', 'tenant-b']) {
    assert.deepEqual(await loadConversationPolicy(policyClient, { businessId, deploymentId: 'dep-' + businessId, generation: 5 }),
      { businessId, deploymentId: 'dep-' + businessId, generation: 5, configurationId: 'cfg-' + businessId })
  }
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'glow' }), null, 'SQL load preserves Glow options')
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'unknown' }), null)
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'tenant-a', deploymentId: 'dep-tenant-b' }), null, 'deployment identity is tenant scoped')
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'tenant-a', generation: 4 }), null, 'stale generation cannot claim the runtime')
  await policyDb.query('UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp() WHERE id=$1', ['dep-tenant-a'])
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), null, 'paused deployments cannot claim work')
  await policyDb.query('UPDATE "BotChannelDeployment" SET "claimsPausedAt"=NULL, channel=$1 WHERE id=$2', ['INSTAGRAM', 'dep-tenant-a'])
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), null, 'eligibility does not widen channel admission')
  await policyDb.query('UPDATE "BotChannelDeployment" SET channel=$1, "activeConfigurationId"=$2 WHERE id=$3', ['WHATSAPP', 'cfg-tenant-b', 'dep-tenant-a'])
  assert.equal(await loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), null, 'foreign active configuration cannot pass the SQL join')
  await policyDb.query('UPDATE "BotChannelDeployment" SET "activeConfigurationId"=$1 WHERE id=$2', ['cfg-tenant-a', 'dep-tenant-a'])
  await policyDb.query('UPDATE "BusinessBotConfiguration" SET status=$1 WHERE id=$2', ['DRAFT', 'cfg-tenant-a'])
  await assert.rejects(loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), /invalid conversational runtime policy/)
  await policyDb.query('UPDATE "BusinessBotConfiguration" SET status=$1, definition=$2::jsonb WHERE id=$3', ['ACTIVE', '{"conversation":{"schemaVersion":2,"engine":"conversational-booking-v1"}}', 'cfg-tenant-a'])
  await assert.rejects(loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), /invalid conversational runtime policy/,
    'invalid markers are not downgraded to options by the loader')
  await policyDb.query('UPDATE "BusinessBotConfiguration" SET definition=$1::jsonb WHERE id=$2', [JSON.stringify({ conversation: definition.conversation }), 'cfg-tenant-a'])
  await policyDb.query('INSERT INTO "BotChannelDeployment" VALUES ($1,$2,5,$3,$4,$5,NULL)', ['dep-duplicate', 'tenant-a', 'deterministic-options', 'cfg-tenant-a', 'WHATSAPP'])
  await assert.rejects(loadConversationPolicy(policyClient, { businessId: 'tenant-a' }), /ambiguous conversational deployment/)
  const optionsDefinition = (await policyDb.query<{ definition: unknown }>('SELECT definition FROM "BusinessBotConfiguration" WHERE id=$1', ['cfg-glow'])).rows[0]!.definition
  assert.deepEqual(optionsDefinition, {}, 'tenant policy checks do not change the options configuration')
} finally {
  await policyDb.close()
}
console.log('commercial runtime policy: explicit opt-in, tenant/config/generation/channel/pause guards PASS')
