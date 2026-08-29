import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'

type LegacyCutoverClient = Pick<PrismaClient, '$transaction'>

type LegacyClaimClient = Pick<PrismaClient, '$transaction' | '$executeRaw'>

export type LegacyPausedInboundPayloadV1 = {
  version: 1
  text: string
  media?: { type: 'image' | 'document'; id: string; mimeType?: string; sha256?: string; caption?: string; filename?: string }
  interactiveReplyId?: string
}

export type PausedLegacyInboundDecision =
  | { kind: 'NOT_PAUSED' }
  | { kind: 'ACK_PAUSED'; duplicate: boolean; legacyDuplicate: boolean }
  | { kind: 'RETRYABLE_IDENTITY_FAILURE' }
  | { kind: 'RETRYABLE_ADMISSION_FAILURE' }

export type LegacyInboundClaimDecision =
  | PausedLegacyInboundDecision
  | { kind: 'PROCESS'; claimToken: string }
  | { kind: 'ACK_TERMINAL_DUPLICATE' }
  | { kind: 'RETRYABLE_IN_FLIGHT'; status: 'CLAIMED' | 'SENDING' | 'UNKNOWN' }

function cutoverLockKey(businessId: string): string {
  return `bot-cutover:${businessId}:WHATSAPP`
}

async function legacyScopeTx(tx: Prisma.TransactionClient, businessId: string) {
  // This is an inactive, legacy-only dispatch scope. It never creates or points
  // at a bot configuration, so F11.1 cannot accidentally activate F11.2.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "updatedAt")
    VALUES (${randomUUID()}, ${businessId}, 'legacy-whatsapp', clock_timestamp())
    ON CONFLICT ("businessId", "channel") DO NOTHING
  `)
  const scopes = await tx.$queryRaw<Array<{ id: string; generation: number; fenceEpoch: number; pausedAt: Date | null }>>(Prisma.sql`
    SELECT "id", "generation", "dispatchFenceEpoch" AS "fenceEpoch", "claimsPausedAt" AS "pausedAt"
    FROM "BotChannelDeployment"
    WHERE "businessId"=${businessId} AND "channel"='WHATSAPP'::"BotChannel" FOR SHARE
  `)
  if (scopes.length !== 1) throw new Error('expected exactly one WhatsApp dispatch scope')
  return scopes[0]!
}

/**
 * The only legacy ingress operation allowed while F11 holds the pause fence.
 * It commits a PII-minimal receipt before returning ACK and never touches
 * Conversation, Message, jobs, AI, or Meta.
 */
export async function admitPausedLegacyInbound(input: {
  client: LegacyCutoverClient
  businessId: string
  providerMessageId?: string
  fromPhone: string
  phoneNumberId?: string
  displayPhoneNumber?: string
  payload: LegacyPausedInboundPayloadV1
}): Promise<PausedLegacyInboundDecision> {
  try {
    return await input.client.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '50ms'`
    await tx.$executeRaw`SET LOCAL statement_timeout = '120ms'`
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cutoverLockKey(input.businessId)}, 0))`)
    const scope = await legacyScopeTx(tx, input.businessId)
    if (!scope.pausedAt) return { kind: 'NOT_PAUSED' }
    if (!input.providerMessageId) return { kind: 'RETRYABLE_IDENTITY_FAILURE' }
    const existingLegacy = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Message" WHERE "providerMessageId"=${input.providerMessageId} LIMIT 1 FOR SHARE
    `)
    const status = existingLegacy.length > 0 ? 'LEGACY_DUPLICATE' : 'PAUSED_ADMITTED'
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      INSERT INTO "LegacyWhatsAppCutoverInbound" (
        "id","receiptKey","businessId","deploymentId","deploymentGeneration","dispatchFenceEpoch","pausedAt",
        "providerMessageId","fromPhone","phoneNumberId","displayPhoneNumber","payload","status","updatedAt"
      ) VALUES (
        ${randomUUID()},${`whatsapp:${input.businessId}:${input.providerMessageId}`},${input.businessId},${scope.id},${scope.generation},${scope.fenceEpoch},${scope.pausedAt},
        ${input.providerMessageId},${input.fromPhone},${input.phoneNumberId ?? null},${input.displayPhoneNumber ?? null},${JSON.stringify(input.payload)}::jsonb,${status}::"LegacyWhatsAppCutoverInboundStatus",clock_timestamp()
      ) ON CONFLICT ("businessId","providerMessageId") DO NOTHING
      RETURNING "id","status"::text AS "status"
    `)
    if (rows.length === 0) {
      const previous = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT "status"::text AS "status" FROM "LegacyWhatsAppCutoverInbound"
        WHERE "businessId"=${input.businessId} AND "providerMessageId"=${input.providerMessageId} FOR SHARE
      `)
      if (previous.length !== 1) throw new Error('paused legacy receipt conflict without durable receipt')
      // This compatibility helper has no recovery result type. Refuse to ACK a
      // normal in-flight/unknown journal so its caller must retry instead.
      if (previous[0]!.status === 'NORMAL_CLAIMED' || previous[0]!.status === 'NORMAL_SENDING' || previous[0]!.status === 'NORMAL_UNKNOWN') {
        return { kind: 'RETRYABLE_ADMISSION_FAILURE' }
      }
      return { kind: 'ACK_PAUSED', duplicate: true, legacyDuplicate: previous[0]!.status === 'LEGACY_DUPLICATE' }
    }
    return { kind: 'ACK_PAUSED', duplicate: false, legacyDuplicate: rows[0]!.status === 'LEGACY_DUPLICATE' }
    })
  } catch {
    // A receipt that did not commit must never be ACKed. Route maps this to 503
    // so Meta retries; no exception detail is exposed to the webhook caller.
    return { kind: 'RETRYABLE_ADMISSION_FAILURE' }
  }
}

