import assert from 'node:assert/strict'
import { CashService } from '../src/services/cash-service.js'

const now = new Date('2026-11-24T15:00:00Z')
const evidence = (id: string, price: number) => ({ businessId: 'b', appointmentId: id, origin: 'MANUAL', coordinationGroupId: 'group', visitId: null, visitBusinessId: null, visitTotalPrice: null, quotedPrice: price, primaryPrice: price, itemCount: 0, pricedItemCount: 0, itemTotal: null, estimated: false, tenantConsistent: true, manualDepositPaid: false, manualDepositAmount: null })
let writes = 0, historyReads = 0, completionCalls = 0, allowed = true, actorAllowed = true, closed = false, failReceipt = false
let entries: any[] = [], requests = new Map<string, any>()
const tx: any = {
  lockBusiness: async () => ({ businessId: 'b', timezone: 'UTC', dbNow: now }),
  resolveAppointmentAccount: async () => null,
  loadAppointmentBackfillGroup: async () => [evidence('one', 10000), evidence('outside-visible-range', 20000)],
  listVisibleAppointmentIds: async (_b: string, ids: string[], professionalId?: string) => professionalId ? ids.filter(id => id === 'one') : ids,
  listAppointmentFinanceSummaryRows: async () => [],
  listAccountAppointmentIds: async () => ['one', 'outside-visible-range'],
  resolveAccountProductSubtotal: async () => 0,
  ensureAppointmentAccount: async () => { writes++; throw new Error('read must not create account') },
  ensureAppointmentAccountLink: async () => { writes++; throw new Error('read must not link account') },
  listAccountEntries: async () => { historyReads++; return [...entries] },
  listTotalAdjustments: async () => { historyReads++; return [] },
  listServiceCorrections: async () => { historyReads++; return [] },
  lockAppointmentMutationRequest: async () => {},
  findAppointmentMutationRequest: async (_b: string, key: string) => requests.get(key) ?? null,
  createAppointmentMutationRequest: async (record: any) => { if (failReceipt) throw new Error('receipt write failed'); requests.set(record.requestId, structuredClone(record)) },
  lockPaymentAppointment: async () => allowed,
  authorizeAppointmentPaymentActor: async () => actorAllowed,
  lockAppointmentForProfessional: async () => allowed,
  findOpenDay: async () => closed ? null : ({ id: 'day' }),
  findOpenSession: async () => ({ id: 'session' }),
  findBusinessPaymentMethod: async (_b: string, id: string) => ({ id, kind: id === 'card' ? 'CARD' : 'CASH', isActive: true }),
  lockAppointmentAccount: async () => ({ id: 'account', businessId: 'b', pricingMode: 'FIXED', originalAmount: 30000, agreedAmount: 30000, minimumAmount: 0, discountAmount: 0 }),
  insertManualPayments: async ({ ids, lines }: any) => { writes++; const made = lines.map((line: any, i: number) => ({ id: ids[i], ...line, type: 'PAYMENT', direction: 'INFLOW' })); entries.push(...made); return made },
  completeAppointmentFromPayment: async ({ appointmentId }: any) => { completionCalls++; return { appointmentId, previousStatus: 'CONFIRMED', status: 'COMPLETED', completedAt: now } }
}
const repository: any = { transaction: async (work: any) => { const snapshot = structuredClone({ entries, requests, writes, completionCalls }); try { return await work(tx) } catch (error) { ({ entries, requests, writes, completionCalls } = snapshot); throw error } } }
const service = new CashService(repository)
const summary = await (service as any).getAppointmentFinanceSummary({ businessId: 'b', appointmentId: 'one' })
assert.equal(summary.accountId, null)
assert.equal(summary.agreedAmount, 30000, 'include coordinated appointments outside the visible range')
assert.deepEqual(summary.appointmentIds, ['one', 'outside-visible-range'])
assert.equal(summary.paymentStatus, 'UNPAID')
assert.equal(writes, 0)
assert.equal(historyReads, 0, 'summary must never load ledger or audit histories')
const own = await (service as any).getAppointmentFinanceSummary({ businessId: 'b', appointmentId: 'one', allowedProfessionalId: 'p' })
assert.deepEqual(own.appointmentIds, ['one'], 'OWN scope must not expose other professionals appointment IDs')
assert.equal(own.balanceAmount, 30000, 'a shared account still has one canonical balance')
tx.resolveAppointmentAccount = async () => ({ id: 'account', businessId: 'b', pricingMode: 'FIXED', originalAmount: 30000, agreedAmount: 30000, minimumAmount: 0, discountAmount: 0 })
tx.listAppointmentFinanceSummaryRows = async () => [{ ...(await tx.resolveAppointmentAccount()), appointmentId: 'one', accountId: 'account', paidAmount: 5000 }]
const existing = await (service as any).getAppointmentFinanceSummary({ businessId: 'b', appointmentId: 'one' })
assert.equal(existing.balanceAmount, 25000)
assert.equal(existing.paymentStatus, 'PARTIAL')
assert.equal(historyReads, 0)

