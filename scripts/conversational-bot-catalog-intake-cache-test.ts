import assert from 'node:assert/strict'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'

// Synthetic source adapter only. Real stamp SQL is covered by public-stamp-pglite.
let displayMode = 'ALL_SERVICES', revision = 1, catalogReads = 0, stampReads = 0
let categoryName = 'Cabello', moveDuringCatalogRead = false
const service = { id: 's', businessId: 'intake-cache', catalogCategoryId: 'c', parentServiceId: null,
  name: 'Corte', description: null, price: 10, priceMode: 'FIXED', duration: 30, isBookable: true,
  attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false, estimateAllowsBooking: true }
const stamp = () => ({ businessId: 'intake-cache', timezone: 'America/Argentina/Buenos_Aires', stamp: revision.toString(16).padStart(64, '0'),
  weeklyHours: [], globalBlocks: [], catalogDisplayMode: displayMode, catalogCategories: [{ id: 'c', name: categoryName }] })
const client: any = {
  business: { findFirst: async () => ({ id: 'intake-cache', name: 'Synthetic' }) },
  businessHours: { findMany: async () => [] }, scheduleBlock: { findMany: async () => [] },
  serviceCategory: { findMany: async () => [{ id: 'c', name: categoryName }] },
  service: { findFirst: async () => null, findMany: async () => { catalogReads++; return [structuredClone(service)] } },
  businessFeatureSettings: { findUnique: async () => ({ serviceCatalogDisplayMode: displayMode }) },
  $queryRaw: async (q: any) => {
    const sql = q.strings.join(' ')
    if (sql.includes('conversational-public-source-stamp')) { stampReads++; return [stamp()] }
    if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [{ timezone: 'America/Argentina/Buenos_Aires', bookingHorizonDays: 2,
      bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: new Date('2026-10-29T12:00:00Z') }]
    throw new Error('unexpected synthetic catalog query')
  }
}
client.$transaction = async (body: any, options: any) => {
  assert.equal(options.isolationLevel, 'RepeatableRead')
  const pinned = structuredClone(stamp()), pinnedService = structuredClone(service)
  return body({ ...client,
    $executeRaw: async (q: any) => { assert.match(q.strings.join(' '), /SET TRANSACTION READ ONLY/); return 0 },
    $queryRaw: async (q: any) => q.strings.join(' ').includes('conversational-public-source-stamp') ? [pinned] : client.$queryRaw(q),
    service: { ...client.service, findMany: async () => {
      catalogReads++
      if (moveDuringCatalogRead) { moveDuringCatalogRead = false; displayMode = 'CATEGORIES_FIRST'; service.name = 'Corte nuevo'; revision++ }
      return [pinnedService]
    } }
  })
}
const first = await createPrismaDialoguePort(client, 'intake-cache')
assert.equal((await first.port.catalog())[0]!.categoryId, 'c')
assert.equal((await first.port.catalogNavigation!()).displayMode, 'ALL_SERVICES')
const coldReads = catalogReads
await first.port.catalog(); assert.equal(catalogReads, coldReads, 'warm unchanged descriptor reuses catalog')
displayMode = 'CATEGORIES_FIRST'; revision++
await first.port.catalog()
assert.ok(catalogReads > coldReads, 'mode-only stamp change invalidates cached catalog descriptor')
assert.equal((await first.port.catalogNavigation!()).displayMode, 'CATEGORIES_FIRST')
categoryName = 'Color'; revision++
await first.port.catalog()
assert.deepEqual((await first.port.catalogNavigation!()).categories, [{ id: 'c', name: 'Color' }])
displayMode = 'ALL_SERVICES'; revision++; moveDuringCatalogRead = true
const retried = await first.port.catalog()
assert.equal(retried[0]!.name, 'Corte nuevo', 'concurrent edit retries the whole descriptor rather than mixing old services and new mode')
assert.equal((await first.port.catalogNavigation!()).displayMode, 'CATEGORIES_FIRST', 'retried catalog and nav share the new pinned snapshot')
await first.port.catalog()
assert.equal((await first.port.catalogNavigation!()).displayMode, 'CATEGORIES_FIRST', 'next lookup observes committed mode edit')
service.catalogCategoryId = null as any; revision++
const uncategorizedClient = { ...client, service: { ...client.service, findFirst: async () => ({ id: 's' }) } }
uncategorizedClient.$transaction = (body: any, options: any) => client.$transaction((source: any) => body({ ...source,
  service: { ...source.service, findFirst: async () => ({ id: 's' }) } }), options)
const mixed = await createPrismaDialoguePort(uncategorizedClient, 'intake-cache')
await mixed.port.catalog()
assert.ok((await mixed.port.catalogNavigation!()).categories.some(category => category.id === 'uncategorized' && category.name === 'Otros'), 'existing repository group keeps real uncategorized members reachable beside real categories')
assert.ok(stampReads > 0)
console.log('PASS catalog intake cache: cold/warm, mode-only invalidation, category rename, pinned source and next-read freshness')
