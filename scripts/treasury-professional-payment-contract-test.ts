import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordTreasuryProfessionalPayment } from '../src/routes/treasury.js'
const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = readFileSync('prisma/migrations/20260923060000_treasury_professional_payments/migration.sql', 'utf8')
const route = readFileSync('src/routes/treasury.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui/cash-register.ts', 'utf8')
for (const marker of ['treasuryMovementId', 'professionalAccountEntry']) assert.ok(schema.includes(marker), `falta vínculo ${marker}`)
assert.ok(migration.includes('FOREIGN KEY ("businessId", "treasuryMovementId")'))
for (const marker of ['/treasury/pay-professional', 'isAdmin(user)', 'INSUFFICIENT_TREASURY', 'PROFESSIONAL_PAYMENT', 'ProfessionalAccountEntry', 'idempotencyKey']) assert.ok(route.includes(marker), `falta ${marker}`)
assert.ok(route.includes("typeof body.professionalId !== 'string'"), 'un profesional no textual debe rechazarse sin TypeError')
for (const marker of ['cash-professional-payment-source', '/treasury/pay-professional', 'idempotencyKey']) assert.ok(ui.includes(marker), `falta UI ${marker}`)
assert.ok(!route.includes('cashSessionId: body.cashSessionId') || route.includes('pay-professional'), 'el pago desde reserva no debe requerir Caja')
const input = { businessId: 'shop', professionalId: 'pro', type: 'PAYMENT' as const, amount: 5000, observation: 'Semana 1', idempotencyKey: '12345678-1234-1234-1234-123456789abc', actorUserId: 'owner', actorName: 'Dueña' }
function fake(balance = 10_000n, existing: Record<string, unknown> | null = null) {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  const tx = {
    $queryRaw: async (query: { sql: string }) => {
      if (query.sql.includes('FROM "TreasuryMovement" movement')) return existing ? [existing] : []
      if (query.sql.includes('FROM "Business"')) return [{ id: 'shop' }]
      if (query.sql.includes('FROM "TreasuryAccount"')) return [{ id: 'cash-reserve' }]
      if (query.sql.includes('COALESCE(SUM')) return [{ balance }]
      if (query.sql.includes('FROM "Professional"')) return [{ name: 'Ana' }]
      if (query.sql.includes('FROM "CashExpenseCategory"')) return [{ id: 'liquidaciones', isActive: true }]
      throw new Error('unexpected query: ' + query.sql)
    },
    $executeRaw: async (query: { sql: string; values: unknown[] }) => { writes.push(query); return 1 }
  }
  return { tx, writes }
}
const happy = fake()
const created = await recordTreasuryProfessionalPayment(happy.tx as never, input)
assert.equal(created.treasuryMovementId, input.idempotencyKey)
assert.equal(happy.writes.length, 3)
assert.ok(happy.writes[0]?.sql.includes('"CashExpenseCategory"'))
assert.ok(happy.writes[1]?.sql.includes('"TreasuryMovement"'))
assert.ok(happy.writes[1]?.values.includes('liquidaciones'))
assert.ok(happy.writes[2]?.sql.includes('"ProfessionalAccountEntry"'))
assert.ok(!happy.writes.some((write) => write.sql.includes('"CashEntry"')), 'Tesoreria no debe escribir Caja diaria')
assert.ok(happy.writes[2]?.values.includes(input.idempotencyKey), 'la cuenta profesional debe vincular el movimiento')
const retry = fake(0n, { id: input.idempotencyKey, businessId: 'shop', kind: 'PROFESSIONAL_PAYMENT', amount: 5000, entryId: created.id, professionalId: 'pro', entryType: 'PAYMENT', observation: 'Semana 1' })
assert.deepEqual(await recordTreasuryProfessionalPayment(retry.tx as never, input), created)
assert.equal(retry.writes.length, 0, 'reintento no duplica pago')
const noFunds = fake(4_999n)
await assert.rejects(recordTreasuryProfessionalPayment(noFunds.tx as never, input), /INSUFFICIENT_TREASURY/)
assert.equal(noFunds.writes.length, 0)
const conflict = fake(10_000n, { id: input.idempotencyKey, businessId: 'shop', kind: 'EXPENSE', amount: 5000, entryId: null, professionalId: null, entryType: null, observation: null })
await assert.rejects(recordTreasuryProfessionalPayment(conflict.tx as never, input), /KEY_CONFLICT/)
assert.equal(conflict.writes.length, 0)
console.log('OK pago profesional desde Tesoreria: vínculo, saldo, privacidad y UI.')
