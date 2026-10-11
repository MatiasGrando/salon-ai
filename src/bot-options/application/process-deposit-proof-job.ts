import { conversationProofBindingFromState, parseConversationProofBinding, sameConversationProofBinding, CONVERSATION_PROOF_ACTION } from '../../conversational-bot/attachment-intent.js'
import { lockCoordinatedDepositGroupForDeposit } from '../../services/coordinated-deposit-group.js'
import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { resolveBusinessWhatsAppCredentials } from '../../services/business-whatsapp-settings.js'
import {
  DepositProofValidationError,
  validateDepositProof
} from '../../services/deposit-proof-validation.js'
import { DEPOSIT_PROOF_TRANSACTION_OPTIONS, writeValidatedDepositProofInTransaction } from '../../services/deposit-proof-writer.js'
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

type DepositProofClient = Pick<PrismaClient, '$queryRaw'> & {
  $transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>
}

// Commit before each bounded phase: 15 s DB + 2 s acquire + 8 s download,
// with margin for credential/validation work. The next phase fences again.
const PROOF_JOB_LEASE_MS = 60_000
export type DepositProofPhaseDiagnostic = {
  phase: 'deployment' | 'event_load' | 'ownership' | 'target' | 'media' | 'validation' | 'write' | 'terminal' | 'fallback'
  durationMs: number
  outcome: 'ok' | 'error'
  reason: 'transaction_expired' | 'media_unavailable' | 'invalid_media' | 'claim_fenced' | 'processing_error' | null
}

async function observeProofPhase<T>(emit: ((value: DepositProofPhaseDiagnostic) => void) | undefined,
  phase: DepositProofPhaseDiagnostic['phase'], run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  let reason: DepositProofPhaseDiagnostic['reason'] = null, outcome: 'ok' | 'error' = 'ok'
  try { return await run() }
  catch (error) {
    outcome = 'error'
    reason = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028'
      || error instanceof Error && /Transaction already closed|expired transaction/i.test(error.message)
      ? 'transaction_expired'
      : error instanceof MetaDepositMediaError ? 'media_unavailable'
      : error instanceof DepositProofValidationError ? 'invalid_media'
      : error instanceof Error && /stale or fenced bot job claim|cannot renew proof job claim/.test(error.message) ? 'claim_fenced'
      : 'processing_error'
    throw error
  } finally {
    try { emit?.({ phase, durationMs: Math.round(Math.max(0, performance.now() - started)), outcome, reason }) }
    catch { /* diagnostic observers cannot alter receipt processing */ }
  }
}

