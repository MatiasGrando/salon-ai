import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { normalizePhone } from '../../services/phone-normalization-service.js'
import { parseBotOptionsState, type BotOptionsState } from '../domain/state.js'
import { transition } from '../domain/transition.js'

type Client = Pick<PrismaClient, '$transaction' | '$queryRaw' | '$executeRaw'>
type Tx = Prisma.TransactionClient
export type HandoffResolution = 'HOME' | 'RESUME'
export type HandoffOperationResult = { handoffId: string; status: 'TAKEN' | 'RESOLVED'; resolution?: HandoffResolution }
type TakePhase = { kind: 'DRAIN'; sessionId: string; handoffId: string; epoch: number } | { kind: 'REPLAY'; handoffId: string } | { kind: 'FAILURE'; message: string }
type FinalTake = HandoffOperationResult | { failure: string }
type ResumeSnapshot = { v: 1; sessionRevision: string; stateDigest: string; conversationUpdatedAt: string; conversationStep: string; conversationAiEnabled: boolean; conversationStateDigest: string; aggregates: AggregateSnapshot[] }
type AggregateSnapshot = { visitId: string; visitVersion: number; visitStatus: string; holdExpiresAt: string | null; professionalId: string; appointmentId: string | null; appointmentVersion: number | null; appointmentStatus: string | null; appointmentStartAt: string | null; serviceId: string | null; depositId: string | null; depositStatus: string | null; depositExpiresAt: string | null; depositVisitId: string | null }