const pay = { businessId: 'b', appointmentId: 'one', cashSessionId: 'session', origin: 'AGENDA' as const, actorUserId: 'actor', actorName: 'Admin', requestId: 'request-partial', expectedBalance: 30000, lines: [{ amount: 5000, method: 'CASH' as const, paymentMethodId: 'cash' }] }
const first = await service.recordAppointmentPayment(pay)
closed = true
const replay = await service.recordAppointmentPayment(pay)
const { replayed, ...replayedResult } = replay as any
assert.equal(replayed, true)
assert.deepEqual(JSON.parse(JSON.stringify(replayedResult)), JSON.parse(JSON.stringify(first)))
assert.equal(entries.length, 1, 'a partial payment replay after Caja closes must not charge again')
assert.equal(writes, 1)
actorAllowed = false
await assert.rejects(() => service.recordAppointmentPayment(pay), (e: any) => e.code === 'CASH_PERMISSION_REQUIRED')
actorAllowed = true
await assert.rejects(() => service.recordAppointmentPayment({ ...pay, actorUserId: 'other' }), (e: any) => e.code === 'APPOINTMENT_REQUEST_CONFLICT')
await assert.rejects(() => service.recordAppointmentPayment({ ...pay, appointmentId: 'another' }), (e: any) => e.code === 'APPOINTMENT_REQUEST_CONFLICT')
await assert.rejects(() => service.recordAppointmentPayment({ ...pay, lines: [{ amount: 6000, method: 'CASH' }] }), (e: any) => e.code === 'APPOINTMENT_REQUEST_CONFLICT')
allowed = false
await assert.rejects(() => service.recordAppointmentPayment({ ...pay, allowedProfessionalId: 'other-pro' }), (e: any) => e.code === 'APPOINTMENT_ACCOUNT_NOT_FOUND')
allowed = true; closed = false
await assert.rejects(() => service.recordAppointmentPayment({ ...pay, requestId: 'stale' }), (e: any) => e.code === 'APPOINTMENT_BALANCE_CHANGED')
assert.equal(entries.length, 1)
const mixed = { ...pay, requestId: 'mixed', expectedBalance: 25000, lines: [{ amount: 5000, method: 'CASH' as const, paymentMethodId: 'cash' }, { amount: 20000, method: 'CARD' as const, paymentMethodId: 'card' }], completeAppointment: true }
const completed = await service.recordAppointmentPayment(mixed)
await service.recordAppointmentPayment(mixed)
assert.equal(completed.finance.balanceAmount, 0)
assert.equal(completionCalls, 1, 'retry must not duplicate settlement/completion effects')
assert.equal(entries.length, 3)
entries = []; requests = new Map(); writes = 0; completionCalls = 0; failReceipt = true
await assert.rejects(() => service.recordAppointmentPayment({ ...mixed, expectedBalance: 30000, lines: [{ amount: 30000, method: 'CASH' }] }), /receipt write failed/)
assert.equal(entries.length, 0, 'receipt failure must roll back payment and completion')
assert.equal(completionCalls, 0)
assert.equal(requests.size, 0)
console.log('appointment checkout safety: pure complete-group summary, scoped IDs, partial/mixed/complete replay, actor/key conflicts, stale balance and rollback OK')
