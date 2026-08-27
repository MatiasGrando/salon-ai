import assert from 'node:assert/strict'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsed = new URL(SAFE_DATABASE_URL)
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '54322' || parsed.pathname !== '/salon_ai_test') {
  throw new Error('Refusing unsafe F6 availability database')
}
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, availabilityModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/prisma-availability.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const rollbackMarker = 'F6_AVAILABILITY_EXPECTED_ROLLBACK'
const persistentBefore = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM public."Appointment"`)

try {
  await assert.rejects(prisma.$transaction(async (tx) => {
    // pg_temp sombrea las tablas públicas: contrato SQL real, cero DDL/DML persistente.
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "BusinessBotOptionsSettings" ("businessId" text PRIMARY KEY, "timezone" text NOT NULL, "bookingHorizonDays" integer NOT NULL, "bookingLeadTimeHours" integer NOT NULL, "morningCutTime" text NOT NULL, "eveningCutTime" text NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Professional" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "name" text NOT NULL, "isActive" boolean NOT NULL, "acceptsBotBookings" boolean NOT NULL, "botBookingPriority" integer NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Service" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "isBookable" boolean NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "ProfessionalService" ("professionalId" text NOT NULL, "serviceId" text NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "BusinessHours" ("businessId" text NOT NULL, "dayOfWeek" integer NOT NULL, "startTime" text NOT NULL, "endTime" text NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "ProfessionalHours" ("professionalId" text NOT NULL, "dayOfWeek" integer NOT NULL, "startTime" text NOT NULL, "endTime" text NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "ScheduleBlock" ("businessId" text NOT NULL, "professionalId" text NULL, "startAt" timestamptz NOT NULL, "endAt" timestamptz NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Appointment" ("id" text PRIMARY KEY, "professionalId" text NOT NULL, "startAt" timestamptz NOT NULL, "totalDurationMinutes" integer NOT NULL, "status" public."AppointmentStatus" NOT NULL) ON COMMIT DROP')
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "BookingDeposit" ("appointmentId" text NOT NULL, "status" public."BookingDepositStatus" NOT NULL, "expiresAt" timestamptz NULL) ON COMMIT DROP')

    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" VALUES ('a', 'UTC', 2, 0, '10:00', '11:00')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" VALUES
      ('p1', 'a', 'Uno', true, true, 20), ('p2', 'a', 'Dos', true, true, 10),
      ('foreign', 'b', 'Ajeno', true, true, 1), ('inactive', 'a', 'Inactivo', false, true, 1)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" VALUES ('s1', 'a', true), ('foreign-service', 'b', true)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" VALUES
      ('p1', 's1'), ('p2', 's1'), ('foreign', 's1'), ('inactive', 's1')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" VALUES ('a', 1, '09:00', '12:00'), ('a', 2, '09:00', '12:00')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" VALUES
      ('p1', 1, '09:00', '12:00'), ('p2', 1, '09:00', '12:00'),
      ('p1', 2, '09:00', '12:00'), ('p2', 2, '09:00', '12:00')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" VALUES
      ('confirmed', 'p1', '2026-08-24T09:00:00Z', 30, 'CONFIRMED'),
      ('pending-live', 'p1', '2026-08-24T09:30:00Z', 30, 'PENDING'),
      ('pending-expired', 'p2', '2026-08-24T09:00:00Z', 30, 'PENDING')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" VALUES
      ('pending-live', 'PENDING_PROOF', '2026-08-24T09:00:00Z'),
      ('pending-expired', 'PENDING_PROOF', '2026-08-24T07:00:00Z')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" VALUES
      ('a', NULL, '2026-08-24T10:00:00Z', '2026-08-24T10:30:00Z'),
      ('a', 'p2', '2026-08-24T11:00:00Z', '2026-08-24T11:30:00Z'),
      ('b', NULL, '2026-08-24T09:00:00Z', '2026-08-24T12:00:00Z')`)

    const repo = new availabilityModule.PrismaAvailabilityRepository(tx)
    const settings = await repo.loadSettings('a')
    assert.deepEqual(settings, { timezone: 'UTC', horizonDays: 2, leadTimeHours: 0, morningCutTime: '10:00', eveningCutTime: '11:00' })
    await assert.rejects(repo.loadSettings('b'), /unavailable for tenant/)
    const compatible = await repo.compatibleProfessionals({ businessId: 'a', serviceIds: ['s1'] })
    assert.deepEqual(compatible.map((item) => item.id), ['p2', 'p1'], 'tenant, actividad y prioridad deben cercar profesionales')

    const result = await repo.search({ businessId: 'a', serviceIds: ['s1'], durationMinutes: 30, dbNow: new Date('2026-08-24T08:00:00Z'), settings })
    const byStart = new Map(result.slots.map((slot) => [slot.startAt, slot]))
    assert.equal(byStart.get('2026-08-24T09:00:00.000Z')?.professionalId, 'p2', 'depósito vencido no bloquea; turno confirmado sí')
    assert.equal(byStart.get('2026-08-24T09:30:00.000Z')?.professionalId, 'p2', 'depósito pendiente no vencido bloquea')
    assert.equal(byStart.has('2026-08-24T10:00:00.000Z'), false, 'bloqueo global elimina slot')
    assert.equal(byStart.get('2026-08-24T11:00:00.000Z')?.professionalId, 'p1', 'bloqueo profesional sólo elimina ese candidato')
    assert.equal(byStart.get('2026-08-25T09:00:00.000Z')?.professionalId, 'p2', 'empate usa prioridad y luego ID')
    assert.equal(byStart.get('2026-08-24T10:30:00.000Z')?.band, 'AFTERNOON')
    assert.equal(byStart.get('2026-08-24T11:30:00.000Z')?.band, 'EVENING')
    assert.equal(await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "Appointment"`).then((rows) => rows[0]!.count), 3n, 'búsqueda es read-only')
    throw new Error(rollbackMarker)
  }), new RegExp(rollbackMarker))

  const persistentAfter = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM public."Appointment"`)
  assert.equal(persistentAfter[0]!.count, persistentBefore[0]!.count, 'el contrato completo debe terminar sin writes persistentes')
  console.log('OK F6.5–F6.8 PG: tenant isolation, horarios, bloqueos, depósitos, balance, prioridad, franjas y rollback total.')
} finally {
  await prisma.$disconnect()
}
