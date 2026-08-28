import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { resolveBusinessWhatsAppCredentials } from '../../services/business-whatsapp-settings.js'
import {
  DepositProofImageValidationError,
  validateDepositProofImage
} from '../../services/deposit-proof-image-validation.js'
import { writeValidatedDepositProofInTransaction } from '../../services/deposit-proof-writer.js'
import { enqueueDepositNotificationWithRecoveryTx } from '../../services/deposit-notification-outbox.js'
import {
  downloadMetaDepositProof,
  MetaDepositMediaError,
  type MetaMediaHttp
} from '../infrastructure/meta-deposit-proof-media.js'
import {
  assertClaimedBotJobTx,
  completeClaimedBotJobTx,
  rescheduleClaimedBotJobTx,
  retargetClaimedBotJobTx,
  type ClaimedBotJob
} from '../infrastructure/postgres-worker.js'
import { upsertJob } from '../infrastructure/prisma-admission.js'

type DepositProofClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>

type ProofEvent = {
  id: string
  businessId: string
  providerMessageId: string | null
  phoneNumberId: string | null
  payload: Prisma.JsonValue
}

type ProofTargetResolution =
  | { kind: 'FOUND'; depositId: string }
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS' }

export type DepositProofJobOutcome =
  | 'APPLIED'
  | 'REPLAYED'
  | 'TERMINAL_INVALID'
  | 'TERMINAL_TRANSPORT'
  | 'FALLBACK'
  | 'CAPABILITY_OFF'
  | 'HUMAN_TAKEN_SILENCED'

