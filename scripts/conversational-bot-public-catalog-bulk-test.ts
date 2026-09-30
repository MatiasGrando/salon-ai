import assert from 'node:assert/strict'
import { PrismaCatalogRepository } from '../src/bot-options/infrastructure/prisma-catalog.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'

const tenant = 'tenant'
const categories: any[] = []
const services: any[] = []
let queries = 0
const professional = { businessId: tenant, isActive: true, acceptsBotBookings: true }
function category(id: string, sortOrder = 0, extra = {}) {
  categories.push({ id, businessId: tenant, name: id, sortOrder, isActive: true, ...extra })
}
function service(id: string, catalogCategoryId: string | null, parentServiceId: string | null = null, extra = {}) {
  services.push({ id, businessId: tenant, catalogCategoryId, parentServiceId, name: id, sortOrder: 0,
    isActive: true, isBookable: true, links: [{ professional }], description: null, duration: 30,
    customerDurationMin: null, customerDurationMax: null, price: 10, priceMode: 'FIXED',
    attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true, requiresPhoto: false, validationEnabled: false,
    estimateOptions: null, estimateQuestion: null, estimateExplanation: null, estimateDisclaimer: null,
    validationMessage: null, validationQuestion: null, ...extra })
}
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((condition: any) => matches(row, condition))
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((condition: any) => matches(row, condition))
    if (key === 'services') return services.some(candidate => candidate.catalogCategoryId === row.id && matches(candidate, value.some))
    if (key === 'variants') return services.some(candidate => candidate.parentServiceId === row.id && matches(candidate, value.some))
    if (key === 'professionalLinks') return row.links.some((link: any) => matches(link, value.some))
    if (key === 'professional') return matches(row.professional, value)
    if (key === 'catalogCategory') return categories.some(candidate => candidate.id === row.catalogCategoryId && matches(candidate, value.is))
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
    return row[key] === value
  })
}
function select(row: any, selection: any) {
  return Object.fromEntries(Object.keys(selection).map(key => [key, row[key]]))
}
function delegate(rows: any[]) {
  const findMany = async (args: any) => {
    queries++
    const filtered = rows.filter(row => matches(row, args.where)).sort((a, b) => {
      for (const order of args.orderBy ?? []) {
        const key = Object.keys(order)[0]!
        const comparison = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]))
        if (comparison) return comparison
      }
      return 0
    })
    return filtered.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? filtered.length)).map(row => select(row, args.select))
  }
  return { findMany, findFirst: async (args: any) => (await findMany({ ...args, take: 1 }))[0] ?? null,
    count: async (args: any) => { queries++; return rows.filter(row => matches(row, args.where)).length } }
}
const client: any = {
  serviceCategory: delegate(categories), service: delegate(services),
  $queryRaw: async (sql: any) => {
    const text = sql.strings.join(' ')
    if (text.includes('conversational-public-source-stamp')) return [{ businessId: tenant, timezone: 'UTC', stamp: 'a'.repeat(64) }]
    if (text.includes('CURRENT_TIMESTAMP')) return [{ now: new Date('2026-09-30T12:00:00Z') }]
    if (text.includes('BusinessBotOptionsSettings')) return [{ timezone: 'UTC', bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00' }]
    throw new Error('unexpected query')
  },
  $executeRaw: async () => 0
}
client.$transaction = async (body: any) => body(client)
async function legacy() {
  const repository = new PrismaCatalogRepository(client)
  const collect = async (read: (page: number) => Promise<any>) => {
    const rows: any[] = []
    for (let page = 0; page < 30; page++) {
      const result = await read(page)
      if (!result) throw new Error('catalog unavailable')
      rows.push(...result.items)
      if (rows.length > 200) throw new Error('catalog exceeds supported bound')
      if (!result.hasNext) return rows
    }
    throw new Error('catalog pagination exceeds supported bound')
  }
  const result: any[] = []
  for (const category of await collect(page => repository.listCategories({ businessId: tenant, page }))) {
    for (const root of await collect(page => repository.listServices({ businessId: tenant, categoryId: category.id, page }))) {
      result.push(...(root.kind === 'SUBCATEGORY' ? await collect(page => repository.listServices({ businessId: tenant, categoryId: category.id, parentServiceId: root.id, page })) : [root]))
      if (result.length > 200) throw new Error('catalog exceeds supported bound')
    }
  }
  return result
}
category('b', 2); category('a', 1); category('inactive', 0, { isActive: false }); category('foreign', 0, { businessId: 'other' })
service('a-direct', 'a', null, { priceMode: 'STARTING_AT', requiresPhoto: true })
service('b-direct', 'b')
service('hidden', 'inactive'); service('foreign-service', 'foreign', null, { businessId: 'other' })
service('unlinked', 'a', null, { links: [] })
service('inactive-pro', 'a', null, { links: [{ professional: { ...professional, isActive: false } }] })
service('foreign-pro', 'a', null, { links: [{ professional: { ...professional, businessId: 'other' } }] })
service('not-bot-pro', 'a', null, { links: [{ professional: { ...professional, acceptsBotBookings: false } }] })
service('inactive-service', 'a', null, { isActive: false })
service('a-group', 'a', null, { isBookable: false, sortOrder: -1 })
service('a-child-z', 'a', 'a-group', { sortOrder: 1 }); service('a-child-a', 'a', 'a-group')
service('wrong-category-child', 'b', 'a-group')
service('b-cross-group', 'b', null, { isBookable: false, sortOrder: -1 })
service('cross-only-child', 'a', 'b-cross-group')
service('other-direct', null)
service('other-group', null, null, { isBookable: false, sortOrder: -1 })
service('other-child', null, 'other-group')
service('other-cross-group', null, null, { isBookable: false })
service('other-cross-child', 'a', 'other-cross-group')
const expected = await legacy()
assert.deepEqual(expected.map(row => row.id), ['a-child-a', 'a-child-z', 'a-direct', 'b-direct', 'other-child', 'other-direct'])
queries = 0
const port = await createPrismaDialoguePort(client, tenant)
const actual = await port.port.catalog()
assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id))
assert.ok(queries <= 4, `cold catalogue uses at most four source queries, got ${queries}`)
assert.equal(actual.find(row => row.id === 'a-direct')?.requiresConsultation, true)
assert.equal(actual.find(row => row.id === 'a-direct')?.priceMode, 'STARTING_AT')
const repository = new PrismaCatalogRepository(client)
assert.deepEqual(await repository.loadPublicCatalogSnapshot(tenant), expected, 'bulk uses identical service mapping and traversal order')
queries = 0; await port.port.catalog(); assert.equal(queries, 0, 'warm lookup keeps existing validated cache')

