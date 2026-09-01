import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsed = new URL(SAFE_DATABASE_URL)
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '54322' || parsed.pathname !== '/salon_ai_test') throw new Error('Refusing unsafe F6 cart database')
process.env.DATABASE_URL = SAFE_DATABASE_URL
const [{ createPrismaClient }, { Prisma }, cartModule] = await Promise.all([
  import('../src/config/prisma-client.js'), import('../src/generated/prisma/client.js'), import('../src/bot-options/infrastructure/prisma-cart.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 3, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessA = `f6cart_a_${suffix}`; const businessB = `f6cart_b_${suffix}`
const categoryA = `f6cart_cat_a_${suffix}`; const categoryB = `f6cart_cat_b_${suffix}`
const cut = `f6cart_cut_${suffix}`; const color = `f6cart_color_${suffix}`; const uncategorized = `f6cart_other_${suffix}`; const foreign = `f6cart_foreign_${suffix}`
const p1 = `f6cart_p1_${suffix}`; const p2 = `f6cart_p2_${suffix}`; const p3 = `f6cart_p3_${suffix}`
try {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessA}, ${`F6CA-${suffix}`}, 'A'), (${businessB}, ${`F6CB-${suffix}`}, 'B')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceCategory" ("id", "businessId", "name", "isActive", "updatedAt") VALUES (${categoryA}, ${businessA}, 'A', true, clock_timestamp()), (${categoryB}, ${businessB}, 'B', true, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable") VALUES
    (${cut}, ${businessA}, ${categoryA}, 'Corte', 30, 1500, 'FIXED'::"ServicePriceMode", true),
    (${color}, ${businessA}, ${categoryA}, 'Color', 45, 3000, 'STARTING_AT'::"ServicePriceMode", true),
    (${uncategorized}, ${businessA}, NULL, 'Peinado sin categoría', 40, 2500, 'FIXED'::"ServicePriceMode", true),
    (${foreign}, ${businessB}, ${categoryB}, 'Ajeno', 60, 9000, 'FIXED'::"ServicePriceMode", true)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings") VALUES
    (${p1}, ${businessA}, 'Uno', true, true), (${p2}, ${businessA}, 'Dos', true, true), (${p3}, ${businessA}, 'Inactivo', false, true)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES
    (${`l1_${suffix}`}, ${p1}, ${cut}), (${`l2_${suffix}`}, ${p2}, ${cut}), (${`l3_${suffix}`}, ${p2}, ${color}), (${`l4_${suffix}`}, ${p3}, ${color}), (${`l5_${suffix}`}, ${p2}, ${uncategorized})`)
  const repo = new cartModule.PrismaCartRepository(prisma)
  const fixedSnapshot = await repo.load({ businessId: businessA, serviceIds: [cut] })
  assert.equal(fixedSnapshot.snapshot.totalPriceMinor, 1500, 'el repositorio conserva pesos enteros como unidad canónica')
  const snapshot = await repo.load({ businessId: businessA, serviceIds: [cut, color] })
  assert.deepEqual(snapshot.snapshot.commonProfessionalIds, [p2])
  assert.equal(snapshot.snapshot.totalDurationMinutes, 75)
  assert.equal(snapshot.snapshot.totalPriceMinor, null)
  const withUncategorized = await repo.load({ businessId: businessA, serviceIds: [cut, uncategorized], preview: true })
  assert.deepEqual(withUncategorized.snapshot.services.map(service => service.id), [cut, uncategorized], 'Otros virtual también es válido dentro del carrito')
  await assert.rejects(repo.load({ businessId: businessA, serviceIds: [cut, foreign] }), /inactive, cross-tenant, or non-bookable/)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceCombinationRule" ("id", "businessId", "serviceAId", "serviceBId", "policy") VALUES (${`rule_${suffix}`}, ${businessA}, ${cut}, ${color}, 'REVIEW_REQUIRED'::"ServiceCombinationPolicy")`)
  const withRule = await repo.load({ businessId: businessA, serviceIds: [cut, color] })
  assert.equal(withRule.policies.get([cut, color].sort().join(':')), 'REVIEW_REQUIRED')
  await prisma.$executeRaw(Prisma.sql`UPDATE "Service" SET "isBookable" = false WHERE "id" = ${color} AND "businessId" = ${businessA}`)
  await assert.rejects(repo.load({ businessId: businessA, serviceIds: [cut, color] }), /inactive, cross-tenant, or non-bookable/)
  const writes = await prisma.appointment.count({ where: { professional: { businessId: businessA } } })
  assert.equal(writes, 0, 'construir y revalidar carrito no crea Appointment')
  console.log('OK F6.3/F6.4 PG: intersección, derivados, políticas, inactivación, tenant isolation y cero agenda writes.')
} finally {
  await prisma.$transaction(async (tx) => {
    await tx.serviceCombinationRule.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
    await tx.professionalService.deleteMany({ where: { professionalId: { in: [p1, p2, p3] } } })
    await tx.professional.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
    await tx.service.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
    await tx.serviceCategory.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
    await tx.business.deleteMany({ where: { id: { in: [businessA, businessB] } } })
  })
  await prisma.$disconnect()
}