const hash = (value: object) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Closes a per-session fence in a short transaction, then drains outside it. */
export async function takeBotHandoff(input: {
  client: Client; businessId: string; conversationId: string; actorUserId: string; operationKey: string; drainMs?: number
}): Promise<HandoffOperationResult> {
  if (!input.actorUserId.trim() || !input.operationKey.trim()) throw new Error('handoff take requires authenticated actor and operation key')
  const requestHash = hash({ action: 'TAKE', actorUserId: input.actorUserId, conversationId: input.conversationId })
  const phase = await input.client.$transaction(async (tx): Promise<TakePhase> => {
    const replay = await lockOperationTarget(tx, input.operationKey, input.businessId, input.conversationId)
    if (replay) {
      const row = replay
      assertOperationReplay(row, 'HANDOFF_TAKE', input.businessId, row.sessionId, requestHash, row.handoffId)
      if (row.operationStatus === 'COMPLETED') return { kind: 'REPLAY', handoffId: row.handoffId }
      if (row.operationStatus === 'BLOCKED_UNKNOWN') {
        const drain = await handoffDrain(tx, input.businessId, row.sessionId)
        if (drain.unknown) {
          await audit(tx, input.businessId, row.sessionId, row.handoffId, 'TAKE_BLOCKED_UNKNOWN', input.actorUserId, input.operationKey, { epoch: row.epoch })
          return { kind: 'FAILURE', message: 'handoff take blocked by UNKNOWN dispatch' }
        }
        expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='STARTED',"updatedAt"=clock_timestamp() WHERE "operationKey"=${input.operationKey} AND "status"='BLOCKED_UNKNOWN'`), 'handoff UNKNOWN recovery')
      } else if (row.operationStatus !== 'STARTED') throw new Error('handoff take is durably aborted')
      return { kind: 'DRAIN', sessionId: row.sessionId, handoffId: row.handoffId, epoch: row.epoch }
    }
    const rows = await tx.$queryRaw<Array<OperationRow>>(Prisma.sql`
      SELECT s."id" AS "sessionId",s."handoffFenceEpoch" AS "epoch",h."id" AS "handoffId",h."status"::text AS "handoffStatus",
        EXISTS (SELECT 1 FROM "BotOperation" pending WHERE pending."businessId"=s."businessId" AND pending."sessionId"=s."id" AND pending."type"='HANDOFF_TAKE' AND pending."status" IN ('STARTED','BLOCKED_UNKNOWN')) AS "otherTakeStarted"
      FROM "BotSession" s JOIN "BotHandoff" h ON h."businessId"=s."businessId" AND h."sessionId"=s."id"
      WHERE s."businessId"=${input.businessId} AND s."conversationId"=${input.conversationId} AND h."status" IN ('QUEUED'::"BotHandoffStatus",'TAKEN'::"BotHandoffStatus")
      FOR UPDATE OF s,h`)
    const row = rows[0]
    if (!row) throw new Error('active deterministic handoff not found in authorized conversation')
    if (row.handoffStatus !== 'QUEUED' || row.otherTakeStarted) throw new Error('handoff is already being taken')
    if (row.epoch < 0) throw new Error('invalid handoff fence epoch')
    const epoch = row.epoch + 1
    expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp(), "handoffFenceEpoch"=${epoch}, "updatedAt"=clock_timestamp()
      WHERE "id"=${row.sessionId} AND "businessId"=${input.businessId} AND "handoffFenceEpoch"=${row.epoch} AND "handoffClaimsPausedAt" IS NULL`), 'handoff fence close')
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt")
      VALUES (${randomUUID()},${input.operationKey},'HANDOFF_TAKE',${input.businessId},${row.sessionId},'STARTED',${requestHash},${row.handoffId},clock_timestamp())`)
    await audit(tx, input.businessId, row.sessionId, row.handoffId, 'TAKE_STARTED', input.actorUserId, input.operationKey, { epoch })
    return { kind: 'DRAIN', sessionId: row.sessionId, handoffId: row.handoffId, epoch }
  })
  if (phase.kind === 'REPLAY') return { handoffId: phase.handoffId, status: 'TAKEN' }
  if (phase.kind === 'FAILURE') throw new Error(phase.message)

  const deadline = Date.now() + Math.max(0, input.drainMs ?? 2_000)
  let drain = await handoffDrain(input.client, input.businessId, phase.sessionId)
  while (!drain.unknown && drain.active > 0 && Date.now() < deadline) {
    await sleep(Math.min(50, deadline - Date.now()))
    drain = await handoffDrain(input.client, input.businessId, phase.sessionId)
  }
  const final = await input.client.$transaction(async (tx): Promise<FinalTake> => {
    const rows = await tx.$queryRaw<Array<LockedSession>>(Prisma.sql`
      SELECT s."state",s."revision",s."deploymentId",s."deploymentGeneration",s."handoffFenceEpoch" AS "epoch",s."handoffClaimsPausedAt" AS "paused",
        h."status"::text AS "handoffStatus" FROM "BotSession" s JOIN "BotHandoff" h ON h."businessId"=s."businessId" AND h."sessionId"=s."id"
      WHERE s."id"=${phase.sessionId} AND s."businessId"=${input.businessId} AND h."id"=${phase.handoffId} FOR UPDATE OF s,h
    `)
    const row = rows[0]
    if (!row || row.epoch !== phase.epoch || !row.paused) throw new Error('handoff take lost exact session fence')
    const nowDrain = await handoffDrain(tx, input.businessId, phase.sessionId)
    if (nowDrain.unknown) {
      expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='BLOCKED_UNKNOWN',"updatedAt"=clock_timestamp()
        WHERE "operationKey"=${input.operationKey} AND "status"='STARTED'`), 'handoff UNKNOWN operation')
      await audit(tx, input.businessId, phase.sessionId, phase.handoffId, 'TAKE_BLOCKED_UNKNOWN', input.actorUserId, input.operationKey, { epoch: phase.epoch })
      return { failure: 'handoff take blocked by UNKNOWN dispatch' }
    }
    if (nowDrain.active > 0) {
      expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "handoffClaimsPausedAt"=NULL,"updatedAt"=clock_timestamp()
        WHERE "id"=${phase.sessionId} AND "businessId"=${input.businessId} AND "handoffFenceEpoch"=${phase.epoch} AND "handoffClaimsPausedAt" IS NOT NULL`), 'exact handoff gate reopen')
      expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='ABORTED',"updatedAt"=clock_timestamp()
        WHERE "operationKey"=${input.operationKey} AND "status"='STARTED'`), 'handoff timeout operation')
      await audit(tx, input.businessId, phase.sessionId, phase.handoffId, 'TAKE_TIMEOUT_REOPENED', input.actorUserId, input.operationKey, { epoch: phase.epoch })
      return { failure: 'handoff take drain timed out; exact gate reopened' }
    }
    if (row.handoffStatus === 'TAKEN') return { handoffId: phase.handoffId, status: 'TAKEN' }
    const transitioned = await persistTransition(tx, row, input.businessId, phase.sessionId, phase.epoch, 'handoff.take', 'HUMAN_TAKEN')
    await lockAndTakeConversation(tx, input.businessId, input.conversationId)
    const aggregates = await lockBookingAggregates(tx, input.businessId, phase.sessionId)
    // Suppression can materialize a pre-TAKE provider inbound in Message. Its
    // database-side CRM projection may touch Conversation, so capture the
    // baseline only after that intentional ownership write while retaining the
    // Conversation lock acquired above.
    const suppressedJobs = await suppressPreTake(tx, input.businessId, phase.sessionId)
    const conversation = await lockConversation(tx, input.businessId, input.conversationId, 'taken conversation lost row ownership')
    const snapshot: ResumeSnapshot = { v: 1, sessionRevision: transitioned.revision.toString(), stateDigest: hashJson(transitioned.state), conversationUpdatedAt: conversation.updatedAt.toISOString(), conversationStep: conversation.currentStep, conversationAiEnabled: conversation.aiEnabled, conversationStateDigest: hashJson(conversation.snapshotState), aggregates: aggregates.map(snapshotAggregate) }
    // The trigger permits this one atomic QUEUED -> TAKEN baseline capture only.
    // Conversation and booking aggregates are already locked and represented in
    // snapshot, so no observable TAKEN handoff can lack its resume baseline.
    expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotHandoff" SET "status"='TAKEN'::"BotHandoffStatus","ownerUserId"=${input.actorUserId},"takenAt"=clock_timestamp(),"resumeSnapshot"=${JSON.stringify(snapshot)}::jsonb,"updatedAt"=clock_timestamp()
      WHERE "id"=${phase.handoffId} AND "businessId"=${input.businessId} AND "status"='QUEUED'::"BotHandoffStatus" AND "resumeSnapshot" IS NULL`), 'handoff ownership and resume snapshot')
    expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='COMPLETED',"updatedAt"=clock_timestamp() WHERE "operationKey"=${input.operationKey} AND "status"='STARTED'`), 'handoff completion')
    await audit(tx, input.businessId, phase.sessionId, phase.handoffId, 'TAKE_COMPLETED', input.actorUserId, input.operationKey, { epoch: phase.epoch, suppressedJobs })
    return { handoffId: phase.handoffId, status: 'TAKEN' }
  })
  if ('failure' in final) throw new Error(final.failure)
  return final
}