/**
 * Admission for the normal legacy path. The shared cutover lock spans the
 * deployment read and durable claim insert, closing the former NOT_PAUSED race.
 * It deliberately does not use acquireDispatchClaim: legacy has no active
 * deterministic configuration to validate.
 */
export async function claimLegacyInboundProcessing(input: {
  client: LegacyCutoverClient
  businessId: string
  providerMessageId?: string
  fromPhone: string
  phoneNumberId?: string
  displayPhoneNumber?: string
  payload: LegacyPausedInboundPayloadV1
  leaseMs?: number
}): Promise<LegacyInboundClaimDecision> {
  try {
    return await input.client.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '50ms'`
      await tx.$executeRaw`SET LOCAL statement_timeout = '120ms'`
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cutoverLockKey(input.businessId)}, 0))`)
      const scope = await legacyScopeTx(tx, input.businessId)
      if (scope.pausedAt) {
        if (!input.providerMessageId) return { kind: 'RETRYABLE_IDENTITY_FAILURE' }
        const existingLegacy = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "Message" WHERE "providerMessageId"=${input.providerMessageId} LIMIT 1 FOR SHARE
        `)
        const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          INSERT INTO "LegacyWhatsAppCutoverInbound" ("id","receiptKey","businessId","deploymentId","deploymentGeneration","dispatchFenceEpoch","pausedAt","providerMessageId","fromPhone","phoneNumberId","displayPhoneNumber","payload","status","updatedAt")
          VALUES (${randomUUID()},${`whatsapp:${input.businessId}:${input.providerMessageId}`},${input.businessId},${scope.id},${scope.generation},${scope.fenceEpoch},${scope.pausedAt},${input.providerMessageId},${input.fromPhone},${input.phoneNumberId ?? null},${input.displayPhoneNumber ?? null},${JSON.stringify(input.payload)}::jsonb,${existingLegacy.length ? 'LEGACY_DUPLICATE' : 'PAUSED_ADMITTED'}::"LegacyWhatsAppCutoverInboundStatus",clock_timestamp())
          ON CONFLICT ("businessId","providerMessageId") DO NOTHING RETURNING "status"::text AS "status"
        `)
        if (rows.length > 0) {
          return { kind: 'ACK_PAUSED', duplicate: false, legacyDuplicate: rows[0]!.status === 'LEGACY_DUPLICATE' }
        }
        const previous = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          SELECT "status"::text AS "status" FROM "LegacyWhatsAppCutoverInbound"
          WHERE "businessId"=${input.businessId} AND "providerMessageId"=${input.providerMessageId} FOR SHARE
        `)
        if (previous.length !== 1) throw new Error('paused legacy receipt conflict without durable receipt')
        if (previous[0]!.status.startsWith('NORMAL_')) {
          return previous[0]!.status === 'NORMAL_DONE'
            ? { kind: 'ACK_TERMINAL_DUPLICATE' }
            : { kind: 'RETRYABLE_IN_FLIGHT', status: previous[0]!.status.replace('NORMAL_', '') as 'CLAIMED' | 'SENDING' | 'UNKNOWN' }
        }
        return { kind: 'ACK_PAUSED', duplicate: true, legacyDuplicate: previous[0]!.status === 'LEGACY_DUPLICATE' }
      }
       // Meta normally supplies an ID. Outside a pause, legacy keeps its historic
       // no-ID behavior, but still gets an ephemeral barrier claim so a cutover
       // that starts next cannot falsely observe quiescence. It intentionally
       // offers no deduplication guarantee that the provider identity lacks.
      const resourceId = input.providerMessageId ?? `legacy-no-provider-id:${randomUUID()}`
      if (!input.providerMessageId) {
        const token = randomUUID()
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "BotDispatchClaim" ("id","businessId","channel","resourceId","engineKey","generation","fenceEpoch","kind","status","claimToken","claimedUntil","updatedAt")
          VALUES (${randomUUID()},${input.businessId},'WHATSAPP'::"BotChannel",${resourceId},'legacy-whatsapp',${scope.generation},${scope.fenceEpoch},'LEGACY_PROCESS'::"BotDispatchKind",'CLAIMED'::"BotDispatchStatus",${token},clock_timestamp() + (${input.leaseMs ?? 120_000} * interval '1 millisecond'),clock_timestamp())
        `)
        return { kind: 'PROCESS', claimToken: token }
      }
       const token = randomUUID()
       // Provider-ID traffic gets a recoverable journal and the claim in the
       // same transaction. The receipt captures the exact scope generation and
       // fence that admitted it; retries never infer those values later.
       const receipt = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
         INSERT INTO "LegacyWhatsAppCutoverInbound" (
           "id","receiptKey","businessId","deploymentId","deploymentGeneration","dispatchFenceEpoch","pausedAt",
           "providerMessageId","fromPhone","phoneNumberId","displayPhoneNumber","payload","status","claimToken","claimedUntil","updatedAt"
         ) VALUES (
           ${randomUUID()},${`whatsapp:${input.businessId}:${input.providerMessageId}`},${input.businessId},${scope.id},${scope.generation},${scope.fenceEpoch},NULL,
           ${input.providerMessageId},${input.fromPhone},${input.phoneNumberId ?? null},${input.displayPhoneNumber ?? null},${JSON.stringify(input.payload)}::jsonb,
           'NORMAL_CLAIMED'::"LegacyWhatsAppCutoverInboundStatus",${token},clock_timestamp() + (${input.leaseMs ?? 120_000} * interval '1 millisecond'),clock_timestamp()
         ) ON CONFLICT ("businessId","providerMessageId") DO NOTHING
         RETURNING "status"::text AS "status"
       `)
       if (receipt.length === 0) {
         const previous = await tx.$queryRaw<Array<{ status: 'NORMAL_CLAIMED' | 'NORMAL_SENDING' | 'NORMAL_DONE' | 'NORMAL_UNKNOWN' }>>(Prisma.sql`
           SELECT "status"::text AS "status" FROM "LegacyWhatsAppCutoverInbound"
           WHERE "businessId"=${input.businessId} AND "providerMessageId"=${input.providerMessageId} FOR SHARE
         `)
         if (previous.length !== 1) throw new Error('legacy journal conflict without durable receipt')
         return previous[0]!.status === 'NORMAL_DONE'
           ? { kind: 'ACK_TERMINAL_DUPLICATE' }
           : { kind: 'RETRYABLE_IN_FLIGHT', status: previous[0]!.status.replace('NORMAL_', '') as 'CLAIMED' | 'SENDING' | 'UNKNOWN' }
       }
       const claim = await tx.$queryRaw<Array<{ claimToken: string }>>(Prisma.sql`
         INSERT INTO "BotDispatchClaim" ("id","businessId","channel","resourceId","engineKey","generation","fenceEpoch","kind","status","claimToken","claimedUntil","updatedAt")
         VALUES (${randomUUID()},${input.businessId},'WHATSAPP'::"BotChannel",${resourceId},'legacy-whatsapp',${scope.generation},${scope.fenceEpoch},'LEGACY_PROCESS'::"BotDispatchKind",'CLAIMED'::"BotDispatchStatus",${token},clock_timestamp() + (${input.leaseMs ?? 120_000} * interval '1 millisecond'),clock_timestamp())
         ON CONFLICT DO NOTHING RETURNING "claimToken"
       `)
       if (!claim[0]) throw new Error('legacy claim conflict after journal admission')
       return { kind: 'PROCESS', claimToken: claim[0].claimToken }
    })
  } catch {
    return { kind: 'RETRYABLE_ADMISSION_FAILURE' }
  }
}

export async function assertLegacyProcessClaimTx(input: { tx: Prisma.TransactionClient; businessId: string; claimToken: string; status?: 'CLAIMED' | 'SENDING' }): Promise<void> {
  await input.tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cutoverLockKey(input.businessId)}, 0))`)
  const rows = await input.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c."id" FROM "BotDispatchClaim" c JOIN "BotChannelDeployment" d ON d."businessId"=c."businessId" AND d."channel"=c."channel"
    WHERE c."businessId"=${input.businessId} AND c."claimToken"=${input.claimToken} AND c."kind"='LEGACY_PROCESS'::"BotDispatchKind"
      AND c."status"=${input.status ?? 'CLAIMED'}::"BotDispatchStatus" AND c."claimedUntil">clock_timestamp()
      AND d."generation"=c."generation" AND d."dispatchFenceEpoch"=c."fenceEpoch" AND d."claimsPausedAt" IS NULL
    FOR UPDATE OF c
  `)
  if (rows.length !== 1) throw new Error('stale or fenced legacy process claim')
}

export async function advanceLegacyProcessClaim(client: LegacyClaimClient, claimToken: string, status: 'SENDING' | 'UNKNOWN' | 'DONE'): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const journalStatus = `NORMAL_${status}`
    const journals = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "LegacyWhatsAppCutoverInbound" WHERE "claimToken"=${claimToken}
        AND "status" IN ('NORMAL_CLAIMED'::"LegacyWhatsAppCutoverInboundStatus",'NORMAL_SENDING'::"LegacyWhatsAppCutoverInboundStatus") FOR UPDATE
    `)
    const claims = await tx.$queryRaw<Array<{ resourceId: string | null }>>(Prisma.sql`
      UPDATE "BotDispatchClaim" SET "status"=${status}::"BotDispatchStatus", "updatedAt"=clock_timestamp()
      WHERE "claimToken"=${claimToken} AND "kind"='LEGACY_PROCESS'::"BotDispatchKind"
        AND "status" IN ('CLAIMED'::"BotDispatchStatus",'SENDING'::"BotDispatchStatus")
      RETURNING "resourceId"
    `)
    if (claims.length !== 1) return false
    if (journals.length === 0) {
      if (!claims[0]!.resourceId?.startsWith('legacy-no-provider-id:')) throw new Error('provider-ID legacy claim has no journal')
      return true
    }
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "LegacyWhatsAppCutoverInbound" SET "status"=${journalStatus}::"LegacyWhatsAppCutoverInboundStatus",
        "claimedUntil"=CASE WHEN ${status} = 'DONE' THEN "claimedUntil" ELSE clock_timestamp() END, "updatedAt"=clock_timestamp()
      WHERE "id"=${journals[0]!.id}
    `)
    if (updated !== 1) throw new Error('legacy claim/journal transition was not atomic')
    return true
  })
}

/** Linearizes the start of an external effect before the effect itself. */
export async function beginLegacyExternalEffect(input: { client: LegacyCutoverClient; businessId: string; claimToken: string }): Promise<void> {
  await input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cutoverLockKey(input.businessId)}, 0))`)
    const valid = await tx.$queryRaw<Array<{ status: 'CLAIMED' | 'SENDING' }>>(Prisma.sql`
      SELECT c."status"::text AS "status" FROM "BotDispatchClaim" c JOIN "BotChannelDeployment" d
        ON d."businessId"=c."businessId" AND d."channel"=c."channel"
      WHERE c."businessId"=${input.businessId} AND c."claimToken"=${input.claimToken} AND c."kind"='LEGACY_PROCESS'::"BotDispatchKind"
        AND c."status" IN ('CLAIMED'::"BotDispatchStatus",'SENDING'::"BotDispatchStatus") AND c."claimedUntil">clock_timestamp()
        AND d."generation"=c."generation" AND d."dispatchFenceEpoch"=c."fenceEpoch" AND d."claimsPausedAt" IS NULL
      FOR UPDATE OF c
    `)
    if (valid.length !== 1) throw new Error('stale or fenced legacy external effect')
    // Multiple legacy sends can belong to one inbound. Once SENDING was
    // durably recorded, repeating this barrier is safe and does not reopen it.
    if (valid[0]!.status === 'SENDING') return
    const journals = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "LegacyWhatsAppCutoverInbound" WHERE "claimToken"=${input.claimToken}
        AND "status"='NORMAL_CLAIMED'::"LegacyWhatsAppCutoverInboundStatus" FOR UPDATE
    `)
    const advanced = await tx.$queryRaw<Array<{ resourceId: string | null }>>(Prisma.sql`
      UPDATE "BotDispatchClaim" SET "status"='SENDING'::"BotDispatchStatus", "updatedAt"=clock_timestamp()
      WHERE "claimToken"=${input.claimToken} AND "kind"='LEGACY_PROCESS'::"BotDispatchKind" AND "status"='CLAIMED'::"BotDispatchStatus"
      RETURNING "resourceId"
    `)
    if (advanced.length !== 1) throw new Error('cannot start stale legacy external effect')
    if (journals.length === 0) {
      if (!advanced[0]!.resourceId?.startsWith('legacy-no-provider-id:')) throw new Error('provider-ID legacy claim has no journal')
      return
    }
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "LegacyWhatsAppCutoverInbound" SET "status"='NORMAL_SENDING'::"LegacyWhatsAppCutoverInboundStatus", "updatedAt"=clock_timestamp()
      WHERE "id"=${journals[0]!.id}
    `)
    if (updated !== 1) throw new Error('cannot start legacy external effect journal')
  })
}
