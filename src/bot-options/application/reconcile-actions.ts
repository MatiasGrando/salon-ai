import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { reconcilePrompt, type BotPromptContract, type PromptAdmittedAction } from '../domain/prompts.js'
import { upsertJob } from '../infrastructure/prisma-admission.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, rescheduleClaimedBotJobTx, type ClaimedBotJob } from '../infrastructure/postgres-worker.js'

type ReconcileClient = Pick<PrismaClient, '$transaction'>

export async function reconcileActions(client: ReconcileClient, job: ClaimedBotJob): Promise<'NOT_READY' | 'SELECT' | 'CONFLICT' | 'NO_ACTIONS' | 'STALE'> {
  return client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job)
    const promptId = job.aggregateId
    const rows = await tx.$queryRaw<Array<{
      promptId: string; sessionId: string; businessId: string; deploymentId: string
      deploymentGeneration: number; revision: bigint; stateRevision: bigint
      mode: 'FUNCTIONAL' | 'NAVIGATION' | 'CONFLICT'; status: 'OPEN' | 'STABILIZING' | 'RESOLVED' | 'INVALIDATED' | 'EXPIRED'
      firstActionAt: Date | null; lastActionAt: Date | null; settleAt: Date | null; absoluteAt: Date | null
      resolvedAt: Date | null; dbNow: Date
    }>>(Prisma.sql`
      SELECT p."id" AS "promptId", p."sessionId", s."businessId", s."deploymentId",
        s."deploymentGeneration", s."revision", p."stateRevision", p."mode", p."status",
        p."firstActionAt", p."lastActionAt", p."settleAt", p."absoluteAt", p."resolvedAt",
        clock_timestamp() AS "dbNow"
      FROM "BotPrompt" p JOIN "BotSession" s ON s."id" = p."sessionId"
      WHERE p."id" = ${promptId} FOR UPDATE OF p
    `)
    if (rows.length !== 1) {
      await completeClaimedBotJobTx(tx, job)
      return 'STALE'
    }
    const row = rows[0]!
    if (row.status !== 'STABILIZING') {
      await completeClaimedBotJobTx(tx, job)
      return 'STALE'
    }
    const choiceRows = await tx.$queryRaw<Array<{
      choiceToken: string; actionType: string; entityType: string | null; entityId: string | null
      payload: Prisma.JsonValue | null; labelSnapshot: string; sortOrder: number
    }>>(Prisma.sql`SELECT "choiceToken", "actionType", "entityType", "entityId", "payload", "labelSnapshot", "sortOrder" FROM "BotPromptChoice" WHERE "promptId" = ${promptId}`)
    const actionRows = await tx.$queryRaw<Array<{
      inboxId: string; providerEventId: string; providerMessageId: string | null; receivedAt: Date
      admittedAt: Date; choiceToken: string
    }>>(Prisma.sql`
      SELECT i."id" AS "inboxId", i."providerEventId", i."providerMessageId", i."receivedAt",
        e."admittedAt", i."choiceToken"
      FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId"
      WHERE i."promptId" = ${promptId} AND i."status" = 'ADMITTED'::"BotInboxStatus"
    `)
    const choices = choiceRows.map((choice) => ({
      choiceToken: choice.choiceToken,
      actionType: choice.actionType as never,
      entityRef: choice.entityType && choice.entityId ? { type: choice.entityType as never, id: choice.entityId } : null,
      payload: choice.payload as never,
      labelSnapshot: choice.labelSnapshot,
      sortOrder: choice.sortOrder
    }))
    const prompt: BotPromptContract = {
      businessId: row.businessId,
      deploymentId: row.deploymentId,
      deploymentGeneration: row.deploymentGeneration,
      sessionId: row.sessionId,
      stateRevision: row.stateRevision,
      promptId: row.promptId,
      mode: row.mode,
      status: row.status,
      firstActionAt: row.firstActionAt?.getTime() ?? null,
      lastActionAt: row.lastActionAt?.getTime() ?? null,
      settleAt: row.settleAt?.getTime() ?? null,
      absoluteAt: row.absoluteAt?.getTime() ?? null,
      resolvedAt: row.resolvedAt?.getTime() ?? null,
      choices
    }
    const actions: PromptAdmittedAction[] = actionRows.flatMap((action) => {
      const choice = choices.find((item) => item.choiceToken === action.choiceToken)
      return choice ? [{
        promptId, providerEventId: action.providerEventId, providerMessageId: action.providerMessageId,
        receivedAt: action.receivedAt.getTime(), admittedAt: action.admittedAt.getTime(), inboxId: action.inboxId, choice
      }] : []
    })
    const decision = reconcilePrompt({ dbNow: row.dbNow.getTime(), prompt, actions })
    if (decision.kind === 'NOT_READY') {
      await rescheduleClaimedBotJobTx(tx, job, new Date(decision.wakeAt))
      return 'NOT_READY'
    }
    if (decision.kind === 'REJECTED_CORRUPTION') throw new Error('corrupt prompt reconciliation state')
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotPrompt" SET "status" = ${decision.prompt.status}::"BotPromptStatus", "resolvedAt" = ${new Date(decision.prompt.resolvedAt)}
      WHERE "id" = ${promptId} AND "status" = 'STABILIZING'::"BotPromptStatus"
    `)
    for (const [inboxId, status] of Object.entries(decision.actionStatuses)) {
      await tx.$executeRaw(Prisma.sql`UPDATE "BotActionInbox" SET "status" = ${status}::"BotInboxStatus" WHERE "id" = ${inboxId} AND "status" = 'ADMITTED'::"BotInboxStatus"`)
    }
    if (decision.kind === 'SELECT') {
      await upsertJob(tx, 'PROCESS_SESSION', decision.selected.inboxId, row.businessId, row.deploymentId, row.deploymentGeneration, row.stateRevision, row.dbNow)
    } else if (decision.kind === 'CONFLICT') {
      await upsertJob(tx, 'PROCESS_SESSION', promptId, row.businessId, row.deploymentId, row.deploymentGeneration, row.stateRevision, row.dbNow)
    }
    await completeClaimedBotJobTx(tx, job)
    return decision.kind
  })
}
