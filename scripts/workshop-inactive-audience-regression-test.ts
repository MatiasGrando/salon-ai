import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const service = readFileSync('src/services/workshop-campaign-audience.ts', 'utf8')
const campaign = readFileSync('src/routes/campaign.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const inactiveSql = service.slice(service.indexOf('export async function loadWorkshopInactiveAudience'), service.indexOf('export async function loadWorkshopMaintenanceDueAudience'))
assert.doesNotMatch(inactiveSql, /cycle\."lastPerformedDate"/, 'la consulta de inactivos no debe referir a una tabla ausente')
assert.match(inactiveSql, /recent\."lastVisitDate" AS "lastVisitDate"/)
assert.match(campaign, /campaign\.segment === 'INACTIVE' && business\?\.businessType === 'WORKSHOP'/, 'campañas viejas de Mecánica deben usar trabajos')
assert.match(ui, /option\.value === 'INACTIVE' && workshopBusiness/, 'no ofrecer el segmento de salón en Mecánica')
console.log('Workshop inactive audience regression: OK')
