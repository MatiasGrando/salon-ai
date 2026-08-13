import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const serviceRoute = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

assert.match(crmUi, /id="service-association-list"/)
assert.match(crmUi, /data-service-addon=/)
assert.match(crmUi, /data-service-policy=/)
assert.match(crmUi, /serviceAssociationConfig/)
assert.match(crmUi, /\['DEFAULT', 'Configuraci&oacute;n general'\]/)
assert.match(crmUi, /\['ALLOWED', 'Se pueden reservar juntos'\]/)
assert.match(crmUi, /\['REVIEW_REQUIRED', 'Consultar al equipo'\]/)
assert.match(crmUi, /\['BLOCKED', 'No se pueden combinar'\]/)

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
assert.doesNotMatch(
  crmUi,
  /id="service-family-selection-mode"/,
  'La regla de variantes no debe aparecer en el formulario de un servicio.'
)
assert.match(crmUi, /id="service-family-selection-mode-dialog"/)
assert.match(crmUi, /<option value="ONE_OF">Elegir una sola variante<\/option>/)
assert.match(crmUi, /<option value="MULTIPLE">Permitir varias variantes<\/option>/)
assert.match(crmUi, /id="service-family-dialog" hidden/)
assert.match(crmUi, /id="service-family-list"/)
assert.doesNotMatch(crmUi, /id="service-family-category"/)
assert.match(crmUi, /function openServiceFamilyDialog\(\)/)
assert.match(crmUi, /els\.serviceFamilyDialog\.hidden = false/)
assert.match(crmUi, /async function saveServiceFamily\(\)/)
assert.match(crmUi, /function editServiceFamily\(id\)/)
assert.match(crmUi, /async function deleteServiceFamily\(id\)/)
assert.match(crmUi, /isBookable: false/)
assert.match(crmUi, /variantSelectionMode: els\.serviceFamilySelectionModeDialog\.value/)
assert.match(crmUi, /Familia o variante \(opcional\)/)
assert.match(crmUi, /id="service-editor-collapsible"/)
assert.match(crmUi, /id="service-list-collapsible" open/)
assert.match(crmUi, /id="service-main-section" open/)
assert.match(crmUi, /id="service-booking-section"/)
assert.match(crmUi, /id="service-organization-section"/)
assert.match(crmUi, /Duraci&oacute;n en agenda/)
assert.match(serviceRoute, /normalizeVariantSelectionMode/)
assert.match(schema, /enum ServiceVariantSelectionMode/)
assert.match(schema, /variantSelectionMode\s+ServiceVariantSelectionMode\s+@default\(ONE_OF\)/)

const estimateEditorStart = crmUi.indexOf('id="service-estimate-editor"')
const finalClarificationStart = crmUi.indexOf('class="service-final-clarification-editor"')
const validationToggleStart = crmUi.indexOf('id="service-validation-enabled"')
assert.ok(estimateEditorStart >= 0)
assert.ok(finalClarificationStart > estimateEditorStart)
assert.ok(validationToggleStart > finalClarificationStart)
assert.match(crmUi, /estimateDisclaimer: isGroup\s+\? null\s+: els\.serviceEstimateDisclaimer\.value\.trim\(\) \|\| null/)
assert.match(
  crmUi,
  /El bot enviar&aacute; esta informaci&oacute;n antes de confirmar la reserva o finalizar la derivaci&oacute;n de este servicio\./
)

console.log('Service association UI contract tests passed.')
