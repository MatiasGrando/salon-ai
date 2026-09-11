import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const route = readFileSync('src/routes/crm.ts', 'utf8')

assert.match(ui, /clientCreatedAt:\s*item\.createdAt/)
assert.match(route, /clientCreatedAt\?:\s*string/)
assert.match(route, /event:\s*'crm_manual_message_to_meta'/)
assert.match(route, /generatedToMetaMs/)
assert.match(route, /serverToMetaMs/)
assert.match(route, /clientToServerMs/)
assert.match(route, /metaResponseMs/)
assert.doesNotMatch(route, /text:\s*text[\s\S]{0,200}crm_manual_message_to_meta/)

console.log('CRM manual send latency: OK')
