import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const response = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(response.statusCode, 200)
assert.match(response.body, /<title>Weex<\/title>/)
assert.match(response.body, /Administr&aacute; tu negocio/)
assert.doesNotMatch(response.body, /CRM Salon AI|Juan Sal&oacute;n|Salon AI/)

const scripts = [...response.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
assert.ok(scripts.length > 0, 'CRM should include inline scripts')
assert.match(response.body, /escapeHtml\(manualCurrent\.whatsappAppUrl\)/, 'manual campaign should deep-link into WhatsApp app')
assert.doesNotMatch(response.body, /escapeHtml\(manualCurrent\.whatsappUrl\) \+ '" target="_blank"/, 'manual campaign should not open a new web tab')
const manualUpdate = response.body.match(/async function updateManualCampaignRecipient\([\s\S]*?\n    \}/)?.[0] || ''
assert.match(manualUpdate, /state\.campaignManualExecutions\[campaign\.id\] = execution\s+renderCampaignDetail\(\)\s+if \(status === 'SENT'\)/, 'the next recipient should render before refreshing delivery history')
assert.doesNotMatch(manualUpdate, /await getJson\('\/campaigns\/' \+ campaign\.id \+ '\/deliveries'\)/, 'delivery history should not block moving to the next recipient')
assert.match(response.body, /id="template-variable-picker"/, 'template builder should expose a persistent variable picker')
const pickerSource = response.body.match(/function renderTemplateVariablePicker\(\) \{[\s\S]*?\n    \}/)?.[0] || ''
const insertSource = response.body.match(/function insertTemplateVariable\(variable\) \{[\s\S]*?\n    \}/)?.[0] || ''
assert.ok(pickerSource && insertSource, 'variable picker should render options and insert selected variables')
const typoSource = response.body.match(/function normalizeTemplateVariableTypos\(text\) \{[\s\S]*?\n    \}/)?.[0] || ''
const fixBodySource = response.body.match(/function correctTemplateBodyVariableTypos\(\) \{[\s\S]*?\n    \}/)?.[0] || ''
assert.ok(typoSource && fixBodySource, 'template editor should correct the known missing-s typo')
const extractSource = response.body.match(/function extractTemplateVariables\(text\) \{[\s\S]*?\n    \}/)?.[0] || ''
assert.ok(extractSource, 'rendered CRM must include template variable extraction')
const extractTemplateVariables = new Function(extractSource + '; return extractTemplateVariables')()
assert.deepEqual(extractTemplateVariables('{{servicios_vencidos}}'), ['servicios_vencidos'])
assert.deepEqual(extractTemplateVariables('{{ssssssessrvicios_vencidos}}'), ['ssssssessrvicios_vencidos'], 'the rendered regex must not consume leading s characters')
const supportedSource = response.body.match(/function supportedTemplateVariables\(category = selectedTemplateCategory\(\)\) \{[\s\S]*?\n    \}/)?.[0] || ''
assert.ok(supportedSource, 'rendered CRM must include business-aware template variables')
const salonSupportedVariables = new Function('selectedTemplateCategory', 'isWorkshopBusiness', supportedSource + '; return supportedTemplateVariables')(
  () => 'MARKETING',
  () => false
)
const workshopSupportedVariables = new Function('selectedTemplateCategory', 'isWorkshopBusiness', supportedSource + '; return supportedTemplateVariables')(
  () => 'MARKETING',
  () => true
)
assert.doesNotMatch(salonSupportedVariables().join(','), /patente|servicios_vencidos/, 'salons must not offer workshop-only variables')
assert.deepEqual(
  workshopSupportedVariables(),
  ['nombre_cliente', 'usuario', 'fecha_ultima_visita', 'patente', 'servicios_vencidos', 'enlace_historial'],
  'workshops must keep their marketing variables'
)
const normalizeTemplateVariableTypos = new Function(typoSource + '; return normalizeTemplateVariableTypos')()
assert.equal(normalizeTemplateVariableTypos('{{ervicios_vencidos}}'), '{{servicios_vencidos}}')
assert.equal(normalizeTemplateVariableTypos('{{servicios_vencidos}}'), '{{servicios_vencidos}}')
assert.equal(normalizeTemplateVariableTypos('{{ssssssservicios_vencidos}}'), '{{ssssssservicios_vencidos}}', 'the typo fixer must not consume additional leading s characters')
const previewSource = response.body.match(/function templatePreviewText\(\) \{[\s\S]*?\n    \}/)?.[0] || ''
assert.ok(previewSource, 'rendered CRM must include the template preview')
const preview = new Function('els', 'state', previewSource + '; return templatePreviewText')(
  { templateBody: { value: 'Hola {{servicios_vencidos}}' } },
  { templateDraftExamples: { servicios_vencidos: 'Cambio de aceite' } }
)
assert.equal(preview(), 'Hola Cambio de aceite', 'preview must resolve the complete variable name')
assert.equal(normalizeTemplateVariableTypos('{{ervicios_vencidos_extra}}'), '{{ervicios_vencidos_extra}}')
const typoText = { value: 'Hola {{ervicios_vencidos}}!', selectionStart: 26, selectionEnd: 26, setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end } }
const fixBody = new Function('els', 'normalizeTemplateVariableTypos', fixBodySource + '; return correctTemplateBodyVariableTypos')({ templateBody: typoText }, normalizeTemplateVariableTypos)
fixBody()
assert.equal(typoText.value, 'Hola {{servicios_vencidos}}!')
assert.equal(typoText.selectionStart, 27)
assert.match(response.body, /templateBody\.addEventListener\('input', \(\) => \{ correctTemplateBodyVariableTypos\(\)/)
const textarea = {
  value: 'Hola mundo', selectionStart: 5, selectionEnd: 5, focused: false,
  setRangeText(token: string, start: number, end: number) {
    this.value = this.value.slice(0, start) + token + this.value.slice(end)
    this.selectionStart = this.selectionEnd = start + token.length
  },
  focus() { this.focused = true }
}
const picker = { options: [] as Array<{ text: string; value: string }>, value: '', replaceChildren(...options: Array<{ text: string; value: string }>) { this.options = options } }
const elements = { templateBody: textarea, templateVariablePicker: picker, templateVariablePickerHelp: { textContent: '' } }
let category = 'MARKETING'
const supported = () => category === 'MARKETING' ? ['nombre_cliente', 'servicios_vencidos'] : ['fecha_turno']
const OptionMock = class { constructor(public text: string, public value: string) {} }
const renderPicker = new Function('els', 'supportedTemplateVariables', 'selectedTemplateCategory', 'isWorkshopBusiness', 'Option', pickerSource + '; return renderTemplateVariablePicker')(
  elements, supported, () => category, () => false, OptionMock
)
const insertVariable = new Function('els', 'supportedTemplateVariables', 'renderTemplateVariables', 'updateTemplateBuilderPreview', insertSource + '; return insertTemplateVariable')(
  elements, supported, () => {}, () => {}
)
renderPicker()
assert.deepEqual(picker.options.map(option => option.value), ['', 'nombre_cliente', 'servicios_vencidos'])
insertVariable('servicios_vencidos')
assert.equal(textarea.value, 'Hola {{servicios_vencidos}}mundo')
assert.equal(textarea.focused, true)
assert.deepEqual(picker.options.map(option => option.value), ['', 'nombre_cliente', 'servicios_vencidos'], 'the picker must remain populated after inserting a variable')
category = 'UTILITY'
renderPicker()
assert.deepEqual(picker.options.map(option => option.value), ['', 'fecha_turno'], 'changing template category should update available variables')
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script)
  } catch (error) {
    throw new Error(`CRM inline script ${index} does not compile: ${error instanceof Error ? error.message : error}`)
  }
}

await app.close()
console.log(`CRM inline scripts compile: OK (${scripts.length})`)