export async function processDepositProofJob(input: {
  client: DepositProofClient
  job: ClaimedBotJob
  capabilityEnabled: boolean
  fetch?: MetaMediaHttp
  resolveAccessToken?: (businessId: string, expectedProviderPhoneNumberId: string) => Promise<string>
}): Promise<DepositProofJobOutcome> {
  if (input.job.kind !== 'RECEIVE_DEPOSIT_PROOF') throw new Error('unsupported deposit proof job')
  // RECEIVE is admitted work, not perpetual recovery. A cutover may make its
  // generation stale before claim, so fence and retarget it before capability
  // handling, target lookup, credential resolution, or provider I/O.
  const job = await retargetProofJobToCurrentDeployment(input.client, input.job)
  if (!input.capabilityEnabled) {
    await input.client.$transaction(async (tx) => {
      await assertClaimedBotJobTx(tx, job)
      await rescheduleClaimedBotJobTx(tx, job, new Date(Date.now() + 5 * 60_000), { refundClaimAttempt: true })
    })
    return 'CAPABILITY_OFF'
  }

  const event = await loadProofEvent(input.client, job)
  if (!event) return finishMissingEvent(input.client, job)
  if (await silenceProofForHumanTaken(input.client, job, event)) return 'HUMAN_TAKEN_SILENCED'
  const target = await resolveProofTarget(input.client, event, job.deploymentId)
  if (target.kind !== 'FOUND') return fallbackToInitialInbox(input.client, job, event)
  const expectedDepositId = target.depositId
  const payload = messagePayload(event.payload)
  const mediaId = stringField(payload?.mediaId)
  if (!payload || payload.messageType === 'document' || !mediaId || isDeclaredUnsupported(payload.mediaMimeType)) {
    return finishTerminal(input.client, job, event, expectedDepositId, 'INVALID_PROOF')
  }

  let downloaded: Awaited<ReturnType<typeof downloadMetaDepositProof>>
  try {
    // Short preflight only: never hold a transaction or DB connection across
    // credential resolution, provider I/O or image validation.
    await input.client.$transaction((tx) => assertClaimedBotJobTx(tx, job))
    if (!event.phoneNumberId) throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
    const accessToken = await (input.resolveAccessToken ?? defaultAccessToken)(event.businessId, event.phoneNumberId)
    downloaded = await downloadMetaDepositProof({
      mediaId,
      accessToken,
      fetch: input.fetch ?? nodeFetch,
    })
  } catch (error) {
    if (isRetryableTransport(error) && job.attempts < job.maxAttempts) throw new Error('deposit_media_transport_retryable')
    return finishTerminal(input.client, job, event, expectedDepositId, isRetryableTransport(error) ? 'PROOF_UNAVAILABLE' : 'INVALID_PROOF')
  }

  let evidence: Awaited<ReturnType<typeof validateDepositProofImage>>
  try {
    evidence = await validateDepositProofImage({
      data: downloaded.data,
      declaredMimeType: downloaded.mimeType,
      filename: stringField(payload.filename)
    })
  } catch (error) {
    if (!(error instanceof DepositProofImageValidationError)) throw new Error('deposit_image_validation_failed')
    return finishTerminal(input.client, job, event, expectedDepositId, 'INVALID_PROOF')
  }

  return input.client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job)
    if (await silenceProofForHumanTakenTx(tx, job, event)) return 'HUMAN_TAKEN_SILENCED'
    const current = await resolveProofTarget(tx, event, job.deploymentId)
    if (current.kind !== 'FOUND' || current.depositId !== expectedDepositId) return fallbackToInitialInboxTx(tx, job, event)
    const result = await writeValidatedDepositProofInTransaction(tx, {
      businessId: event.businessId,
      depositId: current.depositId,
      operationKey: `deposit-proof:${event.id}`,
      providerEventId: event.id,
      providerMessageId: event.providerMessageId,
      providerMediaId: mediaId,
      ...(event.phoneNumberId ? { expectedProviderPhoneNumberId: event.phoneNumberId } : {}),
      evidence
    })
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus"
      WHERE "id" = ${event.id} AND "businessId" = ${event.businessId}
    `)
    await completeClaimedBotJobTx(tx, job)
    return result.outcome
  })
}

async function silenceProofForHumanTaken(client: DepositProofClient, job: ClaimedBotJob, event: ProofEvent): Promise<boolean> {
  return client.$transaction((tx) => silenceProofForHumanTakenTx(tx, job, event))
}

/** F10.3 backstop: no proof media I/O or persistence crosses human ownership. */
async function silenceProofForHumanTakenTx(tx: Prisma.TransactionClient, job: ClaimedBotJob, event: ProofEvent): Promise<boolean> {
  await assertClaimedBotJobTx(tx, job)
  const payload = messagePayload(event.payload)
  const fromPhone = stringField(payload?.fromPhone)
  if (!fromPhone) return false
  const candidates = await tx.$queryRaw<Array<{ sessionId: string; conversationId: string; handoffId: string }>>(Prisma.sql`
    SELECT s."id" AS "sessionId", c."id" AS "conversationId", h."id" AS "handoffId" FROM "Conversation" c
    JOIN "BotSession" s ON s."conversationId"=c."id" AND s."businessId"=c."businessId"
    JOIN "BotHandoff" h ON h."businessId"=s."businessId" AND h."sessionId"=s."id"
    WHERE c."businessId"=${event.businessId} AND c."phone"=${fromPhone}
      AND s."status"='HUMAN_TAKEN'::"BotSessionStatus" AND h."status"='TAKEN'::"BotHandoffStatus"
  `)
  if (candidates.length === 0) return false
  if (candidates.length !== 1) throw new Error('ambiguous human-owned proof conversation')
  const candidate = candidates[0]!
  const sessions = await tx.$queryRaw<Array<{ sessionId: string }>>(Prisma.sql`
    SELECT "id" AS "sessionId" FROM "BotSession" WHERE "id"=${candidate.sessionId} AND "businessId"=${event.businessId}
      AND "status"='HUMAN_TAKEN'::"BotSessionStatus" FOR UPDATE
  `)
  if (sessions.length !== 1) return false
  const handoffs = await tx.$queryRaw<Array<{ handoffId: string }>>(Prisma.sql`
    SELECT "id" AS "handoffId" FROM "BotHandoff" WHERE "id"=${candidate.handoffId} AND "businessId"=${event.businessId}
      AND "sessionId"=${candidate.sessionId} AND "status"='TAKEN'::"BotHandoffStatus" FOR UPDATE
  `)
  if (handoffs.length !== 1) return false
  const conversations = await tx.$queryRaw<Array<{ conversationId: string }>>(Prisma.sql`
    SELECT "id" AS "conversationId" FROM "Conversation" WHERE "id"=${candidate.conversationId} AND "businessId"=${event.businessId}
      AND "phone"=${fromPhone} FOR UPDATE
  `)
  if (conversations.length !== 1) return false
  const target = { sessionId: sessions[0]!.sessionId, conversationId: conversations[0]!.conversationId }
  const body = typeof payload?.textBody === 'string' && payload.textBody.trim() ? payload.textBody.trim() : '[deposit proof]'
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "Message" ("id","conversationId","phone","direction","body","providerMessageId","status","metadata")
    VALUES (${randomUUID()},${target.conversationId},${fromPhone},'INBOUND'::"MessageDirection",${body},${event.providerMessageId},'received',
      ${JSON.stringify({ provider: 'whatsapp', source: 'bot-options-handoff-proof', messageType: payload?.messageType ?? null, mediaId: payload?.mediaId ?? null })}::jsonb)
    ON CONFLICT ("providerMessageId") DO NOTHING
  `)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Conversation" SET "lastMessage"=${body},"archivedAt"=NULL,"updatedAt"=clock_timestamp()
    WHERE "id"=${target.conversationId} AND "businessId"=${event.businessId}
  `)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","sessionId","providerMessageId","actionType","deploymentId","deploymentGeneration","payload","status","error")
    VALUES (${`handoff-taken-proof:${event.id}`},${event.businessId},${event.id},${target.sessionId},${event.providerMessageId},
      'handoff.taken_silent',${job.deploymentId},${job.deploymentGeneration},${JSON.stringify(event.payload)}::jsonb,
      'PROCESSED'::"BotInboxStatus",'HUMAN_TAKEN_SILENCED') ON CONFLICT ("id") DO NOTHING
  `)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotProviderEvent" SET "status"='PROCESSED'::"BotProviderEventStatus"
    WHERE "id"=${event.id} AND "businessId"=${event.businessId}
  `)
  await completeClaimedBotJobTx(tx, job)
  return true
}

async function loadProofEvent(client: DepositProofClient, job: ClaimedBotJob): Promise<ProofEvent | null> {
  return (await client.$queryRaw<ProofEvent[]>(Prisma.sql`
    SELECT "id", "businessId", "providerMessageId", "phoneNumberId", "payload" FROM "BotProviderEvent"
    WHERE "id" = ${job.aggregateId} AND "businessId" = ${job.businessId}
      AND "eventType" = 'MESSAGE'::"BotProviderEventType"
    LIMIT 1
  `))[0] ?? null
}

async function resolveProofTarget(
  client: Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient,
  event: ProofEvent,
  deploymentId: string
): Promise<ProofTargetResolution> {
  const payload = messagePayload(event.payload)
  if (!payload) return { kind: 'NONE' }
  const fromPhone = stringField(payload.fromPhone)
  if (!fromPhone) return { kind: 'NONE' }
  const rows = await client.$queryRaw<Array<{ depositId: string }>>(Prisma.sql`
    SELECT deposit."id" AS "depositId"
    FROM "Conversation" c
    JOIN "BotSession" s
      ON s."conversationId" = c."id" AND s."businessId" = c."businessId"
     AND s."status" = 'ACTIVE'::"BotSessionStatus"
    JOIN "BotChannelDeployment" deployment
      ON deployment."id" = s."deploymentId" AND deployment."businessId" = s."businessId"
     AND deployment."channel" = 'WHATSAPP'::"BotChannel"
     AND deployment."engineKey" = 'deterministic-options'
     AND deployment."activeConfigurationId" IS NOT NULL
     AND deployment."legacyDispatchCoverageVersion" >= 1
     AND deployment."claimsPausedAt" IS NULL
    JOIN "BookingDeposit" deposit
      ON deposit."conversationId" = c."id" AND deposit."businessId" = c."businessId"
    JOIN "BookingVisit" visit
      ON visit."id" = deposit."visitId" AND visit."businessId" = deposit."businessId"
     AND visit."sessionId" = s."id"
    JOIN "Appointment" appointment
      ON appointment."id" = deposit."appointmentId" AND appointment."visitId" = visit."id"
    WHERE c."businessId" = ${event.businessId} AND c."phone" = ${fromPhone}
      AND s."deploymentId" = ${deploymentId}
      AND deposit."snapshotSealedAt" IS NOT NULL
     AND deposit."source" = 'WHATSAPP'::"BookingDepositSource"
      AND (
        (deposit."status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus")
          AND visit."status" = 'HELD'::"BookingVisitStatus"
          AND appointment."status" = 'PENDING'::"AppointmentStatus")
        OR (deposit."status" = 'EXPIRED'::"BookingDepositStatus"
          AND visit."status" = 'EXPIRED'::"BookingVisitStatus"
          AND appointment."status" = 'CANCELLED'::"AppointmentStatus")
      )
    LIMIT 2
  `)
  if (rows.length === 0) return { kind: 'NONE' }
  if (rows.length > 1) return { kind: 'AMBIGUOUS' }
  return { kind: 'FOUND', depositId: rows[0]!.depositId }
}

async function finishTerminal(
  client: DepositProofClient,
  job: ClaimedBotJob,
  event: ProofEvent,
  expectedDepositId: string,
  kind: 'INVALID_PROOF' | 'PROOF_UNAVAILABLE'
): Promise<'TERMINAL_INVALID' | 'TERMINAL_TRANSPORT'> {
  return client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job)
    const target = await resolveProofTarget(tx, event, job.deploymentId)
    if (target.kind !== 'FOUND' || target.depositId !== expectedDepositId) {
      await fallbackToInitialInboxTx(tx, job, event)
      return kind === 'INVALID_PROOF' ? 'TERMINAL_INVALID' : 'TERMINAL_TRANSPORT'
    }
    await enqueueDepositNotificationWithRecoveryTx(tx, {
      businessId: event.businessId,
      depositId: target.depositId,
      sourceId: event.id,
      kind,
      ...(event.phoneNumberId ? { expectedProviderPhoneNumberId: event.phoneNumberId } : {})
    })
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotProviderEvent" SET "status" = 'REJECTED'::"BotProviderEventStatus"
      WHERE "id" = ${event.id} AND "businessId" = ${event.businessId}
    `)
    await completeClaimedBotJobTx(tx, job)
    return kind === 'INVALID_PROOF' ? 'TERMINAL_INVALID' : 'TERMINAL_TRANSPORT'
  })
}

