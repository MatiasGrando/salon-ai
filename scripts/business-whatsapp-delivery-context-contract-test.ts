import assert from 'node:assert/strict'
import { whatsappConfig } from '../src/config/whatsapp.js'
import { resolveBusinessWhatsAppCredentialsFromState } from '../src/services/business-whatsapp-settings.js'

const config = whatsappConfig
const original = {
  allowInternalFallback: config.allowInternalFallback,
  accessToken: config.accessToken,
  phoneNumberId: config.phoneNumberId,
  businessAccountId: config.businessAccountId,
  appId: config.appId
}

try {
  config.allowInternalFallback = true
  config.accessToken = 'env-token'
  config.phoneNumberId = 'env-phone'
  config.businessAccountId = 'env-waba'
  config.appId = 'env-app'

  const fallbackCredentials = resolveBusinessWhatsAppCredentialsFromState({
    config: { accessToken: 'partial-token', phoneNumberId: 'partial-phone', wabaId: null },
    connection: { usingInternalFallback: true }
  } as any)
  assert.equal(fallbackCredentials.accessToken, 'env-token')
  assert.equal(fallbackCredentials.phoneNumberId, 'env-phone')
  assert.equal(fallbackCredentials.businessAccountId, 'env-waba')

  const tenantCredentials = resolveBusinessWhatsAppCredentialsFromState({
    config: {
      accessToken: 'tenant-token',
      phoneNumberId: 'tenant-phone',
      wabaId: 'tenant-waba',
      metaAppId: 'tenant-app'
    },
    connection: { usingInternalFallback: false }
  } as any)
  assert.equal(tenantCredentials.accessToken, 'tenant-token')
  assert.equal(tenantCredentials.phoneNumberId, 'tenant-phone')
  assert.equal(tenantCredentials.businessAccountId, 'tenant-waba')
  assert.equal(tenantCredentials.appId, 'tenant-app')
} finally {
  config.allowInternalFallback = original.allowInternalFallback
  config.accessToken = original.accessToken
  config.phoneNumberId = original.phoneNumberId
  config.businessAccountId = original.businessAccountId
  config.appId = original.appId
}

console.log('business-whatsapp-delivery-context-contract-test: OK')
