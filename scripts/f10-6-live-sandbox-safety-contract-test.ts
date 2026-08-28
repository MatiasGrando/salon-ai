import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  F10_6LiveSandboxSafetyError,
  F10_6_LIVE_SANDBOX_ENABLE_PHRASE,
  F10_6_LIVE_SANDBOX_OPT_IN_PHRASE,
  redactF10_6LiveSandboxSafetyError,
  validateF10_6LiveSandboxSafety
} from './f10-6-live-sandbox-safety.js'

const valid = {
  F10_6_LIVE_SANDBOX_ENABLE: F10_6_LIVE_SANDBOX_ENABLE_PHRASE,
  F10_PG_CONTRACT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_live_sandbox',
  F10_6_LIVE_SANDBOX_BUSINESS_ID: 'f106-qa-sandbox',
  F10_6_LIVE_SANDBOX_EXPECTED_DEMO_TYPE: 'QA_SANDBOX',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  F10_6_LIVE_SANDBOX_SENDER_E164: '+15555550101',
  F10_6_LIVE_SANDBOX_RECIPIENT_E164: '+15555550102',
  F10_6_LIVE_SANDBOX_RECIPIENT_ALLOWLIST_E164: '+15555550102',
  F10_6_LIVE_SANDBOX_RECIPIENT_OPT_IN: F10_6_LIVE_SANDBOX_OPT_IN_PHRASE,
  WHATSAPP_ACCESS_TOKEN: 'contract-token-only',
  META_APP_SECRET: 'contract-secret-only',
  F10_6_LIVE_SANDBOX_WEBHOOK_URL: 'https://sandbox.invalid/webhooks/whatsapp',
  BOT_OPTIONS_WORKERS_ENABLED: 'false'
} as const

const before = { DATABASE_URL: 'must-not-change' }
assert.doesNotThrow(() => validateF10_6LiveSandboxSafety({ ...valid, ...before }))
assert.deepEqual(before, { DATABASE_URL: 'must-not-change' }, 'the pure gate must not infer or assign DATABASE_URL')

for (const [name, env, code] of [
  ['exact enable phrase', { ...valid, F10_6_LIVE_SANDBOX_ENABLE: 'true' }, 'ENABLE_REQUIRED'],
  ['F10 scratch URL', { ...valid, F10_PG_CONTRACT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai' }, 'SCRATCH_DATABASE_UNSAFE'],
  ['business identity', { ...valid, F10_6_LIVE_SANDBOX_BUSINESS_ID: '' }, 'BUSINESS_ID_REQUIRED'],
  ['sandbox marker', { ...valid, F10_6_LIVE_SANDBOX_EXPECTED_DEMO_TYPE: 'NAILS' }, 'DEMO_MARKER_REQUIRED'],
  ['Meta phone id', { ...valid, WHATSAPP_PHONE_NUMBER_ID: 'not-an-id' }, 'PHONE_NUMBER_ID_INVALID'],
  ['normalized sender', { ...valid, F10_6_LIVE_SANDBOX_SENDER_E164: '15555550101' }, 'F10_6_LIVE_SANDBOX_SENDER_E164_INVALID'],
  ['distinct endpoints', { ...valid, F10_6_LIVE_SANDBOX_RECIPIENT_E164: valid.F10_6_LIVE_SANDBOX_SENDER_E164, F10_6_LIVE_SANDBOX_RECIPIENT_ALLOWLIST_E164: valid.F10_6_LIVE_SANDBOX_SENDER_E164 }, 'SENDER_RECIPIENT_MUST_DIFFER'],
  ['single recipient allowlist', { ...valid, F10_6_LIVE_SANDBOX_RECIPIENT_ALLOWLIST_E164: '+15555550103' }, 'RECIPIENT_ALLOWLIST_MISMATCH'],
  ['recipient opt-in phrase', { ...valid, F10_6_LIVE_SANDBOX_RECIPIENT_OPT_IN: 'true' }, 'RECIPIENT_OPT_IN_REQUIRED'],
  ['access token presence', { ...valid, WHATSAPP_ACCESS_TOKEN: ' ' }, 'ACCESS_TOKEN_REQUIRED'],
  ['app secret presence', { ...valid, META_APP_SECRET: '' }, 'APP_SECRET_REQUIRED'],
  ['HTTPS webhook', { ...valid, F10_6_LIVE_SANDBOX_WEBHOOK_URL: 'http://sandbox.invalid/webhooks/whatsapp' }, 'WEBHOOK_URL_INVALID'],
  ['invalid runtime flag', { ...valid, BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED: 'yes' }, 'BOT_OPTIONS_FLAG_ENABLED_OR_INVALID']
] as const) {
  assert.throws(() => validateF10_6LiveSandboxSafety(env), (error: unknown) => {
    assert.ok(error instanceof F10_6LiveSandboxSafetyError, `${name} must fail closed with a typed refusal`)
    assert.equal(error.code, code)
    return true
  })
}

for (const flag of [
  'BOT_OPTIONS_SHADOW_ADMISSION_ENABLED',
  'BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED',
  'BOT_OPTIONS_WORKERS_ENABLED',
  'BOT_OPTIONS_SENDER_ENABLED',
  'BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED',
  'BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED',
  'BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED',
  'BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED',
  'BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE'
]) {
  assert.throws(() => validateF10_6LiveSandboxSafety({ ...valid, [flag]: 'true' }), /BOT_OPTIONS_FLAG_ENABLED_OR_INVALID/)
}

const leakedValue = 'do-not-log-this-token-or-phone'
const redacted = redactF10_6LiveSandboxSafetyError(new F10_6LiveSandboxSafetyError('ACCESS_TOKEN_REQUIRED'))
assert.equal(redacted, 'F10_6_LIVE_SANDBOX_PREFLIGHT_REFUSED:ACCESS_TOKEN_REQUIRED')
assert.doesNotMatch(redacted, new RegExp(leakedValue))
assert.equal(redactF10_6LiveSandboxSafetyError(new Error(leakedValue)), 'F10_6_LIVE_SANDBOX_PREFLIGHT_REFUSED:UNEXPECTED')

const preflightSource = await readFile(new URL('./bot-options-f10-6-handoff-live-sandbox.ts', import.meta.url), 'utf8')
assert.doesNotMatch(preflightSource, /(?:from|import)\s*\(?\s*['"][^'"]*(?:prisma|node:https|node:net)/i, 'preflight must not import database/network modules')
assert.doesNotMatch(preflightSource, /\bfetch\s*\(|\bDATABASE_URL\s*=/i, 'preflight must remain free of network I/O and DATABASE_URL assignment')
assert.doesNotMatch(preflightSource, /import\(['"]/i, 'preflight must not dynamically load a future I/O stage')
assert.match(preflightSource, /console\.log\('META_LIVE_PENDING'\)/, 'successful preflight must explicitly stop as pending')

console.log('OK F10.6 live sandbox safety: pure refusal matrix and redaction passed.')
