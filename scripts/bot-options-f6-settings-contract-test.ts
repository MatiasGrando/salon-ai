import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260826140000_add_bot_options_settings/migration.sql', import.meta.url), 'utf8')
const alignmentMigration = readFileSync(new URL('../prisma/migrations/20260826160000_align_bot_options_settings_updated_at/migration.sql', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../src/bot-options/application/process-session-job.ts', import.meta.url), 'utf8')
const businessRoutes = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(schema, /model BusinessBotOptionsSettings[\s\S]*timezone\s+String[\s\S]*bookingHorizonDays\s+Int\s+@default\(30\)[\s\S]*bookingLeadTimeHours\s+Int\s+@default\(0\)[\s\S]*morningCutTime\s+String\s+@default\("12:30"\)[\s\S]*eveningCutTime\s+String\s+@default\("16:30"\)/)
assert.match(schema, /botBookingPriority\s+Int\s+@default\(100\)/)
assert.ok(migration.includes('BusinessBotOptionsSettings_lead_check'))
assert.match(alignmentMigration, /ALTER TABLE "BusinessBotOptionsSettings"[\s\S]*ALTER COLUMN "updatedAt" DROP DEFAULT/)
assert.ok(migration.includes('"bookingHorizonDays" BETWEEN 1 AND 90'))
assert.ok(migration.includes('"morningCutTime" < "eveningCutTime"'))
assert.equal(/INSERT\s+INTO\s+"BusinessBotOptionsSettings"/i.test(migration), false, 'no debe inventar timezone/backfill para negocios existentes')
assert.ok(runtime.includes('JOIN "BusinessBotOptionsSettings" settings'), 'la sesión debe capturar timezone real, sin fallback')
assert.equal(runtime.includes("businessTimezone: 'America/Argentina/Buenos_Aires'"), false, 'F6 no admite timezone hardcodeada')
assert.ok(runtime.includes("settings.timezone !== input.businessTimezone"), 'disponibilidad debe cercar cambios/mismatches de timezone')
assert.match(businessRoutes, /get\('\/businesses\/:id\/availability-settings'/)
assert.match(businessRoutes, /patch\('\/businesses\/:id\/availability-settings'/)
assert.match(businessRoutes, /morningCutTime[\s\S]*eveningCutTime[\s\S]*morningMinutes\s*>=\s*eveningMinutes/)
assert.match(crmUi, /id="availability-morning-cut-time"[\s\S]*id="availability-evening-cut-time"/)
assert.match(crmUi, /Antes de[\s\S]*a[\s\S]*Desde/)
assert.match(crmUi, /\/availability-settings/)

console.log('OK F6 settings contract: persistencia explícita, constraints, defaults canónicos y runtime fail-closed sin timezone inventada.')
