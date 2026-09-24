import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(ui, /const isStaffCash = state\.currentUser\?\.role === 'STAFF'/)
assert.match(ui, /state\.cashRegister\.selectedDayId = isStaffCash \? \(current\.day\?\.id \|\| null\)/)
assert.match(ui, /cashUi\.viewPeriod\.hidden = !canViewCash \|\| isStaffCash/)
assert.match(ui, /cashUi\.daySelect\.disabled = state\.currentUser\?\.role === 'STAFF'/)
assert.match(ui, /cashDate\(service\.appointment\.startAt\)/, 'fecha y hora del turno deben figurar juntas')
assert.match(ui, /responsibleUsers\.concat\(.*currentUser/, 'la lista local debe incluir al administrador actual')
assert.match(ui, /cashSessionNeedsRefresh = operationSaved/, 'no se debe repetir la apertura si el POST se guardó y falló el refresco')
assert.match(ui, /cash-session-loading/, 'la apertura debe indicar carga mientras actualiza la jornada')
assert.match(ui, /await loadCashRegister\(\)[\s\S]{0,100}closeCashSessionDialog\(\)/, 'no mostrar datos viejos entre POST y refresco')
console.log('OK alcance de Caja, fecha de turno y carga de apertura en UI')
