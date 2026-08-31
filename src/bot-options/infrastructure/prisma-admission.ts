import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { randomUUID } from 'node:crypto'
import { admitPromptChoice, isRecoverableStalePromptClassification, type BotPromptContract, type PromptExecutionContext } from '../domain/prompts.js'
import { parseInteractiveActionId } from '../domain/prompt-tokens.js'
import { botOptionsMetrics } from '../observability/metrics.js'
import type { ParsedWebhookEvent } from './meta-webhook-adapter.js'

export type ShadowAdmissionTenant = {
  businessId: string
  appSecret: string | null
  appSecretPrevious: string | null
  appSecretPreviousValidUntil: Date | null
}

export type ShadowEventInsert = {
  provider: 'WHATSAPP'
  eventKey: string
  businessId: string
  phoneNumberId: string
  eventType: 'MESSAGE' | 'STATUS' | 'UNSUPPORTED'
  payloadRedacted: Record<string, string | boolean | null>
  observedAt: Date
  result: 'ADMITTED'
  traceId?: string
}

export interface ShadowAdmissionRepository {
  findConnectedTenantsByPhoneNumberId(phoneNumberId: string): Promise<ShadowAdmissionTenant[]>
  insertShadowEvents(events: ShadowEventInsert[]): Promise<number>
}

export type AuthoritativeRoute = {
  kind: 'new'
  businessId: string
  deploymentId: string
  generation: number
  appSecret: string | null
  appSecretPrevious: string | null
  appSecretPreviousValidUntil: Date | null
} | { kind: 'legacy' } | { kind: 'ambiguous' }

export type AuthoritativeAdmissionResult = {
  eventCount: number
  insertedCount: number
}

export type ProviderEventClassificationResult = {
  outboundMessage: { businessId: string; conversationId: string; messageId: string } | null
}

export interface AuthoritativeAdmissionRepository {
  resolveRoute(phoneNumberId: string): Promise<AuthoritativeRoute>
  admitAuthoritative(input: {
    route: Extract<AuthoritativeRoute, { kind: 'new' }>
    phoneNumberId: string
    events: readonly ParsedWebhookEvent[]
    traceId?: string
  }): Promise<AuthoritativeAdmissionResult>
}

type AdmissionPrismaClient = Pick<
  PrismaClient,
  'businessWhatsAppConfig' | 'botProviderEventShadow'
>

export class PrismaAdmissionRepository implements ShadowAdmissionRepository {
  readonly #client: AdmissionPrismaClient

  constructor(client: AdmissionPrismaClient) {
    this.#client = {
      businessWhatsAppConfig: client.businessWhatsAppConfig,
      botProviderEventShadow: client.botProviderEventShadow
    }
  }

  async findConnectedTenantsByPhoneNumberId(phoneNumberId: string) {
    return this.#client.businessWhatsAppConfig.findMany({
      where: {
        phoneNumberId,
        connectionStatus: 'CONNECTED'
      },
      select: {
        businessId: true,
        appSecret: true,
        appSecretPrevious: true,
        appSecretPreviousValidUntil: true
      },
      take: 2
    })
  }

  async insertShadowEvents(events: ShadowEventInsert[]) {
    if (events.length === 0) return 0

    const result = await this.#client.botProviderEventShadow.createMany({
      data: events.map((event) => ({
        provider: event.provider,
        eventKey: event.eventKey,
        businessId: event.businessId,
        phoneNumberId: event.phoneNumberId,
        eventType: event.eventType,
        payloadRedacted: event.payloadRedacted,
        observedAt: event.observedAt,
        result: event.result,
        ...(event.traceId ? { traceId: event.traceId } : {})
      })),
      skipDuplicates: true
    })

    return result.count
  }
}

type AuthoritativePrismaClient = Pick<PrismaClient, 'businessWhatsAppConfig' | '$queryRaw' | '$transaction'>

export const DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS = 10_000
export const AUTHORITATIVE_LOCK_TIMEOUT_MS = 1_000
export const AUTHORITATIVE_STATEMENT_TIMEOUT_MS = 3_000