async function retargetProofJobToCurrentDeployment(client: DepositProofClient, job: ClaimedBotJob): Promise<ClaimedBotJob> {
  return client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
    const rows = await tx.$queryRaw<Array<{ deploymentId: string; generation: number }>>(Prisma.sql`
      SELECT d."id" AS "deploymentId", d."generation"
      FROM "BotChannelDeployment" d
      WHERE d."id" = ${job.deploymentId} AND d."businessId" = ${job.businessId}
        AND d."channel" = 'WHATSAPP'::"BotChannel"
        AND d."engineKey" = 'deterministic-options'
        AND d."activeConfigurationId" IS NOT NULL
        AND d."legacyDispatchCoverageVersion" >= 1
        AND d."claimsPausedAt" IS NULL
      LIMIT 1
    `)
    const current = rows[0]
    if (!current) throw new Error('deposit proof deployment is inactive or incompatible')
    if (job.deploymentGeneration > current.generation) {
      throw new Error('deposit proof job generation is ahead of current deployment')
    }
    return retargetClaimedBotJobTx(tx, job, current)
  })
}

async function finishMissingEvent(client: DepositProofClient, job: ClaimedBotJob): Promise<'FALLBACK'> {
  await client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job)
    await completeClaimedBotJobTx(tx, job)
  })
  return 'FALLBACK'
}