/** Proof-only renewal; an expired claim is never resurrected, even with its old token. */
export async function renewProofJobLeaseTx(tx: Prisma.TransactionClient, job: ClaimedBotJob): Promise<void> {
  if (job.kind !== 'RECEIVE_DEPOSIT_PROOF') throw new Error('cannot renew non-proof job claim')
  await assertClaimedBotJobTx(tx, job)
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "leasedUntil" = clock_timestamp() + (${PROOF_JOB_LEASE_MS} * interval '1 millisecond'),
      "updatedAt" = clock_timestamp()
    WHERE "id" = ${job.id} AND "businessId" = ${job.businessId}
      AND "kind" = 'RECEIVE_DEPOSIT_PROOF' AND "status" = 'LEASED'::"BotJobStatus"
      AND "leaseToken" = ${job.claimToken} AND "deploymentId" = ${job.deploymentId}
      AND "deploymentGeneration" = ${job.deploymentGeneration} AND "leasedUntil" > clock_timestamp()
  `)
  if (count !== 1) throw new Error('cannot renew proof job claim')
}

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
  onDiagnostic?: (value: DepositProofPhaseDiagnostic) => void
  resolveAccessToken?: (businessId: string, expectedProviderPhoneNumberId: string) => Promise<string>
}): Promise<DepositProofJobOutcome> {
  if (input.job.kind !== 'RECEIVE_DEPOSIT_PROOF') throw new Error('unsupported deposit proof job')
  // This adapter is private to this handler. No global Prisma or worker budget
  // changes. Renewal commits before a slow transaction, so its rollback cannot
  // undo the live lease; that transaction still repeats its normal claim fences.
  let activeJob: ClaimedBotJob | null = null
  const client: DepositProofClient = {
    $queryRaw: input.client.$queryRaw.bind(input.client),
    async $transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
      if (activeJob) await input.client.$transaction(tx => renewProofJobLeaseTx(tx, activeJob!), DEPOSIT_PROOF_TRANSACTION_OPTIONS)
      return input.client.$transaction(run, DEPOSIT_PROOF_TRANSACTION_OPTIONS)
    }
  }
  const observe = <T>(phase: DepositProofPhaseDiagnostic['phase'], run: () => Promise<T>) => observeProofPhase(input.onDiagnostic, phase, run)
  // RECEIVE is admitted work, not perpetual recovery. A cutover may make its
  // generation stale before claim, so fence and retarget it before capability
  // handling, target lookup, credential resolution, or provider I/O.
  const job = await observe('deployment', () => retargetProofJobToCurrentDeployment(client, input.job))
  activeJob = job
  if (!input.capabilityEnabled) {
    await client.$transaction(async (tx) => {
      await assertClaimedBotJobTx(tx, job)
      await rescheduleClaimedBotJobTx(tx, job, new Date(Date.now() + 5 * 60_000), { refundClaimAttempt: true })
    })
    return 'CAPABILITY_OFF'
  }

  const event = await observe('event_load', () => loadProofEvent(client, job))
  if (!event) return observe('fallback', () => finishMissingEvent(client, job))
  if (await observe('ownership', () => silenceProofForHumanTaken(client, job, event))) return 'HUMAN_TAKEN_SILENCED'
  const target = await observe('target', () => client.$transaction(tx=>resolveProofTarget(tx, event, job.deploymentId)))
  if (target.kind !== 'FOUND') return observe('fallback', () => fallbackToInitialInbox(client, job, event))
  const expectedDepositId = target.depositId
  const payload = messagePayload(event.payload)
  const mediaId = stringField(payload?.mediaId)
  if (!payload || !['image', 'document'].includes(String(payload.messageType)) || !mediaId || isDeclaredUnsupported(payload.mediaMimeType)) {
    return observe('terminal', () => finishTerminal(client, job, event, expectedDepositId, 'INVALID_PROOF'))
  }

  let downloaded: Awaited<ReturnType<typeof downloadMetaDepositProof>>
  try {
    // Short preflight only: never hold a transaction or DB connection across
    // credential resolution, provider I/O or image validation.
    downloaded = await observe('media', async () => {
      await client.$transaction((tx) => assertClaimedBotJobTx(tx, job))
      if (!event.phoneNumberId) throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
      const accessToken = await (input.resolveAccessToken ?? defaultAccessToken)(event.businessId, event.phoneNumberId)
      return downloadMetaDepositProof({
        mediaId,
        accessToken,
        fetch: input.fetch ?? nodeFetch,
      })
    })
  } catch (error) {
    // A DB/claim/credential failure says nothing about the bytes. Preserve the
    // worker retry path rather than issuing a false invalid-proof notification.
    if (!(error instanceof MetaDepositMediaError)) throw error
    if (isRetryableTransport(error) && job.attempts < job.maxAttempts) throw new Error('deposit_media_transport_retryable')
    return observe('terminal', () => finishTerminal(client, job, event, expectedDepositId, isRetryableTransport(error) ? 'PROOF_UNAVAILABLE' : 'INVALID_PROOF'))
  }

  let evidence: Awaited<ReturnType<typeof validateDepositProof>>
  try {
    evidence = await observe('validation', () => validateDepositProof({
      data: downloaded.data,
      declaredMimeType: downloaded.mimeType,
      filename: stringField(payload.filename)
    }))
  } catch (error) {
    if (!(error instanceof DepositProofValidationError)) throw new Error('deposit_image_validation_failed')
    return observe('terminal', () => finishTerminal(client, job, event, expectedDepositId, 'INVALID_PROOF'))
  }

  return observe('write', () => client.$transaction(async (tx) => {
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
  }))
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

export async function resolveProofTarget(
  client: Prisma.TransactionClient,
  event: ProofEvent,
  deploymentId: string
): Promise<ProofTargetResolution> {
  const payload = messagePayload(event.payload)
  if (!payload) return { kind: 'NONE' }
  const fromPhone = stringField(payload.fromPhone)
  if (!fromPhone) return { kind: 'NONE' }
  // Resolve the event's canonical obligation before collecting financial rows.
  // A terminal group in the same chat must neither compete with that group nor
  // consume the bounded member query. Legacy events retain their original path.
  const bindings = await client.$queryRaw<Array<{ entityRef: unknown; sessionId: string; sessionState: unknown; revision: bigint; generation: number; configurationId: string; businessTimezone: string }>>(Prisma.sql`
    /* conversation-proof-binding */ SELECT inbox."entityRef",s.id AS "sessionId",s.state AS "sessionState",s.revision,s."businessTimezone",d.generation,d."activeConfigurationId" AS "configurationId"
    FROM "BotActionInbox" inbox
    JOIN "BotSession" s ON s.id=inbox."sessionId" AND s."businessId"=inbox."businessId"
    JOIN "Conversation" c ON c.id=s."conversationId" AND c."businessId"=s."businessId"
    JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=s."businessId"
    WHERE inbox."businessId"=${event.businessId} AND inbox."providerEventId"=${event.id}
      AND inbox."deploymentId"=${deploymentId} AND inbox."deploymentGeneration"=d.generation
      AND inbox."actionType"=${CONVERSATION_PROOF_ACTION} AND inbox.status='PROCESSED'::"BotInboxStatus"
      AND s.status='ACTIVE'::"BotSessionStatus" AND s."deploymentId"=${deploymentId} AND s."deploymentGeneration"=d.generation
      AND c.phone=${fromPhone} AND d.channel='WHATSAPP'::"BotChannel" AND d."engineKey"='deterministic-options'
      AND d."legacyDispatchCoverageVersion">=1 AND d."claimsPausedAt" IS NULL
      AND cfg.status::text='ACTIVE' AND cfg.definition->'conversation'='{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb
    LIMIT 2`)
  let validatedBinding: ReturnType<typeof parseConversationProofBinding> = null
  if (bindings.length > 0) {
    if (bindings.length !== 1) return { kind: 'NONE' }
    const row = bindings[0]!, bound = parseConversationProofBinding(row.entityRef)
    const current = conversationProofBindingFromState(row.sessionState, { businessId: event.businessId,
      sessionId: row.sessionId, deploymentId, generation: row.generation, configurationId: row.configurationId,
      revision: String(row.revision), timezone: row.businessTimezone })
    if (!bound || !current || !sameConversationProofBinding(current, bound)) return { kind: 'NONE' }
    validatedBinding = bound
  }
  const rows = await client.$queryRaw<Array<{ depositId: string; groupId:string|null; sessionId:string; sessionState:unknown; revision:bigint; generation:number; configurationId:string; conversational:boolean; eligible:boolean; sessionGeneration:number; businessTimezone:string }>>(Prisma.sql`
    SELECT deposit."id" AS "depositId",appointment."coordinationGroupId" AS "groupId",
      s."id" AS "sessionId",s."state" AS "sessionState",s."revision",s."businessTimezone",s."deploymentGeneration" AS "sessionGeneration",deployment."generation",deployment."activeConfigurationId" AS "configurationId",
      (cfg."status"::text='ACTIVE' AND cfg."definition"->'conversation'='{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb) AS "eligible",
      (cfg."definition"->'conversation' IS NOT NULL OR s."state"->'conversationDraft' IS NOT NULL) AS "conversational"
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
    JOIN "BusinessBotConfiguration" cfg ON cfg."id"=deployment."activeConfigurationId" AND cfg."businessId"=deployment."businessId"
    JOIN "BookingDeposit" deposit
      ON deposit."conversationId" = c."id" AND deposit."businessId" = c."businessId"
    JOIN "BookingVisit" visit
      ON visit."id" = deposit."visitId" AND visit."businessId" = deposit."businessId"
     AND visit."sessionId" = s."id"
    JOIN "Appointment" appointment
      ON appointment."id" = deposit."appointmentId" AND appointment."visitId" = visit."id"
    WHERE c."businessId" = ${event.businessId} AND c."phone" = ${fromPhone}
      AND s."deploymentId" = ${deploymentId}
      ${validatedBinding ? Prisma.sql`AND s.id=${validatedBinding.sessionId} AND appointment."coordinationGroupId"=${validatedBinding.coordinationGroupId}` : Prisma.empty}
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
    ORDER BY deposit.id
    LIMIT 9
  `)
  if (rows.length === 0) return { kind: 'NONE' }
  if (rows.some(row => row.conversational)) {
    const row = rows[0]!
    if (!row.eligible || row.sessionGeneration !== row.generation) return { kind: 'NONE' }
    if (!rows.every(candidate => candidate.conversational && candidate.sessionId === row.sessionId)) return { kind: 'AMBIGUOUS' }
    const current = conversationProofBindingFromState(row.sessionState, { businessId: event.businessId,
      sessionId: row.sessionId, deploymentId, generation: row.generation, configurationId: row.configurationId,
      revision: String(row.revision), timezone: row.businessTimezone })
    if (!current || !rows.every(candidate => candidate.groupId === current.coordinationGroupId)) return { kind: 'NONE' }
    if (!validatedBinding || !sameConversationProofBinding(current, validatedBinding) ||
        !rows.some(candidate => candidate.depositId === validatedBinding.depositId)) return { kind: 'NONE' }
  }
  const state=await lockCoordinatedDepositGroupForDeposit(client,{businessId:event.businessId,depositId:rows[0]!.depositId})
  if (validatedBinding) {
    // Financial helpers acquire business/professional agenda locks first. Only
    // then lock and re-read the session, so a stale sidecar cannot authorize a
    // proof after selection and lock acquisition. Keep this lock through write.
    const fresh = await client.$queryRaw<Array<{state:unknown; revision:bigint; businessTimezone:string}>>(Prisma.sql`
      /* conversation-proof-binding-lock */ SELECT s.state,s.revision,s."businessTimezone" FROM "BotSession" s
      JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
      JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=s."businessId"
      WHERE s.id=${validatedBinding.sessionId} AND s."businessId"=${event.businessId}
        AND s.status='ACTIVE'::"BotSessionStatus" AND s."deploymentId"=${deploymentId}
        AND s."deploymentGeneration"=${validatedBinding.generation} AND d.generation=${validatedBinding.generation}
        AND d."activeConfigurationId"=${validatedBinding.configurationId} AND d."claimsPausedAt" IS NULL
        AND cfg.status::text='ACTIVE' AND cfg.definition->'conversation'='{"engine":"conversational-booking-v1","schemaVersion":1}'::jsonb
      FOR SHARE OF s`)
    const locked = fresh.length === 1 ? fresh[0]! : null
    const current = locked && conversationProofBindingFromState(locked.state,{...validatedBinding,
      revision:String(locked.revision),timezone:locked.businessTimezone})
    if (!current || !sameConversationProofBinding(current,validatedBinding)) return {kind:'NONE'}
  }
  if(state) {
    if(rows.length>8 || rows.some(r=>r.groupId!==state.group.groupId)) return {kind:'AMBIGUOUS'}
    const ids=state.group.members.flatMap(m=>m.depositId?[m.depositId]:[]).sort()
    if(ids.length!==rows.length || ids.some((id,i)=>id!==rows[i]!.depositId)) return {kind:'AMBIGUOUS'}
    return {kind:'FOUND',depositId:state.group.anchorDepositId}
  }
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
    const currentJob = await retargetClaimedBotJobTx(tx, job, current)
    await renewProofJobLeaseTx(tx, currentJob)
    return currentJob
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
  await upsertJob(tx, 'PROCESS_INBOX', inboxId, event.businessId, job.deploymentId, job.deploymentGeneration, null, 'immediate')
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
  return mime !== undefined && mime !== null && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)
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
