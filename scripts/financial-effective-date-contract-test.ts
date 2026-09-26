import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { treasuryRoutes } from '../src/routes/treasury.js'
import { cashRegisterRoutes } from '../src/routes/cash-register.js'
import {
  financialCorrectionDirections,
  isFinancialEffectiveDate
} from '../src/services/financial-effective-date.js'

assert.equal(isFinancialEffectiveDate('2026-09-26'), true)
assert.equal(isFinancialEffectiveDate('2026-02-29'), false)
assert.equal(isFinancialEffectiveDate('26/09/2026'), false)
assert.deepEqual(financialCorrectionDirections('INFLOW'), { reversal: 'OUTFLOW', replacement: 'INFLOW' })
assert.deepEqual(financialCorrectionDirections('OUTFLOW'), { reversal: 'INFLOW', replacement: 'OUTFLOW' })

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schema, /model TreasuryMovement[\s\S]*effectiveAt\s+DateTime/)
assert.match(schema, /model TreasuryMovement[\s\S]*correctionSourceId\s+String\?/)
assert.match(schema, /model TreasuryMovement[\s\S]*correctionRole\s+String\?/)
assert.match(schema, /model CashEntry[\s\S]*correctionSourceId\s+String\?/)
assert.match(schema, /model CashEntry[\s\S]*correctionReason\s+String\?/)

const migration = readFileSync(new URL('../prisma/migrations/20260926010000_financial_effective_dates/migration.sql', import.meta.url), 'utf8')
assert.match(migration, /ADD COLUMN "effectiveAt" TIMESTAMP\(3\)/)
assert.match(migration, /UPDATE "TreasuryMovement" SET "effectiveAt" = "createdAt"/)
assert.equal((migration.match(/UPDATE "TreasuryMovement" SET "effectiveAt" = "createdAt"/g) || []).length, 1)
assert.match(migration, /TreasuryMovement_effectiveAt_id_idx/)
assert.match(migration, /CashEntry_correctionSourceId_fkey/)

const treasury = readFileSync(new URL('../src/routes/treasury.ts', import.meta.url), 'utf8')
assert.match(treasury, /effectiveDate/)
assert.match(treasury, /movement\."effectiveAt"/)
assert.match(treasury, /\/treasury\/movements\/:id\/correct-date/)
assert.match(treasury, /TREASURY_DATE_ALREADY_CORRECTED/)
assert.match(treasury, /correctionRole/)
assert.match(treasury, /financialCorrectionDirections\(source[.]direction\)/)
assert.match(treasury, /row[.]effectiveDate !== input[.]effectiveDate/)

const cash = readFileSync(new URL('../src/routes/cash-register.ts', import.meta.url), 'utf8')
assert.match(cash, /\/cash-register\/entries\/:id\/correct-date/)
assert.match(cash, /CASH_DATE_ALREADY_CORRECTED/)
assert.match(cash, /financialCorrectionDirections\(source[.]direction\)/)
assert.match(cash, /source[.]registerDayId \? target\?[.]registerDayId/)
assert.match(cash, /CASH_CORRECTION_TARGET_DAY_REQUIRED/)
assert.match(cash, /responsibleUserId.*IS NOT DISTINCT FROM.*responsibleUserId/)
assert.doesNotMatch(cash, /\['PAYMENT', 'LEGACY_PAYMENT', 'INCOME', 'EXPENSE'\][.]includes\(source[.]type\)/)

const repository = readFileSync(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
assert.match(repository, /dateCorrected/)
assert.match(repository, /correctionSourceId/)

const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(ui, /cash-treasury-outflow-date/)
assert.match(ui, /cash-professional-payment-date/)
assert.match(ui, /cash-financial-date-dialog/)
assert.match(ui, /Registrado:/)
assert.match(ui, /Corregir fecha/)
assert.match(ui, /data-treasury-correct-date/)
assert.match(ui, /data-cash-correct-date/)
assert.match(ui, /entryList[.]addEventListener\('click'/)
assert.match(ui, /cash-treasury-entries'\)[.]addEventListener\('click'/)
assert.match(ui, /cash-financial-date-form'\)[.]addEventListener\('submit'/)
assert.doesNotMatch(ui, /window[.]prompt|window[.]confirm/)

const app = Fastify()
app.addHook('preHandler', async (request) => { request.auth = { user: { role: 'STAFF', businessId: 'shop', id: 'secretary', name: 'Secretaria' } as never } })
await app.register(treasuryRoutes)
await app.register(cashRegisterRoutes)
for (const path of ['/treasury/movements/movement-1/correct-date', '/cash-register/entries/entry-1/correct-date']) {
  const response = await app.inject({ method: 'POST', url: path, payload: { effectiveDate: '2026-09-25', reason: 'Fecha equivocada' } })
  assert.equal(response.statusCode, 403, path)
}
await app.close()
console.log('financial effective date contract: OK')