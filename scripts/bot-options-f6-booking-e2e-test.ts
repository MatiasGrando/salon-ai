import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsed = new URL(SAFE_DATABASE_URL)
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '54322' || parsed.pathname !== '/salon_ai_test') throw new Error('Refusing unsafe F6 booking E2E database')
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, processor, stateModule, availability] = await Promise.all([
  import('../src/config/prisma-client.js'), import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/process-session-job.js'), import('../src/bot-options/domain/state.js'),
  import('../src/bot-options/application/availability-queries.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f6book_b_${suffix}`; const configurationId = `f6book_cfg_${suffix}`; const deploymentId = `f6book_dep_${suffix}`
const conversationId = `f6book_conv_${suffix}`; const sessionId = `f6book_session_${suffix}`; const categoryId = `f6book_cat_${suffix}`
const serviceId = `f6book_service_${suffix}`; const professionalId = `f6book_pro_${suffix}`
const rollbackMarker = 'F6_BOOKING_E2E_EXPECTED_ROLLBACK'
const persistentBefore = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM public."Appointment"`)

try {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const initial = stateModule.createInitialBotOptionsState()
    initial.flow = 'CATEGORY_SELECT'
    initial.catalogMode = 'BOOKING'
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F6BOOK-${suffix}`}, 'F6 Booking')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
      VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'F6 Booking', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "activatedAt", "updatedAt")
      VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, '5491100000099', ${businessId}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt")
      VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'UTC', ${JSON.stringify(initial)}::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ServiceCategory" ("id", "businessId", "name", "isActive", "updatedAt") VALUES (${categoryId}, ${businessId}, 'Pelo', true, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable")
      VALUES (${serviceId}, ${businessId}, ${categoryId}, 'Corte', 30, 1500, 'FIXED'::"ServicePriceMode", true)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO public."Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings") VALUES (${professionalId}, ${businessId}, 'Ada', true, true)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES (${`f6book_link_${suffix}`}, ${professionalId}, ${serviceId})`)

    const clock = await tx.$queryRaw<Array<{ dbNow: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "dbNow"`)
    const tomorrow = availability.localDateKey(clock[0]!.dbNow, 'UTC', 1)
    const noon = availability.localDateTimeToInstants(tomorrow, 12 * 60, 'UTC')[0]!
    const weekday = availability.weekdayInTimezone(noon, 'UTC')
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES (${`f6book_bh_${suffix}`}, ${businessId}, ${weekday}, '09:00', '18:00')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES (${`f6book_ph_${suffix}`}, ${professionalId}, ${weekday}, '09:00', '18:00')`)

    // Compatibilidad contra un schema aún no migrado: sólo pg_temp y rollback total.
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "BusinessBotOptionsSettings" ("businessId" text PRIMARY KEY, "timezone" text NOT NULL, "bookingHorizonDays" integer NOT NULL, "bookingLeadTimeHours" integer NOT NULL, "morningCutTime" text NOT NULL, "eveningCutTime" text NOT NULL) ON COMMIT DROP')
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" VALUES (${businessId}, 'UTC', 2, 0, '12:30', '16:30')`)
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Professional" AS TABLE public."Professional"')
    await tx.$executeRawUnsafe('ALTER TABLE "Professional" ADD COLUMN IF NOT EXISTS "botBookingPriority" integer NOT NULL DEFAULT 100')

    const runtimeClient = {
      $queryRaw: tx.$queryRaw.bind(tx), $executeRaw: tx.$executeRaw.bind(tx),
      $transaction: async <T>(callback: (inner: typeof tx) => Promise<T>): Promise<T> => callback(tx)
    } as Parameters<typeof processor.processSessionJob>[0]['client']
    let revision = 0n
    async function act(actionType: string, entityRef: object | null = null, payload: object | null = null) {
      const token = randomUUID(); const eventId = `f6book_event_${token}`; const inboxId = `f6book_inbox_${token}`; const jobId = `f6book_job_${token}`
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload")
        VALUES (${eventId}, ${`f6book-${token}`}, 'MESSAGE'::"BotProviderEventType", ${businessId}, ${`wamid.f6book.${token}`}, '{}'::jsonb)`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "providerMessageId", "actionType", "entityRef", "payload", "deploymentId", "deploymentGeneration", "expectedRevision", "status")
        VALUES (${inboxId}, ${businessId}, ${eventId}, ${sessionId}, ${`wamid.f6book.${token}`}, ${actionType}, ${entityRef ? JSON.stringify(entityRef) : null}::jsonb,
          ${payload ? JSON.stringify(payload) : null}::jsonb, ${deploymentId}, 1, ${revision}, 'SELECTED'::"BotInboxStatus")`)
      const claimToken = randomUUID()
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "status", "attempts", "leaseToken", "leasedUntil", "updatedAt")
        VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${businessId}, ${deploymentId}, 1, ${revision}, 'LEASED'::"BotJobStatus", 1, ${claimToken}, clock_timestamp() + interval '30 seconds', clock_timestamp())`)
      const job: ClaimedBotJob = { id: jobId, kind: 'PROCESS_SESSION', aggregateId: inboxId, businessId, deploymentId, deploymentGeneration: 1, expectedRevision: revision, attempts: 1, maxAttempts: 8, claimToken, claimedUntil: new Date(Date.now() + 30_000), queueWaitMs: 0 }
      assert.equal(await processor.processSessionJob({ client: runtimeClient, job }), 'PROCESSED')
      revision += 1n
    }

    await act('category.select', { type: 'CATEGORY', id: categoryId })
    await act('service.select', { type: 'SERVICE', id: serviceId })
    await act('cart.continue')
    await act('professional.any')
    await act('date.select', null, { date: tomorrow })
    const slotStartAt = `${tomorrow}T10:00:00.000Z`
    await act('slot.select', null, { startAt: slotStartAt })

    const sessions = await tx.$queryRaw<Array<{ revision: bigint; state: { flow: string; cart: Array<{ serviceId: string }>; selections: { date: string; slotStartAt: string; provisionalProfessionalId: string } } }>>(Prisma.sql`
      SELECT "revision", "state" FROM "BotSession" WHERE "id" = ${sessionId} AND "businessId" = ${businessId}`)
    assert.equal(sessions[0]!.revision, 6n)
    assert.equal(sessions[0]!.state.flow, 'BOOKING_SUMMARY')
    assert.deepEqual(sessions[0]!.state.cart, [{ serviceId }])
    assert.equal(sessions[0]!.state.selections.date, tomorrow)
    assert.equal(sessions[0]!.state.selections.slotStartAt, slotStartAt)
    assert.equal(sessions[0]!.state.selections.provisionalProfessionalId, professionalId)
    const appointmentWrites = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM public."Appointment" WHERE "professionalId" = ${professionalId}`)
    assert.equal(appointmentWrites[0]!.count, 0n, 'F6 termina en resumen sin Appointment/hold')
    throw new Error(rollbackMarker)
  }), new RegExp(rollbackMarker))

  const persistentAfter = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM public."Appointment"`)
  assert.equal(persistentAfter[0]!.count, persistentBefore[0]!.count)
  console.log('OK F6.9 E2E: categoría → carrito → profesional → fecha → slot → resumen, sin agenda writes y con rollback total.')
} finally {
  await prisma.$disconnect()
}