function eventPayload(event: ParsedWebhookEvent): Prisma.InputJsonObject {
  if (event.kind === 'message') {
    return {
      kind: event.kind,
      fromPhone: event.fromPhone,
      messageType: event.messageType,
      textBody: event.textBody,
      interactiveReplyId: event.interactiveReplyId,
      mediaType: event.mediaType,
      mediaMimeType: event.mediaMimeType,
      mediaId: event.mediaId,
      filename: event.filename
    }
  }
  if (event.kind === 'status') {
    return { kind: event.kind, status: event.status, errorMessage: event.errorMessage }
  }
  return { kind: event.kind }
}

function millis(value: Date | null): number | null {
  return value?.getTime() ?? null
}

function diagnosticToken(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.-]{1,64}$/.test(trimmed) ? trimmed : fallback
}

function sanitizedAdmissionError(error: unknown): { errorName: string; errorCode: string | null } {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'UnknownError', errorCode: null }
  }
  const candidate = error as { name?: unknown; code?: unknown }
  return {
    errorName: diagnosticToken(candidate.name, 'Error'),
    errorCode: typeof candidate.code === 'string'
      ? diagnosticToken(candidate.code, 'REDACTED')
      : null
  }
}

export class PrismaAuthoritativeAdmissionRepository implements AuthoritativeAdmissionRepository {
  readonly #client: AuthoritativePrismaClient
  readonly #depositProofIngressEnabled: boolean
  readonly #authoritativeTransactionTimeoutMs: number

  constructor(client: AuthoritativePrismaClient, options: {
    depositProofIngressEnabled?: boolean
    authoritativeTransactionTimeoutMs?: number
  } = {}) {
    const authoritativeTransactionTimeoutMs = options.authoritativeTransactionTimeoutMs
      ?? DEFAULT_AUTHORITATIVE_TRANSACTION_TIMEOUT_MS
    if (
      !Number.isFinite(authoritativeTransactionTimeoutMs)
      || !Number.isInteger(authoritativeTransactionTimeoutMs)
      || authoritativeTransactionTimeoutMs <= 0
    ) {
      throw new Error('authoritativeTransactionTimeoutMs must be a finite positive integer')
    }
    this.#client = client
    this.#depositProofIngressEnabled = options.depositProofIngressEnabled ?? false
    this.#authoritativeTransactionTimeoutMs = authoritativeTransactionTimeoutMs
  }

