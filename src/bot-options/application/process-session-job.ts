import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { createInitialBotOptionsState, parseBotOptionsState, type BotOptionsState } from '../domain/state.js'
import { renderCurrentView, transition, type TransitionContext } from '../domain/transition.js'
import type { BotOptionsActionPayload, BotOptionsEntityRef } from '../domain/actions.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { menuView, type BotOptionsViewModel } from '../domain/views.js'
import { generatePromptToken } from '../domain/prompt-tokens.js'
import { renderWhatsAppScreen } from '../infrastructure/whatsapp-renderer.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, retargetClaimedBotJobTx, type ClaimedBotJob } from '../infrastructure/postgres-worker.js'
import { acquireDispatchClaim, assertDispatchClaimTx, completeDispatchClaimTx, releaseDispatchClaim } from '../infrastructure/dispatch-claims.js'
import { upsertJob } from '../infrastructure/prisma-admission.js'
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.js'
import { prismaHandoffEffectExecutor } from '../infrastructure/prisma-handoff-effect-executor.js'
import type { BotOptionsActionType } from '../domain/actions.js'
import { botOptionsMetrics } from '../observability/metrics.js'

type RuntimeClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

export type TransitionContextProvider = (
  tx: Prisma.TransactionClient,
  input: {
    businessId: string
    sessionId: string
    state: BotOptionsState
    actionType: string
    entityRef: BotOptionsEntityRef | null
    dbNow: Date
  }
) => Promise<TransitionContext>

export type TransitionEffectExecutor = (
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; operationKey: string; effects: readonly BotOptionsEffect[] }
) => Promise<void>

export const unavailableEffectExecutor: TransitionEffectExecutor = async (_tx, input) => {
  if (input.effects.length > 0) {
    throw new Error(`effect executor unavailable: ${input.effects.map((effect) => effect.kind).join(',')}`)
  }
}

/**
 * Provider de contexto real que revalida entidades contra DB tenant-scoped.
 * Para acciones que involucran un SERVICE entityRef, busca el servicio vía
 * PrismaCatalogRepository.getService (isBookable + category active) y deriva
 * serviceActive / serviceBookable / requiresConsultation / labels desde la fila.
 *
 * serviceCompatibleWithCart se asume true para el primer servicio (F6.3
 * intersección multiprofesional se implementa después).
 */
const defaultContextProvider: TransitionContextProvider = async (tx, input) => {
  const base: TransitionContext = {
    dbNowIso: input.dbNow.toISOString(), customerNameOnFile: null,
    draftExists: false, draftHasProgress: false, categoryActive: false, categoryHasServices: false,
    serviceActive: false, serviceBookable: false, requiresConsultation: false,
    serviceCompatibleWithCart: input.state.cart.length === 0, serviceInCart: false,
    hasRecommendations: false, recommendedServiceAvailable: false, recommendedCompatibleWithCart: false,
    professionalCommonExists: false, professionalSelectable: false, dateAvailable: false, slotAvailable: false,
    bandHasAvailability: false, catalogCanNext: false, catalogCanPrevious: false, dateCanNext: false,
    dateCanPrevious: false, slotCanNext: false, appointmentsExist: false, appointmentsCanNext: false,
    appointmentOwnedAndFuture: false, cancellationAllowed: false, rescheduleAllowed: false,
    rescheduleDateAvailable: false, rescheduleSlotAvailable: false, approvedDepositTransferable: false,
    slotStillAvailableAtConfirm: false, depositRequired: false, paymentConfigComplete: false,
    labels: {}, confirmVisitSnapshot: null, depositRequest: null
  }
  if (input.entityRef?.type === 'SERVICE') {
    const repo = new PrismaCatalogRepository(tx)
    const service = await repo.getService({ businessId: input.businessId, serviceId: input.entityRef.id })
    if (service) {
      base.serviceActive = true
      base.serviceBookable = service.isBookable
      base.requiresConsultation = service.requiresConsultation
      base.serviceInCart = input.state.cart.some((item) => item.serviceId === service.id)
      base.labels.serviceName = service.name
    }
  }
  return base
}

function parseSelectedEntityRef(value: Prisma.JsonValue | null): BotOptionsEntityRef | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid selected action entityRef')
  const type = value['type']
  const id = value['id']
  if (
    (type !== 'CATEGORY' && type !== 'SERVICE' && type !== 'PROFESSIONAL' && type !== 'APPOINTMENT') ||
    typeof id !== 'string' || id.length === 0 || id.trim() !== id
  ) {
    throw new Error('invalid selected action entityRef')
  }
  return { type, id }
}

