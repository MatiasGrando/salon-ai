import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  businessAccountAccessMessage,
  isBusinessAccountOperational,
  isBusinessAccountUnavailable
} from '../src/services/business-account-access.js'

assert.equal(isBusinessAccountUnavailable('PAUSED'), true)
assert.equal(isBusinessAccountUnavailable('CANCELLED'), true)
assert.equal(isBusinessAccountUnavailable('ACTIVE'), false)
assert.equal(isBusinessAccountUnavailable('ONBOARDING'), false)
assert.equal(isBusinessAccountOperational('ACTIVE'), true)
assert.equal(isBusinessAccountOperational('ONBOARDING'), false)
assert.match(businessAccountAccessMessage('PAUSED'), /pausada/)
assert.match(businessAccountAccessMessage('CANCELLED'), /cancelada/)

const authGuard = readFileSync('src/plugins/auth-guard.ts', 'utf8')
const authRoute = readFileSync('src/routes/auth.ts', 'utf8')
const accountRoute = readFileSync('src/routes/account-management.ts', 'utf8')
const landingRoute = readFileSync('src/routes/landing-ui.ts', 'utf8')
const publicBookingRoute = readFileSync('src/routes/public-booking.ts', 'utf8')
const whatsappWebhook = readFileSync('src/services/whatsapp-webhook-service.ts', 'utf8')
const instagramWebhook = readFileSync('src/services/instagram-webhook-service.ts', 'utf8')
const whatsappGate = readFileSync('src/services/business-whatsapp-settings.ts', 'utf8')
const onboarding = readFileSync('src/services/business-onboarding-service.ts', 'utf8')
const crmUi = readFileSync('src/routes/crm-ui.ts', 'utf8')
const customSite = readFileSync('src/routes/tamara-site.ts', 'utf8')

assert.match(authGuard, /BUSINESS_ADMIN.*STAFF/)
assert.match(authGuard, /status\(423\)/)
assert.match(authRoute, /destroySessionFromRequest/)
assert.match(accountRoute, /userSession\.deleteMany/)
assert.match(accountRoute, /confirmationName/)
assert.match(landingRoute, /renderBusinessUnavailable/)
assert.match(publicBookingRoute, /isBusinessAccountUnavailable/)
assert.match(whatsappWebhook, /Cuenta pausada o cancelada/)
assert.match(instagramWebhook, /Cuenta pausada o cancelada/)
assert.match(whatsappGate, /isBusinessAccountOperational/)
assert.doesNotMatch(onboarding, /data:\s*\{\s*accountStatus:\s*'ACTIVE'/)
assert.match(crmUi, /account-status-confirmation/)
assert.match(customSite, /customSiteIsUnavailable/)

console.log('Business account access contract tests passed')
