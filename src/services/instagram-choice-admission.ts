import { Prisma } from '../generated/prisma/client.js'
import { readConversationDraft } from '../conversational-bot/session-state.js'
import type { ConversationPolicy } from '../conversational-bot/runtime-policy.js'
import { instagramChoiceActorKeyTx,resolveConversationChoicePayload } from '../conversational-bot/runtime-choice-persistence.js'
import type { InstagramConversationSubject } from '../conversational-bot/conversation-subject.js'
type Input={businessId:string;sessionId:string;revision:bigint;state:Prisma.JsonValue;subject:InstagramConversationSubject;policy:ConversationPolicy;timezone:string;occurredAt:Date;text:string;providerPayload?:string}
export async function resolveInstagramChoiceAdmissionTx(tx:Pick<Prisma.TransactionClient,'$queryRaw'|'$executeRaw'>,input:Input):Promise<{kind:'message'}|{kind:'reject'}|{kind:'choice';payload:unknown;promptId:string;choiceToken:string}> {
  // This transport emits only numbered plain text. Native payloads were not presented.
  if(input.providerPayload)return {kind:'reject'}
  const rows=await tx.$queryRaw<Array<{promptId:string;choiceToken:string;payload:Prisma.JsonValue;labelSnapshot:string;sortOrder:number;openedAt:Date;deliveryStatus:string}>>(Prisma.sql`
    SELECT p.id AS "promptId",choice."choiceToken",choice.payload,choice."labelSnapshot",choice."sortOrder",p."openedAt",outbox.status::text AS "deliveryStatus"
    FROM "BotPrompt" p JOIN "BotPromptChoice" choice ON choice."promptId"=p.id
    JOIN "BotOutbox" outbox ON outbox.id=p."outboxMessageId" AND outbox."businessId"=${input.businessId} AND outbox."sessionId"=p."sessionId"
    WHERE p."sessionId"=${input.sessionId} AND p."stateRevision"=${input.revision} AND p.status='OPEN'
      AND choice."actionType"='conversation.choice'
    ORDER BY choice."sortOrder" FOR UPDATE OF p
  `)
  const numeric=/^[0-9]+$/.test(input.text.trim())
  if(!rows.length)return input.providerPayload||numeric?{kind:'reject'}:{kind:'message'}
  if(rows.some(row=>input.occurredAt.getTime()<row.openedAt.getTime()))return {kind:'reject'}
  const supplied=input.providerPayload
  const normalized=input.text.trim().toLocaleLowerCase('es')
  const matches=rows.filter(row=>supplied?(row.payload as {choiceId?:unknown})?.choiceId===supplied:numeric?String(row.sortOrder+1)===input.text.trim():row.labelSnapshot.trim().toLocaleLowerCase('es')===normalized)
  if(matches.length!==1)return supplied||numeric?{kind:'reject'}:{kind:'message'}
  const row=matches[0]!
  if(!['ACCEPTED','DELIVERED','READ'].includes(row.deliveryStatus))return {kind:'reject'}
  try {
    const scope={businessId:input.businessId,conversationKey:input.sessionId,policyKey:input.policy.configurationId,policyGeneration:input.policy.generation,revision:String(input.revision),instagramActorKey:await instagramChoiceActorKeyTx(tx,input.businessId,input.sessionId,input.subject)}
    resolveConversationChoicePayload(row.payload,scope,readConversationDraft(input.state,input.policy,input.timezone))
  }catch{return {kind:'reject'}}
  const changed=await tx.$executeRaw(Prisma.sql`UPDATE "BotPrompt" SET status='RESOLVED',"resolvedAt"=clock_timestamp() WHERE id=${row.promptId} AND "sessionId"=${input.sessionId} AND "stateRevision"=${input.revision} AND status='OPEN'`)
  if(changed!==1)throw new Error('Instagram current question resolution lost')
  return {kind:'choice',payload:row.payload,promptId:row.promptId,choiceToken:row.choiceToken}
}
