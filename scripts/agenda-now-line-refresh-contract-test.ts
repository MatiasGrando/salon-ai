import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /agendaNowLineTimer:\s*null/)
assert.match(source, /function updateAgendaNowLine\(\)/)
assert.match(source, /function startAgendaNowLineTimer\(\)/)
assert.match(source, /function stopAgendaNowLineTimer\(\)/)
assert.match(source, /60000\s*-\s*\(Date\.now\(\)\s*%\s*60000\)/)
assert.match(source, /document\.addEventListener\('visibilitychange', handleAgendaNowLineVisibilityChange\)/)
assert.match(source, /if \(section === 'agenda'\) \{[\s\S]*startAgendaNowLineTimer\(\)/)
assert.match(source, /else \{\s*stopAgendaNowLineTimer\(\)\s*\}/)

const updater = source.match(/function updateAgendaNowLine\(\) \{([\s\S]*?)\n    \}\n\n    function startAgendaNowLineTimer/)?.[1] || ''
assert.ok(updater, 'No se encontró el cuerpo del actualizador de la línea horaria.')
assert.doesNotMatch(updater, /getJson\(|loadAgenda\(|fetch\(/)
assert.match(updater, /querySelectorAll/)
assert.match(updater, /style\.top/)

console.log('OK: la linea horaria se actualiza localmente sin consultar servidor ni base de datos.')