  async resolveRoute(phoneNumberId: string): Promise<AuthoritativeRoute> {
    const tenants = await this.#client.businessWhatsAppConfig.findMany({
      where: { phoneNumberId, connectionStatus: 'CONNECTED' },
      select: {
        businessId: true,
        appSecret: true,
        appSecretPrevious: true,
        appSecretPreviousValidUntil: true,
      },
      take: 2
    })
    if (tenants.length === 0) return { kind: 'legacy' }
    if (tenants.length > 1) return { kind: 'ambiguous' }
    const tenant = tenants[0]!
    const pointers = await this.#client.$queryRaw<Array<{
      id: string; engineKey: string; activeConfigurationId: string | null; generation: number; legacyDispatchCoverageVersion: number
    }>>(Prisma.sql`
      SELECT "id", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion"
      FROM "BotChannelDeployment"
      WHERE "businessId" = ${tenant.businessId} AND "channel" = 'WHATSAPP'::"BotChannel"
      LIMIT 2
    `)
    if (pointers.length !== 1) return pointers.length > 1 ? { kind: 'ambiguous' } : { kind: 'legacy' }
    const pointer = pointers[0]!
    if (pointer.engineKey !== 'deterministic-options' || !pointer.activeConfigurationId) return { kind: 'legacy' }
    if (pointer.legacyDispatchCoverageVersion < 1) return { kind: 'ambiguous' }
    return {
      kind: 'new',
      businessId: tenant.businessId,
      deploymentId: pointer.id,
      generation: pointer.generation,
      appSecret: tenant.appSecret,
      appSecretPrevious: tenant.appSecretPrevious,
      appSecretPreviousValidUntil: tenant.appSecretPreviousValidUntil
    }
  }

  async admitAuthoritative(input: {
    route: Extract<AuthoritativeRoute, { kind: 'new' }>
    phoneNumberId: string
    events: readonly ParsedWebhookEvent[]
    traceId?: string
  }): Promise<AuthoritativeAdmissionResult> {
    const startedAt = performance.now()
    try {
      const result = await this.#client.$transaction(async (tx) => {
      // Cross-region production traffic needs a wider interactive transaction
      // envelope than the local load fixture. Individual statements and lock
      // acquisition remain tightly bounded, so this does not permit a query to
      // consume the full HTTP ACK budget by itself.
      await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${input.route.businessId}:WHATSAPP`}, 0))`

      const current = await tx.$queryRaw<Array<{ id: string; generation: number }>>(Prisma.sql`
        SELECT "id", "generation"
        FROM "BotChannelDeployment"
        WHERE "id" = ${input.route.deploymentId}
          AND "businessId" = ${input.route.businessId}
          AND "channel" = 'WHATSAPP'::"BotChannel"
          AND "engineKey" = 'deterministic-options'
          AND "activeConfigurationId" IS NOT NULL
          AND "claimsPausedAt" IS NULL
        FOR SHARE
      `)
      if (current.length !== 1 || current[0]!.generation !== input.route.generation) {
        throw new Error('authoritative pointer changed during admission')
      }

      let insertedCount = 0
      for (const event of input.events) {
        const providerEventId = randomUUID()
        const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO "BotProviderEvent" (
            "id", "provider", "eventKey", "eventType", "businessId", "phoneNumberId",
            "providerMessageId", "payload", "providerOccurredAt", "status", "traceId"
          ) VALUES (
            ${providerEventId}, 'WHATSAPP', ${event.eventKey},
            ${event.kind === 'message' ? 'MESSAGE' : event.kind === 'status' ? 'STATUS' : 'UNSUPPORTED'}::"BotProviderEventType",
            ${input.route.businessId}, ${input.phoneNumberId},
            ${event.kind === 'unsupported_change' ? null : event.providerMessageId},
            ${JSON.stringify(eventPayload(event))}::jsonb,
            ${event.kind === 'unsupported_change' || event.providerOccurredAtIso === null ? null : new Date(event.providerOccurredAtIso)},
            'ADMITTED'::"BotProviderEventStatus", ${input.traceId ?? null}
          ) ON CONFLICT ("provider", "eventKey") DO NOTHING
          RETURNING "id"
        `)
        if (inserted.length === 0) continue
        insertedCount += 1
        await upsertJob(
          tx,
          'PROCESS_PROVIDER_EVENT',
          providerEventId,
          input.route.businessId,
          input.route.deploymentId,
          input.route.generation,
          null,
          new Date()
        )
      }

      return { eventCount: input.events.length, insertedCount }
      }, { timeout: this.#authoritativeTransactionTimeoutMs })
      botOptionsMetrics.observe('webhook_ack', performance.now() - startedAt)
      return result
    } catch (error) {
      botOptionsMetrics.observe('webhook_ack', performance.now() - startedAt, 'error')
      console.error('[bot-options-authoritative-admission-error]', {
        event: 'admission_failed',
        traceId: input.traceId ? diagnosticToken(input.traceId, 'REDACTED') : null,
        eventCount: input.events.length,
        hasInteractiveReply: input.events.some(
          (event) => event.kind === 'message' && event.interactiveReplyId !== null
        ),
        ...sanitizedAdmissionError(error)
      })
      throw error
    }
  }

  /**
   * Classifies one already-journaled provider event. This deliberately runs in
   * the worker transaction, never in the HTTP webhook transaction.
   */
  async classifyProviderEventTx(
    tx: Prisma.TransactionClient,
    input: {
      route: Extract<AuthoritativeRoute, { kind: 'new' }>
      event: ParsedWebhookEvent
      providerEventId: string
      contextWindowEvaluated?: boolean
    }
  ): Promise<ProviderEventClassificationResult> {
    const { event } = input
    if (event.kind === 'status') {
      const callback = await applyStatusCallbackTx(
        tx,
        input.route.businessId,
        event.providerMessageId,
        event.status,
        event.errorMessage
      )
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotProviderEvent" SET "status" = ${callback.matched ? 'PROCESSED' : 'UNMATCHED'}::"BotProviderEventStatus"
        WHERE "id" = ${input.providerEventId}
      `)
      return { outboundMessage: callback.outboundMessage }
    }

    if (event.kind === 'message' && await this.#persistHumanTakenInbound(tx, {
      route: input.route,
      event,
      providerEventId: input.providerEventId,
      inboxId: randomUUID()
    })) return { outboundMessage: null }

    const servicePhotoSession = event.kind === 'message' && (event.messageType === 'image' || event.messageType === 'document')
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT s."id" FROM "BotSession" s
          JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
          WHERE s."businessId" = ${input.route.businessId} AND c."phone" = ${event.fromPhone}
            AND s."status" IN ('ACTIVE'::"BotSessionStatus", 'HUMAN_QUEUED'::"BotSessionStatus")
            AND s."deploymentId" = ${input.route.deploymentId} AND s."deploymentGeneration" = ${input.route.generation}
            AND (s."state"->>'flow' = 'SERVICE_PHOTOS' OR
              (s."state"->>'flow' = 'HANDOFF_QUEUED' AND s."state"->'pendingEntityRef'->>'type' = 'SERVICE'))
          LIMIT 1
        `) : []
    if (
      this.#depositProofIngressEnabled && event.kind === 'message'
      && (event.messageType === 'image' || event.messageType === 'document')
      && servicePhotoSession.length === 0
    ) {
      await upsertJob(
        tx,
        'RECEIVE_DEPOSIT_PROOF',
        input.providerEventId,
        input.route.businessId,
        input.route.deploymentId,
        input.route.generation,
        null,
        new Date()
      )
      return { outboundMessage: null }
    }

    const inboxId = randomUUID()
    if (event.kind === 'message' && event.interactiveReplyId) {
      await this.#admitInteractive(tx, { ...input, event, inboxId })
      return { outboundMessage: null }
    }

    const actionType = event.kind === 'message' && event.messageType === 'unsupported'
      ? 'input.unsupported'
      : event.kind === 'unsupported_change' ? 'input.unsupported' : 'input.initial'
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotActionInbox" (
        "id", "businessId", "providerEventId", "providerMessageId", "actionType", "deploymentId",
        "deploymentGeneration", "payload", "status"
      ) VALUES (
        ${inboxId}, ${input.route.businessId}, ${input.providerEventId}, ${event.kind === 'message' ? event.providerMessageId : null},
        ${actionType}, ${input.route.deploymentId}, ${input.route.generation},
        ${JSON.stringify({ ...eventPayload(event), contextWindowEvaluated: input.contextWindowEvaluated === true })}::jsonb, 'ADMITTED'::"BotInboxStatus"
      )
    `)
    await upsertJob(
      tx,
      'PROCESS_INBOX',
      inboxId,
      input.route.businessId,
      input.route.deploymentId,
      input.route.generation,
      null,
      new Date()
    )
    return { outboundMessage: null }
  }

  /**
   * F10.3: ownership preserves inbound in the CRM Message ledger, but creates
   * no bot job. Joining the active TAKEN handoff excludes historical sessions.
   */
  async #persistHumanTakenInbound(
    tx: Prisma.TransactionClient,
    input: {
      route: Extract<AuthoritativeRoute, { kind: 'new' }>
      event: Extract<ParsedWebhookEvent, { kind: 'message' }>
      providerEventId: string
      inboxId: string
    }
  ): Promise<boolean> {
    const candidates = await tx.$queryRaw<Array<{ conversationId: string; sessionId: string; handoffId: string }>>(Prisma.sql`
      SELECT c."id" AS "conversationId", s."id" AS "sessionId", h."id" AS "handoffId"
      FROM "Conversation" c
      JOIN "BotSession" s ON s."conversationId" = c."id" AND s."businessId" = c."businessId"
      JOIN "BotHandoff" h ON h."businessId" = s."businessId" AND h."sessionId" = s."id"
      WHERE c."businessId" = ${input.route.businessId} AND c."phone" = ${input.event.fromPhone}
        AND s."status" = 'HUMAN_TAKEN'::"BotSessionStatus"
        AND h."status" = 'TAKEN'::"BotHandoffStatus"
    `)
    if (candidates.length === 0) return false
    if (candidates.length !== 1) throw new Error('ambiguous human-owned conversation')
    const candidate = candidates[0]!
    const sessions = await tx.$queryRaw<Array<{ sessionId: string }>>(Prisma.sql`
      SELECT "id" AS "sessionId" FROM "BotSession"
      WHERE "id"=${candidate.sessionId} AND "businessId"=${input.route.businessId}
        AND "status"='HUMAN_TAKEN'::"BotSessionStatus"
      FOR UPDATE
    `)
    if (sessions.length !== 1) return false
    const handoffs = await tx.$queryRaw<Array<{ handoffId: string }>>(Prisma.sql`
      SELECT "id" AS "handoffId" FROM "BotHandoff"
      WHERE "id"=${candidate.handoffId} AND "businessId"=${input.route.businessId} AND "sessionId"=${candidate.sessionId}
        AND "status"='TAKEN'::"BotHandoffStatus"
      FOR UPDATE
    `)
    if (handoffs.length !== 1) return false
    const conversations = await tx.$queryRaw<Array<{ conversationId: string }>>(Prisma.sql`
      SELECT "id" AS "conversationId" FROM "Conversation"
      WHERE "id"=${candidate.conversationId} AND "businessId"=${input.route.businessId} AND "phone"=${input.event.fromPhone}
      FOR UPDATE
    `)
    if (conversations.length !== 1) return false
    const target = { conversationId: conversations[0]!.conversationId, sessionId: sessions[0]!.sessionId }
    const body = input.event.textBody?.trim() || `[${input.event.messageType}]`
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "Message" ("id", "conversationId", "phone", "direction", "body", "providerMessageId", "status", "metadata")
      VALUES (${randomUUID()}, ${target.conversationId}, ${input.event.fromPhone}, 'INBOUND'::"MessageDirection", ${body},
        ${input.event.providerMessageId}, 'received',
        ${JSON.stringify({
          provider: 'whatsapp',
          source: 'bot-options-handoff',
          messageType: input.event.messageType,
          phoneNumberId: input.event.phoneNumberId,
          interactiveReplyId: input.event.interactiveReplyId,
          mediaType: input.event.mediaType,
          mediaMimeType: input.event.mediaMimeType,
          mediaId: input.event.mediaId,
          filename: input.event.filename
        })}::jsonb)
      ON CONFLICT ("providerMessageId") DO NOTHING
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation" SET "lastMessage" = ${body}, "archivedAt" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${target.conversationId} AND "businessId" = ${input.route.businessId}
    `)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotActionInbox" (
        "id", "businessId", "providerEventId", "sessionId", "providerMessageId", "actionType", "deploymentId",
        "deploymentGeneration", "payload", "status", "error"
      ) VALUES (
        ${input.inboxId}, ${input.route.businessId}, ${input.providerEventId}, ${target.sessionId}, ${input.event.providerMessageId},
        'handoff.taken_silent', ${input.route.deploymentId}, ${input.route.generation},
        ${JSON.stringify(eventPayload(input.event))}::jsonb, 'PROCESSED'::"BotInboxStatus", 'HUMAN_TAKEN_SILENCED'
      )
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotProviderEvent" SET "status" = 'PROCESSED'::"BotProviderEventStatus"
      WHERE "id" = ${input.providerEventId} AND "status" = 'ADMITTED'::"BotProviderEventStatus"
    `)
    return true
  }

  async #admitInteractive(
    tx: Prisma.TransactionClient,
    input: {
      route: Extract<AuthoritativeRoute, { kind: 'new' }>
      event: Extract<ParsedWebhookEvent, { kind: 'message' }>
      providerEventId: string
      inboxId: string
      contextWindowEvaluated?: boolean
    }
  ) {
    const parsed = parseInteractiveActionId(input.event.interactiveReplyId)
    if (!parsed.ok) {
      await insertRejectedInbox(tx, input, 'REJECTED', 'invalid interactive token')
      return
    }
    const rows = await tx.$queryRaw<Array<{
      promptId: string; sessionId: string; businessId: string; deploymentId: string
      deploymentGeneration: number; revision: bigint; stateRevision: bigint; mode: 'FUNCTIONAL' | 'NAVIGATION' | 'CONFLICT'
      status: 'OPEN' | 'STABILIZING' | 'RESOLVED' | 'INVALIDATED' | 'EXPIRED'
      firstActionAt: Date | null; lastActionAt: Date | null; settleAt: Date | null
      absoluteAt: Date | null; resolvedAt: Date | null
      choiceToken: string; actionType: string; entityType: string | null; entityId: string | null
      payload: Prisma.JsonValue | null; labelSnapshot: string; sortOrder: number; dbNow: Date
    }>>(Prisma.sql`
      SELECT p."id" AS "promptId", p."sessionId", s."businessId", s."deploymentId",
        s."deploymentGeneration", s."revision", p."stateRevision", p."mode", p."status",
        p."firstActionAt", p."lastActionAt", p."settleAt", p."absoluteAt", p."resolvedAt",
        c."choiceToken", c."actionType", c."entityType", c."entityId", c."payload",
        c."labelSnapshot", c."sortOrder", clock_timestamp() AS "dbNow"
      FROM "BotPrompt" p
      JOIN "BotSession" s ON s."id" = p."sessionId"
      JOIN "Conversation" owner ON owner."id" = s."conversationId" AND owner."businessId" = s."businessId"
      JOIN "BotPromptChoice" c ON c."promptId" = p."id" AND c."choiceToken" = ${parsed.choiceToken}
      WHERE p."promptToken" = ${parsed.promptToken} AND s."businessId" = ${input.route.businessId}
        AND owner."phone" = ${input.event.fromPhone}
      FOR UPDATE OF p
    `)
    if (rows.length !== 1) {
      await insertRejectedInbox(tx, input, 'REJECTED', 'unknown prompt or choice')
      return
    }
    const row = rows[0]!
    const current: PromptExecutionContext = {
      businessId: input.route.businessId,
      deploymentId: input.route.deploymentId,
      deploymentGeneration: input.route.generation,
      sessionId: row.sessionId,
      stateRevision: row.revision
    }
    const prompt: BotPromptContract = {
      businessId: row.businessId,
      deploymentId: row.deploymentId,
      deploymentGeneration: row.deploymentGeneration,
      sessionId: row.sessionId,
      stateRevision: row.stateRevision,
      promptId: row.promptId,
      mode: row.mode,
      status: row.status,
      firstActionAt: millis(row.firstActionAt),
      lastActionAt: millis(row.lastActionAt),
      settleAt: millis(row.settleAt),
      absoluteAt: millis(row.absoluteAt),
      resolvedAt: millis(row.resolvedAt),
      choices: [{
        choiceToken: row.choiceToken,
        actionType: row.actionType as never,
        entityRef: row.entityType && row.entityId ? { type: row.entityType as never, id: row.entityId } : null,
        payload: row.payload as never,
        labelSnapshot: row.labelSnapshot,
        sortOrder: row.sortOrder
      }]
    }
    const decision = admitPromptChoice({
      dbNow: row.dbNow.getTime(), current, prompt,
      attempt: {
        ...prompt,
        choiceToken: parsed.choiceToken,
        providerEventId: input.providerEventId,
        providerMessageId: input.event.providerMessageId,
        receivedAt: row.dbNow.getTime()
      },
      existingProviderEventIds: new Set(),
      inboxId: input.inboxId
    })
    const recoverCurrentView = decision.classification !== 'STALE_CUTOVER'
      && isRecoverableStalePromptClassification(decision.classification)
    const status = decision.classification === 'ADMITTED' || recoverCurrentView ? 'ADMITTED'
      : decision.classification === 'STALE_CUTOVER' ? 'STALE_CUTOVER'
      : decision.classification === 'STALE_REVISION' || decision.classification === 'STALE_CONTEXT' || decision.classification === 'EXPIRED' ? 'STALE'
      : 'REJECTED'
    const admittedActionType = recoverCurrentView ? 'system.stale_prompt' : row.actionType
    const admittedPayload = recoverCurrentView
      ? { ...eventPayload(input.event), contextWindowEvaluated: input.contextWindowEvaluated === true, stalePromptClassification: decision.classification }
      : row.payload
    const admittedDeploymentId = recoverCurrentView ? input.route.deploymentId : row.deploymentId
    const admittedGeneration = recoverCurrentView ? input.route.generation : row.deploymentGeneration
    const admittedRevision = recoverCurrentView ? row.revision : row.stateRevision
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotActionInbox" (
        "id", "businessId", "providerEventId", "sessionId", "promptId", "providerMessageId", "choiceToken",
        "actionType", "deploymentId", "deploymentGeneration", "entityRef", "payload",
        "expectedRevision", "receivedAt", "status", "error"
      ) VALUES (
        ${input.inboxId}, ${input.route.businessId}, ${input.providerEventId}, ${row.sessionId}, ${row.promptId}, ${input.event.providerMessageId},
        ${parsed.choiceToken}, ${admittedActionType}, ${admittedDeploymentId}, ${admittedGeneration},
        ${row.entityType && row.entityId ? JSON.stringify({ type: row.entityType, id: row.entityId }) : null}::jsonb,
        ${admittedPayload === null ? null : JSON.stringify(admittedPayload)}::jsonb, ${admittedRevision}, ${row.dbNow},
        ${status}::"BotInboxStatus", ${decision.classification}
      )
    `)
    if (recoverCurrentView) {
      await upsertJob(tx, 'PROCESS_INBOX', input.inboxId, input.route.businessId, input.route.deploymentId, input.route.generation, row.revision, row.dbNow)
    } else if (decision.classification === 'ADMITTED') {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotPrompt" SET "status" = 'STABILIZING'::"BotPromptStatus",
          "firstActionAt" = ${new Date(decision.prompt.firstActionAt!)},
          "lastActionAt" = ${new Date(decision.prompt.lastActionAt!)},
          "settleAt" = ${new Date(decision.prompt.settleAt!)},
          "absoluteAt" = ${new Date(decision.prompt.absoluteAt!)}
        WHERE "id" = ${row.promptId}
      `)
      await upsertJob(tx, 'RECONCILE_PROMPT', row.promptId, row.businessId, row.deploymentId, row.deploymentGeneration, row.stateRevision, new Date(decision.wakeAt))
    } else if (decision.classification === 'STALE_CUTOVER') {
      await upsertJob(tx, 'RECOVER_CUTOVER', input.providerEventId, input.route.businessId, input.route.deploymentId, input.route.generation, null, row.dbNow)
    }
  }
}