function parseSelectedPayload(value: Prisma.JsonValue | null): BotOptionsActionPayload | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid selected action payload')
  return value as BotOptionsActionPayload
}

export async function processSessionJob(input: {
  client: RuntimeClient
  job: ClaimedBotJob
  contextProvider?: TransitionContextProvider
  effectExecutor?: TransitionEffectExecutor
}): Promise<'PROCESSED' | 'STALE_CUTOVER' | 'STALE_REVISION'> {
  const startedAt = performance.now()
  try {
    const result = await processSessionJobInternal(input)
    botOptionsMetrics.observe('transition_execution', performance.now() - startedAt)
    return result
  } catch (error) {
    botOptionsMetrics.observe('transition_execution', performance.now() - startedAt, 'error')
    throw error
  }
}

async function processSessionJobInternal(input: {
  client: RuntimeClient
  job: ClaimedBotJob
  contextProvider?: TransitionContextProvider
  effectExecutor?: TransitionEffectExecutor
}): Promise<'PROCESSED' | 'STALE_CUTOVER' | 'STALE_REVISION'> {
  if (input.job.kind === 'PROCESS_INBOX') return processInitialInbox(input)
  if (input.job.kind === 'RECOVER_CUTOVER') return processCutoverRecovery(input)
  if (input.job.kind !== 'PROCESS_SESSION') throw new Error(`unsupported session job ${input.job.kind}`)

  const target = await input.client.$queryRaw<Array<{
    sessionId: string; businessId: string; generation: number; fenceEpoch: number
  }>>(Prisma.sql`
    SELECT s."id" AS "sessionId", s."businessId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch"
    FROM "BotSession" s JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId"
    WHERE s."id" = COALESCE(
      (SELECT "sessionId" FROM "BotActionInbox" WHERE "id" = ${input.job.aggregateId}),
      (SELECT "sessionId" FROM "BotPrompt" WHERE "id" = ${input.job.aggregateId})
    )
  `)
  if (target.length !== 1) throw new Error('session job target not found')
  const dispatchToken = await acquireDispatchClaim({
    client: input.client,
    businessId: target[0]!.businessId,
    sessionId: target[0]!.sessionId,
    resourceId: input.job.id,
    generation: target[0]!.generation,
    fenceEpoch: target[0]!.fenceEpoch,
    kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('process dispatch gate closed')
  try {
    return await input.client.$transaction(async (tx) => {
      await assertClaimedBotJobTx(tx, input.job)
      await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
      const sessions = await tx.$queryRaw<Array<{
        id: string; businessId: string; deploymentId: string; deploymentGeneration: number
        revision: bigint; state: Prisma.JsonValue; status: string; dbNow: Date; toPhone: string | null
      }>>(Prisma.sql`
        SELECT s."id", s."businessId", s."deploymentId", s."deploymentGeneration", s."revision", s."state",
          s."status"::text AS "status", clock_timestamp() AS "dbNow", c."phone" AS "toPhone"
        FROM "BotSession" s
        JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId"
        LEFT JOIN "Conversation" c ON c."id" = s."conversationId"
        WHERE s."id" = ${target[0]!.sessionId} AND d."businessId" = s."businessId"
          AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
          AND d."claimsPausedAt" IS NULL AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
        FOR UPDATE OF s
      `)
      if (sessions.length !== 1 || sessions[0]!.deploymentGeneration !== input.job.deploymentGeneration) {
        await completeDispatchClaimTx(tx, dispatchToken)
        await completeClaimedBotJobTx(tx, input.job)
        return 'STALE_CUTOVER'
      }
      const session = sessions[0]!
      if (input.job.expectedRevision !== null && session.revision !== input.job.expectedRevision) {
        await completeDispatchClaimTx(tx, dispatchToken)
        await completeClaimedBotJobTx(tx, input.job)
        return 'STALE_REVISION'
      }
      const parsedState = parseBotOptionsState(session.state)
      if (!parsedState.ok) throw new Error(`unknown/corrupt state: ${parsedState.invariant}`)

      const selected = await tx.$queryRaw<Array<{
        id: string; actionType: string; entityRef: Prisma.JsonValue | null; payload: Prisma.JsonValue | null
        promptId: string | null; providerEventId: string; status: string
      }>>(Prisma.sql`
        SELECT "id", "actionType", "entityRef", "payload", "promptId", "providerEventId", "status"::text AS "status"
        FROM "BotActionInbox" WHERE "id" = ${input.job.aggregateId} FOR UPDATE
      `)
      let actionType: string
      let view: BotOptionsViewModel
      let nextState = parsedState.state
      let outcome = 'CONFLICT'
      let effects: readonly BotOptionsEffect[] = []
      let promptId: string | null = null
      let providerEventId: string | null = null
      if (selected.length === 1) {
        const action = selected[0]!
        if (action.status !== 'SELECTED' || !action.actionType) throw new Error('session action is not selected')
        // La admisión/reconciliación es la frontera canónica del actionType. No se
        // amplía ese contrato en F5.5; sí se valida la forma de datos JSON antes
        // de entregarlos al provider y a la transición.
        const selectedActionType = action.actionType as BotOptionsActionType
        const selectedEntityRef = parseSelectedEntityRef(action.entityRef)
        const selectedPayload = parseSelectedPayload(action.payload)
        actionType = selectedActionType
        promptId = action.promptId
        providerEventId = action.providerEventId
        const context = await (input.contextProvider ?? defaultContextProvider)(tx, {
          businessId: session.businessId, sessionId: session.id, state: parsedState.state, actionType: selectedActionType,
          entityRef: selectedEntityRef,
          dbNow: session.dbNow
        })
        const result = transition(parsedState.state, {
          actionType: selectedActionType,
          entityRef: selectedEntityRef,
          payload: selectedPayload
        }, context)
        nextState = result.state
        view = result.view
        outcome = result.outcome
        effects = 'effects' in result ? result.effects : []
      } else {
        actionType = 'prompt.conflict'
        promptId = input.job.aggregateId
        const choices = await tx.$queryRaw<Array<{ actionType: string; labelSnapshot: string; entityType: string | null; entityId: string | null; payload: Prisma.JsonValue | null }>>(Prisma.sql`
          SELECT DISTINCT ON (c."choiceToken") c."actionType", c."labelSnapshot", c."entityType", c."entityId",
            COALESCE(c."payload", '{}'::jsonb) || jsonb_build_object('conflictChoiceToken', c."choiceToken") AS "payload"
          FROM "BotActionInbox" i JOIN "BotPromptChoice" c ON c."promptId" = i."promptId" AND c."choiceToken" = i."choiceToken"
          WHERE i."promptId" = ${input.job.aggregateId} AND i."status" = 'CONFLICT'::"BotInboxStatus"
          ORDER BY c."choiceToken", c."sortOrder"
        `)
        view = menuView('Recibimos opciones distintas. Elegí cuál querés confirmar.', choices.map((choice) => ({
          actionType: choice.actionType as never,
          label: choice.labelSnapshot,
          ...(choice.entityType && choice.entityId ? { entityRef: { type: choice.entityType as never, id: choice.entityId } } : {}),
          payload: choice.payload as never
        })))
      }

      const operationKey = `transition:${session.id}:${session.revision + 1n}`
      await (input.effectExecutor ?? prismaHandoffEffectExecutor)(tx, {
        businessId: session.businessId, sessionId: session.id, operationKey, effects
      })
      const nextRevision = session.revision + 1n
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotSession" SET "state" = ${JSON.stringify(nextState)}::jsonb, "revision" = ${nextRevision}, "updatedAt" = clock_timestamp()
        WHERE "id" = ${session.id} AND "revision" = ${session.revision}
      `)
      const handoffEffect = effects.find((effect) => effect.kind === 'REQUEST_HUMAN_HANDOFF')
      const transitionDetail = handoffEffect ? JSON.stringify({ handoff: handoffEffect }) : null
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration",
          "revisionFrom", "revisionTo", "actionType", "outcome", "promptId", "providerEventId", "detail")
        VALUES (${randomUUID()}, ${session.businessId}, ${session.id}, ${session.deploymentId}, ${session.deploymentGeneration},
          ${session.revision}, ${nextRevision}, ${actionType}, ${outcome}, ${promptId}, ${providerEventId}, ${transitionDetail}::jsonb)
      `)
      await persistView(tx, {
        businessId: session.businessId, sessionId: session.id, revision: nextRevision,
        transitionId: operationKey, toPhone: session.toPhone, view, dbNow: session.dbNow
      })
      if (selected[0]) {
        await tx.$executeRaw`UPDATE "BotActionInbox" SET "status" = 'PROCESSED'::"BotInboxStatus", "operationKey" = ${operationKey} WHERE "id" = ${selected[0].id} AND "status" = 'SELECTED'::"BotInboxStatus"`
      }
      await completeDispatchClaimTx(tx, dispatchToken)
      await completeClaimedBotJobTx(tx, input.job)
      return 'PROCESSED'
    })
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function processInitialInbox(input: { client: RuntimeClient; job: ClaimedBotJob }): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  const target = await input.client.$queryRaw<Array<{ businessId: string; generation: number; fenceEpoch: number }>>(Prisma.sql`
    SELECT e."businessId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch"
    FROM "BotActionInbox" i
    JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
    JOIN "BotChannelDeployment" d ON d."id" = i."deploymentId" AND d."businessId" = e."businessId"
    WHERE i."id" = ${input.job.aggregateId}
  `)
  if (target.length !== 1) throw new Error('initial inbox target not found')
  if (target[0]!.generation !== input.job.deploymentGeneration) {
    await scheduleCurrentRecovery(input.client, input.job)
    return 'STALE_CUTOVER'
  }
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: target[0]!.businessId, sessionId: null, resourceId: input.job.id,
    generation: target[0]!.generation, fenceEpoch: target[0]!.fenceEpoch, kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('initial dispatch gate closed')
  try {
    const result = await processInitialInboxUnderClaim(input, false, dispatchToken)
    if (result === 'STALE_CUTOVER') await scheduleCurrentRecovery(input.client, input.job)
    return result
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function processInitialInboxUnderClaim(
  input: { client: RuntimeClient; job: ClaimedBotJob },
  forceFreshView = false,
  dispatchToken: string
): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  return input.client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, input.job)
    await assertDispatchClaimTx({ tx, businessId: input.job.businessId, claimToken: dispatchToken })
    const rows = await tx.$queryRaw<Array<{ id: string; businessId: string; deploymentId: string; deploymentGeneration: number; payload: Prisma.JsonValue; status: string; dbNow: Date }>>(Prisma.sql`
      SELECT i."id", e."businessId", i."deploymentId", i."deploymentGeneration", i."payload", i."status"::text AS "status", clock_timestamp() AS "dbNow"
      FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
      JOIN "BotChannelDeployment" d ON d."id" = i."deploymentId" AND d."businessId" = e."businessId"
      WHERE i."id" = ${input.job.aggregateId} AND d."generation" = i."deploymentGeneration"
        AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
       FOR UPDATE OF i FOR SHARE OF d
    `)
    if (rows.length !== 1 || rows[0]!.deploymentGeneration !== input.job.deploymentGeneration) {
      await completeDispatchClaimTx(tx, dispatchToken)
      return 'STALE_CUTOVER'
    }
    const row = rows[0]!
    if (row.status !== 'ADMITTED') {
      await completeDispatchClaimTx(tx, dispatchToken)
      await completeClaimedBotJobTx(tx, input.job)
      return 'PROCESSED'
    }
    const payload = row.payload as { fromPhone?: unknown }
    if (typeof payload.fromPhone !== 'string' || !payload.fromPhone) throw new Error('initial inbound has no phone')
    const conversationId = randomUUID()
    const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
      VALUES (${conversationId}, ${payload.fromPhone}, ${row.businessId}, clock_timestamp())
      ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt"
      RETURNING "id"
    `)
    const sessionId = randomUUID()
    const state = createInitialBotOptionsState()
    const insertedSessions = await tx.$queryRaw<Array<{ id: string; revision: bigint; deploymentGeneration: number }>>(Prisma.sql`
      INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
        "businessTimezone", "state", "revision", "updatedAt")
      VALUES (${sessionId}, ${row.businessId}, ${conversations[0]!.id}, ${row.deploymentId}, ${row.deploymentGeneration},
        'America/Argentina/Buenos_Aires', ${JSON.stringify(state)}::jsonb, 1, clock_timestamp())
      ON CONFLICT ("deploymentId", "conversationId")
        WHERE "status" = 'ACTIVE'::"BotSessionStatus" AND "conversationId" IS NOT NULL
      DO NOTHING
      RETURNING "id", "revision", "deploymentGeneration"
    `)
    const inserted = insertedSessions.length === 1
    const existingSessions = inserted ? [] : await tx.$queryRaw<Array<{ id: string; revision: bigint; deploymentGeneration: number }>>(Prisma.sql`
      SELECT "id", "revision", "deploymentGeneration" FROM "BotSession"
      WHERE "deploymentId" = ${row.deploymentId} AND "conversationId" = ${conversations[0]!.id}
        AND "status" = 'ACTIVE'::"BotSessionStatus" FOR UPDATE
    `)
    const session = insertedSessions[0] ?? existingSessions[0]
    if (!session) throw new Error('active session disappeared after conflict')
    await tx.$executeRaw(Prisma.sql`UPDATE "BotActionInbox" SET "sessionId" = ${session.id}, "expectedRevision" = ${session.revision}, "status" = 'PROCESSED'::"BotInboxStatus" WHERE "id" = ${row.id}`)
    const refreshForGeneration = session.deploymentGeneration !== row.deploymentGeneration
    if (inserted || forceFreshView || refreshForGeneration) {
      const revisionFrom = inserted ? 0n : session.revision
      const revisionTo = inserted ? 1n : session.revision + 1n
      if (!inserted) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "BotSession" SET "state" = ${JSON.stringify(state)}::jsonb, "revision" = ${revisionTo},
            "deploymentGeneration" = ${row.deploymentGeneration}, "updatedAt" = clock_timestamp()
          WHERE "id" = ${session.id} AND "revision" = ${revisionFrom}
        `)
      }
      const transitionId = `${forceFreshView ? 'cutover-recovery' : 'initial'}:${session.id}:${revisionTo}`
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotTransitionLog" ("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome")
        VALUES (${randomUUID()}, ${row.businessId}, ${session.id}, ${row.deploymentId}, ${row.deploymentGeneration}, ${revisionFrom}, ${revisionTo},
          ${forceFreshView ? 'system.cutover_recovery' : 'system.initial_view'}, 'APPLIED')
        ON CONFLICT ("sessionId", "revisionTo") DO NOTHING
      `)
      await persistView(tx, {
        businessId: row.businessId!, sessionId: session.id, revision: revisionTo, transitionId,
        toPhone: payload.fromPhone, view: renderCurrentView(state, await defaultContextProvider(tx, {
          businessId: row.businessId!, sessionId: session.id, state, actionType: 'system.initial_view',
          entityRef: null, dbNow: row.dbNow
        })), dbNow: row.dbNow
      })
    }
    await completeDispatchClaimTx(tx, dispatchToken)
    await completeClaimedBotJobTx(tx, input.job)
    return 'PROCESSED'
  })
}

async function processCutoverRecovery(input: { client: RuntimeClient; job: ClaimedBotJob }): Promise<'PROCESSED' | 'STALE_CUTOVER'> {
  const rows = await input.client.$queryRaw<Array<{
    businessId: string; deploymentId: string; generation: number; fenceEpoch: number; payload: Prisma.JsonValue; providerMessageId: string | null
  }>>(Prisma.sql`
    SELECT e."businessId", d."id" AS "deploymentId", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch",
      e."payload", e."providerMessageId"
    FROM "BotProviderEvent" e
    JOIN "BotChannelDeployment" d ON d."businessId" = e."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
    WHERE e."id" = ${input.job.aggregateId}
      AND d."engineKey" = 'deterministic-options' AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
  `)
  if (rows.length !== 1) throw new Error('current deployment unavailable for cutover recovery')
  const row = rows[0]!
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: row.businessId, sessionId: null, resourceId: input.job.id,
    generation: row.generation, fenceEpoch: row.fenceEpoch, kind: 'PROCESS'
  })
  if (!dispatchToken) throw new Error('cutover recovery dispatch gate closed')
  try {
    const recoveryInboxId = `cutover-recovery:${input.job.aggregateId}`
    const retargetedJob = await input.client.$transaction(async (tx) => {
      const retargeted = await retargetClaimedBotJobTx(tx, input.job, { deploymentId: row.deploymentId, generation: row.generation })
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "providerMessageId", "actionType", "deploymentId", "deploymentGeneration", "payload", "status")
        VALUES (${recoveryInboxId}, ${row.businessId}, ${input.job.aggregateId}, ${row.providerMessageId}, 'system.cutover_recovery', ${row.deploymentId},
          ${row.generation}, ${JSON.stringify(row.payload)}::jsonb, 'ADMITTED'::"BotInboxStatus")
        ON CONFLICT ("id") DO NOTHING
      `)
      return retargeted
    })
    const synthetic = { ...retargetedJob, kind: 'PROCESS_INBOX', aggregateId: recoveryInboxId }
    const result = await processInitialInboxUnderClaim({ client: input.client, job: synthetic }, true, dispatchToken)
    if (result === 'STALE_CUTOVER') throw new Error('deployment changed during cutover recovery')
    return result
  } finally {
    await releaseDispatchClaim(input.client, dispatchToken)
  }
}

