import { Prisma } from '../generated/prisma/client.js'
import { isInstagramSubject, type InstagramConversationSubject } from './conversation-subject.js'

export function instagramSubjectFromPayload(value:unknown):InstagramConversationSubject {
  const payload=value as Record<string,unknown>|null
  const subject={channel:payload?.channel,instagramLeadId:payload?.instagramLeadId,instagramAccountId:payload?.instagramAccountId,externalUserId:payload?.senderId}
  if(!isInstagramSubject(subject))throw new Error('invalid Instagram runtime subject')
  return subject
}
export async function lockInstagramConversationSessionTx(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,input:{businessId:string;deploymentId:string;subject:InstagramConversationSubject}) {
  const rows=await tx.$queryRaw<Array<{sessionId:string;conversationId:null;revision:bigint;status:string;state:Prisma.JsonValue;businessTimezone:string;handoffFenceEpoch:number;handoffClaimsPausedAt:Date|null;deploymentId:string;deploymentGeneration:number;leadAiEnabled:boolean;leadBotPausedByUserId:string|null}>>(Prisma.sql`
    /* instagram-conversation-session */ SELECT s.id AS "sessionId",s."conversationId",s.revision,s.status::text,s.state,s."businessTimezone",s."handoffFenceEpoch",s."handoffClaimsPausedAt",s."deploymentId",s."deploymentGeneration",lead."aiEnabled" AS "leadAiEnabled",lead."botPausedByUserId" AS "leadBotPausedByUserId"
    FROM "BotSession" s JOIN "InstagramLead" lead ON lead.id=s."instagramLeadId" AND lead."businessId"=s."businessId"
    JOIN "BusinessInstagramConfig" config ON config."businessId"=s."businessId" AND config."instagramAccountId"=s."instagramAccountId" AND config.enabled=true
    WHERE s."businessId"=${input.businessId} AND s."deploymentId"=${input.deploymentId} AND s.channel='INSTAGRAM' AND s."conversationId" IS NULL
      AND lead.id=${input.subject.instagramLeadId} AND s."instagramAccountId"=${input.subject.instagramAccountId} AND lead."instagramUserId"=${input.subject.externalUserId}
      AND s.status<>'CLOSED'::"BotSessionStatus"
    ORDER BY s."updatedAt" DESC,s.id DESC FOR UPDATE OF s,lead FOR SHARE OF config
  `)
  if(rows.length>1)throw new Error('ambiguous Instagram conversational session')
  return rows[0]??null
}

/** Rechecked by preflight and by the provider immediately before the POST.
 * Only an authenticated user event for this exact account/lead opens the window. */
export async function resolveInstagramSendTargetTx(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,input:{businessId:string;sessionId:string;generation:number;fenceEpoch:number;expectedRevision:bigint;subject:InstagramConversationSubject}) {
  const rows=await tx.$queryRaw<Array<{instagramAccountId:string;apiAccountId:string|null;accessToken:string}>>(Prisma.sql`
    /* instagram-send-target */ SELECT config."instagramAccountId",config."apiAccountId",config."accessToken"
    FROM "BotSession" session JOIN "InstagramLead" lead ON lead.id=session."instagramLeadId" AND lead."businessId"=session."businessId"
    JOIN "BusinessInstagramConfig" config ON config."businessId"=session."businessId" AND config."instagramAccountId"=session."instagramAccountId" AND config.enabled=true
    JOIN "BotChannelDeployment" deployment ON deployment.id=session."deploymentId" AND deployment."businessId"=session."businessId" AND deployment.channel='INSTAGRAM'
    JOIN "BusinessBotConfiguration" configuration ON configuration.id=deployment."activeConfigurationId" AND configuration."businessId"=session."businessId" AND configuration.status='ACTIVE'
    JOIN "Business" business ON business.id=session."businessId" AND business."botEnabled"=true AND business."accountStatus"='ACTIVE'
    WHERE session.id=${input.sessionId} AND session."businessId"=${input.businessId} AND session.channel='INSTAGRAM'
      AND session."instagramLeadId"=${input.subject.instagramLeadId} AND session."instagramAccountId"=${input.subject.instagramAccountId} AND lead."instagramUserId"=${input.subject.externalUserId}
      AND session.revision=${input.expectedRevision} AND session.status IN ('ACTIVE','HUMAN_QUEUED') AND session."handoffClaimsPausedAt" IS NULL
      AND (lead."aiEnabled"=true OR (session.status='HUMAN_QUEUED' AND lead."botPausedByUserId" IS NULL AND EXISTS (SELECT 1 FROM "BotHandoff" handoff WHERE handoff."sessionId"=session.id AND handoff."businessId"=session."businessId" AND handoff.status='QUEUED')))
      AND deployment.generation=${input.generation} AND session."deploymentGeneration"=deployment.generation AND deployment."dispatchFenceEpoch"=${input.fenceEpoch}
      AND deployment."claimsPausedAt" IS NULL AND deployment."legacyDispatchCoverageVersion">=1
      AND (SELECT max(event."providerOccurredAt") FROM "BotProviderEvent" event WHERE event."businessId"=session."businessId" AND event.provider='INSTAGRAM' AND event."eventType"='MESSAGE'
        AND event.payload->>'signedEventTimeValid'='true' AND event.payload->>'channel'='INSTAGRAM' AND event.payload->>'instagramLeadId'=lead.id AND event.payload->>'instagramAccountId'=session."instagramAccountId" AND event.payload->>'senderId'=lead."instagramUserId"
        AND event."providerOccurredAt"<=clock_timestamp()) > clock_timestamp()-interval '24 hours'
  `)
  return rows.length===1&&rows[0]!.accessToken?rows[0]:null
}
