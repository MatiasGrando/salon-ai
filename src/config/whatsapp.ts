import 'dotenv/config'

const DEFAULT_MESSAGE_BATCH_DELAY_MS = 3_000
const DEFAULT_MESSAGE_BATCH_MAX_WAIT_MS = 8_000

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

const messageBatchDelayMs = nonNegativeInteger(
  process.env.WHATSAPP_MESSAGE_BATCH_DELAY_MS,
  DEFAULT_MESSAGE_BATCH_DELAY_MS
)
const configuredMessageBatchMaxWaitMs = nonNegativeInteger(
  process.env.WHATSAPP_MESSAGE_BATCH_MAX_WAIT_MS,
  DEFAULT_MESSAGE_BATCH_MAX_WAIT_MS
)

export const whatsappConfig = {
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'salon_ai_verify_95',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  appId: process.env.META_APP_ID,
  appSecret: process.env.META_APP_SECRET,
  embeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
  oauthRedirectUri: process.env.META_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/crm',
  apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v25.0',
  phoneNumberMode: process.env.WHATSAPP_PHONE_NUMBER_MODE ?? 'production_argentina',
  allowInternalFallback: process.env.WHATSAPP_ALLOW_INTERNAL_FALLBACK === 'true',
  latencyDiagnosticsEnabled: process.env.WHATSAPP_LATENCY_DIAGNOSTICS_ENABLED === 'true',
  messageBatchDelayMs,
  messageBatchMaxWaitMs: Math.max(messageBatchDelayMs, configuredMessageBatchMaxWaitMs)
}
