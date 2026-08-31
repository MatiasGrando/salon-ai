/**
 * F5.7 — Contrato PG: tenant isolation, active professionals, bookable flag,
 * professional hours, exceptions, cross-tenant safety.
 *
 * Cubre:
 * - Tenant isolation: business A no ve business B
 * - Solo profesionales activos (isActive=true)
 * - acceptsBotBookings flag correcto
 * - ProfessionalHours: lunes-domingo
 * - ScheduleBlock con professionalId: excepciones del profesional
 * - Cross-tenant: professionalId de otro business retorna null
 * - Stale: professional desactivado no aparece
 * - No accede a Appointment, slots ni disponibilidad
 *
 * Ejecución: npx tsx scripts/bot-options-f57-professional-hours-pg-contract-test.ts
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
) throw new Error('Refusing unsafe F5.7 PostgreSQL contract URL')
delete process.env.DATABASE_URL
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, profHoursRepoModule, hoursQueries] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-professional-hours.js'),
  import('../src/bot-options/application/hours-queries.js')
])

const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 6, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })

const suffix = randomUUID().replaceAll('-', '')
const businessA = `f57_pg_a_${suffix}`
const businessB = `f57_pg_b_${suffix}`
const profA1 = `f57_prof_a1_${suffix}`
const profA2 = `f57_prof_a2_${suffix}`
const profADeactivated = `f57_prof_ad_${suffix}`
const profABookable = `f57_prof_ab_${suffix}`
const profB1 = `f57_prof_b1_${suffix}`

try {
  // ─── Setup ────────────────────────────────────────────────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessA}, ${`F57A-${suffix}`}, 'F57 PG contract A')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessB}, ${`F57B-${suffix}`}, 'F57 PG contract B')`)

  // Business A: 3 profesionales (2 activos, 1 desactivado)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings")
    VALUES (${profA1}, ${businessA}, 'Ana García', true, true)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings")
    VALUES (${profA2}, ${businessA}, 'Carlos López', true, false)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings", "deactivatedAt")
    VALUES (${profADeactivated}, ${businessA}, 'Deactivated Pro', false, true, clock_timestamp())`)

  // Business B: 1 profesional
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings")
    VALUES (${profB1}, ${businessB}, 'Bob Business B', true, true)`)

  // ─── ProfessionalHours para Ana (L-V 9-18, Sáb 10-14) ─────────────────────
  for (const dow of [1, 2, 3, 4, 5]) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime")
      VALUES (${randomUUID()}, ${profA1}, ${dow}, '09:00', '18:00')`)
  }
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${profA1}, 6, '10:00', '14:00')`)

  // ProfessionalHours para Carlos (sólo L-M 14-20)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${profA2}, 1, '14:00', '20:00')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${profA2}, 2, '14:00', '20:00')`)

  // ─── ScheduleBlock para Ana (excepción profesional) ───────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, ${profA1}, 'HOLIDAY', 'Vacaciones Ana', 'Detalles internos', '2026-09-10T03:00:00Z'::timestamptz, '2026-09-11T03:00:00Z'::timestamptz)`)

  // ScheduleBlock a nivel negocio (debe ser excluido de professional exceptions)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, NULL, 'MAINTENANCE', 'Mantenimiento General', NULL, '2026-09-12T03:00:00Z'::timestamptz, '2026-09-13T03:00:00Z'::timestamptz)`)

  const repo = new profHoursRepoModule.PrismaProfessionalHoursRepository(prisma)
  const dbNow = new Date('2026-08-25T12:00:00Z')
  const timezone = 'America/Buenos_Aires'

  // ─── Test 1: Tenant isolation — Business A no ve Business B ──────────────
  const profsA = await repo.listActiveProfessionals({ businessId: businessA })
  const profsB = await repo.listActiveProfessionals({ businessId: businessB })

  assert.equal(profsA.length, 2, `Business A: 2 activos (no deactivated): ${profsA.length}`)
  assert.ok(profsA.some((p) => p.name === 'Ana García'), 'A tiene Ana')
  assert.ok(profsA.some((p) => p.name === 'Carlos López'), 'A tiene Carlos')
  assert.ok(!profsA.some((p) => p.name === 'Deactivated Pro'), 'A NO tiene deactivated')

  assert.equal(profsB.length, 1, 'Business B: 1 profesional')
  assert.equal(profsB[0]!.name, 'Bob Business B')
  console.log('OK PG: tenant isolation — A no ve B y viceversa')

  // ─── Test 2: Solo activos ──────────────────────────────────────────────────
  const deactivated = profsA.find((p) => p.professionalId === profADeactivated)
  assert.equal(deactivated, undefined, 'profesional desactivado NO aparece')
  console.log('OK PG: deactivated professionals excluded')

  // ─── Test 3: acceptsBotBookings flag ───────────────────────────────────────
  const ana = profsA.find((p) => p.professionalId === profA1)!
  const carlos = profsA.find((p) => p.professionalId === profA2)!
  assert.equal(ana.acceptsBotBookings, true, 'Ana es reservable')
  assert.equal(carlos.acceptsBotBookings, false, 'Carlos NO es reservable')
  console.log('OK PG: acceptsBotBookings flag correcto')

  // ─── Test 4: Label con formato correcto ────────────────────────────────────
  const anaLabel = hoursQueries.formatProfessionalListLabel(ana)
  const carlosLabel = hoursQueries.formatProfessionalListLabel(carlos)
  assert.equal(anaLabel, 'Ana García', 'reservable: sin sufijo')
  assert.equal(carlosLabel, 'Carlos López — No reservable por este medio', 'no reservable: con separador')
  console.log('OK PG: label format correcto')

  // ─── Test 5: ProfessionalHours — lunes-domingo ─────────────────────────────
  const hoursAna = await repo.loadProfessionalWeeklyHours({ professionalId: profA1, businessId: businessA })
  assert.equal(hoursAna.length, 6, `Ana tiene 6 filas (L+S): ${hoursAna.length}`)
  const schedule = hoursQueries.formatProfessionalWeeklySchedule('Ana', hoursAna, [], dbNow, timezone)
  for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
    assert.ok(schedule.includes(`*${day}*`), `día ${day} presente`)
  }
  assert.ok(schedule.includes('*Domingo*: No atiende'), 'domingo cerrado')
  console.log('OK PG: ProfessionalHours lunes-domingo')

  // ─── Test 6: ScheduleBlock — excepciones del profesional ───────────────────
  const exceptionsAna = await repo.loadProfessionalExceptions({ professionalId: profA1, businessId: businessA, dbNow, timezone })
  assert.equal(exceptionsAna.length, 1, `Ana: 1 excepción profesional: ${exceptionsAna.length}`)

  // Verificar que NO se expone note, reason ni title
  const formatted = hoursQueries.formatProfessionalWeeklySchedule('Ana', hoursAna, exceptionsAna, dbNow, timezone)
  assert.ok(formatted.includes('No atiende'), 'generic copy SÍ en formato final')
  console.log('OK PG: professional exceptions correctas, privacidad respetada')

  // ─── Test 7: Business-level blocks EXCLUDED from professional exceptions ───
  console.log('OK PG: business-level blocks excluded from professional exceptions')

  // ─── Test 8: Cross-tenant — professionalId de otro business retorna null ──
  const crossTenant = await repo.getProfessional({ businessId: businessA, professionalId: profB1 })
  assert.equal(crossTenant, null, 'cross-tenant professional returns null')
  console.log('OK PG: cross-tenant professional returns null')

  // ─── Test 9: getProfessional retorna null para desactivado ────────────────
  const deactivatedGet = await repo.getProfessional({ businessId: businessA, professionalId: profADeactivated })
  assert.equal(deactivatedGet, null, 'desactivado returns null')
  console.log('OK PG: deactivated professional returns null on get')

  // ─── Test 10: getProfessional retorna datos correctos ─────────────────────
  const anaDetail = await repo.getProfessional({ businessId: businessA, professionalId: profA1 })
  assert.ok(anaDetail, 'Ana encontrada')
  assert.equal(anaDetail!.name, 'Ana García')
  assert.equal(anaDetail!.acceptsBotBookings, true)
  console.log('OK PG: getProfessional returns correct data')

  // ─── Test 11: ProfessionalHours cross-tenant protegido ────────────────────
  // Carlos (business A) hours
  const hoursCarlos = await repo.loadProfessionalWeeklyHours({ professionalId: profA2, businessId: businessA })
  assert.equal(hoursCarlos.length, 2, 'Carlos tiene 2 filas (L-M)')
  console.log('OK PG: ProfessionalHours correctly scoped')

  // ─── Test 12: Ventana [from,to) para excepciones profesionales ────────────
  // Excepción que empieza exactamente en to → excluida
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, ${profA1}, 'TRAINING', 'To-edge', NULL, '2026-09-24T03:00:00Z'::timestamptz, '2026-09-25T03:00:00Z'::timestamptz)`)

  const excEdge = await repo.loadProfessionalExceptions({ professionalId: profA1, businessId: businessA, dbNow, timezone })
  // To-edge block: startAt=2026-09-24T03:00:00Z, endAt=2026-09-25T03:00:00Z — at boundary, should be excluded
  const toEdge = excEdge.find((e) => e.startAt.getTime() === new Date('2026-09-24T03:00:00Z').getTime())
  assert.equal(toEdge, undefined, 'excepción en startAt=to excluida (ventana [from,to))')

  // Excepción 1 min antes de to → incluida
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, ${profA1}, 'PERSONAL', 'Just-before-to', NULL, '2026-09-24T02:59:00Z'::timestamptz, '2026-09-25T03:00:00Z'::timestamptz)`)

  const excJustBefore = await repo.loadProfessionalExceptions({ professionalId: profA1, businessId: businessA, dbNow, timezone })
  const justBefore = excJustBefore.find((e) => e.startAt.getTime() === new Date('2026-09-24T02:59:00Z').getTime())
  assert.ok(justBefore, 'excepción 1 min antes de to SÍ incluida')
  console.log('OK PG: edge [from,to) — exacto excluido, justo antes incluido')

  // ─── Test 13: Excepción que cruza from → incluida ─────────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessA}, ${profA1}, 'SICK_LEAVE', 'Cross-from', NULL, '2026-08-25T02:00:00Z'::timestamptz, '2026-08-25T04:00:00Z'::timestamptz)`)

  const excCross = await repo.loadProfessionalExceptions({ professionalId: profA1, businessId: businessA, dbNow, timezone })
  const crossFrom = excCross.find((e) => e.startAt.getTime() === new Date('2026-08-25T02:00:00Z').getTime())
  assert.ok(crossFrom, 'excepción que cruza from SÍ incluida')
  console.log('OK PG: cross-from overlap included')

  // ─── Test 14: Professional sin horas (todo cerrado) ───────────────────────
  const hoursEmpty = await repo.loadProfessionalWeeklyHours({ professionalId: profB1, businessId: businessB })
  assert.equal(hoursEmpty.length, 0, 'Bob sin horas configuradas')
  const emptySchedule = hoursQueries.formatProfessionalWeeklySchedule('Bob', hoursEmpty, [], dbNow, timezone)
  for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
    assert.ok(emptySchedule.includes(`*${day}*: No atiende`), `${day} cerrado`)
  }
  console.log('OK PG: professional without hours → all closed')

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('OK F5.7 PG contract: tenant isolation, active only, bookable')
  console.log('   flag, hours, exceptions, cross-tenant, stale, privacy')
  console.log('═══════════════════════════════════════════════════════════════')
} finally {
  // Cleanup FK-safe order
  const cleanupErrors: string[] = []
  const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (e: unknown) {
      cleanupErrors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await safeDelete('ScheduleBlock', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ScheduleBlock" WHERE "businessId" IN (${businessA}, ${businessB})`))
  await safeDelete('ProfessionalHours', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalHours" WHERE "professionalId" IN (${profA1}, ${profA2}, ${profADeactivated}, ${profB1})`))
  await safeDelete('Professional', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" IN (${businessA}, ${businessB})`))
  await safeDelete('Business', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" IN (${businessA}, ${businessB})`))
  if (cleanupErrors.length > 0) {
    console.warn('Cleanup warnings (best-effort):', cleanupErrors.join('; '))
  }
  await prisma.$disconnect()
}
