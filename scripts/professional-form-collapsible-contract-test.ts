import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

for (const id of [
  'professional-basic-section',
  'professional-services-section',
  'professional-schedule-section',
  'professional-settings-section'
]) {
  assert.match(source, new RegExp('<details[^>]+id="' + id + '"'))
}

assert.match(source, /<summary>[\s\S]*Datos principales[\s\S]*<\/summary>/)
assert.match(source, /<summary>[\s\S]*Servicios[\s\S]*<\/summary>/)
assert.match(source, /<summary>[\s\S]*Horarios de disponibilidad[\s\S]*<\/summary>/)
assert.match(source, /<summary>[\s\S]*Estado y reservas[\s\S]*<\/summary>/)
assert.match(source, /professionalScheduleSection:\s*document\.getElementById\('professional-schedule-section'\)/)
assert.match(source, /els\.professionalScheduleSection\.open = true/)
assert.match(source, /\.professional-form-section\s*\{[\s\S]*border:\s*1px solid #d7dfeb/)
assert.match(source, /\.professional-form-section > summary\s*\{[\s\S]*cursor:\s*pointer/)

console.log('OK: el editor de profesionales organiza sus campos en secciones desplegables.')
