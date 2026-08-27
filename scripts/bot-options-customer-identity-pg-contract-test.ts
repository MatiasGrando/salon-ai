import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (
  safety.protocol !== 'postgresql:' || safety.hostname !== '127.0.0.1' || safety.port !== '54322' ||
  safety.pathname !== '/salon_ai_test' || safety.username !== 'postgres' || safety.password !== 'postgres'
) throw new Error('Refusing unsafe F6.1 PostgreSQL contract URL')
delete process.env.DATABASE_URL
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, lookupModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-customer-lookup.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessA = `f61_pg_a_${suffix}`
const businessB = `f61_pg_b_${suffix}`
const canonical = '5491123456789'
const variants = [canonical, `+${canonical}`, '011 15-2345-6789', '1123456789']

const ids = {
  normalized: `f61_normalized_${suffix}`,
  literalOlder: `f61_literal_older_${suffix}`,
  literal: `f61_literal_${suffix}`,
  digits: `f61_digits_${suffix}`,
  otherTenant: `f61_other_${suffix}`
}

try {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES
    (${businessA}, ${`F61A-${suffix}`}, 'F6.1 A'), (${businessB}, ${`F61B-${suffix}`}, 'F6.1 B')`)

  // El literal es más viejo, pero normalizedPhone tiene precedencia determinista.
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone", "createdAt") VALUES
    (${ids.literalOlder}, ${businessA}, 'Literal viejo', ${canonical}, NULL, '2026-01-01T00:00:00Z'),
    (${ids.normalized}, ${businessA}, 'Normalizado gana', 'legacy-value', ${canonical}, '2026-01-02T00:00:00Z'),
    (${ids.literal}, ${businessA}, 'Sólo literal', '+5491199998888', NULL, '2026-01-03T00:00:00Z'),
    (${ids.digits}, ${businessA}, 'Sólo dígitos', '(011) 15-7777-6666', NULL, '2026-01-04T00:00:00Z'),
    (${ids.otherTenant}, ${businessB}, 'Nombre tenant B', ${canonical}, ${canonical}, '2026-01-01T00:00:00Z')`)

  const before = await prisma.$queryRaw<Array<{ id: string; businessId: string | null; name: string; phone: string; normalizedPhone: string | null }>>(Prisma.sql`
    SELECT "id", "businessId", "name", "phone", "normalizedPhone" FROM "Customer"
    WHERE "businessId" IN (${businessA}, ${businessB}) ORDER BY "id"
  `)
  const repo = new lookupModule.PrismaCustomerLookupRepository(prisma)

  const normalized = await repo.findByPhone({ businessId: businessA, phoneVariants: variants, canonicalPhone: canonical })
  assert.deepEqual(normalized, { customerId: ids.normalized, name: 'Normalizado gana', canonicalPhone: canonical })

  const tenantB = await repo.findByPhone({ businessId: businessB, phoneVariants: variants, canonicalPhone: canonical })
  assert.deepEqual(tenantB, { customerId: ids.otherTenant, name: 'Nombre tenant B', canonicalPhone: canonical })

  const literalCanonical = '5491199998888'
  const literal = await repo.findByPhone({ businessId: businessA, phoneVariants: [`+${literalCanonical}`], canonicalPhone: literalCanonical })
  assert.deepEqual(literal, { customerId: ids.literal, name: 'Sólo literal', canonicalPhone: literalCanonical })

  const digitCanonical = '5491177776666'
  const digits = await repo.findByPhone({ businessId: businessA, phoneVariants: ['0111577776666'], canonicalPhone: digitCanonical })
  assert.deepEqual(digits, { customerId: ids.digits, name: 'Sólo dígitos', canonicalPhone: digitCanonical })

  const absent = await repo.findByPhone({ businessId: businessA, phoneVariants: ['5491100000000'], canonicalPhone: '5491100000000' })
  assert.equal(absent, null)

  const deterministicAgain = await repo.findByPhone({ businessId: businessA, phoneVariants: variants, canonicalPhone: canonical })
  assert.deepEqual(deterministicAgain, normalized)

  const after = await prisma.$queryRaw<typeof before>(Prisma.sql`
    SELECT "id", "businessId", "name", "phone", "normalizedPhone" FROM "Customer"
    WHERE "businessId" IN (${businessA}, ${businessB}) ORDER BY "id"
  `)
  assert.deepEqual(after, before, 'lookup debe producir cero writes')
  console.log('OK F6.1 PG: tenant isolation, precedencia normalized/literal/digits, ausencia, determinismo y cero writes.')
} finally {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" IN (${businessA}, ${businessB})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${businessA}, ${businessB})`)
  })
  await prisma.$disconnect()
}