async function scheduleCurrentRecovery(client: RuntimeClient, job: ClaimedBotJob): Promise<void> {
  await client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
    const rows = await tx.$queryRaw<Array<{
      providerEventId: string; businessId: string; deploymentId: string; generation: number; dbNow: Date
    }>>(Prisma.sql`
      SELECT i."providerEventId", e."businessId", d."id" AS "deploymentId", d."generation", clock_timestamp() AS "dbNow"
      FROM "BotActionInbox" i
      JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
      JOIN "BotChannelDeployment" d ON d."businessId" = e."businessId" AND d."channel" = 'WHATSAPP'::"BotChannel"
      WHERE i."id" = ${job.aggregateId} AND d."engineKey" = 'deterministic-options'
        AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL
      FOR UPDATE OF i FOR SHARE OF d
    `)
    if (rows.length !== 1) throw new Error('cannot schedule cutover recovery without current deployment')
    const row = rows[0]!
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotActionInbox" SET "status" = 'STALE_CUTOVER'::"BotInboxStatus", "error" = 'STALE_CUTOVER'
      WHERE "id" = ${job.aggregateId} AND "status" IN ('ADMITTED'::"BotInboxStatus", 'CLAIMED'::"BotInboxStatus")
    `)
    await upsertJob(tx, 'RECOVER_CUTOVER', row.providerEventId, row.businessId, row.deploymentId, row.generation, null, row.dbNow)
    await completeClaimedBotJobTx(tx, job)
  })
}

async function persistView(
  tx: Prisma.TransactionClient,
  input: { businessId: string; sessionId: string; revision: bigint; transitionId: string; toPhone: string | null; view: BotOptionsViewModel; dbNow: Date }
) {
  if (!input.toPhone) throw new Error('cannot render outbox without destination phone')
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotPrompt" SET "status" = 'INVALIDATED'::"BotPromptStatus", "resolvedAt" = clock_timestamp()
    WHERE "sessionId" = ${input.sessionId} AND "status" IN ('OPEN'::"BotPromptStatus", 'STABILIZING'::"BotPromptStatus")
  `)
  const promptToken = generatePromptToken()
  const rendered = renderWhatsAppScreen(input.view, { promptToken })
  const promptId = rendered.choiceMappings.length > 0 ? randomUUID() : null
  if (promptId) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "mode", "status", "openedAt")
      VALUES (${promptId}, ${input.sessionId}, ${promptToken}, ${input.revision}, 'FUNCTIONAL'::"BotPromptMode", 'OPEN'::"BotPromptStatus", ${input.dbNow})
    `)
    for (const choice of rendered.choiceMappings) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "entityType", "entityId", "payload", "labelSnapshot", "sortOrder")
        VALUES (${randomUUID()}, ${promptId}, ${choice.choiceToken}, ${choice.actionType}, ${choice.entityType}, ${choice.entityId},
          ${choice.payload === null ? null : JSON.stringify(choice.payload)}::jsonb, ${choice.labelSnapshot}, ${choice.sortOrder})
      `)
    }
  }
  const deliveryGroupId = randomUUID()
  let sequence = 0
  for (const item of rendered.items) {
    if (item.type === 'none') continue
    const id = randomUUID()
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
        "idempotencyKey", "status", "dependsOnSequence", "availableAt", "updatedAt")
      VALUES (${id}, ${input.businessId}, ${input.sessionId}, ${input.transitionId}, ${deliveryGroupId}, ${sequence}, ${item.type},
        ${JSON.stringify({ to: input.toPhone, item })}::jsonb, ${`${input.transitionId}:${sequence}`}, 'PENDING'::"BotOutboxStatus",
        ${sequence > 0 && rendered.interactiveDependsOnPrevious ? sequence - 1 : null}, ${input.dbNow}, clock_timestamp())
    `)
    if (item.type === 'interactive' && promptId) {
      await tx.$executeRaw`UPDATE "BotPrompt" SET "outboxMessageId" = ${id} WHERE "id" = ${promptId}`
    }
    sequence += 1
  }
}
