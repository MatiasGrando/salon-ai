/**
 * F5.6 — Contrato PG: tenant isolation, business-level exceptions,
 * exclusión de bloques profesionales y bordes exactos [from,to).
 *
 * Cubre:
 * - Tenant isolation: business A no ve business B
 * - Business-level exceptions (professionalId=NULL)
 * - Professional blocks EXCLUDED (professionalId IS NOT NULL)
 * - Edge exacto [from,to): from inclusivo, to exclusivo
 * - Determinismo del orden
 * - Ventana 30 días calendario con timezone
 *
 * Ejecución: npx tsx scripts/bot-options-hours-pg-contract-test.ts
 * Base de datos: salon_ai_test (127.0.0.1:54322)
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsedSafetyUrl = new URL(SAFE_DATABASE_URL)
if (
  parsedSafetyUrl.protocol !== 'postgresql:' || parsedSafetyUrl.hostname !== '127.0.0.1' ||
  parsedSafetyUrl.port !== '54322' || parsedSafetyUrl.pathname !== '/salon_ai_test' ||
  parsedSafetyUrl.username !== 'postgres' || parsedSafetyUrl.password !== 'postgres'
) throw new Error('Refusing unsafe F5.6 PostgreSQL contract URL')
delete process.env.DATABASE_URL
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, hoursRepoModule, hoursQueries] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-hours.js'),
  import('../src/bot-options/application/hours-queries.js')
])

const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 6, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })

const suffix = randomUUID().replaceAll('-', '')
const businessA = `f56_pg_a_${suffix}`
const businessB = `f56_pg_b_${suffix}`

// Professional IDs for exclusion test
const professionalId = `f56_prof_${suffix}`

try {
  // ─── Setup ────────────────────────────────────────────────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessA}, ${`F56A-${suffix}`}, 'F56 PG contract A')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessB}, ${`F56B-${suffix}`}, 'F56 PG contract B')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${professionalId}, ${businessA}, 'Profe Test')`)

  // ─── Business A: horarios L-V 9-18 ───────────────────────────────────────
  for (const dow of [1, 2, 3, 4, 5]) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime")
      VALUES (${randomUUID()}, ${businessA}, ${dow}, '09:00', '18:00')`)
  }
  // Sábado: 10-14
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${businessA}, 6, '10:00', '14:00')`)
  // Domingo: cerrado (no fila)

  // ─── Business B: horarios diferentes (L 8-12) ────────────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${businessB}, 1, '08:00', '12:00')`)

  // ─── Excepciones ──────────────────────────────────────────────────────────
  // Business A: excepción nivel negocio (professionalId=NULL)
  const bizExcId = randomUUID()
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${bizExcId}, ${businessA}, NULL, 'HOLIDAY', 'Día Feriado', 'Detalles internos', '2026-09-10T03:00:00Z'::timestamptz, '2026-09-11T03:00:00Z'::timestamptz)`)

  // Business A: excepción PROFESIONAL (debe ser excluida)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, ${professionalId}, 'ABSENCE', 'Ausencia Profe', NULL, '2026-09-12T03:00:00Z'::timestamptz, '2026-09-13T03:00:00Z'::timestamptz)`)

  // Business B: excepción (debe ser excluida por tenant)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessB}, NULL, 'VACATION', 'Vacaciones B', NULL, '2026-09-15T03:00:00Z'::timestamptz, '2026-09-16T03:00:00Z'::timestamptz)`)

  const repo = new hoursRepoModule.PrismaHoursRepository(prisma)
  const dbNow = new Date('2026-08-25T12:00:00Z')
  const timezone = 'America/Buenos_Aires'

  // ─── Test 1: Tenant isolation — Business A no ve Business B ──────────────
  const hoursA = await repo.loadBusinessWeeklyHours({ businessId: businessA })
  const hoursB = await repo.loadBusinessWeeklyHours({ businessId: businessB })

  assert.ok(hoursA.length >= 6, `Business A tiene 6+ filas (L+S): ${hoursA.length}`)
  assert.equal(hoursB.length, 1, 'Business B tiene 1 fila')
  assert.equal(hoursB[0]!.dayOfWeek, 1)
  assert.equal(hoursB[0]!.startTime, '08:00')

  const excA = await repo.loadBusinessOperationalExceptions({ businessId: businessA, dbNow, timezone })
  const excB = await repo.loadBusinessOperationalExceptions({ businessId: businessB, dbNow, timezone })

  // Business A: 1 business-level (HOLIDAY), professional block excluded
  assert.equal(excA.length, 1, `Business A: solo excepción nivel negocio (no profesional): ${excA.length}`)
  assert.equal(excA[0]!.reason, 'HOLIDAY')
  assert.equal(excA[0]!.title, 'Día Feriado')

  // Business B: 1 excepción (su propio tenant)
  assert.equal(excB.length, 1, 'Business B: solo sus propias excepciones')
  assert.equal(excB[0]!.reason, 'VACATION')
  console.log('OK PG: tenant isolation — A no ve B y viceversa')

  // ─── Test 2: Professional blocks EXCLUDED ──────────────────────────────────
  // Ya verificado arriba: excA.length === 1 (solo HOLIDAY, no ABSENCE del profesional)
  const profBlock = excA.find((e) => e.reason === 'ABSENCE')
  assert.equal(profBlock, undefined, 'bloque profesional NO aparece en excepciones de negocio')
  console.log('OK PG: professional blocks excluded from business exceptions')

  // ─── Test 3: Edge exacto [from,to) — excepción en to EXCLUIDA ─────────────
  // from = 2026-08-25T03:00:00Z, to = 2026-09-24T03:00:00Z
  // Agregamos excepción que empieza EXACTAMENTE en to (debe ser excluida)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, NULL, 'TRAINING', 'Capa to-edge', NULL, '2026-09-24T03:00:00Z'::timestamptz, '2026-09-25T03:00:00Z'::timestamptz)`)

  const excWithEdge = await repo.loadBusinessOperationalExceptions({ businessId: businessA, dbNow, timezone })
  const toEdge = excWithEdge.find((e) => e.reason === 'TRAINING')
  assert.equal(toEdge, undefined, 'excepción en startAt=to NO incluida (ventana [from,to) es semi-abierta)')

  // Excepción que empieza 1 minuto ANTES de to (debe ser incluida)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, NULL, 'PERSONAL', 'Just-before-to', NULL, '2026-09-24T02:59:00Z'::timestamptz, '2026-09-25T03:00:00Z'::timestamptz)`)

  const excJustBefore = await repo.loadBusinessOperationalExceptions({ businessId: businessA, dbNow, timezone })
  const justBefore = excJustBefore.find((e) => e.reason === 'PERSONAL')
  assert.ok(justBefore, 'excepción 1 min antes de to SÍ incluida')
  console.log('OK PG: edge [from,to) — exacto excluido, justo antes incluido')

  // ─── Test 4: Excepción que empieza ANTES de from pero cruza → INCLUIDA ────
  // startAt = from - 1h, endAt = from + 1h → overlap
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, NULL, 'SICK_LEAVE', 'Cross-from', NULL, '2026-08-25T02:00:00Z'::timestamptz, '2026-08-25T04:00:00Z'::timestamptz)`)

  const excWithCross = await repo.loadBusinessOperationalExceptions({ businessId: businessA, dbNow, timezone })
  const crossFrom = excWithCross.find((e) => e.reason === 'SICK_LEAVE')
  assert.ok(crossFrom, 'excepción que cruza from SÍ incluida')
  console.log('OK PG: cross-from overlap included')

  // ─── Test 5: Las excepciones operativas NO se exponen en formato ─────────
  const formatted = hoursQueries.formatBusinessWeeklySchedule(hoursA, excA, dbNow, timezone)
  assert.ok(!formatted.includes('Detalles internos'), 'note NO en formato final')
  assert.ok(!formatted.includes('Feriado'), 'reason NO en formato final')
  assert.ok(!formatted.includes('Día Feriado'), 'title NO en formato final')
  assert.ok(formatted.includes('Los horarios pueden variar en fechas especiales.'), 'aclaración pública presente')
  console.log('OK PG: operational exceptions not exposed in formatted output')

  // ─── Test 6: Horarios del negocio — Lunes-Domingo siempre presentes ───────
  const schedule = hoursQueries.formatBusinessWeeklySchedule(hoursA, [], dbNow, timezone)
  for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
    assert.ok(schedule.includes(`*${day}*`), `día ${day} presente en formato`)
  }
  assert.ok(schedule.includes('*Domingo*: Cerrado'), 'domingo cerrado')
  console.log('OK PG: Lunes-Domingo siempre presentes')

  // ─── Test 7: Solo ScheduleBlock con startAt < to AND endAt > from ─────────
  // Excepción completamente fuera de ventana → excluida
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, NULL, 'MAINTENANCE', 'Past block', NULL, '2026-06-01T03:00:00Z'::timestamptz, '2026-06-02T03:00:00Z'::timestamptz)`)

  const excFinal = await repo.loadBusinessOperationalExceptions({ businessId: businessA, dbNow, timezone })
  const pastBlock = excFinal.find((e) => e.title === 'Past block')
  assert.equal(pastBlock, undefined, 'excepción pasada completamente excluida')
  console.log('OK PG: past exception outside window excluded')

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('OK F5.6 PG contract: tenant isolation, business exceptions,')
  console.log('   professional exclusion, [from,to) edges, formatting')
  console.log('═══════════════════════════════════════════════════════════════')
} finally {
  await prisma.scheduleBlock.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
  await prisma.businessHours.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
  await prisma.professional.deleteMany({ where: { businessId: { in: [businessA, businessB] } } })
  await prisma.business.deleteMany({ where: { id: { in: [businessA, businessB] } } })
  await prisma.$disconnect()
}
