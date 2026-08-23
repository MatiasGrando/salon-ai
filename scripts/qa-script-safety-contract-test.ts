import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveQaScriptEnvironment } from './qa-script-safety.js'

const approvedUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'

assert.deepEqual(resolveQaScriptEnvironment({
  TEST_DATABASE_URL: approvedUrl,
  QA_BUSINESS_ID: 'qa-business'
}), {
  databaseUrl: approvedUrl,
  businessId: 'qa-business'
})

for (const [name, environment] of [
  ['missing explicit database', { QA_BUSINESS_ID: 'qa-business' }],
  ['missing explicit business', { TEST_DATABASE_URL: approvedUrl }],
  ['wrong database name', { TEST_DATABASE_URL: approvedUrl.replace('salon_ai_test', 'salon_ai'), QA_BUSINESS_ID: 'qa-business' }],
  ['wrong database host', { TEST_DATABASE_URL: approvedUrl.replace('127.0.0.1', 'db.example.com'), QA_BUSINESS_ID: 'qa-business' }],
  ['conflicting active database', { TEST_DATABASE_URL: approvedUrl, DATABASE_URL: approvedUrl.replace('salon_ai_test', 'salon_ai'), QA_BUSINESS_ID: 'qa-business' }]
] as const) {
  assert.throws(() => resolveQaScriptEnvironment(environment), name)
}

const [replay, smoke, sync] = await Promise.all([
  readFile(new URL('./reproduce-glow-conversations.ts', import.meta.url), 'utf8'),
  readFile(new URL('./conversation-smoke-test.ts', import.meta.url), 'utf8'),
  readFile(new URL('./sync-business-qa-sandbox.ts', import.meta.url), 'utf8')
])

for (const [name, source] of [
  ['conversation replay', replay],
  ['conversation smoke', smoke],
  ['QA sandbox sync', sync]
] as const) {
  assert.match(source, /resolveQaScriptEnvironment/, `${name} must validate its environment before importing Prisma`)
  assert.match(source, /import\('\.\.\/src\/config\/prisma\.js'\)/, `${name} must dynamically import Prisma`)
  assert.ok(
    source.indexOf('resolveQaScriptEnvironment(process.env)') < source.indexOf("import('../src/config/prisma.js')"),
    `${name} must validate the environment before importing Prisma`
  )
  assert.doesNotMatch(source, /^import (?!type).*from '\.\.\/src\//m, `${name} must not load application modules before the safety guard`)
  assert.match(source, /isDemo[^\n]*demoType|demoType[^\n]*isDemo/s, `${name} must verify a QA_SANDBOX business`)
  assert.match(source, /QA_SANDBOX/, `${name} must require the QA sandbox demo type`)
}

assert.doesNotMatch(smoke, /business\.findFirst\(/, 'conversation smoke must never select the first business')
assert.match(replay, /where:\s*\{\s*phone:\s*qaPhone,\s*businessId\s*\}/, 'replay cleanup discovery must retain businessId')
assert.match(replay, /conversation:\s*\{\s*businessId\s*\}/, 'replay dependent deletes must retain the conversation tenant')
assert.match(smoke, /where:\s*\{\s*phone,\s*businessId\s*\}/, 'smoke cleanup discovery must retain businessId')
assert.match(smoke, /businessId,\s*title:/, 'smoke schedule-block cleanup must retain businessId')
assert.match(sync, /appointment:\s*\{\s*professional:\s*\{\s*businessId:\s*existing\.id\s*\}\s*\}/, 'sandbox dependent deletes must retain the appointment tenant')
assert.match(sync, /id:\s*\{\s*in:\s*appointmentIds\s*\},\s*professional:\s*\{\s*businessId:\s*existing\.id\s*\}/, 'sandbox appointment delete must retain business scope')

console.log('QA script safety contract tests passed')
