
import {Prisma,type PrismaClient} from '../generated/prisma/client.js'
type Client=Pick<PrismaClient,'$transaction'>
export async function setInstagramConversationAi(input:{client:Client;businessId:string;leadId:string;actorUserId:string;aiEnabled:boolean}) {
  if(!input.actorUserId||!input.businessId||!input.leadId||typeof input.aiEnabled!=='boolean')throw new Error('invalid Instagram human authority')
  return input.client.$transaction(async tx=>{
    const rows=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "InstagramLead" WHERE id=${input.leadId} AND "businessId"=${input.businessId} FOR UPDATE`)
    if(rows.length!==1)throw new Error('Instagram conversation unavailable in this business')
    const handoffs=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT h.id FROM "BotHandoff" h JOIN "BotSession" s ON s.id=h."sessionId" AND s."businessId"=h."businessId" WHERE s."businessId"=${input.businessId} AND s.channel='INSTAGRAM' AND s."instagramLeadId"=${input.leadId} AND h.status IN ('QUEUED','TAKEN') LIMIT 1`)
    if(handoffs.length)throw new Error('La derivación requiere tomar o resolver desde sus acciones explícitas.')
    const count=await tx.$executeRaw(Prisma.sql`UPDATE "InstagramLead" SET "aiEnabled"=${input.aiEnabled},"botPausedAt"=${input.aiEnabled?null:Prisma.sql`clock_timestamp()`},"botPausedByUserId"=${input.aiEnabled?null:input.actorUserId},"updatedAt"=clock_timestamp() WHERE id=${input.leadId} AND "businessId"=${input.businessId}`)
    if(count!==1)throw new Error('Instagram human authority changed')
    return {aiEnabled:input.aiEnabled}
  })
}
