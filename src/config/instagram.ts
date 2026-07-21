import 'dotenv/config'

export const instagramConfig = {
  verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? 'salon_ai_instagram_verify_95',
  apiVersion: process.env.INSTAGRAM_API_VERSION ?? 'v25.0'
}
