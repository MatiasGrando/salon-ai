import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const route = readFileSync('src/routes/account-management.ts', 'utf8')
const onboarding = readFileSync('src/services/business-onboarding-service.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const auth = readFileSync('src/routes/auth.ts', 'utf8')

assert.match(schema, /model BusinessPlan/)
assert.match(schema, /model BusinessOnboardingStatus/)
assert.match(schema, /contactPhone\s+String\?/)
assert.match(schema, /firstLoginAt\s+DateTime\?/)
assert.match(route, /ACCOUNT_ROLES = new Set\(\['SUPER_ADMIN', 'ACCOUNT_ADMIN'\]\)/)
assert.match(route, /accountAdminId: request\.auth!\.user\.id/)
assert.match(route, /createdByUserId: request\.auth!\.user\.id/)
assert.doesNotMatch(route, /setInterval|cron|24 \* 60/)
assert.match(onboarding, /refreshBusinessOnboarding/)
assert.match(onboarding, /hasServices/)
assert.match(onboarding, /whatsappConnected/)
assert.match(auth, /firstLoginAt/)
assert.match(ui, /data-section="accounts"/)
assert.match(ui, /\/admin\/accounts\?/)
assert.match(ui, /id="account-contact-phone"/)
assert.match(ui, /id="account-plan"/)

console.log('Account management contract tests passed')