export async function resolveBotHandoff(input: { client: Client; businessId: string; conversationId: string; actorUserId: string; operationKey: string; resolution: HandoffResolution }): Promise<HandoffOperationResult> {
  if (!input.actorUserId.trim() || !input.operationKey.trim()) throw new Error('handoff resolve requires authenticated actor and operation key')
  const requestHash = hash({ action: 'RESOLVE', actorUserId: input.actorUserId, conversationId: input.conversationId, resolution: input.resolution })
  const result = await input.client.$transaction(async (tx): Promise<HandoffOperationResult | { failure: string }> => {
    const replay = await lockOperationTarget(tx, input.operationKey, input.businessId, input.conversationId)
    let row: (OperationRow & LockedSession) | undefined
    if (replay) {
      assertOperationReplay(replay, 'HANDOFF_RESOLVE', input.businessId, replay.sessionId, requestHash, replay.handoffId)
      if (replay.owner !== input.actorUserId) throw new Error('only handoff owner may resolve')
      if (replay.operationStatus === 'COMPLETED') return { handoffId: replay.handoffId, status: 'RESOLVED', resolution: replay.resumePolicy === 'RESUME' ? 'RESUME' : 'HOME' }
      if (replay.operationStatus !== 'BLOCKED_UNKNOWN') throw new Error('handoff resolve is durably aborted')
      const drain = await handoffDrain(tx, input.businessId, replay.sessionId)
      if (drain.unknown) {
        await audit(tx, input.businessId, replay.sessionId, replay.handoffId, 'RESOLVE_BLOCKED_UNKNOWN', input.actorUserId, input.operationKey, { epoch: replay.epoch })
        return { failure: 'handoff resolve blocked by UNKNOWN dispatch' }
      }
      expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='STARTED',"updatedAt"=clock_timestamp()
        WHERE "operationKey"=${input.operationKey} AND "status"='BLOCKED_UNKNOWN'`), 'handoff resolve UNKNOWN recovery')
      row = replay
    } else {
      const rows = await tx.$queryRaw<Array<OperationRow & LockedSession>>(Prisma.sql`
      SELECT s."id" AS "sessionId",s."state",s."revision",s."deploymentId",s."deploymentGeneration",s."handoffFenceEpoch" AS "epoch",s."handoffClaimsPausedAt" AS "paused",
        h."id" AS "handoffId",h."status"::text AS "handoffStatus",h."ownerUserId" AS "owner",h."resumePolicy",h."resumeSnapshot"
      FROM "BotSession" s JOIN "BotHandoff" h ON h."businessId"=s."businessId" AND h."sessionId"=s."id"
      WHERE s."businessId"=${input.businessId} AND s."conversationId"=${input.conversationId} AND h."status"='TAKEN'::"BotHandoffStatus" FOR UPDATE OF s,h
    `)
      row = rows[0]
    }
    if (!row) throw new Error('taken deterministic handoff not found')
    if (row.owner !== input.actorUserId) throw new Error('only handoff owner may resolve')
    if (row.handoffStatus !== 'TAKEN' || !row.paused) throw new Error('handoff resolve lost paused ownership fence')
    const drain = await handoffDrain(tx, input.businessId, row.sessionId)
    if (drain.unknown) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${input.operationKey},'HANDOFF_RESOLVE',${input.businessId},${row.sessionId},'BLOCKED_UNKNOWN',${requestHash},${row.handoffId},clock_timestamp())`)
      await audit(tx, input.businessId, row.sessionId, row.handoffId, 'RESOLVE_BLOCKED_UNKNOWN', input.actorUserId, input.operationKey, { epoch: row.epoch })
      return { failure: 'handoff resolve blocked by UNKNOWN dispatch' }
    }
    if (!replay) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${randomUUID()},${input.operationKey},'HANDOFF_RESOLVE',${input.businessId},${row.sessionId},'STARTED',${requestHash},${row.handoffId},clock_timestamp())`)
    }
    const conversation = await lockConversation(tx, input.businessId, input.conversationId)
    const applied: HandoffResolution = input.resolution === 'RESUME' && await isSafeResume(tx, row, conversation, input.businessId) ? 'RESUME' : 'HOME'
    expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotHandoff" SET "status"='RESOLVED'::"BotHandoffStatus","resolvedAt"=clock_timestamp(),"resumePolicy"=${applied},"updatedAt"=clock_timestamp() WHERE "id"=${row.handoffId} AND "businessId"=${input.businessId} AND "status"='TAKEN'::"BotHandoffStatus"`), 'handoff resolution')
    await persistTransition(tx, row, input.businessId, row.sessionId, row.epoch, applied === 'RESUME' ? 'handoff.resolve_resume' : 'handoff.resolve_home', 'ACTIVE')
    expectOne(await tx.$executeRaw(applied === 'RESUME'
      ? Prisma.sql`UPDATE "Conversation" SET "currentStep"='START',"aiEnabled"=true,"humanHandoffResolvedAt"=clock_timestamp(),"misunderstandingCount"=0,"updatedAt"=clock_timestamp() WHERE "id"=${input.conversationId} AND "businessId"=${input.businessId}`
      : Prisma.sql`UPDATE "Conversation" SET "currentStep"='START',"aiEnabled"=true,"humanHandoffResolvedAt"=clock_timestamp(),"lastAvailability"=NULL,"misunderstandingCount"=0,"updatedAt"=clock_timestamp() WHERE "id"=${input.conversationId} AND "businessId"=${input.businessId}`), 'resolved conversation')
    const suppressedJobs = await suppressPreTake(tx, input.businessId, row.sessionId)
    expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status"='COMPLETED',"updatedAt"=clock_timestamp() WHERE "operationKey"=${input.operationKey} AND "status"='STARTED'`), 'resolve completion')
    await audit(tx, input.businessId, row.sessionId, row.handoffId, 'RESOLVE_COMPLETED', input.actorUserId, input.operationKey, { requested: input.resolution, applied, epoch: row.epoch, suppressedJobs })
    return { handoffId: row.handoffId, status: 'RESOLVED', resolution: applied }
  })
  if ('failure' in result) throw new Error(result.failure)
  return result
}

