import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { workshopInPersonMarketingPreferenceData } from '../src/services/marketing-preference-service.js'

const source = readFileSync('src/routes/workshop.ts', 'utf8')
const legacyImport = readFileSync('scripts/workshop-historical-import.ts', 'utf8')
const backfill = readFileSync('scripts/backfill-workshop-marketing-preferences.ts', 'utf8')
const now = new Date('2026-09-22T12:00:00.000Z')

assert.deepEqual(workshopInPersonMarketingPreferenceData(now), {
  status: 'ACTIVE', source: 'WORKSHOP_IN_PERSON', optedInAt: now
})
assert.deepEqual(workshopInPersonMarketingPreferenceData(null), {
  status: 'ACTIVE', source: 'WORKSHOP_IN_PERSON', optedInAt: null
})
assert.match(source, /transaction\.customerMarketingPreference\.upsert\([\s\S]*update: \{\}/, 'el alta no debe reactivar bajas existentes')
assert.match(legacyImport, /customerMarketingPreference\.createMany\([\s\S]*skipDuplicates: true/, 'la importación debe ser idempotente')
assert.match(legacyImport, /normalizedPhone\.startsWith\('legacy-'\)/, 'contactos sintéticos no son consentimientos reales')
assert.match(backfill, /business\.businessType !== 'WORKSHOP'/, 'el backfill solo aplica al taller')
assert.match(backfill, /marketingPreferences: \{ none: \{ businessId:/, 'el backfill solo agrega preferencias ausentes')
assert.match(backfill, /skipDuplicates: true/, 'el backfill no pisa bajas')
assert.match(backfill, /--apply/, 'el backfill requiere confirmación explícita')
console.log('Workshop marketing consent contract: OK')
