import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runbook = readFileSync(new URL('../docs/barber-demo-lead-form-pilot.md', import.meta.url), 'utf8')

assert.match(runbook, /BENEFIT[^\n]*RewardClaim/)
assert.match(runbook, /NONE[^\n]*benefitAvailable=false/)
assert.match(runbook, /rewardClaim=null/)
assert.match(runbook, /Instagram[^\n]*landing[^\n]*Pipeline/i)
assert.match(runbook, /FILE[^\n]*diferid/i)
assert.match(runbook, /leadCaptureFormsEnabled[^\n]*false/)
assert.match(runbook, /rollback/i)
assert.match(runbook, /E2E[\s\S]*staging|E2E[\s\S]*entorno controlado/i)
assert.match(runbook, /flag[\s\S]*temporalmente habilitado[\s\S]*formulario publicado/i)
assert.match(runbook, /producci[oó]n[\s\S]*no[\s\S]*activar[\s\S]*PASS/i)
assert.doesNotMatch(runbook, /E2E con el flag todavía apagado en producción/i)

console.log('lead form rollout runbook contract: PASS')