async function fallbackToInitialInbox(client: DepositProofClient, job: ClaimedBotJob, event: ProofEvent): Promise<'FALLBACK'> {
  return client.$transaction(async (tx) => fallbackToInitialInboxTx(tx, job, event))
}

async function fallbackToInitialInboxTx(tx: Prisma.TransactionClient, job: ClaimedBotJob, event: ProofEvent): Promise<'FALLBACK'> {
  await assertClaimedBotJobTx(tx, job)
  const inboxId = `deposit-proof-fallback:${event.id}`
  const payload = messagePayload(event.payload)
  const safeFallbackPayload = {
    kind: 'message',
    fromPhone: stringField(payload?.fromPhone),
    messageType: 'unsupported',
    textBody: null,
    interactiveReplyId: null,
    mediaType: null,
    mediaMimeType: null,
    mediaId: null,
    filename: null
  }
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" (
      "id", "businessId", "providerEventId", "providerMessageId", "actionType", "deploymentId",
      "deploymentGeneration", "payload", "status"
    ) VALUES (
       ${inboxId}, ${event.businessId}, ${event.id}, ${event.providerMessageId},
       'input.initial', ${job.deploymentId}, ${job.deploymentGeneration}, ${JSON.stringify(safeFallbackPayload)}::jsonb,
      'ADMITTED'::"BotInboxStatus"
    ) ON CONFLICT ("id") DO NOTHING
  `)
  await upsertJob(tx, 'PROCESS_INBOX', inboxId, event.businessId, job.deploymentId, job.deploymentGeneration, null, new Date())
  await completeClaimedBotJobTx(tx, job)
  return 'FALLBACK'
}

function messagePayload(value: Prisma.JsonValue): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'message'
    ? value as Record<string, unknown>
    : null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function isDeclaredUnsupported(value: unknown): boolean {
  const mime = stringField(value)?.split(';')[0]?.trim().toLowerCase()
  return mime !== undefined && mime !== null && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)
}

function isRetryableTransport(error: unknown): boolean {
  return error instanceof MetaDepositMediaError
    && ['METADATA_UNAVAILABLE', 'DOWNLOAD_FAILED', 'DOWNLOAD_TIMEOUT'].includes(error.code)
}

async function defaultAccessToken(businessId: string, expectedProviderPhoneNumberId: string): Promise<string> {
  const credentials = await resolveBusinessWhatsAppCredentials(businessId, { allowInternalFallback: false })
  if (!credentials.accessToken || credentials.phoneNumberId !== expectedProviderPhoneNumberId) {
    throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
  }
  return credentials.accessToken
}

const nodeFetch: MetaMediaHttp = async (url, init) => {
  const response = await fetch(url, init)
  return {
    ok: response.ok,
    headers: response.headers,
    body: response.body as AsyncIterable<Uint8Array> | null,
    json: () => response.json()
  }
}
