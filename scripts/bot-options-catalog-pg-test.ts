import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (safety.hostname !== '127.0.0.1' || safety.port !== '54322' || safety.pathname !== '/salon_ai_test') {
  throw new Error('Refusing unsafe F5 catalog PostgreSQL URL')
}
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, catalog, catalogQueries] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/bot-options/infrastructure/prisma-catalog.js'),
  import('../src/bot-options/application/catalog-queries.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f5_catalog_b_${suffix}`
const otherBusinessId = `f5_catalog_other_${suffix}`
const categoryIds = Array.from({ length: 9 }, (_, index) => `f5_cat_${index}_${suffix}`)
const groupId = `f5_group_${suffix}`
const serviceId = `f5_service_${suffix}`
const variantId = `f5_variant_${suffix}`

try {
  await prisma.business.createMany({ data: [
    { id: businessId, customerCode: `F5-CAT-${suffix}`, name: 'F5 catalog' },
    { id: otherBusinessId, customerCode: `F5-OTHER-${suffix}`, name: 'F5 other catalog' }
  ] })
  await prisma.serviceCategory.createMany({ data: [
    ...categoryIds.map((id, index) => ({ id, businessId, name: `Categoría ${String(index).padStart(2, '0')}`, sortOrder: index })),
    { id: `f5_cat_empty_${suffix}`, businessId, name: 'Vacía', sortOrder: 50 },
    { id: `f5_cat_inactive_${suffix}`, businessId, name: 'Inactiva', sortOrder: 51, isActive: false },
    { id: `f5_cat_other_${suffix}`, businessId: otherBusinessId, name: 'Otro tenant', sortOrder: 0 }
  ] })
  await prisma.service.createMany({ data: [
    ...categoryIds.map((categoryId, index) => ({
      id: `f5_seed_service_${index}_${suffix}`, businessId, catalogCategoryId: categoryId,
      name: `Servicio ${index}`, duration: 30, sortOrder: index, price: 1000 + index
    })),
    { id: groupId, businessId, catalogCategoryId: categoryIds[0]!, name: 'Color', duration: 0, isBookable: false, sortOrder: 20 },
    { id: serviceId, businessId, catalogCategoryId: categoryIds[0]!, name: 'Corte premium', description: 'Detalle real', duration: 45,
      customerDurationMin: 40, customerDurationMax: 50, price: 25000, priceMode: 'STARTING_AT', sortOrder: 21 },
    { id: variantId, businessId, catalogCategoryId: categoryIds[0]!, parentServiceId: groupId, name: 'Color corto', duration: 90,
      price: null, attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: false, sortOrder: 0 },
    { id: `f5_other_service_${suffix}`, businessId: otherBusinessId, catalogCategoryId: `f5_cat_other_${suffix}`,
      name: 'Secreto otro tenant', duration: 60, price: 99999 }
  ] })

  const repository = new catalog.PrismaCatalogRepository(prisma)
  const first = await repository.listCategories({ businessId, page: 0 })
  assert.equal(first.items.length, 7, 'rows are reserved for pagination and global navigation')
  assert.equal(first.hasPrevious, false)
  assert.equal(first.hasNext, true)
  assert.ok(first.items.every((item) => item.name !== 'Vacía' && item.name !== 'Inactiva'))
  const second = await repository.listCategories({ businessId, page: 1 })
  assert.equal(second.items.length, 2)
  assert.equal(second.hasPrevious, true)
  assert.equal(second.hasNext, false)

  const topLevel = await repository.listServices({ businessId, categoryId: categoryIds[0]!, page: 0 })
  assert.ok(topLevel)
  assert.ok(topLevel.items.some((item) => item.id === groupId && item.kind === 'SUBCATEGORY'))
  assert.ok(topLevel.items.some((item) => item.id === serviceId && item.kind === 'SERVICE'))
  assert.ok(topLevel.items.every((item) => item.id !== variantId))
  const variants = await repository.listServices({ businessId, categoryId: categoryIds[0]!, parentServiceId: groupId, page: 0 })
  assert.deepEqual(variants?.items.map((item) => item.id), [variantId])
  assert.equal(variants?.items[0]?.requiresConsultation, true)

  const detail = await repository.getService({ businessId, serviceId })
  assert.equal(detail?.name, 'Corte premium')
  assert.equal(detail?.priceMode, 'STARTING_AT')
  assert.equal(detail?.durationMinMinutes, 40)
  assert.equal(await repository.getService({ businessId, serviceId: `f5_other_service_${suffix}` }), null, 'service reads are tenant-scoped')
  assert.equal(await repository.listServices({ businessId, categoryId: `f5_cat_other_${suffix}`, page: 0 }), null, 'category reads are tenant-scoped')
  assert.throws(() => catalogQueries.catalogPageOffset(-1), /non-negative integer/)
  console.log('OK F5.3 catalog: tenant isolation, subcategories, real services and seven-row pagination satisfy the contract.')
} finally {
  await prisma.service.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.serviceCategory.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.$disconnect()
}