type OperationRow = { sessionId: string; handoffId: string; handoffStatus: string; epoch: number; operationType: string | null; operationBusinessId: string | null; operationSessionId: string | null; operationHash: string | null; resultRef: string | null; operationStatus: string | null; otherTakeStarted?: boolean; owner?: string | null; resumePolicy?: string | null; resumeSnapshot?: Prisma.JsonValue | null }
type LockedSession = { state: Prisma.JsonValue; revision: bigint; deploymentId: string; deploymentGeneration: number; epoch: number; paused: Date | null; handoffStatus: string; resumeSnapshot?: Prisma.JsonValue | null }
function assertOperationReplay(row: OperationRow, type: string, businessId: string, sessionId: string, requestHash: string, handoffId: string) {
  if (row.operationType !== type || row.operationBusinessId !== businessId || row.operationSessionId !== sessionId || row.operationHash !== requestHash || row.resultRef !== handoffId) throw new Error('handoff idempotency conflict')
}
/** Operation keys bind to one tenant/session/handoff forever; never infer a historical target from status. */
async function lockOperationTarget(tx: Tx, operationKey: string, businessId: string, conversationId: string): Promise<(OperationRow & LockedSession) | null> {
  // Canonical hierarchy is session -> handoff -> operation.  This initial read
  // deliberately has no row lock: it only discovers the immutable target.
  const operations = await tx.$queryRaw<Array<{ operationBusinessId: string; operationSessionId: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "businessId" AS "operationBusinessId","sessionId" AS "operationSessionId","resultRef"
    FROM "BotOperation" WHERE "operationKey"=${operationKey}`)
  const operation = operations[0]
  if (!operation) return null
  if (operation.operationBusinessId !== businessId || !operation.resultRef) throw new Error('handoff idempotency conflict')
  const sessions = await tx.$queryRaw<Array<LockedSession & { sessionId: string }>>(Prisma.sql`
    SELECT "id" AS "sessionId","state","revision","deploymentId","deploymentGeneration","handoffFenceEpoch" AS "epoch","handoffClaimsPausedAt" AS "paused"
    FROM "BotSession" WHERE "id"=${operation.operationSessionId} AND "businessId"=${businessId} AND "conversationId"=${conversationId} FOR UPDATE`)
  const session = sessions[0]
  if (!session) throw new Error('handoff idempotency conflict')
  const handoffs = await tx.$queryRaw<Array<{ handoffId: string; handoffStatus: string; owner: string | null; resumePolicy: string | null }>>(Prisma.sql`
    SELECT "id" AS "handoffId","status"::text AS "handoffStatus","ownerUserId" AS "owner","resumePolicy","resumeSnapshot"
    FROM "BotHandoff" WHERE "id"=${operation.resultRef} AND "businessId"=${businessId} AND "sessionId"=${session.sessionId} FOR UPDATE`)
  const handoff = handoffs[0]
  if (!handoff) throw new Error('handoff idempotency conflict')
  const current = await tx.$queryRaw<Array<{ operationType: string; operationBusinessId: string; operationSessionId: string; operationHash: string; resultRef: string | null; operationStatus: string }>>(Prisma.sql`
    SELECT "type" AS "operationType","businessId" AS "operationBusinessId","sessionId" AS "operationSessionId","requestHash" AS "operationHash","resultRef","status" AS "operationStatus"
    FROM "BotOperation" WHERE "operationKey"=${operationKey} FOR UPDATE`)
  const locked = current[0]
  if (!locked || locked.operationBusinessId !== operation.operationBusinessId || locked.operationSessionId !== operation.operationSessionId || locked.resultRef !== operation.resultRef) throw new Error('handoff idempotency conflict')
  return { ...session, ...handoff, ...locked }
}
function expectOne(count: number, operation: string) { if (count !== 1) throw new Error(`${operation} lost row ownership`) }
type LockedConversation = { phone: string; currentStep: string; aiEnabled: boolean; bookingV2State: Prisma.JsonValue | null; updatedAt: Date; snapshotState: Prisma.JsonValue }
type AggregateRow = { visitId: string; visitVersion: number; visitStatus: string; holdExpiresAt: Date | null; professionalId: string; appointmentId: string | null; appointmentVersion: number | null; appointmentStatus: string | null; appointmentStartAt: Date | null; serviceId: string | null; depositId: string | null; depositStatus: string | null; depositExpiresAt: Date | null; depositVisitId: string | null; dbNow: Date }
const hashJson = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')

async function lockConversation(tx: Tx, businessId: string, conversationId: string, missingRowError = 'handoff conversation disappeared'): Promise<LockedConversation> {
  const rows = await tx.$queryRaw<Array<LockedConversation>>(Prisma.sql`SELECT "phone","currentStep"::text AS "currentStep","aiEnabled","bookingV2State","updatedAt",to_jsonb("Conversation") AS "snapshotState" FROM "Conversation" WHERE "id"=${conversationId} AND "businessId"=${businessId} FOR UPDATE`)
  if (rows.length !== 1) throw new Error(missingRowError)
  return rows[0]!
}
async function lockAndTakeConversation(tx: Tx, businessId: string, conversationId: string): Promise<LockedConversation> {
  // Preserve the canonical session/handoff -> conversation lock order before
  // mutating. UPDATE RETURNING is the exact ownership proof; the final resume
  // snapshot is read later, after intentional pre-TAKE suppression writes.
  await lockConversation(tx, businessId, conversationId, 'taken conversation lost row ownership')
  const rows = await tx.$queryRaw<Array<LockedConversation>>(Prisma.sql`
    UPDATE "Conversation"
    SET "currentStep"='HUMAN_HANDOFF',"aiEnabled"=false,"humanHandoffResolvedAt"=NULL,"misunderstandingCount"=0,"updatedAt"=clock_timestamp()
    WHERE "id"=${conversationId} AND "businessId"=${businessId}
    RETURNING "phone","currentStep"::text AS "currentStep","aiEnabled","bookingV2State","updatedAt",to_jsonb("Conversation") AS "snapshotState"
  `)
  if (rows.length !== 1) throw new Error('taken conversation lost row ownership')
  return rows[0]!
}
async function lockBookingAggregates(tx: Tx, businessId: string, sessionId: string): Promise<AggregateRow[]> {
  // Lock in aggregate dependency order. Locking v first also prevents a related
  // Appointment from being attached while its aggregate snapshot is assembled.
  type VisitRow = Pick<AggregateRow, 'visitId' | 'visitVersion' | 'visitStatus' | 'holdExpiresAt' | 'professionalId' | 'dbNow'>
  type AppointmentRow = { visitId: string; appointmentId: string; appointmentVersion: number; appointmentStatus: string; appointmentStartAt: Date; serviceId: string }
  type DepositRow = { appointmentId: string; depositId: string; depositStatus: string; depositExpiresAt: Date; depositVisitId: string | null }
  const visits = await tx.$queryRaw<Array<VisitRow>>(Prisma.sql`
    SELECT "id" AS "visitId","version" AS "visitVersion","status"::text AS "visitStatus","holdExpiresAt","professionalId",clock_timestamp() AS "dbNow"
    FROM "BookingVisit"
    WHERE "businessId"=${businessId} AND "sessionId"=${sessionId}
    ORDER BY "id" FOR UPDATE`)
  if (visits.length === 0) return []

  const visitIds = visits.map((visit) => visit.visitId)
  const appointments = await tx.$queryRaw<Array<AppointmentRow>>(Prisma.sql`
    SELECT a."visitId",a."id" AS "appointmentId",a."version" AS "appointmentVersion",a."status"::text AS "appointmentStatus",a."startAt" AS "appointmentStartAt",a."serviceId"
    FROM "Appointment" a
    JOIN "BookingVisit" v ON v."id"=a."visitId" AND v."businessId"=${businessId}
    WHERE a."visitId" IN (${Prisma.join(visitIds)})
    ORDER BY a."visitId",a."id" FOR UPDATE OF a`)

  const appointmentIds = appointments.map((appointment) => appointment.appointmentId)
  const deposits = appointmentIds.length === 0 ? [] : await tx.$queryRaw<Array<DepositRow>>(Prisma.sql`
    SELECT "appointmentId","id" AS "depositId","status"::text AS "depositStatus","expiresAt" AS "depositExpiresAt","visitId" AS "depositVisitId"
    FROM "BookingDeposit"
    WHERE "businessId"=${businessId} AND "appointmentId" IN (${Prisma.join(appointmentIds)})
    ORDER BY "appointmentId","id" FOR UPDATE`)

  const appointmentsByVisitId = new Map(appointments.map((appointment) => [appointment.visitId, appointment]))
  const depositsByAppointmentId = new Map(deposits.map((deposit) => [deposit.appointmentId, deposit]))
  return visits.map((visit) => {
    const appointment = appointmentsByVisitId.get(visit.visitId)
    const deposit = appointment ? depositsByAppointmentId.get(appointment.appointmentId) : undefined
    return {
      ...visit,
      appointmentId: appointment?.appointmentId ?? null,
      appointmentVersion: appointment?.appointmentVersion ?? null,
      appointmentStatus: appointment?.appointmentStatus ?? null,
      appointmentStartAt: appointment?.appointmentStartAt ?? null,
      serviceId: appointment?.serviceId ?? null,
      depositId: deposit?.depositId ?? null,
      depositStatus: deposit?.depositStatus ?? null,
      depositExpiresAt: deposit?.depositExpiresAt ?? null,
      depositVisitId: deposit?.depositVisitId ?? null,
    }
  })
}
function snapshotAggregate(row: AggregateRow): AggregateSnapshot {
  return { visitId: row.visitId, visitVersion: row.visitVersion, visitStatus: row.visitStatus, holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null, professionalId: row.professionalId, appointmentId: row.appointmentId, appointmentVersion: row.appointmentVersion, appointmentStatus: row.appointmentStatus, appointmentStartAt: row.appointmentStartAt?.toISOString() ?? null, serviceId: row.serviceId, depositId: row.depositId, depositStatus: row.depositStatus, depositExpiresAt: row.depositExpiresAt?.toISOString() ?? null, depositVisitId: row.depositVisitId }
}
function isResumeSnapshot(value: Prisma.JsonValue | null | undefined): value is ResumeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as Record<string, unknown>
  return x.v === 1 && typeof x.sessionRevision === 'string' && typeof x.stateDigest === 'string' && typeof x.conversationUpdatedAt === 'string' && typeof x.conversationStep === 'string' && typeof x.conversationAiEnabled === 'boolean' && typeof x.conversationStateDigest === 'string' && Array.isArray(x.aggregates)
}
/** Any uncertain comparison is a HOME decision. References are read under row locks. */
async function isSafeResume(tx: Tx, row: LockedSession & OperationRow, conversation: LockedConversation, businessId: string): Promise<boolean> {
  try {
    if (!isResumeSnapshot(row.resumeSnapshot) || row.revision.toString() !== row.resumeSnapshot.sessionRevision || hashJson(row.state) !== row.resumeSnapshot.stateDigest) return false
    if (conversation.updatedAt.toISOString() !== row.resumeSnapshot.conversationUpdatedAt || conversation.currentStep !== row.resumeSnapshot.conversationStep || conversation.aiEnabled !== row.resumeSnapshot.conversationAiEnabled || hashJson(conversation.snapshotState) !== row.resumeSnapshot.conversationStateDigest) return false
    const parsed = parseBotOptionsState(row.state)
    if (!parsed.ok || parsed.state.handoff !== 'TAKEN') return false
    const aggregates = await lockBookingAggregates(tx, businessId, row.sessionId)
    if (JSON.stringify(aggregates.map(snapshotAggregate)) !== JSON.stringify(row.resumeSnapshot.aggregates)) return false
    if (!aggregateStateIsValid(parsed.state, aggregates)) return false
    return await stateReferencesAreActive(tx, businessId, conversation, parsed.state, aggregates)
  } catch { return false }
}
function aggregateStateIsValid(state: BotOptionsState, rows: AggregateRow[]) {
  const now = rows[0]?.dbNow ?? new Date(0)
  if (state.booking === 'NONE' || state.booking === 'CANCELLED') return rows.length === 0
  if (rows.length !== 1) return false
  const row = rows[0]!
  if (!row.appointmentId || !row.appointmentStatus || !row.appointmentStartAt || row.appointmentStartAt <= now || !['PENDING', 'CONFIRMED'].includes(row.appointmentStatus)) return false
  if (state.booking === 'HELD' && (row.visitStatus !== 'HELD' || !row.holdExpiresAt || row.holdExpiresAt <= now)) return false
  if (state.booking === 'PENDING_PAYMENT_REVIEW' && row.visitStatus !== 'PENDING_PAYMENT_REVIEW') return false
  if (state.booking === 'CONFIRMED' && row.visitStatus !== 'CONFIRMED') return false
  if (state.deposit === 'NONE') return !row.depositId
  if (!row.depositId || !row.depositStatus || !row.depositExpiresAt || row.depositExpiresAt <= now || row.depositVisitId !== row.visitId) return false
  const expected: Record<string, string[]> = { PENDING_PROOF: ['PENDING_PROOF'], PROOF_RECEIVED: ['PROOF_RECEIVED'], REJECTED_RESUBMISSION_ALLOWED: ['PENDING_RESUBMISSION'], APPROVED: ['APPROVED'] }
  return expected[state.deposit]?.includes(row.depositStatus) ?? false
}
async function stateReferencesAreActive(tx: Tx, businessId: string, conversation: LockedConversation, state: BotOptionsState, aggregates: AggregateRow[]): Promise<boolean> {
  const serviceIds = new Set<string>([...state.cart.map(x => x.serviceId), ...(state.pendingEntityRef?.type === 'SERVICE' ? [state.pendingEntityRef.id] : []), ...aggregates.map(x => x.serviceId).filter((id): id is string => typeof id === 'string')])
  const professionalIds = new Set<string>([state.selections.professionalId, state.selections.provisionalProfessionalId, ...(state.pendingEntityRef?.type === 'PROFESSIONAL' ? [state.pendingEntityRef.id] : []), ...aggregates.map(x => x.professionalId)].filter((id): id is string => typeof id === 'string'))
  if (serviceIds.size && (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Service" WHERE "businessId"=${businessId} AND "isBookable"=true AND "id" IN (${Prisma.join([...serviceIds])}) FOR UPDATE`)).length !== serviceIds.size) return false
  if (professionalIds.size && (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Professional" WHERE "businessId"=${businessId} AND "isActive"=true AND "acceptsBotBookings"=true AND "id" IN (${Prisma.join([...professionalIds])}) FOR UPDATE`)).length !== professionalIds.size) return false
  if (state.selections.categoryId && (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "ServiceCategory" WHERE "id"=${state.selections.categoryId} AND "businessId"=${businessId} AND "isActive"=true FOR UPDATE`)).length !== 1) return false
  if (state.selections.appointmentId) {
    // Match F9 appointment-management authorization: Conversation.phone is
    // canonically normalized in TypeScript and must equal the tenant-scoped
    // Appointment.Customer.normalizedPhone. Lock both rows so reassignment or
    // identity edits cannot race the decision.
    const appointments = await tx.$queryRaw<Array<{ normalizedPhone: string | null }>>(Prisma.sql`
      SELECT c."normalizedPhone"
      FROM "Appointment" a
      JOIN "Customer" c ON c."id"=a."customerId" AND c."businessId"=${businessId}
      WHERE a."id"=${state.selections.appointmentId}
        AND a."status" IN ('PENDING'::"AppointmentStatus",'CONFIRMED'::"AppointmentStatus")
        AND a."startAt">clock_timestamp()
      FOR UPDATE OF a,c`)
    if (appointments.length !== 1 || !appointments[0]!.normalizedPhone || normalizePhone(conversation.phone) !== appointments[0]!.normalizedPhone) return false
  }
  return true
}
async function persistTransition(tx: Tx, row: LockedSession, businessId: string, sessionId: string, epoch: number, actionType: 'handoff.take' | 'handoff.resolve_home' | 'handoff.resolve_resume', status: 'HUMAN_TAKEN' | 'ACTIVE') {
  const parsed = parseBotOptionsState(row.state)
  if (!parsed.ok) throw new Error(`handoff persisted state violates invariant: ${parsed.invariant}`)
  const result = transition(parsed.state, { actionType, entityRef: null, payload: null }, { dbNowIso: new Date().toISOString() })
  if (result.outcome !== 'APPLIED') throw new Error(`handoff state transition rejected: ${actionType}`)
  const nextRevision = row.revision + 1n
  expectOne(await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "state"=${JSON.stringify(result.state)}::jsonb,"revision"=${nextRevision},"status"=${status}::"BotSessionStatus", "handoffClaimsPausedAt"=${status === 'ACTIVE' ? null : Prisma.sql`"handoffClaimsPausedAt"`},"updatedAt"=clock_timestamp()
    WHERE "id"=${sessionId} AND "businessId"=${businessId} AND "revision"=${row.revision} AND "handoffFenceEpoch"=${epoch}`), 'handoff state transition')
  expectOne(await tx.$executeRaw(Prisma.sql`INSERT INTO "BotTransitionLog" ("id","businessId","sessionId","deploymentId","deploymentGeneration","revisionFrom","revisionTo","actionType","outcome") VALUES (${randomUUID()},${businessId},${sessionId},${row.deploymentId},${row.deploymentGeneration},${row.revision},${nextRevision},${actionType},${result.outcome}) ON CONFLICT DO NOTHING`), 'handoff transition log')
  return { state: result.state, revision: nextRevision }
}
async function handoffDrain(client: Pick<PrismaClient, '$queryRaw'>, businessId: string, sessionId: string) {
  const rows = await client.$queryRaw<Array<{ active: bigint; unknown: bigint }>>(Prisma.sql`
    SELECT count(*) FILTER (WHERE status IN ('CLAIMED','SENDING'))::bigint AS active, count(*) FILTER (WHERE status='UNKNOWN')::bigint AS unknown FROM (
      SELECT "status"::text AS status FROM "BotDispatchClaim" WHERE "businessId"=${businessId} AND "sessionId"=${sessionId}
      UNION ALL SELECT "status"::text FROM "BotOutbox" WHERE "businessId"=${businessId} AND "sessionId"=${sessionId}
       UNION ALL SELECT 'CLAIMED'::text FROM "BotJob" j WHERE j."businessId"=${businessId} AND j."status"='LEASED'::"BotJobStatus" AND (
         EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id"=j."aggregateId" AND i."businessId"=${businessId} AND i."sessionId"=${sessionId})
         OR EXISTS (SELECT 1 FROM "BotPrompt" p JOIN "BotSession" ps ON ps."id"=p."sessionId" WHERE p."id"=j."aggregateId" AND ps."businessId"=${businessId} AND p."sessionId"=${sessionId})
          OR EXISTS (
            SELECT 1 FROM "BotProviderEvent" e JOIN "Conversation" c ON c."businessId"=e."businessId"
            WHERE (e."id"=j."aggregateId" OR EXISTS (
              SELECT 1 FROM "BotActionInbox" i
              WHERE i."id"=j."aggregateId" AND i."businessId"=e."businessId" AND i."providerEventId"=e."id"
            )) AND e."businessId"=${businessId}
              AND e."eventType"='MESSAGE'::"BotProviderEventType" AND e."payload" ->> 'fromPhone'=c."phone"
              AND c."id"=(SELECT "conversationId" FROM "BotSession" WHERE "id"=${sessionId} AND "businessId"=${businessId})
          )
       )
      UNION ALL SELECT 'CLAIMED'::text FROM "BotActionInbox" i WHERE i."businessId"=${businessId} AND i."sessionId"=${sessionId} AND i."status"='CLAIMED'::"BotInboxStatus"
        AND NOT EXISTS (SELECT 1 FROM "BotJob" j WHERE j."businessId"=i."businessId" AND j."aggregateId"=i."id" AND j."status"='LEASED'::"BotJobStatus")
    ) q`)
  return { active: Number(rows[0]?.active ?? 0n), unknown: Number(rows[0]?.unknown ?? 0n) > 0 }
}
/**
 * Terminally consumes pre-TAKE automatic work. DONE is deliberate rather than
 * POISON: ownership silencing is an expected terminal policy, not an operator
 * failure. The marker retains the reason on the durable job ledger.
 *
 * The three correlations deliberately mirror F10.3 claim fencing: session
 * inbox, session prompt, and provider MESSAGE fromPhone -> Conversation.
 * Therefore recovery jobs without a conversation correlation remain runnable.
 */
async function suppressPreTake(tx: Tx, businessId: string, sessionId: string): Promise<number> {
  await tx.$executeRaw(Prisma.sql`UPDATE "BotPrompt" SET "status"='INVALIDATED'::"BotPromptStatus","resolvedAt"=clock_timestamp() WHERE "sessionId"=${sessionId} AND "status" IN ('OPEN'::"BotPromptStatus",'STABILIZING'::"BotPromptStatus")`)
  await tx.$executeRaw(Prisma.sql`UPDATE "BotOutbox" SET "status"='SKIPPED'::"BotOutboxStatus","updatedAt"=clock_timestamp() WHERE "businessId"=${businessId} AND "sessionId"=${sessionId} AND "status" IN ('PENDING'::"BotOutboxStatus",'RETRY'::"BotOutboxStatus")`)
  const suppressedJobs = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" j SET "status"='DONE'::"BotJobStatus", "leaseToken"=NULL, "leasedUntil"=NULL,
      "lastError"='HUMAN_TAKEN_SUPPRESSED', "updatedAt"=clock_timestamp()
    WHERE j."businessId"=${businessId} AND j."status" IN ('READY'::"BotJobStatus",'RETRY'::"BotJobStatus")
      AND (
        EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id"=j."aggregateId" AND i."businessId"=${businessId} AND i."sessionId"=${sessionId})
        OR EXISTS (SELECT 1 FROM "BotPrompt" p JOIN "BotSession" ps ON ps."id"=p."sessionId" WHERE p."id"=j."aggregateId" AND ps."businessId"=${businessId} AND p."sessionId"=${sessionId})
          OR EXISTS (
            SELECT 1 FROM "BotProviderEvent" e JOIN "Conversation" c ON c."businessId"=e."businessId"
            WHERE (e."id"=j."aggregateId" OR EXISTS (
              SELECT 1 FROM "BotActionInbox" i
              WHERE i."id"=j."aggregateId" AND i."businessId"=e."businessId" AND i."providerEventId"=e."id"
            )) AND e."businessId"=${businessId}
              AND e."eventType"='MESSAGE'::"BotProviderEventType" AND e."payload" ->> 'fromPhone'=c."phone"
              AND c."id"=(SELECT "conversationId" FROM "BotSession" WHERE "id"=${sessionId} AND "businessId"=${businessId})
          )
      )`)
  // Some provider-event jobs (notably RECEIVE_DEPOSIT_PROOF) do not first
  // create an inbox. Preserve any suppressed provider inbound for CRM without
  // creating another automatic job; providerMessageId makes this idempotent.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "Message" ("id","conversationId","phone","direction","body","providerMessageId","status","metadata")
    SELECT 'handoff-taken:' || e."id", c."id", c."phone", 'INBOUND'::"MessageDirection",
      COALESCE(NULLIF(btrim(e."payload" ->> 'textBody'),''), '[' || COALESCE(NULLIF(e."payload" ->> 'messageType',''),'message') || ']'),
      e."providerMessageId", 'received', jsonb_build_object('provider','whatsapp','source','bot-options-handoff-pre-take','messageType',e."payload" ->> 'messageType','mediaId',e."payload" ->> 'mediaId')
    FROM "BotJob" j JOIN "BotProviderEvent" e ON e."businessId"=j."businessId" AND (
      e."id"=j."aggregateId" OR EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id"=j."aggregateId" AND i."providerEventId"=e."id")
    )
    JOIN "Conversation" c ON c."businessId"=e."businessId" AND c."phone"=e."payload" ->> 'fromPhone'
    WHERE j."businessId"=${businessId} AND j."lastError"='HUMAN_TAKEN_SUPPRESSED'
      AND c."id"=(SELECT "conversationId" FROM "BotSession" WHERE "id"=${sessionId} AND "businessId"=${businessId})
      AND e."eventType"='MESSAGE'::"BotProviderEventType" AND e."providerMessageId" IS NOT NULL
    ON CONFLICT DO NOTHING`)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "BotProviderEvent" e SET "status"='PROCESSED'::"BotProviderEventStatus"
    FROM "BotJob" j JOIN "Conversation" c ON c."businessId"=j."businessId"
    WHERE j."businessId"=${businessId} AND e."businessId"=j."businessId" AND (
      j."aggregateId"=e."id" OR EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id"=j."aggregateId" AND i."providerEventId"=e."id")
    )
      AND j."lastError"='HUMAN_TAKEN_SUPPRESSED' AND e."eventType"='MESSAGE'::"BotProviderEventType"
      AND e."payload" ->> 'fromPhone'=c."phone"
      AND c."id"=(SELECT "conversationId" FROM "BotSession" WHERE "id"=${sessionId} AND "businessId"=${businessId})
  `)
  return suppressedJobs
}
async function audit(tx: Tx, businessId: string, sessionId: string, handoffId: string, action: string, actorUserId: string, operationKey: string, detail: object) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","actorUserId","operationKey","detail") VALUES (${randomUUID()},${businessId},${sessionId},${handoffId},${action},${actorUserId},${operationKey},${JSON.stringify(detail)}::jsonb) ON CONFLICT ("handoffId","operationKey","action") DO NOTHING`)
}
