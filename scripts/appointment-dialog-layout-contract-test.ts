import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /class="dialog appointment-dialog-card"/)
assert.match(source, /<details class="appointment-additional" id="appointment-additional">/)
assert.match(source, /<summary>[\s\S]*Informaci&oacute;n adicional[\s\S]*<\/summary>/)
assert.match(source, /appointmentAdditional:\s*document\.getElementById\('appointment-additional'\)/)
assert.match(source, /els\.appointmentAdditional\.open = Boolean\(/)
assert.match(source, /\.appointment-dialog-card\s*\{[\s\S]*width:\s*min\(680px, 100%\)/)
assert.match(source, /\.appointment-form \.dialog-actions\s*\{[\s\S]*position:\s*sticky/)
assert.match(source, /\.appointment-form label\s*\{[\s\S]*color:\s*#334155/)
assert.match(source, /\.appointment-form :is\(\.field, select, textarea\)\s*\{[\s\S]*border-color:\s*#b8c4d4/)
assert.match(source, /\.appointment-form :is\(\.field, select, textarea\):hover\s*\{[\s\S]*border-color:\s*#94a3b8/)
assert.match(source, /\.appointment-additional\s*\{[\s\S]*border:\s*1px solid #b8c4d4/)
assert.doesNotMatch(source, /for="appointment-customer-phone"[^>]*>Tel&eacute;fono\s*<span class="optional-label"/)
assert.doesNotMatch(source, /id="appointment-customer-name"[^>]*placeholder=/)
assert.doesNotMatch(source, /id="appointment-customer-phone"[^>]*placeholder=/)
assert.doesNotMatch(source, /id="appointment-notes"[^>]*placeholder=/)
assert.doesNotMatch(source, /Sin tel&eacute;fono, el turno se guarda como cliente presencial provisional/)
assert.doesNotMatch(source, /Nuevo turno r[aá]pido/)

console.log('OK: el formulario de turnos prioriza campos esenciales y agrupa la informacion adicional.')
