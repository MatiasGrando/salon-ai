import assert from 'node:assert/strict'
import { PublicDataCache, publicCacheFor } from '../src/conversational-bot/public-data-cache.js'

let now = 0
const cache = new PublicDataCache({ maxEntries: 2, ttlMs: 100, now: () => now })
let stamp = 'one', loads = 0
let source = { price: 10, nested: { address: 'A' } }
const read = (key = 'a') => cache.read({ key, stamp, readStamp: async () => stamp, load: async () => { loads++; return source } })
const first = await read()
first.nested.address = 'corrupt'
source = { price: 10, nested: { address: 'A' } }
assert.equal((await read()).nested.address, 'A', 'consumer cannot mutate cached data')
assert.equal(loads, 1)
stamp = 'two'; source.price = 20
assert.equal((await read()).price, 20, 'separate editor revision invalidates reader')
now = 101; await read(); assert.equal(loads, 3, 'TTL evicts even with stable stamp')
await read('b'); await read('c'); await read('a'); assert.equal(loads, 6, 'bounded LRU evicts oldest')
const identity = {}, foreign = {}
assert.equal(publicCacheFor(identity), publicCacheFor(identity))
assert.notEqual(publicCacheFor(identity), publicCacheFor(foreign), 'separate source clients cannot share data')
const otherReader = new PublicDataCache()
stamp = 'three'; source.price = 30
assert.equal((await otherReader.read({ key: 'a', stamp, readStamp: async () => stamp, load: async () => source })).price, 30)
assert.equal((await read()).price, 30)
await assert.rejects(() => cache.read({ key: 'a', stamp: 'failure', readStamp: async () => { throw new Error('failed') }, load: async () => source }))
assert.equal((await read()).price, 30, 'failed reload does not publish unverified source')

let release!: () => void
const barrier = new Promise<void>(resolve => { release = resolve })
let concurrentLoads = 0
const concurrent = new PublicDataCache()
const request = () => concurrent.read({ key: 'shared', stamp: 's', readStamp: async () => 's', load: async () => { concurrentLoads++; await barrier; return { value: 1 } } })
const a = request(), b = request(); release()
assert.deepEqual(await a, await b); assert.equal(concurrentLoads, 1, 'single flight preserves independent caller copies')

let changing = 'old', changedLoads = 0
const raced = new PublicDataCache()
assert.equal((await raced.read({ key: 'r', stamp: changing, readStamp: async () => changing, load: async () => {
  changedLoads++; const value = changing; changing = 'new'; return { value }
} })).value, 'new', 'change during load forces reread')
assert.equal(changedLoads, 2)
await assert.rejects(() => raced.read({ key: 'unstable', stamp: '0', readStamp: async () => String(++changedLoads), load: async () => ({ value: changing }) }), /changed/)

