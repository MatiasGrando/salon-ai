import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /@media \(max-width: 767px\)[\s\S]*body\[data-current-section="professionals"\] \.professionals-view\.form-open \.professionals-main\s*\{[\s\S]*display:\s*none/)
assert.match(source, /\.professional-service-option input\[type="checkbox"\]\s*\{[\s\S]*width:\s*20px !important[\s\S]*flex:\s*0 0 20px/)
assert.match(source, /\.professional-service-option > span\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/)
assert.match(source, /els\.professionalServicesSection\.open = window\.matchMedia\('\(max-width: 767px\)'\)\.matches/)
assert.match(source, /function openProfessionalPanel\(\)[\s\S]*els\.professionalsView\.scrollTop = 0[\s\S]*professionalPanelScroll\?\.scrollTo/)
assert.match(source, /\.professional-form \.config-actions\s*\{[\s\S]*position:\s*sticky/)

console.log('OK: el editor de profesionales conserva servicios visibles y editables en móvil.')
