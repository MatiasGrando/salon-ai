import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (
  safety.protocol !== 'postgresql:' || safety.hostname !== '127.0.0.1' || safety.port !== '54322' ||
  safety.pathname !== '/salon_ai_test' || safety.username !== 'postgres' || safety.password !== 'postgres'
) throw new Error('Refusing unsafe F5 PostgreSQL contract URL')
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, admissionApplication, admissionInfrastructure, worker, processor, outbox, config] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/admit-provider-events.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/config/bot-options.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 3000
})
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f5_menu_b_${suffix}`
const configurationId = `f5_menu_c_${suffix}`
const deploymentId = `f5_menu_d_${suffix}`
const phoneNumberId = `f5_menu_phone_${suffix}`
const customerPhone = `54911${suffix.slice(0, 8)}`
const secret = `f5_menu_secret_${suffix}`

try {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name")
    VALUES (${businessId}, ${`F5-${suffix}`}, 'F5 main menu contract')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'Deterministic options', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "appSecret", "updatedAt")
    VALUES (${`f5_menu_wa_${suffix}`}, ${businessId}, 'CONNECTED'::"WhatsAppConnectionStatus", ${phoneNumberId}, ${secret}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation",
      "legacyDispatchCoverageVersion", "activatedAt", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())
  `)

  const runtimeOff = config.resolveBotOptionsConfig({
    BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED: 'true',
    BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE: 'true'
  })
  assert.equal(runtimeOff.workersEnabled, false, 'worker kill switch remains independent from routing pointer')
  assert.equal(runtimeOff.senderEnabled, false, 'sender kill switch remains independent from routing pointer')
  const pointerBefore = await prisma.botChannelDeployment.findUniqueOrThrow({
    where: { businessId_channel: { businessId, channel: 'WHATSAPP' } },
    select: { id: true, generation: true, engineKey: true }
  })

  const repository = new admissionInfrastructure.PrismaAuthoritativeAdmissionRepository(prisma)
  const webhook = admissionApplication.createAuthoritativeWebhookAdmission(repository)
  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: `wamid.f5.menu.${suffix}`, from: customerPhone, timestamp: '1787701000', type: 'text', text: { body: 'hola' } }]
  } }] }] }), 'utf8')
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const admitted = await webhook.routeAndAdmit({ rawBody: body, signatureHeader: signature, traceId: `f5-menu-${suffix}` })
  assert.deepEqual(admitted, { route: 'new', outcome: { status: 'admitted', eventCount: 1 } })

  const job = await worker.claimBotJob(prisma)
  assert.ok(job)
  assert.equal(job.kind, 'PROCESS_INBOX')
  assert.equal(await processor.processSessionJob({ client: prisma, job }), 'PROCESSED')

  const queued = await outbox.claimOutbox(prisma)
  assert.ok(queued)
  let providerCalls = 0
  const delivery = await outbox.sendClaimedOutbox({
    client: prisma,
    item: queued,
    provider: {
      async send(input, signal) {
        providerCalls += 1
        assert.equal(signal.aborted, false)
        assert.equal(input.businessId, businessId)
        const payload = input.payload as { to?: unknown; item?: { type?: unknown; body?: unknown; rows?: Array<{ title?: string }> } }
        assert.equal(payload.to, customerPhone)
        assert.equal(payload.item?.type, 'interactive')
        assert.equal(payload.item?.body, '¿Qué querés hacer?')
        assert.deepEqual(payload.item?.rows?.map((row) => row.title), [
          'Sacar un turno',
          'Ver servicios y precios',
          'Consultar horarios',
          'Gestionar un turno',
          'Hablar con el equipo'
        ])
        return { kind: 'accepted', providerMessageId: `wamid.f5.out.${suffix}` }
      }
    }
  })
  assert.equal(delivery, 'ACCEPTED')
  assert.equal(providerCalls, 1)

  const result = await prisma.$queryRaw<Array<{
    sessions: bigint; prompts: bigint; choices: bigint; accepted: bigint; doneClaims: bigint
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BotSession" WHERE "businessId" = ${businessId})::bigint AS "sessions",
      (SELECT count(*) FROM "BotPrompt" p JOIN "BotSession" s ON s."id" = p."sessionId"
        WHERE s."businessId" = ${businessId} AND p."status" = 'OPEN'::"BotPromptStatus")::bigint AS "prompts",
      (SELECT count(*) FROM "BotPromptChoice" c JOIN "BotPrompt" p ON p."id" = c."promptId"
        JOIN "BotSession" s ON s."id" = p."sessionId" WHERE s."businessId" = ${businessId})::bigint AS "choices",
      (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${businessId} AND "status" = 'ACCEPTED'::"BotOutboxStatus")::bigint AS "accepted",
      (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId" = ${businessId} AND "status" = 'DONE'::"BotDispatchStatus")::bigint AS "doneClaims"
  `)
  assert.deepEqual(result[0], { sessions: 1n, prompts: 1n, choices: 5n, accepted: 1n, doneClaims: 2n })

  const pointerAfter = await prisma.botChannelDeployment.findUniqueOrThrow({
    where: { businessId_channel: { businessId, channel: 'WHATSAPP' } },
    select: { id: true, generation: true, engineKey: true }
  })
  assert.deepEqual(pointerAfter, pointerBefore, 'capability kill switches must not roll back routing')
  console.log('OK F5.1: signed inbound reaches one fenced main-menu prompt and one accepted Meta delivery; kill switches preserve pointer.')
} finally {
  await prisma.business.deleteMany({ where: { id: businessId } }).catch(() => undefined)
  await prisma.$disconnect()
}