// No uncategorized category may be introduced by a cross-category-only variant.
services.splice(0); categories.splice(0)
category('a'); service('cross-root', null, null, { isBookable: false }); service('cross-child', 'a', 'cross-root')
assert.deepEqual(await repository.loadPublicCatalogSnapshot(tenant), await legacy())
assert.deepEqual(await repository.loadPublicCatalogSnapshot(tenant), [])

for (const kind of ['categories', 'roots', 'children', 'total'] as const) {
  services.splice(0); categories.splice(0)
  if (kind === 'categories') {
    for (let i = 0; i < 201; i++) { category(`c${i}`); service(`s${i}`, `c${i}`) }
  } else {
    category('a')
    if (kind === 'children') {
      service('group', 'a', null, { isBookable: false })
      for (let i = 0; i < 201; i++) service(`child${i}`, 'a', 'group')
    } else if (kind === 'total') {
      category('b')
      for (let i = 0; i < 201; i++) service(`s${i}`, i < 100 ? 'a' : 'b')
    } else {
      for (let i = 0; i < 201; i++) {
        service(`group${i}`, 'a', null, { isBookable: false })
        service(`cross${i}`, 'b', `group${i}`)
      }
    }
  }
  await assert.rejects(() => legacy(), /bound/)
  await assert.rejects(() => repository.loadPublicCatalogSnapshot(tenant), /bound/, `${kind} overflow fails instead of truncating`)
}
// A valid hierarchy may contain more than 200 empty cross-category subcategories across categories.
services.splice(0); categories.splice(0); category('a'); category('b')
for (let i = 0; i < 300; i++) { const cat = i < 150 ? 'a' : 'b'; service(`group${i}`, cat, null, { isBookable: false }); service(`cross${i}`, cat === 'a' ? 'b' : 'a', `group${i}`) }
assert.deepEqual(await repository.loadPublicCatalogSnapshot(tenant), await legacy())
// Exact inclusive bounds remain accepted, not truncated by the bulk fetch.
for (const kind of ['categories', 'roots', 'children', 'total'] as const) {
  services.splice(0); categories.splice(0)
  if (kind === 'categories') {
    for (let i = 0; i < 200; i++) { category(`c${i}`); service(`s${i}`, `c${i}`) }
  } else {
    category('a')
    if (kind === 'children') {
      service('group', 'a', null, { isBookable: false })
      for (let i = 0; i < 200; i++) service(`child${i}`, 'a', 'group')
    } else if (kind === 'roots') {
      for (let i = 0; i < 200; i++) {
        service(`group${i}`, 'a', null, { isBookable: false })
        service(`cross${i}`, 'b', `group${i}`)
      }
    } else {
      category('b')
      for (let i = 0; i < 200; i++) service(`s${i}`, i < 100 ? 'a' : 'b')
    }
  }
  assert.deepEqual(await repository.loadPublicCatalogSnapshot(tenant), await legacy(), `${kind} inclusive bound preserves every result`)
}
console.log('conversational public catalog bulk: PASS')