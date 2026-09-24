import assert from 'node:assert/strict'
import { CashService } from '../src/services/cash-service.js'
import { resolveRegisterOpeningCash } from '../src/services/cash-domain.js'

function fixture({ treasuryEnabled = true, failAtClose = false } = {}) {
  const initial = {
    day: { id: 'day', businessId: 'shop', openingCash: 20_000, openedAt: new Date('2026-09-23T10:00:00Z'), closedAt: null as Date | null, expectedClosingCash: null as number | null, countedClosingCash: null as number | null, closingDifference: null as number | null },
    session: { id: 'session', businessId: 'shop', registerDayId: 'day', responsibleUserId: 'admin', responsibleName: 'Dueña', openedAt: new Date('2026-09-23T10:00:00Z'), closedAt: null as Date | null, expectedCash: null as number | null, countedCash: null as number | null, cashDifference: null as number | null },
    entries: [{ type: 'PAYMENT' as const, direction: 'INFLOW' as const, amount: 100_000, method: 'CASH' as const, cashSessionId: 'session' }],
    movements: [] as Array<{ amount: number; cashEntryId: string; actorUserId: string }>
  }
  let state = structuredClone(initial)
  const service = new CashService({
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const draft = structuredClone(state)
      const tx = {
        lockBusiness: async () => ({ businessId: 'shop', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-23T20:00:00Z') }),
        findOpenDay: async () => draft.day.closedAt ? null : draft.day,
        findOpenSession: async () => draft.session.closedAt ? null : draft.session,
        listDayEntries: async () => draft.entries,
        listDaySessions: async () => [draft.session],
        findTreasuryCashAccount: async () => treasuryEnabled ? { id: 'reserve' } : null,
        insertCashOperation: async (input: { id: string; type: string; amount: number; method: string; cashSessionId: string; counterparty: string | null }) => { assert.ok(input.counterparty?.trim(), "CashEntry_shape_check requires a withdrawal counterparty"); draft.entries.push({ id: input.id, type: input.type as 'PAYMENT', direction: 'OUTFLOW', amount: input.amount, method: input.method as 'CASH', cashSessionId: input.cashSessionId }); return input },
        insertTreasuryMovement: async (input: { amount: number; cashEntryId: string; actorUserId: string }) => { draft.movements.push(input); return input },
        closeSession: async (input: Record<string, number | Date>) => { Object.assign(draft.session, input); return draft.session },
        closeDay: async (input: Record<string, number | Date>) => { if (failAtClose) throw new Error('forced close failure'); Object.assign(draft.day, input); return draft.day }
      }
      const result = await work(tx)
      state = draft
      return result
    }
  } as never)
  return { service, get state() { return state } }
}

const input = { businessId: 'shop', currentSessionId: 'session', countedCash: 120_000, cashToLeave: 20_000, actorUserId: 'admin', actorName: 'Dueña' }
const valid = fixture()
const closed = await valid.service.closeRegisterDay(input)
assert.equal(closed.transferAmount, 100_000)
assert.equal(closed.day.countedClosingCash, 20_000)
assert.equal(resolveRegisterOpeningCash({ previousCountedCash: closed.day.countedClosingCash, firstOpeningCash: null }), 20_000)
assert.equal(closed.day.expectedClosingCash, 20_000)
assert.equal(closed.day.closingDifference, 0)
assert.equal(closed.session.countedCash, 20_000)
assert.equal(valid.state.movements[0]?.cashEntryId, valid.state.entries.at(-1)?.id)
assert.equal(valid.state.movements[0]?.actorUserId, 'admin')
assert.equal(valid.state.movements[0]?.amount, 100_000)
await assert.rejects(valid.service.closeRegisterDay(input), { code: 'CASH_CLOSED' })
assert.equal(valid.state.movements.length, 1)

const different = fixture()
const differenceClose = await different.service.closeRegisterDay({ ...input, countedCash: 119_000, acknowledgeDifference: true })
assert.equal(differenceClose.day.closingDifference, -1_000)
assert.equal(differenceClose.day.expectedClosingCash, 21_000)
assert.equal(differenceClose.day.countedClosingCash, 20_000)
assert.equal(different.state.movements[0]?.amount, 99_000)

for (const cashToLeave of [-1, 120_001, 1.5]) {
  const invalid = fixture()
  await assert.rejects(invalid.service.closeRegisterDay({ ...input, cashToLeave }), { code: 'INVALID_CASH_TO_LEAVE' })
  assert.equal(invalid.state.movements.length, 0)
}
const unconfirmed = fixture()
await assert.rejects(unconfirmed.service.closeRegisterDay({ ...input, countedCash: 119_000 }), { code: 'CASH_DIFFERENCE_CONFIRMATION_REQUIRED' })
assert.equal(unconfirmed.state.movements.length, 0)
const zeroTransfer = fixture({ treasuryEnabled: false })
const zeroClose = await zeroTransfer.service.closeRegisterDay({ ...input, cashToLeave: 120_000 })
assert.equal(zeroClose.transferAmount, 0)
assert.equal(zeroTransfer.state.movements.length, 0)

const disabled = fixture({ treasuryEnabled: false })
await assert.rejects(disabled.service.closeRegisterDay(input), { code: 'TREASURY_NOT_ENABLED' })
assert.equal(disabled.state.day.closedAt, null)
const failed = fixture({ failAtClose: true })
await assert.rejects(failed.service.closeRegisterDay(input), /forced close failure/)
assert.equal(failed.state.movements.length, 0)
assert.equal(failed.state.entries.length, 1)
assert.equal(failed.state.day.closedAt, null)

const legacy = fixture()
const oldClose = await legacy.service.closeRegisterDay({ businessId: 'shop', currentSessionId: 'session', countedCash: 120_000 })
assert.equal(oldClose.day.countedClosingCash, 120_000)
assert.equal(legacy.state.movements.length, 0)
console.log('OK cierre de Caja: cambio, arqueo, atomicidad y compatibilidad.')
