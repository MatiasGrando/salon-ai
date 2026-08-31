import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [syncScript, demoRoute, simulator] = await Promise.all([
  readFile(new URL('./sync-business-qa-sandbox.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/demo-profile.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/bot-options/application/run-demo-simulation.ts', import.meta.url), 'utf8')
])

assert.match(syncScript, /--options-bot/)
assert.match(syncScript, /qa-options-bot-sandbox/)
assert.match(syncScript, /Bot nuevo · simulador QA/)
assert.match(syncScript, /qaSimulator: true/)
assert.match(demoRoute, /runDeterministicDemoSimulation/)
assert.match(demoRoute, /botKey: 'deterministic-options'/)
assert.match(demoRoute, /path: \['qaSimulator'\], equals: true/)
assert.match(simulator, /createAuthoritativeWebhookAdmission/)
assert.match(simulator, /providerMessageId: messageId/)
assert.match(simulator, /transitionId/)
assert.match(simulator, /status: 'PROCESSED'/)
assert.doesNotMatch(simulator, /claimOutbox|sendClaimedOutbox/)
assert.doesNotMatch(simulator, /WhatsAppCloudApi|fetch\(/)

console.log('Demo options-bot sandbox contract: OK')
