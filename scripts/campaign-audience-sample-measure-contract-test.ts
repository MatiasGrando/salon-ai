import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const script = readFileSync(new URL('./measure-campaign-audience-sample.ts', import.meta.url), 'utf8')
assert.match(script, /SET TRANSACTION READ ONLY/, 'todas las consultas deben ejecutarse en una transacción read-only')
assert.match(script, /LIMIT 100/, 'la muestra no debe exceder 100 clientes')
assert.match(script, /customerId: \{ in: sampleIds \}/, 'las lecturas pesadas deben restringirse a la muestra')
assert.match(script, /process\.cpuUsage/, 'medir CPU del proceso')
assert.match(script, /process\.memoryUsage/, 'medir pico de memoria')
assert.match(script, /Buffer\.byteLength\(JSON\.stringify\(rows\)/, 'medir bytes de resultados serializados')
assert.doesNotMatch(script, /sendTemplateMessage|manual-executions|process-automated|execute-one-time/, 'la medición no puede enviar mensajes')
console.log('Campaign audience sample measure contract: OK')