
import {randomUUID} from 'node:crypto'
import {Prisma,type PrismaClient} from '../generated/prisma/client.js'
import {resolveInstagramBotConfig} from '../config/instagram-bot.js'
import {resolveConversationPolicy} from '../conversational-bot/runtime-policy.js'
import type {DispatchPauseHandle,ActivationPreflightSnapshot} from '../bot-options/infrastructure/prisma-activation.js'
type Client=Pick<PrismaClient,'$queryRaw'|'$transaction'>
type Configuration={id:string;businessId:string;name:string;version:string;status:string;mode:string;routingMode:string;definition:Prisma.JsonValue}
function published(configuration:Configuration){
  if(configuration.status!=='ACTIVE'||configuration.mode!=='OPTIONS_ONLY'||configuration.routingMode!=='EXCLUSIVE')return false
  try{return !!resolveConversationPolicy({businessId:configuration.businessId,customerCode:'',deploymentId:'validation',generation:1,configurationId:configuration.id,configurationBusinessId:configuration.businessId,configurationStatus:configuration.status,engineKey:'deterministic-options',definition:configuration.definition,channel:'INSTAGRAM'})}catch{return false}
}
const summary=(row:Configuration)=>({id:row.id,name:row.name,version:row.version,variant:'conversational' as const})
export class PrismaInstagramBotRouting {
  constructor(private readonly client:Client,private readonly env:Record<string,string|undefined>=process.env){}
  private async preparation(businessId:string){
    const rows=await this.client.$queryRaw<Array<{instagramAccountId:string;accessToken:string|null;appSecret:string|null;enabled:boolean;timezone:string|null}>>(Prisma.sql`SELECT config."instagramAccountId",config."accessToken",config."appSecret",config.enabled,settings.timezone FROM "BusinessInstagramConfig" config LEFT JOIN "BusinessBotOptionsSettings" settings ON settings."businessId"=config."businessId" WHERE config."businessId"=${businessId}`)
    const row=rows[0],rollout=resolveInstagramBotConfig(this.env)
    const enabled=rollout.enabled&&rollout.businessIds.includes(businessId)
    const hasAppSecret=!!(row?.appSecret||this.env.INSTAGRAM_APP_SECRET||this.env.META_APP_SECRET)
    const conversationalAiReady=this.env.CONVERSATIONAL_INSTAGRAM_AI_ENABLED==='true'&&!!this.env.OPENAI_API_KEY?.trim()
    const instagramReady=!!(row?.enabled&&row.instagramAccountId&&row.accessToken)
    return {hasAppSecret,hasTimezone:!!row?.timezone,timezone:row?.timezone??null,conversationalAiReady,instagramReady,rolloutReady:enabled,ready:hasAppSecret&&instagramReady&&enabled&&conversationalAiReady&&!!row?.timezone}
  }
  async state(input:{businessId:string}){
    const [pointers,configurations,audits,preparation]=await Promise.all([
      this.client.$queryRaw<Array<{id:string;activeConfigurationId:string|null;generation:number;claimsPausedAt:Date|null;engineKey:string}>>(Prisma.sql`SELECT id,"activeConfigurationId",generation,"claimsPausedAt","engineKey" FROM "BotChannelDeployment" WHERE "businessId"=${input.businessId} AND channel='INSTAGRAM'`),
      this.client.$queryRaw<Configuration[]>(Prisma.sql`SELECT id,"businessId",name,version,status,mode,"routingMode",definition FROM "BusinessBotConfiguration" WHERE "businessId"=${input.businessId} AND status='ACTIVE' AND "routingMode"='EXCLUSIVE' ORDER BY name,version,id`),
      this.client.$queryRaw<Array<Record<string,unknown>>>(Prisma.sql`SELECT id,action,generation,"actorUserId",detail,"createdAt" FROM "BotDeploymentAudit" WHERE "businessId"=${input.businessId} AND detail->>'channel'='INSTAGRAM' ORDER BY "createdAt" DESC LIMIT 20`),
      this.preparation(input.businessId)
    ])
    const pointer=pointers[0],available=configurations.filter(published)
    return {businessId:input.businessId,channel:'INSTAGRAM' as const,deploymentId:pointer?.id??null,engineKey:pointer?.engineKey??'legacy-instagram',activeConfigurationId:pointer?.activeConfigurationId??null,activeVariant:available.some(c=>c.id===pointer?.activeConfigurationId)?'conversational':null,generation:pointer?.generation??0,paused:!!pointer?.claimsPausedAt,configurations:available.map(summary),preparation,audits}
  }
  async prepare(input:{businessId:string;timezone:string;actorId:string}){
    const state=await this.state(input)
    if(!state.preparation.ready)throw new Error('Completá la conexión, clave de la app, IA y habilitación de Instagram antes de asignar el bot.')
    if(input.timezone!==state.preparation.timezone)throw new Error('Instagram usa la zona horaria actual del comercio; actualizala desde la configuración general.')
    const whatsapp=await this.client.$queryRaw<Array<{activeConfigurationId:string|null}>>(Prisma.sql`SELECT "activeConfigurationId" FROM "BotChannelDeployment" WHERE "businessId"=${input.businessId} AND channel='WHATSAPP'`)
    const configuration=state.configurations.find(c=>c.id===whatsapp[0]?.activeConfigurationId)??state.configurations.find(c=>c.id===state.activeConfigurationId)??state.configurations[0]
    if(!configuration)throw new Error('Prepará y publicá primero una versión del Nuevo bot para este comercio. Instagram reutiliza esa misma versión.')
    return configuration
  }
  private async target(tx:Prisma.TransactionClient,businessId:string,target:string){
    const rows=await tx.$queryRaw<Configuration[]>(Prisma.sql`SELECT id,"businessId",name,version,status,mode,"routingMode",definition FROM "BusinessBotConfiguration" WHERE id=${target} AND "businessId"=${businessId} FOR SHARE`)
    if(rows.length!==1||!published(rows[0]!))throw new Error('Instagram requiere una versión publicada del Nuevo bot en este comercio.')
  }
  private async snapshot(tx:Prisma.TransactionClient,businessId:string,deploymentId:string):Promise<ActivationPreflightSnapshot>{
    const select=async(query:Prisma.Sql)=>tx.$queryRaw<Array<{id:string;status:string}>>(query)
    const [drafts,inbox,jobs,outbox,holds,deposits,handoffs,unknown,legacyProtected]=await Promise.all([
      select(Prisma.sql`SELECT id,status::text FROM "BotSession" WHERE "businessId"=${businessId} AND "deploymentId"=${deploymentId} AND status='ACTIVE'`),
      select(Prisma.sql`SELECT id,status::text FROM "BotActionInbox" WHERE "businessId"=${businessId} AND "deploymentId"=${deploymentId} AND status IN ('ADMITTED','CLAIMED','SELECTED','CONFLICT')`),
      select(Prisma.sql`SELECT id,status::text FROM "BotJob" WHERE "businessId"=${businessId} AND "deploymentId"=${deploymentId} AND status IN ('READY','RETRY','LEASED','POISON')`),
      select(Prisma.sql`SELECT o.id,o.status::text FROM "BotOutbox" o JOIN "BotSession" s ON s.id=o."sessionId" AND s."businessId"=o."businessId" WHERE s."businessId"=${businessId} AND s."deploymentId"=${deploymentId} AND o.status IN ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN','POISON')`),
      select(Prisma.sql`SELECT v.id,v.status::text FROM "BookingVisit" v JOIN "BotSession" s ON s.id=v."sessionId" AND s."businessId"=v."businessId" WHERE s."businessId"=${businessId} AND s."deploymentId"=${deploymentId} AND v.status IN ('HELD','PENDING_PAYMENT_REVIEW')`),
      select(Prisma.sql`SELECT d.id,d.status::text FROM "BookingDeposit" d JOIN "BookingVisit" v ON v.id=d."visitId" AND v."businessId"=d."businessId" JOIN "BotSession" s ON s.id=v."sessionId" AND s."businessId"=v."businessId" WHERE s."businessId"=${businessId} AND s."deploymentId"=${deploymentId} AND d.status IN ('PENDING_PROOF','PENDING_RESUBMISSION','PROOF_RECEIVED')`),
      select(Prisma.sql`SELECT h.id,h.status::text FROM "BotHandoff" h JOIN "BotSession" s ON s.id=h."sessionId" AND s."businessId"=h."businessId" WHERE s."businessId"=${businessId} AND s."deploymentId"=${deploymentId} AND h.status IN ('QUEUED','TAKEN')`),
      select(Prisma.sql`SELECT id,status::text FROM "BotDispatchClaim" WHERE "businessId"=${businessId} AND channel='INSTAGRAM' AND (status IN ('SENDING','UNKNOWN') OR status='CLAIMED' AND "claimedUntil">clock_timestamp())`),
      select(Prisma.sql`SELECT message.id,message.status FROM "InstagramMessage" message JOIN "InstagramLead" lead ON lead.id=message."leadId" WHERE lead."businessId"=${businessId} AND message.direction='OUTBOUND' AND message.status IN ('pending','queued','sending','unknown')`)
    ])
    const entries={drafts,legacyDrafts:[],legacyProtected,inbox,jobs,outbox,holds,deposits,handoffs,unknown}
    return {...entries,counts:Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,BigInt(value.length)])) as ActivationPreflightSnapshot['counts']}
  }
  private blocked(snapshot:ActivationPreflightSnapshot){return Object.entries(snapshot.counts).some(([key,count])=>key!=='drafts'&&count>0n)}
  async preflight(input:{businessId:string;expectedGeneration:number;target:string;actorId:string}){
    if(!(await this.preparation(input.businessId)).ready)throw new Error('Instagram todavía no está listo para activar el bot.')
    return this.client.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'bot-cutover:'+input.businessId+':INSTAGRAM'},0))`)
      await this.target(tx,input.businessId,input.target)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" (id,"businessId",channel,"engineKey",generation,"dispatchFenceEpoch","legacyDispatchCoverageVersion","updatedAt") VALUES (${randomUUID()},${input.businessId},'INSTAGRAM','legacy-instagram',0,0,1,clock_timestamp()) ON CONFLICT ("businessId",channel) DO NOTHING`)
      const rows=await tx.$queryRaw<Array<{id:string;generation:number;dispatchFenceEpoch:number;claimsPausedAt:Date}>>(Prisma.sql`UPDATE "BotChannelDeployment" SET "dispatchFenceEpoch"="dispatchFenceEpoch"+1,"claimsPausedAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE "businessId"=${input.businessId} AND channel='INSTAGRAM' AND generation=${input.expectedGeneration} AND "claimsPausedAt" IS NULL RETURNING id,generation,"dispatchFenceEpoch","claimsPausedAt"`)
      if(rows.length!==1)throw new Error('La generación cambió o ya existe un cambio pausado en Instagram.')
      const row=rows[0]!,handle:DispatchPauseHandle={channel:'INSTAGRAM',businessId:input.businessId,deploymentId:row.id,generation:row.generation,fenceEpoch:row.dispatchFenceEpoch,pausedAt:row.claimsPausedAt}
      const snapshot=await this.snapshot(tx,input.businessId,row.id)
      await this.audit(tx,input.businessId,input.actorId,'DISPATCH_PAUSED',row.generation,{channel:'INSTAGRAM',deploymentId:row.id,fenceEpoch:row.dispatchFenceEpoch})
      return this.blocked(snapshot)?{kind:'BLOCKED' as const,handle,snapshot,reason:snapshot.unknown.some(r=>r.status==='UNKNOWN')?'UNKNOWN' as const:'PROTECTED_STATE' as const}:{kind:'CLEAN' as const,handle,snapshot}
    })
  }
  async commit(input:{businessId:string;target:string;handle:DispatchPauseHandle;actorId:string}){
    if(input.handle.channel!=='INSTAGRAM'||input.handle.businessId!==input.businessId)throw new Error('El control de pausa pertenece a otro canal o comercio.')
    if(!(await this.preparation(input.businessId)).ready)throw new Error('Instagram dejó de cumplir los requisitos de activación.')
    return this.client.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'bot-cutover:'+input.businessId+':INSTAGRAM'},0))`)
      await this.target(tx,input.businessId,input.target)
      const rows=await tx.$queryRaw<Array<{activeConfigurationId:string|null}>>(Prisma.sql`SELECT "activeConfigurationId" FROM "BotChannelDeployment" WHERE id=${input.handle.deploymentId} AND "businessId"=${input.businessId} AND channel='INSTAGRAM' AND generation=${input.handle.generation} AND "dispatchFenceEpoch"=${input.handle.fenceEpoch} AND "claimsPausedAt"=${input.handle.pausedAt} FOR UPDATE`)
      if(rows.length!==1)throw new Error('La pausa de Instagram venció o cambió.')
      if(this.blocked(await this.snapshot(tx,input.businessId,input.handle.deploymentId)))throw new Error('El estado protegido cambió; no se modificó la asignación.')
      await tx.$executeRaw(Prisma.sql`UPDATE "BotPrompt" p SET status='INVALIDATED',"resolvedAt"=clock_timestamp() FROM "BotSession" s WHERE s.id=p."sessionId" AND s."businessId"=${input.businessId} AND s."deploymentId"=${input.handle.deploymentId} AND s.channel='INSTAGRAM' AND p.status IN ('OPEN','STABILIZING')`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET status='CLOSED',"updatedAt"=clock_timestamp() WHERE "businessId"=${input.businessId} AND "deploymentId"=${input.handle.deploymentId} AND channel='INSTAGRAM' AND status='ACTIVE'`)
      const changed=await tx.$queryRaw<Array<{generation:number}>>(Prisma.sql`UPDATE "BotChannelDeployment" SET "previousConfigurationId"="activeConfigurationId","activeConfigurationId"=${input.target},"engineKey"='deterministic-options',generation=generation+1,"activatedAt"=clock_timestamp(),"activatedByUserId"=${input.actorId},"claimsPausedAt"=NULL,"legacyDispatchCoverageVersion"=1,"updatedAt"=clock_timestamp() WHERE id=${input.handle.deploymentId} AND "businessId"=${input.businessId} AND channel='INSTAGRAM' AND generation=${input.handle.generation} AND "dispatchFenceEpoch"=${input.handle.fenceEpoch} AND "claimsPausedAt"=${input.handle.pausedAt} RETURNING generation`)
      if(changed.length!==1)throw new Error('Se perdió el control de pausa de Instagram.')
      await this.audit(tx,input.businessId,input.actorId,'ACTIVATE',changed[0]!.generation,{channel:'INSTAGRAM',deploymentId:input.handle.deploymentId,configurationId:input.target,previousConfigurationId:rows[0]!.activeConfigurationId})
      return {kind:'SWITCHED' as const,deploymentId:input.handle.deploymentId,generation:changed[0]!.generation,engineKey:'deterministic-options' as const,activeConfigurationId:input.target,previousConfigurationId:rows[0]!.activeConfigurationId}
    })
  }
  async abort(input:{businessId:string;handle:DispatchPauseHandle;actorId:string}){
    if(input.handle.channel!=='INSTAGRAM'||input.handle.businessId!==input.businessId)throw new Error('El control de pausa pertenece a otro canal o comercio.')
    return this.client.$transaction(async tx=>{
      const changed=await tx.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "claimsPausedAt"=NULL,"updatedAt"=clock_timestamp() WHERE id=${input.handle.deploymentId} AND "businessId"=${input.businessId} AND channel='INSTAGRAM' AND generation=${input.handle.generation} AND "dispatchFenceEpoch"=${input.handle.fenceEpoch} AND "claimsPausedAt"=${input.handle.pausedAt}`)
      if(changed!==1)throw new Error('La pausa de Instagram venció o cambió.')
      await this.audit(tx,input.businessId,input.actorId,'DISPATCH_RESUMED',input.handle.generation,{channel:'INSTAGRAM',deploymentId:input.handle.deploymentId})
    })
  }
  private async audit(tx:Prisma.TransactionClient,businessId:string,actorId:string,action:string,generation:number,detail:object){
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotDeploymentAudit" (id,"businessId",action,generation,"actorUserId",detail) VALUES (${randomUUID()},${businessId},${action},${generation},${actorId},${JSON.stringify(detail)}::jsonb)`)
  }
}
