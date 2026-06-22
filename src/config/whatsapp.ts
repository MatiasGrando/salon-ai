import 'dotenv/config'

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
  phoneNumberMode: process.env.WHATSAPP_PHONE_NUMBER_MODE ?? 'production_argentina'
}
