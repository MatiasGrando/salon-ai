import assert from 'node:assert/strict'
import { sanitizeBusinessWhatsAppConfigForClient } from '../src/services/business-whatsapp-settings.js'

const secret = '0123456789abcdef0123456789abcdef'
const previousSecret = 'fedcba9876543210fedcba9876543210'
const result = sanitizeBusinessWhatsAppConfigForClient({
  id: 'config',
  businessId: 'business',
  connectionStatus: 'CONNECTED',
  mode: 'CLIENT_OWNED',
  appSecret: secret,
  appSecretPrevious: previousSecret,
  appSecretPreviousValidUntil: new Date('2026-08-30T00:00:00.000Z'),
  accessToken: 'token-remains-covered-by-existing-password-field'
} as never)

assert.equal(result.hasAppSecret, true)
assert.equal(result.hasPreviousAppSecret, true)
assert.equal('appSecret' in result.config, false)
assert.equal('appSecretPrevious' in result.config, false)
assert.equal('appSecretPreviousValidUntil' in result.config, false)
assert.doesNotMatch(JSON.stringify(result), new RegExp(`${secret}|${previousSecret}`))

console.log('OK WhatsApp secret contract: Meta App Secret is write-only and client state exposes only configured booleans.')