let oldRelease!: () => void
const oldBarrier = new Promise<void>(resolve => { oldRelease = resolve })
const ordered = new PublicDataCache()
let durable = 'old'
const oldRequest = ordered.read({ key: 'one', stamp: durable, readStamp: async () => durable, load: async () => { await oldBarrier; return { value: durable } } })
durable = 'new'
assert.equal((await ordered.read({ key: 'one', stamp: durable, readStamp: async () => durable, load: async () => ({ value: 'new' }) })).value, 'new')
oldRelease(); assert.equal((await oldRequest).value, 'new')
assert.equal((await ordered.read<{ value: string }>({ key: 'one', stamp: durable, readStamp: async () => durable, load: async () => { throw new Error('older load overwrote cache') } })).value, 'new')
console.log('conversational public cache: PASS')
// Port integration: clock/settings remain live, reusable data verifies durable stamp per new turn.
const { createPrismaDialoguePort } = await import('../src/conversational-bot/prisma-dialogue-port.js')
let revision = 1, databaseNow = new Date('2026-09-29T15:00:00Z')
let catalogReads = 0, factsReads = 0, weeklyReads = 0, agendaReads = 0, stampReads = 0, stampFailure = false
const service = { id: 's', businessId: 'tenant', catalogCategoryId: null, parentServiceId: null, name: 'Cut', price: 10, priceMode: 'FIXED', duration: 30, isBookable: true, attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false, estimateAllowsBooking: true }
const facts = { id: 'tenant', name: 'Demo', publicAddress: 'Address', publicAddressArea: null, publicMapsUrl: null, publicWhatsapp: null, contactEmail: null, workshopPublicSiteUrl: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, landingDescription: null }
const client: any = {
  business: { findFirst: async () => { factsReads++; return structuredClone(facts) } },
  businessHours: { findMany: async () => { weeklyReads++; return [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] } },
  scheduleBlock: { findMany: async () => [] },
  serviceCategory: { findMany: async () => [], count: async () => 0 },
  service: { findFirst: async (args: any) => args.select.name ? structuredClone(service) : { id: 's' }, findMany: async () => { catalogReads++; return [structuredClone(service)] } },
  $queryRaw: async (q: any) => {
    const sql = q.strings.join(' ')
    if (sql.includes('conversational-public-source-stamp')) { stampReads++; if (stampFailure) throw new Error('stamp unavailable'); return [{ businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', stamp: revision.toString(16).padStart(64, '0') }] }
    if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [{ timezone: 'America/Argentina/Buenos_Aires', bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: databaseNow }]
    if (sql.includes('FROM "Professional"')) { agendaReads++; return [] }
    throw new Error('unexpected query')
  }
}
const transactionOptions: any[] = []
client.$transaction = async (body: any, options: any) => {
  transactionOptions.push(options)
  const snapshotRevision = revision, snapshotService = structuredClone(service), snapshotFacts = structuredClone(facts)
  const source = { ...client, service: { ...client.service, findMany: async () => { catalogReads++; return [structuredClone(snapshotService)] } },
    business: { findFirst: async () => { factsReads++; return structuredClone(snapshotFacts) } },
    $executeRaw: async (q: any) => { assert.match(q.strings.join(' '), /SET TRANSACTION READ ONLY/); return 0 },
    $queryRaw: async (q: any) => q.strings.join(' ').includes('conversational-public-source-stamp') ? [{ businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', stamp: snapshotRevision.toString(16).padStart(64, '0') }] : client.$queryRaw(q)
  }
  return body(source)
}
const port1 = await createPrismaDialoguePort(client, 'tenant')
await port1.port.catalog(); await port1.port.information!(['HOURS'])
const afterCold = { catalogReads, factsReads, weeklyReads, stampReads }
const port2 = await createPrismaDialoguePort(client, 'tenant')
await port2.port.catalog(); await port2.port.information!(['HOURS'])
assert.equal(catalogReads, afterCold.catalogReads, 'catalogue reused across turns')
assert.equal(factsReads, afterCold.factsReads, 'facts reused across turns')
assert.equal(weeklyReads, afterCold.weeklyReads)
assert.equal(stampReads, afterCold.stampReads + 2, 'each warm public lookup verifies its own current stamp')
assert.equal(port2.cacheDiagnostics?.hits, 2)
revision++; service.price = 25; facts.publicAddress = 'New address'
const edited = await createPrismaDialoguePort(client, 'tenant')
assert.equal((await edited.port.catalog())[0]!.price, 25)
assert.equal((await edited.port.information!(['ADDRESS'])).address, 'New address')
assert.equal((await edited.port.information!(['ADDRESS'])).hours, null, 'action-specific facts cannot leak cached hours')
await edited.port.availability((await edited.port.catalog())[0]!, '2026-09-30')
await edited.port.availability((await edited.port.catalog())[0]!, '2026-09-30')
assert.equal(agendaReads, 2, 'availability is never cached')
databaseNow = new Date('2026-09-30T03:01:00Z')
const tomorrow = await createPrismaDialoguePort(client, 'tenant')
assert.equal(tomorrow.context.dbNow, databaseNow, 'database clock refreshed every turn')
await tomorrow.port.information!(['HOURS'])
assert.equal(weeklyReads, afterCold.weeklyReads + 1, 'hours window renews at local midnight')
stampFailure = true
const failedPort = await createPrismaDialoguePort(client, 'tenant')
assert.equal((await failedPort.port.catalog())[0]!.price, 25, 'stamp outage reads current snapshot instead of stale cache')
assert.equal(failedPort.cacheDiagnostics?.bypasses, 1)
assert.ok(transactionOptions.every(option => option.isolationLevel === 'RepeatableRead'))
console.log('conversational public cache port integration: PASS')
// Loaded version, not the earlier warm-read version, decides whether a snapshot may be cached.
let snapshotLoads = 0
const aba = new PublicDataCache()
assert.equal((await aba.read({ key: 'aba', stamp: 'ten', readStamp: async () => 'ten',
  load: async () => { throw new Error('snapshot loader must be used') },
  loadSnapshot: async () => { snapshotLoads++; return snapshotLoads === 1 ? { stamp: 'twenty', value: { price: 20 } } : { stamp: 'ten', value: { price: 10 } } }
})).price, 10, 'ABA cannot publish value twenty under stamp ten')
assert.equal(snapshotLoads, 2)
const busy = new PublicDataCache()
let releaseBusy!: () => void
const busyBarrier = new Promise<void>(resolve => { releaseBusy = resolve })
const pending = Array.from({ length: 32 }, (_, i) => busy.read({ key: String(i), stamp: 's', readStamp: async () => 's', load: async () => { await busyBarrier; return i } }))
const diagnostics = { hits: 0, misses: 0, bypasses: 0, stampReads: 0, stampMs: 0, loadMs: 0 }
assert.equal(await busy.read({ key: 'overflow', stamp: 's', readStamp: async () => 's', load: async () => 33, diagnostics }), 33, 'full cache capacity must not fail a valid query')
assert.equal(diagnostics.bypasses, 1)
releaseBusy(); await Promise.all(pending)
console.log('conversational public cache snapshot/bypass: PASS')
// A client without snapshot support remains functional but cannot share unverified cached rows.
stampFailure = false
const unsnapshot: any = { ...client }; delete unsnapshot.$transaction
const compatibility = await createPrismaDialoguePort(unsnapshot, 'tenant')
await compatibility.port.catalog(); service.price = 40
assert.equal((await compatibility.port.catalog())[0]!.price, 40)
assert.equal(compatibility.cacheDiagnostics?.bypasses, 2)
// Snapshot captures a consistent price/version even if an external editor reverses the price (ABA).
revision++; service.price = 10
const txn = client.$transaction
let abaEdited = false
client.$transaction = async (body: any, options: any) => {
  const result = await txn(async (source: any) => {
    if (!abaEdited) { abaEdited = true; service.price = 20; revision++ }
    const loaded = await body(source)
    service.price = 10; revision++
    return loaded
  }, options)
  client.$transaction = txn
  return result
}
const pinned = await createPrismaDialoguePort(client, 'tenant')
assert.equal((await pinned.port.catalog())[0]!.price, 10)
console.log('conversational public cache read-only snapshot integration: PASS')
// A later public lookup after AI work verifies edits even on the same dialogue port.
const sameTurn = await createPrismaDialoguePort(client, 'tenant')
await sameTurn.port.catalog(); await sameTurn.port.information!(['ADDRESS'])
const oldAddress = facts.publicAddress
facts.publicAddress = 'Edited while AI worked'; revision++
assert.equal((await sameTurn.port.information!(['ADDRESS'])).address, facts.publicAddress, 'same-port public lookup cannot retain the first lookup stamp')
assert.notEqual(facts.publicAddress, oldAddress)
console.log('conversational public cache intra-turn freshness: PASS')