async function insertRejectedInbox(
  tx: Prisma.TransactionClient,
  input: { route: Extract<AuthoritativeRoute, { kind: 'new' }>; event: Extract<ParsedWebhookEvent, { kind: 'message' }>; providerEventId: string; inboxId: string },
  status: 'REJECTED',
  error: string
) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "providerMessageId", "deploymentId", "deploymentGeneration", "status", "error")
    VALUES (${input.inboxId}, ${input.route.businessId}, ${input.providerEventId}, ${input.event.providerMessageId}, ${input.route.deploymentId},
      ${input.route.generation}, ${status}::"BotInboxStatus", ${error})
  `)
}

export async function upsertJob(
  tx: Prisma.TransactionClient,
  kind: string,
  aggregateId: string,
  businessId: string,
  deploymentId: string,
  generation: number,
  expectedRevision: bigint | null,
  availableAt: Date
) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "availableAt", "status", "updatedAt")
    VALUES (${randomUUID()}, ${kind}, ${aggregateId}, ${businessId}, ${deploymentId}, ${generation}, ${expectedRevision}, ${availableAt}, 'READY'::"BotJobStatus", clock_timestamp())
    ON CONFLICT ("kind", "aggregateId") DO UPDATE SET
      "businessId" = EXCLUDED."businessId", "deploymentId" = EXCLUDED."deploymentId",
      "deploymentGeneration" = EXCLUDED."deploymentGeneration", "expectedRevision" = EXCLUDED."expectedRevision",
      "availableAt" = EXCLUDED."availableAt", "status" = 'READY'::"BotJobStatus",
      "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
    WHERE "BotJob"."status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
  `)
}

