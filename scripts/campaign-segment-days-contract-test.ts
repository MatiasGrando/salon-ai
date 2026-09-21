import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const form = ui.slice(ui.indexOf('<form class="campaign-form" id="campaign-form">'), ui.indexOf('</form>', ui.indexOf('<form class="campaign-form" id="campaign-form">')))
const segmentField = form.indexOf('id="campaign-segment-days-field"')
const automationSettings = form.indexOf('id="campaign-automation-settings"')

assert.ok(segmentField > form.indexOf('id="campaign-segment"'), 'el umbral debe estar junto al segmento')
assert.ok(segmentField < automationSettings, 'el umbral debe estar disponible también en campañas puntuales')
assert.match(ui, /campaignSegmentDaysField\.hidden = !campaignSegmentNeedsDays\(segment\)/)
assert.match(ui, /campaignSegmentDays\.required = campaignSegmentNeedsDays\(segment\)/)
assert.match(ui, /D&iacute;as sin venir/, 'explicar el umbral de inactividad')
assert.match(ui, /segmentDays:?[\s\S]{0,160}els\.campaignSegmentDays\.value/, 'enviar el umbral elegido')
assert.match(route, /if \(requireSegmentDays && \['INACTIVE', 'ONE_TIME_VISITOR', 'NEW_CUSTOMER'\]\.includes\(segment\) && segmentDays === null\)/, 'exigir el umbral para nuevas campañas')
assert.match(route, /normalizeCampaignInput\(body, reply, true, true\)/, 'validar al crear')
assert.match(route, /body\.segment !== undefined && body\.segment !== current\.segment/, 'validar al cambiar de segmento sin bloquear campañas existentes')
assert.match(route, /campaign\.segmentDays \?\? 45/, 'usar el umbral al calcular audiencia')

console.log('Campaign segment days contract: OK')