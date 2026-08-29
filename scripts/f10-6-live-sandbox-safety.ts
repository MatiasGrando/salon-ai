import { assertF10PgContractDatabaseUrl } from './f10-pg-contract-database.js'

export const F10_6_LIVE_SANDBOX_ENABLE_PHRASE = 'F10_6_LIVE_SANDBOX_PREFLIGHT_ONLY'
export const F10_6_LIVE_SANDBOX_OPT_IN_PHRASE = 'F10_6_RECIPIENT_OPT_IN_CONFIRMED'

type Env = Record<string, string | undefined>

export type F10_6LiveSandboxSafetyConfig = Readonly<{
  scratchDatabaseUrl: string
  businessId: string
  phoneNumberId: string
  senderE164: string
  recipientE164: string
  webhookUrl: string
}>

export class F10_6LiveSandboxSafetyError extends Error {
  constructor(readonly code: string) {
    super(`F10.6 live sandbox preflight refused: ${code}`)
    this.name = 'F10_6LiveSandboxSafetyError'
  }
}

/** Produces an operator-safe refusal label; never include environment values in logs. */
export function redactF10_6LiveSandboxSafetyError(error: unknown): string {
  const code = error instanceof F10_6LiveSandboxSafetyError ? error.code : 'UNEXPECTED'
  return `F10_6_LIVE_SANDBOX_PREFLIGHT_REFUSED:${code}`
}

/**
 * Pure, fail-closed gate for the F10.6 Meta sandbox preflight. It neither loads
 * dotenv nor mutates process.env, so it cannot infer or assign DATABASE_URL.
 */
export function validateF10_6LiveSandboxSafety(env: Env): F10_6LiveSandboxSafetyConfig {
  requireExact(env, 'F10_6_LIVE_SANDBOX_ENABLE', F10_6_LIVE_SANDBOX_ENABLE_PHRASE, 'ENABLE_REQUIRED')

  const scratchDatabaseUrl = required(env, 'F10_PG_CONTRACT_DATABASE_URL', 'SCRATCH_DATABASE_REQUIRED')
  try {
    assertF10PgContractDatabaseUrl(scratchDatabaseUrl, 'F10.6 live sandbox preflight')
  } catch {
    refuse('SCRATCH_DATABASE_UNSAFE')
  }

  const businessId = requiredIdentifier(env, 'F10_6_LIVE_SANDBOX_BUSINESS_ID', 'BUSINESS_ID_REQUIRED')
  requireExact(env, 'F10_6_LIVE_SANDBOX_EXPECTED_DEMO_TYPE', 'QA_SANDBOX', 'DEMO_MARKER_REQUIRED')
  const phoneNumberId = requiredMetaPhoneNumberId(env, 'WHATSAPP_PHONE_NUMBER_ID')

  const senderE164 = requiredE164(env, 'F10_6_LIVE_SANDBOX_SENDER_E164')
  const recipientE164 = requiredE164(env, 'F10_6_LIVE_SANDBOX_RECIPIENT_E164')
  if (senderE164 === recipientE164) refuse('SENDER_RECIPIENT_MUST_DIFFER')
  const allowlist = parseSingleRecipientAllowlist(env)
  if (allowlist !== recipientE164 || allowlist === senderE164) refuse('RECIPIENT_ALLOWLIST_MISMATCH')

  requireExact(env, 'F10_6_LIVE_SANDBOX_RECIPIENT_OPT_IN', F10_6_LIVE_SANDBOX_OPT_IN_PHRASE, 'RECIPIENT_OPT_IN_REQUIRED')
  requirePresent(env, 'WHATSAPP_ACCESS_TOKEN', 'ACCESS_TOKEN_REQUIRED')
  requirePresent(env, 'META_APP_SECRET', 'APP_SECRET_REQUIRED')
  const webhookUrl = requiredHttpsUrl(env, 'F10_6_LIVE_SANDBOX_WEBHOOK_URL')
  assertBotOptionsFlagsDisabled(env)

  return Object.freeze({ scratchDatabaseUrl, businessId, phoneNumberId, senderE164, recipientE164, webhookUrl })
}

function assertBotOptionsFlagsDisabled(env: Env): void {
  const flags = [
    'BOT_OPTIONS_SHADOW_ADMISSION_ENABLED',
    'BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED',
    'BOT_OPTIONS_WORKERS_ENABLED',
    'BOT_OPTIONS_SENDER_ENABLED',
    'BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED',
    'BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED',
    'BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED',
    'BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED',
    'BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE'
  ]
  for (const name of flags) {
    const value = env[name]
    if (value !== undefined && value !== 'false') refuse('BOT_OPTIONS_FLAG_ENABLED_OR_INVALID')
  }
}

function parseSingleRecipientAllowlist(env: Env): string {
  const value = required(env, 'F10_6_LIVE_SANDBOX_RECIPIENT_ALLOWLIST_E164', 'RECIPIENT_ALLOWLIST_REQUIRED')
  if (value.includes(',') || value.includes(' ') || !isE164(value)) refuse('RECIPIENT_ALLOWLIST_INVALID')
  return value
}

function requiredHttpsUrl(env: Env, name: string): string {
  const value = required(env, name, 'WEBHOOK_URL_REQUIRED')
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) refuse('WEBHOOK_URL_INVALID')
    return parsed.toString()
  } catch (error) {
    if (error instanceof F10_6LiveSandboxSafetyError) throw error
    refuse('WEBHOOK_URL_INVALID')
  }
}

function requiredMetaPhoneNumberId(env: Env, name: string): string {
  const value = required(env, name, 'PHONE_NUMBER_ID_REQUIRED')
  if (!/^[1-9][0-9]{5,31}$/.test(value)) refuse('PHONE_NUMBER_ID_INVALID')
  return value
}

function requiredIdentifier(env: Env, name: string, code: string): string {
  const value = required(env, name, code)
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) refuse('BUSINESS_ID_INVALID')
  return value
}

function requiredE164(env: Env, name: string): string {
  const value = required(env, name, `${name}_REQUIRED`)
  if (!isE164(value)) refuse(`${name}_INVALID`)
  return value
}

function isE164(value: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(value)
}

function requirePresent(env: Env, name: string, code: string): void {
  if (!env[name]?.trim()) refuse(code)
}

function requireExact(env: Env, name: string, expected: string, code: string): void {
  if (env[name] !== expected) refuse(code)
}

function required(env: Env, name: string, code: string): string {
  const value = env[name]
  if (!value?.trim()) refuse(code)
  return value
}

function refuse(code: string): never {
  throw new F10_6LiveSandboxSafetyError(code)
}