export async function applyStatusCallbackTx(
  tx: Prisma.TransactionClient,
  businessId: string,
  providerMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'unknown',
  error: string | null
): Promise<{
  matched: boolean
  outboundMessage: { businessId: string; conversationId: string; messageId: string } | null
}> {
  const rank = status === 'read' ? 3 : status === 'delivered' ? 2 : status === 'sent' ? 1 : 0
  let matched = 0
  if (rank > 0) {
    matched = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotOutbox" SET
        "status" = CASE
          WHEN ${rank} = 3 THEN 'READ'::"BotOutboxStatus"
          WHEN ${rank} = 2 AND "status" NOT IN ('READ'::"BotOutboxStatus") THEN 'DELIVERED'::"BotOutboxStatus"
          WHEN ${rank} = 1 AND "status" IN ('SENDING'::"BotOutboxStatus", 'UNKNOWN'::"BotOutboxStatus", 'ACCEPTED'::"BotOutboxStatus") THEN 'ACCEPTED'::"BotOutboxStatus"
          ELSE "status" END,
        "sentAt" = CASE WHEN ${rank} >= 1 THEN COALESCE("sentAt", clock_timestamp()) ELSE "sentAt" END,
        "deliveredAt" = CASE WHEN ${rank} >= 2 THEN COALESCE("deliveredAt", clock_timestamp()) ELSE "deliveredAt" END,
        "readAt" = CASE WHEN ${rank} >= 3 THEN COALESCE("readAt", clock_timestamp()) ELSE "readAt" END,
        "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${businessId} AND "providerMessageId" = ${providerMessageId}
        AND "status" NOT IN ('POISON'::"BotOutboxStatus", 'SKIPPED'::"BotOutboxStatus")
    `)
  } else if (status === 'failed') {
    matched = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotOutbox" SET "status" = 'FAILED'::"BotOutboxStatus",
        "errorCode" = ${error ?? 'provider_failed'}, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${businessId} AND "providerMessageId" = ${providerMessageId}
        AND "status" NOT IN ('DELIVERED'::"BotOutboxStatus", 'READ'::"BotOutboxStatus", 'POISON'::"BotOutboxStatus", 'SKIPPED'::"BotOutboxStatus")
    `)
  }
  if (matched > 0) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotDispatchClaim" c SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      FROM "BotOutbox" o
      WHERE o."businessId" = ${businessId} AND o."providerMessageId" = ${providerMessageId}
        AND c."kind" = 'SEND'::"BotDispatchKind" AND c."resourceId" = o."id"
      AND c."status" <> 'DONE'::"BotDispatchStatus"
    `)
  }
  let outboundMessage: { businessId: string; conversationId: string; messageId: string } | null = null
  if (matched > 0 && status !== 'unknown') {
    const messages = await tx.$queryRaw<Array<{ conversationId: string; messageId: string }>>(Prisma.sql`
      UPDATE "Message" m SET
        "status" = ${status},
        "providerErrorCode" = CASE WHEN ${status} = 'failed' THEN COALESCE(${error}, 'provider_failed') ELSE NULL END,
        "providerErrorMessage" = CASE WHEN ${status} = 'failed' THEN ${error} ELSE NULL END
      FROM "Conversation" c
      WHERE m."conversationId" = c."id" AND c."businessId" = ${businessId}
        AND m."providerMessageId" = ${providerMessageId} AND m."direction" = 'OUTBOUND'::"MessageDirection"
      RETURNING m."conversationId", m."id" AS "messageId"
    `)
    if (messages.length > 1) throw new Error('ambiguous outbound CRM message for provider callback')
    if (messages[0]) outboundMessage = { businessId, ...messages[0] }
  }
  return { matched: matched > 0, outboundMessage }
}
