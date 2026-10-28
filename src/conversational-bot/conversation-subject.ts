import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
export type InstagramConversationSubject = { channel:'INSTAGRAM'; instagramLeadId:string; instagramAccountId:string; externalUserId:string }
export type ConversationSubject = { channel:'WHATSAPP'; canonicalPhone:string } | InstagramConversationSubject
export function isInstagramSubject(value: unknown): value is InstagramConversationSubject {
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const subject=value as Record<string,unknown>
  return subject.channel==='INSTAGRAM'&&['instagramLeadId','instagramAccountId','externalUserId'].every(key=>typeof subject[key]==='string'&&!!subject[key]&&String(subject[key]).length<=256)
}
/** A namespaced actor key is a mutex/idempotency input, never a telephone number. */
export function conversationSubjectKey(subject:ConversationSubject):string {
  return subject.channel==='WHATSAPP' ? subject.canonicalPhone : JSON.stringify(['INSTAGRAM',subject.instagramAccountId,subject.instagramLeadId,subject.externalUserId])
}
export async function lockConversationSubjectTx(tx:Prisma.TransactionClient,businessId:string,subject:ConversationSubject) {
  const key=createHash('sha256').update(JSON.stringify([businessId,subject.channel,conversationSubjectKey(subject)])).digest('hex')
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'bot-subject-input:'+key},0))`)
}
/** Exact persisted IG ownership; a typed name/phone never participates in this lookup. */
export async function resolveInstagramSessionSubjectTx(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,input:{businessId:string;sessionId:string;expected?:InstagramConversationSubject}) {
  const rows=await tx.$queryRaw<Array<InstagramConversationSubject & {customerId:string|null;aiEnabled:boolean}>>(Prisma.sql`
    /* instagram-runtime-subject */ SELECT 'INSTAGRAM'::text AS channel,l."id" AS "instagramLeadId",s."instagramAccountId",l."instagramUserId" AS "externalUserId",identity."customerId",l."aiEnabled"
    FROM "BotSession" s JOIN "InstagramLead" l ON l."id"=s."instagramLeadId" AND l."businessId"=s."businessId"
    JOIN "BusinessInstagramConfig" config ON config."businessId"=s."businessId" AND config."instagramAccountId"=s."instagramAccountId" AND config."enabled"=true
    LEFT JOIN "CustomerChannelIdentity" identity ON identity."businessId"=s."businessId" AND identity."channel"='INSTAGRAM' AND identity."externalUserId"=l."instagramUserId"
    LEFT JOIN "Customer" customer ON customer."id"=identity."customerId" AND customer."businessId"=s."businessId"
    WHERE s."id"=${input.sessionId} AND s."businessId"=${input.businessId} AND s."channel"='INSTAGRAM'::"BotChannel"
      AND s."conversationId" IS NULL AND (identity."customerId" IS NULL OR customer."id" IS NOT NULL)
  `)
  if(rows.length!==1)return null
  const subject=rows[0]!
  if(input.expected && conversationSubjectKey(input.expected)!==conversationSubjectKey(subject))return null
  return subject
}

export type RuntimeChannelIdentity = {canonicalPhone:string;subject?:never}|{subject:InstagramConversationSubject;canonicalPhone?:never}
export type ManagementChannelIdentity = {normalizedPhone:string;subject?:never}|{subject:InstagramConversationSubject;normalizedPhone?:never}
export function validRuntimeChannelIdentity(value:{canonicalPhone?:unknown;subject?:unknown}):boolean {
  return value.subject===undefined ? typeof value.canonicalPhone==='string'&&/^[0-9]{10,15}$/.test(value.canonicalPhone) : value.canonicalPhone===undefined&&isInstagramSubject(value.subject)
}
export function runtimeChannelIdentityRecord(value:RuntimeChannelIdentity):RuntimeChannelIdentity {
  if(!validRuntimeChannelIdentity(value))throw new Error('invalid runtime channel identity')
  return value.subject ? {subject:structuredClone(value.subject)} : {canonicalPhone:value.canonicalPhone}
}
export function managementChannelIdentityRecord(value:ManagementChannelIdentity):ManagementChannelIdentity {
  if(value.subject){if(value.normalizedPhone!==undefined||!isInstagramSubject(value.subject))throw new Error('invalid management channel identity');return {subject:structuredClone(value.subject)}}
  if(typeof value.normalizedPhone!=='string'||!/^[0-9]{8,15}$/.test(value.normalizedPhone))throw new Error('invalid management channel identity')
  return {normalizedPhone:value.normalizedPhone}
}

export type InstagramRuntimeScope = {businessId:string;sessionId:string;subject:InstagramConversationSubject;revision?:bigint;deploymentId?:string;generation?:number;configurationId?:string;dispatchFenceEpoch?:number;handoffFenceEpoch?:number}
/** Current actor authority shared by booking, receipts and appointment management. */
export async function lockInstagramRuntimeActorTx(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,input:InstagramRuntimeScope) {
  if(!isInstagramSubject(input.subject))return undefined
  const target=input.subject
  const rows=await tx.$queryRaw<Array<{state:unknown;customerId:string|null;customerName:string|null;businessAddress:string|null;businessTimezone:string;dbNow:Date}>>(Prisma.sql`
    /* instagram-runtime-actor */ SELECT s.state,customer.id AS "customerId",customer.name AS "customerName",b."publicAddress" AS "businessAddress",s."businessTimezone",clock_timestamp() AS "dbNow"
    FROM "BotSession" s JOIN "InstagramLead" lead ON lead.id=s."instagramLeadId" AND lead."businessId"=s."businessId"
    JOIN "BusinessInstagramConfig" instagram ON instagram."businessId"=s."businessId" AND instagram."instagramAccountId"=s."instagramAccountId"
    JOIN "BotChannelDeployment" d ON d.id=s."deploymentId" AND d."businessId"=s."businessId"
    JOIN "BusinessBotConfiguration" cfg ON cfg.id=d."activeConfigurationId" AND cfg."businessId"=s."businessId"
    JOIN "Business" b ON b.id=s."businessId"
    LEFT JOIN "CustomerChannelIdentity" identity ON identity."businessId"=s."businessId" AND identity.channel='INSTAGRAM' AND identity."externalUserId"=lead."instagramUserId"
    LEFT JOIN "Customer" customer ON customer.id=identity."customerId" AND customer."businessId"=s."businessId"
    WHERE s.id=${input.sessionId} AND s."businessId"=${input.businessId} AND s.channel='INSTAGRAM'::"BotChannel" AND s."conversationId" IS NULL
      AND s."instagramLeadId"=${target.instagramLeadId} AND s."instagramAccountId"=${target.instagramAccountId} AND lead."instagramUserId"=${target.externalUserId}
      AND s.status='ACTIVE' AND s."handoffClaimsPausedAt" IS NULL AND lead."aiEnabled"=true AND instagram.enabled=true
      AND d.channel='INSTAGRAM' AND d.generation=s."deploymentGeneration" AND d."claimsPausedAt" IS NULL AND d."legacyDispatchCoverageVersion">=1
      AND cfg.status='ACTIVE' AND b."botEnabled"=true AND (identity."customerId" IS NULL OR customer.id IS NOT NULL)
      AND (${input.revision??null}::bigint IS NULL OR s.revision=${input.revision??null})
      AND (${input.deploymentId??null}::text IS NULL OR s."deploymentId"=${input.deploymentId??null})
      AND (${input.generation??null}::integer IS NULL OR d.generation=${input.generation??null})
      AND (${input.configurationId??null}::text IS NULL OR cfg.id=${input.configurationId??null})
      AND (${input.dispatchFenceEpoch??null}::integer IS NULL OR d."dispatchFenceEpoch"=${input.dispatchFenceEpoch??null})
      AND (${input.handoffFenceEpoch??null}::integer IS NULL OR s."handoffFenceEpoch"=${input.handoffFenceEpoch??null})
    FOR UPDATE OF s,lead FOR SHARE OF instagram,d,cfg,b
  `)
  return rows.length===1?rows[0]:undefined
}

export function managementIdentityFromRuntime(value:RuntimeChannelIdentity):ManagementChannelIdentity {
  return value.subject ? {subject:structuredClone(value.subject)} : {normalizedPhone:value.canonicalPhone}
}
export function runtimeIdentityFromManagement(value:ManagementChannelIdentity):RuntimeChannelIdentity {
  return value.subject ? {subject:structuredClone(value.subject)} : {canonicalPhone:value.normalizedPhone}
}
