import {explicitReferralAction} from '../conversational-bot/conversational-referral.js'
import { resolveInstagramChoiceAdmissionTx } from './instagram-choice-admission.js'
import { randomUUID, randomBytes } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { resolveInstagramBotConfig, type InstagramBotConfig } from '../config/instagram-bot.js'
import { loadConversationPolicy } from '../conversational-bot/runtime-policy.js'
import { createInitialBotOptionsState } from '../bot-options/domain/state.js'
import { upsertJob } from '../bot-options/infrastructure/prisma-admission.js'
import type { InstagramMessagingWebhookEvent } from './instagram-webhook-parser.js'
type Client=Pick<Prisma.TransactionClient,'$queryRaw'|'$executeRaw'> & { $transaction<T>(operation:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{maxWait?:number;timeout?:number}):Promise<T> }
export type InstagramBotAdmissionResult={route:'legacy'}|{route:'new';status:'admitted'|'duplicate'|'paused'|'outside_window'|'rejected_choice';leadId:string;messageId:string|null}
/** Called only after the webhook route authenticated the exact raw body. */
export class PrismaInstagramBotAdmission {
  constructor(private readonly client:Client,private readonly rollout:InstagramBotConfig=resolveInstagramBotConfig(process.env),private readonly processingReady:boolean|readonly string[]=false){}
  selected(businessId:string){return this.rollout.enabled&&this.rollout.businessIds.includes(businessId)}
  async admit(input:{businessId:string;accountId:string;event:InstagramMessagingWebhookEvent;signatureVerified:boolean}):Promise<InstagramBotAdmissionResult> {
    if(!this.selected(input.businessId))return {route:'legacy'}
    if(!(this.processingReady===true||Array.isArray(this.processingReady)&&this.processingReady.includes(input.businessId)))throw new Error('Instagram conversational processor unavailable')
    if(!input.signatureVerified||!input.event.messageId||!input.event.instagramAccountIds.includes(input.accountId))throw new Error('Instagram bot requires an authenticated account-bound message')
    return this.client.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'bot-cutover:'+input.businessId+':INSTAGRAM'},0))`)
      const config=await tx.$queryRaw<Array<{accountId:string;timezone:string;deploymentId:string;generation:number;enabled:boolean}>>(Prisma.sql`
        /* instagram-bot-admission-config */ SELECT config."instagramAccountId" AS "accountId",business."timezone",d."id" AS "deploymentId",d."generation",COALESCE(features."botEnabled",true) AS "enabled"
        FROM "BusinessInstagramConfig" config JOIN "Business" business ON business."id"=config."businessId"
        JOIN "BotChannelDeployment" d ON d."businessId"=business."id" AND d."channel"='INSTAGRAM'::"BotChannel"
        LEFT JOIN "BusinessFeatureSettings" features ON features."businessId"=business."id"
        WHERE config."businessId"=${input.businessId} AND config."instagramAccountId"=${input.accountId} AND config."enabled"=true
          AND business."accountStatus"='ACTIVE' AND d."activeConfigurationId" IS NOT NULL AND d."claimsPausedAt" IS NULL AND d."legacyDispatchCoverageVersion">=1
        FOR SHARE OF config,d
      `)
      if(config.length!==1||!config[0]!.timezone)throw new Error('Instagram conversational deployment unavailable')
      const current=config[0]!
      const policy=await loadConversationPolicy(tx,{businessId:input.businessId,deploymentId:current.deploymentId,generation:current.generation,channel:'INSTAGRAM'})
      if(!policy)throw new Error('Instagram conversational policy unavailable')
      const leads=await tx.$queryRaw<Array<{id:string;aiEnabled:boolean;botPausedByUserId:string|null}>>(Prisma.sql`
        INSERT INTO "InstagramLead" ("id","businessId","instagramUserId","referralCode","lastMessage","createdAt","updatedAt")
        VALUES (${randomUUID()},${input.businessId},${input.event.senderId},${randomBytes(12).toString('hex')},${input.event.text},clock_timestamp(),clock_timestamp())
        ON CONFLICT ("businessId","instagramUserId") DO UPDATE SET "lastMessage"=EXCLUDED."lastMessage","updatedAt"=clock_timestamp()
        RETURNING "id","aiEnabled","botPausedByUserId"
      `)
      const lead=leads[0]!
      const eventId=randomUUID(),messageId=randomUUID(),eventKey=JSON.stringify([input.businessId,input.accountId,input.event.messageId])
      const attachments=input.event.attachments??[]
      const attachment=attachments.length===1?attachments[0]:null
      const messageType=input.event.unsupported?'unsupported':attachment?.type==='image'?'image':attachment?.type==='file'?'document':attachments.length?'unsupported':'text'
      const occurred=input.event.timestamp===undefined?null:new Date(input.event.timestamp)
      if(occurred&&!Number.isFinite(occurred.getTime()))throw new Error('Invalid Instagram provider timestamp')
      const timeRows=await tx.$queryRaw<Array<{valid:boolean}>>(Prisma.sql`SELECT (${occurred}::timestamptz IS NOT NULL AND ${occurred}::timestamptz<=clock_timestamp() AND ${occurred}::timestamptz>clock_timestamp()-interval '24 hours') AS valid`)
      const signedEventTimeValid=timeRows[0]?.valid===true
      const payload={kind:'message',channel:'INSTAGRAM',instagramLeadId:lead.id,instagramAccountId:input.accountId,senderId:input.event.senderId,messageType,textBody:input.event.text,contextWindowEvaluated:false,signedEventTimeValid,
        ...(attachment&&['image','file'].includes(attachment.type)&&attachment.url?{mediaSource:'INSTAGRAM_SIGNED_URL',instagramAttachment:attachment,mediaId:input.event.messageId,mediaMimeType:null}:{}),
        ...(input.event.choicePayload?{instagramChoicePayload:input.event.choicePayload}:{})}

      const inserted=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","providerMessageId","payload","providerOccurredAt","admittedAt","status")
        VALUES (${eventId},'INSTAGRAM',${eventKey},'MESSAGE',${input.businessId},${input.event.messageId},${JSON.stringify(payload)}::jsonb,${occurred},clock_timestamp(),'ADMITTED')
        ON CONFLICT ("provider","eventKey") DO NOTHING RETURNING "id"
      `)
      if(!inserted.length)return {route:'new',status:'duplicate',leadId:lead.id,messageId:null}
      const inbound=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        INSERT INTO "InstagramMessage" ("id","leadId","providerMessageId","direction","body","status","metadata","createdAt")
        VALUES (${messageId},${lead.id},${input.event.messageId},'INBOUND',${input.event.text},'received',${JSON.stringify({provider:'instagram',accountId:input.accountId,eventId})}::jsonb,clock_timestamp())
        ON CONFLICT ("providerMessageId") DO NOTHING RETURNING "id"
      `)
      if(!inbound.length){await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET "status"='DUPLICATE' WHERE "id"=${eventId}`);return {route:'new',status:'duplicate',leadId:lead.id,messageId:null}}
      if(!signedEventTimeValid){await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET "status"='PROCESSED' WHERE "id"=${eventId}`);return {route:'new',status:'outside_window',leadId:lead.id,messageId}}
      const queuedResume=!lead.aiEnabled&&lead.botPausedByUserId===null&&explicitReferralAction(input.event.text)==='resume'
      if((!lead.aiEnabled&&!queuedResume)||!current.enabled){await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET "status"='PROCESSED' WHERE "id"=${eventId}`);return {route:'new',status:'paused',leadId:lead.id,messageId}}
      const sessions=await tx.$queryRaw<Array<{id:string;revision:bigint;instagramAccountId:string;deploymentGeneration:number;state:Prisma.JsonValue;draftTouchedAt:Date|null}>>(Prisma.sql`
        SELECT "id","revision","instagramAccountId","deploymentGeneration",state,"draftTouchedAt" FROM "BotSession"
        WHERE "businessId"=${input.businessId} AND "deploymentId"=${current.deploymentId} AND "instagramLeadId"=${lead.id} AND "status"<>'CLOSED'::"BotSessionStatus" FOR UPDATE
      `)
      let session=sessions[0]
      if(session&&(session.instagramAccountId!==input.accountId||session.deploymentGeneration!==current.generation))throw new Error('Instagram session requires explicit cutover')
      if(queuedResume&&!session){await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET status='PROCESSED' WHERE id=${eventId}`);return {route:'new',status:'paused',leadId:lead.id,messageId}}
      if(!session){const id=randomUUID();const created=await tx.$queryRaw<Array<{id:string;revision:bigint;instagramAccountId:string;deploymentGeneration:number;state:Prisma.JsonValue;draftTouchedAt:Date|null}>>(Prisma.sql`
        INSERT INTO "BotSession" ("id","businessId","deploymentId","deploymentGeneration","channel","instagramLeadId","instagramAccountId","businessTimezone","state","revision","createdAt","updatedAt","draftTouchedAt","draftExpiresAt")
        VALUES (${id},${input.businessId},${current.deploymentId},${current.generation},'INSTAGRAM',${lead.id},${input.accountId},${current.timezone},${JSON.stringify(createInitialBotOptionsState())}::jsonb,0,clock_timestamp(),clock_timestamp(),${occurred}::timestamptz,${occurred}::timestamptz+interval '24 hours')
        RETURNING "id","revision","instagramAccountId","deploymentGeneration",state,"draftTouchedAt"
      `);session=created[0]}
      if(!session)throw new Error('Instagram session unavailable')
      const subject={channel:'INSTAGRAM' as const,instagramLeadId:lead.id,instagramAccountId:input.accountId,externalUserId:input.event.senderId}
      const choice=session.draftTouchedAt&&occurred!.getTime()<session.draftTouchedAt.getTime()?{kind:'reject' as const}:await resolveInstagramChoiceAdmissionTx(tx,{businessId:input.businessId,sessionId:session.id,revision:session.revision,state:session.state,subject,policy,timezone:current.timezone,occurredAt:occurred!,text:input.event.text,...(input.event.choicePayload?{providerPayload:input.event.choicePayload}:{})})
      if(choice.kind==='reject'){await tx.$executeRaw(Prisma.sql`UPDATE "BotProviderEvent" SET status='PROCESSED' WHERE id=${eventId}`);return {route:'new',status:'rejected_choice',leadId:lead.id,messageId}}
      const inboxPayload={...payload,...(choice.kind==='choice'?{conversationChoice:choice.payload}:{})}
      const inboxId=randomUUID()
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotActionInbox" ("id","businessId","providerEventId","sessionId","providerMessageId","actionType","deploymentId","deploymentGeneration","payload","expectedRevision","promptId","choiceToken","status")
        VALUES (${inboxId},${input.businessId},${eventId},${session.id},${input.event.messageId},${choice.kind==='choice'?'conversation.choice':'conversation.message'},${current.deploymentId},${current.generation},${JSON.stringify(inboxPayload)}::jsonb,${session.revision},${choice.kind==='choice'?choice.promptId:null},${choice.kind==='choice'?choice.choiceToken:null},'ADMITTED')
      `)
      await upsertJob(tx,'PROCESS_INBOX',inboxId,input.businessId,current.deploymentId,current.generation,null,'immediate')
      return {route:'new',status:'admitted',leadId:lead.id,messageId}
    },{maxWait:2000,timeout:10000})
  }
}
