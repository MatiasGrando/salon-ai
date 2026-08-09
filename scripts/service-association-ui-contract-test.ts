import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const serviceRoute = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

assert.match(crmUi, /id="service-association-list"/)
assert.match(crmUi, /data-service-addon=/)
assert.match(crmUi, /data-service-policy=/)
assert.match(crmUi, /serviceAssociationConfig/)
assert.match(crmUi, /\['DEFAULT', 'Sin regla espec&iacute;fica'\]/)
assert.match(crmUi, /\['ALLOWED', 'Permitida'\]/)
assert.match(crmUi, /\['REVIEW_REQUIRED', 'Revisi&oacute;n requerida'\]/)
assert.match(crmUi, /\['BLOCKED', 'No permitida'\]/)

assert.doesNotMatch(crmUi, /id="service-suggested-addons"/)
assert.doesNotMatch(crmUi, /id="service-allowed-combinations"/)
assert.doesNotMatch(crmUi, /id="service-review-combinations"/)
assert.doesNotMatch(crmUi, /id="service-blocked-combinations"/)

assert.match(
  crmUi,
  /suggestedAddon: select\.value === 'BLOCKED' \? false : current\.suggestedAddon/,
  'Al bloquear una combinaci\u00f3n debe quitarse autom\u00e1ticamente como extra.'
)
assert.match(
  crmUi,
  /checkbox\.checked && current\.policy === 'BLOCKED' \? 'DEFAULT' : current\.policy/,
  'Al ofrecer un servicio bloqueado como extra debe volver a una pol\u00edtica compatible.'
)

for (const payloadField of [
  'suggestedAddonIds',
  'allowedCombinationServiceIds',
  'reviewCombinationServiceIds',
  'blockedCombinationServiceIds'
]) {
  assert.match(crmUi, new RegExp('\\b' + payloadField + '\\b'))
}

assert.match(crmUi, /id="service-family-open"/, 'Familias debe aparecer junto a categorías en Servicios.')
assert.match(crmUi, /id="service-family-selection-mode"/)
assert.match(crmUi, /<option value="ONE_OF">Elegir una variante<\/option>/)
assert.match(crmUi, /<option value="MULTIPLE">Permitir varias variantes<\/option>/)
assert.match(crmUi, /function openServiceFamilyEditor\(\)/)
assert.match(crmUi, /variantSelectionMode,/)
assert.match(crmUi, /Familia \(opcional\)/)
assert.match(serviceRoute, /normalizeVariantSelectionMode/)
assert.match(schema, /enum ServiceVariantSelectionMode/)
assert.match(schema, /variantSelectionMode\s+ServiceVariantSelectionMode\s+@default\(ONE_OF\)/)

console.log('Service association UI contract tests passed.')
