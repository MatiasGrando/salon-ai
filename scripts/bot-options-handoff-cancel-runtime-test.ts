import assert from 'node:assert/strict'
import type { Prisma } from '../src/generated/prisma/client.js'
import { processSessionJob } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState, type BotOptionsState } from '../src/bot-options/domain/state.js'
import { transition } from '../src/bot-options/domain/transition.js'

const now = new Date('2026-08-31T18:00:00Z')
const notice = 'Cancelaste la solicitud de atención del equipo.'
type Scope = 'categories' | 'subcategories' | 'services' | 'overlay' | 'legacy' | 'hours' | 'professional-hours'

// Run PROCESS_SESSION, the real context provider/repositories and persistView.
// Only database transport and the already-covered cancellation effect are fake:
// no database URL, real customer, provider call or production write is involved.
async function scenario(scope: Scope, count: number, failRefresh = false) {
  const category = { id: 'cat', name: 'Cabello' }
  const subcategory = { id: 'sub', businessId: 'b', name: 'Coloración', catalogCategoryId: 'cat',
    parentServiceId: null, isBookable: false }
  const service = { id: 'svc', businessId: 'b', name: 'Color completo', catalogCategoryId: 'cat',
    parentServiceId: 'sub', duration: 30, customerDurationMin: null, customerDurationMax: null,
    price: 1000, priceMode: 'FIXED', isBookable: true, attentionMode: 'DIRECT_BOOKING',
    estimateAllowsBooking: true, description: 'Servicio disponible' }
  const before: BotOptionsState = { ...createInitialBotOptionsState(),
    flow: scope === 'categories' ? 'CATEGORY_SELECT' : scope === 'hours' ? 'BUSINESS_HOURS'
      : scope === 'professional-hours' ? 'PROFESSIONAL_HOURS_DETAIL' : 'SERVICE_SELECT',
    nameCandidate: count === 0 ? null : 'Martina', cart: Array.from({ length: count }, (_, i) => ({ serviceId: `cart-${i}` })),
    catalogMode: 'BOOKING', rejectedRecommendationIds: ['rejected'],
    pendingEntityRef: scope === 'professional-hours' ? { type: 'PROFESSIONAL', id: 'prof' } : { type: 'SERVICE', id: 'pending' },
    selections: { categoryId: scope === 'categories' ? null : 'cat', professionalId: 'prof',
      anyProfessional: false, date: '2026-09-03', slotStartAt: '2026-09-03T12:00:00-03:00',
      provisionalProfessionalId: 'prof', appointmentId: 'existing-appointment' },
    presentation: scope === 'overlay' ? { kind: 'navigation_menu' }
      : scope === 'legacy' || scope === 'hours' ? { kind: 'plain' }
      : { kind: 'catalog_page', cursor: 1, parentServiceId: scope === 'services' ? 'sub' : null }
  }
  const state = transition(before, { actionType: 'handoff.request', entityRef: null, payload: null },
    { dbNowIso: now.toISOString() }).state
  if (scope === 'legacy') state.presentation = { kind: 'plain' }
  let committed: Prisma.Sql[] = []
  let staged: Prisma.Sql[] = []
  let catalogReads = 0
  let effectCalls = 0
  const customer = { id: 'customer', name: 'Martina' }
  const query = async (q: Prisma.Sql) => {
    const sql = q.text
    if (sql.includes('SELECT s."id" AS "sessionId"')) return [{ sessionId: 's', businessId: 'b', generation: 1, fenceEpoch: 0 }]
    if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch' }]
    if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: 'job' }]
    if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: 'dispatch' }]
    if (sql.includes('s."status"::text AS "status", clock_timestamp() AS "dbNow"')) return [{ id: 's', businessId: 'b',
      deploymentId: 'd', deploymentGeneration: 1, revision: 10n, state, status: 'HUMAN_QUEUED',
      dbNow: now, toPhone: '5491100000000', conversationId: null, businessTimezone: 'UTC' }]
    if (sql.includes('e."payload" AS "providerPayload"')) return [{ id: 'inbox', actionType: 'handoff.cancel',
      entityRef: null, payload: null, promptId: 'prompt', providerEventId: 'event', providerMessageId: 'wamid',
      providerPayload: {}, status: 'SELECTED' }]
    if (sql.includes('FROM "Customer"')) {
      assert.ok(q.values.includes('b'), 'identity lookup stays tenant scoped')
      return [customer]
    }
    if (sql.includes('AS "professionalIds"')) {
      assert.ok(q.values.includes('b'), 'cart reload stays tenant scoped')
      return before.cart.map(item => ({ id: item.serviceId, name: item.serviceId, duration: 30,
        price: 1000, priceMode: 'FIXED', professionalIds: ['prof'] }))
    }
    if (sql.includes('FROM "ServiceCombinationRule"')) return []
    if (sql.includes('inserted_choices AS')) {
      staged.push(q)
      const choiceCount = q.values.filter(v => typeof v === 'string' && /^(category\.|subcategory\.|service\.|catalog\.|navigation\.|handoff\.|hours\.)/.test(v)).length
      const outboxCount = q.values.filter(v => typeof v === 'string' && v.startsWith('{"to":')).length
      return [{ choiceCount: BigInt(choiceCount), outboxCount: BigInt(outboxCount) }]
    }
    if (sql.includes('WITH inbox AS')) { staged.push(q); return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }] }
    throw new Error(`unexpected SQL: ${sql}`)
  }
  function catalogRead(where: { businessId?: string }) {
    assert.equal(where.businessId, 'b', 'catalog reconstruction stays tenant scoped')
    catalogReads++
    if (failRefresh) throw new Error('catalog unavailable')
  }
  const tx = {
    $queryRaw: query,
    $executeRaw: async (q: Prisma.Sql) => { staged.push(q); return 1 },
    serviceCategory: {
      findMany: async ({ where, skip }: { where: { businessId: string }; skip: number }) => {
        catalogRead(where)
        assert.equal(skip, 7, 'category page must survive interruption')
        return [category]
      },
      findFirst: async ({ where }: { where: { businessId: string } }) => { catalogRead(where); return category }
    },
    service: {
      findFirst: async ({ where }: { where: { businessId: string } }) => { catalogRead(where); return subcategory },
      findMany: async ({ where, skip }: { where: { businessId: string; parentServiceId: string | null }; skip: number }) => {
        catalogRead(where)
        assert.equal(where.parentServiceId, scope === 'services' ? 'sub' : null, 'subcategory must survive interruption')
        assert.equal(skip, scope === 'overlay' || scope === 'legacy' ? 0 : 7, 'catalog page must survive interruption')
        return where.parentServiceId ? [service] : [subcategory]
      }
    },
    businessHours: { findMany: async () => [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] },
    professional: { findFirst: async () => ({ id: 'prof', name: 'Lucas', acceptsBotBookings: true }) },
    professionalHours: { findMany: async () => [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] },
    scheduleBlock: { findMany: async () => [] }
  }
  const client = { $queryRaw: query, $executeRaw: async () => 1,
    $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
      staged = []
      const result = await run(tx)
      committed.push(...staged)
      return result
    }
  }
  const run = () => processSessionJob({ client: client as never, job: {
    id: 'job', aggregateId: 'inbox', kind: 'PROCESS_SESSION', businessId: 'b', deploymentId: 'd',
    deploymentGeneration: 1, expectedRevision: 10n, attempts: 1, maxAttempts: 5, claimToken: 'job-token',
    claimedUntil: now, queueWaitMs: 0
  }, effectExecutor: async (_tx, input) => {
    effectCalls++
    assert.deepEqual(input.effects, [{ kind: 'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER' }], 'never release a hold or mutate a booking/customer')
  } })
  if (failRefresh) {
    await assert.rejects(run, /catalog unavailable/)
    assert.equal(committed.some(q => q.text.includes('INSERT INTO "BotOutbox"')), false)
    assert.equal(committed.some(q => q.text.includes('UPDATE "BotSession"')), false)
    return
  }
  assert.equal(await run(), 'PROCESSED')
  const writes = committed.filter(q => q.text.includes('UPDATE "BotSession" SET "state"'))
  assert.equal(writes.length, 1)
  const resumed = JSON.parse(writes[0]!.values.find((v): v is string => typeof v === 'string' && v.startsWith('{"schemaVersion"'))!)
  assert.deepEqual(resumed, { ...before, presentation: scope === 'overlay' ? { kind: 'plain' } : before.presentation }, 'all previously supplied state survives')
  const items = committed.flatMap(q => q.values.filter((v): v is string => typeof v === 'string' && v.startsWith('{"to":'))).map(v => JSON.parse(v).item)
  const contextualAction = scope === 'categories' ? 'category.select' : scope === 'services' ? 'service.view' : 'subcategory.select'
  if (scope === 'hours' || scope === 'professional-hours') {
    assert.ok(items.some(item => item.body.includes('09:00') && item.body.includes('18:00')), 'generic resume also reconstructs hours')
    assert.equal(items.length, 3, 'only notice, fresh informative text and final menu; no stale or duplicated headings')
    if (scope === 'professional-hours') assert.ok(items[1].body.includes('Lucas'))
  }
  else {
    assert.ok(catalogReads > 0, 'cancellation must load the restored catalog, not HANDOFF_QUEUED')
    assert.ok(committed.some(q => q.values.includes(contextualAction)), 'real contextual options are persisted with fresh tokens')
    assert.ok(items.some(item => item.body.includes('Cabello') || item.body.includes('Coloración')))
  }
  assert.equal(items[0].body, notice, 'generic cancellation notice comes before the restored screen')
  assert.equal(items.filter(item => item.body === notice).length, 1)
  assert.equal(items.some(item => item.body.includes('¿Cómo es tu nombre?')), false, 'known identity is not requested again')
  assert.equal(effectCalls, 1)
  assert.deepEqual(customer, { id: 'customer', name: 'Martina' }, 'stored customer identity is unchanged')
  assert.doesNotMatch(committed.map(q => q.text).join('\n'), /(?:DELETE FROM|UPDATE|INSERT INTO) "(?:Customer|BookingVisit|Appointment|BookingDeposit)"/)
}

for (const count of [0, 1, 2]) {
  for (const scope of ['categories', 'subcategories', 'services', 'overlay', 'legacy'] as const) await scenario(scope, count)
}
await scenario('hours', 0)
await scenario('professional-hours', 0)
await scenario('services', 2, true)
console.log('OK handoff cancellation runtime: catalog, subcategory, page, name/cart preservation, overlay/legacy, hours and rollback.')
