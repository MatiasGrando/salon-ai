import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite, type Transaction } from '@electric-sql/pglite'
process.env.DOTENV_CONFIG_PATH='__instagram_runtime_no_env__'
process.env.DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline'
const { Prisma }=await import('../src/generated/prisma/client.js')
const { PrismaInstagramBotAdmission }=await import('../src/services/instagram-bot-admission.js')
const { PrismaInstagramBotRouting }=await import('../src/services/instagram-bot-routing.js')
const { instagramBotWorkerScope }=await import('../src/config/instagram-bot.js')
const { claimBotJob }=await import('../src/bot-options/infrastructure/postgres-worker.js')
const { InstagramOutboxProvider }=await import('../src/bot-options/infrastructure/instagram-outbox-provider.js')
const { InstagramApi }=await import('../src/integrations/instagram-api.js')
const { setInstagramConversationAi }=await import('../src/services/instagram-inbox-actions.js')
const { takeConversationForManualAttention,resolveBotHandoff }=await import('../src/bot-options/application/handoff-operations.js')
const { planPersistedView,persistView }=await import('../src/bot-options/application/process-session-job.js')
const { textView }=await import('../src/bot-options/domain/views.js')
const { claimOutbox,sendClaimedOutbox }=await import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js')
const { processSessionJob }=await import('../src/bot-options/application/process-session-job.js')
const db=new PGlite(),schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8')
const models=['Business','BusinessFeatureSettings','BusinessBotOptionsSettings','BusinessInstagramConfig','InstagramLead','InstagramMessage','Customer','CustomerChannelIdentity','Conversation','Message','BotProviderEvent','BotChannelDeployment','BusinessBotConfiguration','BotSession','BotActionInbox','BotJob','BotOutbox','BotPrompt','BotPromptChoice','BotDispatchClaim','BotTransitionLog','BotOperation','BotHandoff','BotHandoffAudit','BotDeploymentAudit','BookingVisit','BookingDeposit','Appointment','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','AppointmentServiceItem','AppointmentChangeHistory','BookingDepositLine','BookingDepositProof','BusinessPaymentSettings','ServiceCombinationRule']
const enums=[...schema.matchAll(/enum (\w+) \{([\s\S]*?)\n\}/g)]
for(const [,name,body] of enums){const values=body!.split('\n').flatMap(line=>line.match(/@map\("([^"]+)"\)/)?.[1]??line.trim().match(/^([A-Za-z_][A-Za-z_0-9]*)(?:\s|$)/)?.[1]??[]);await db.exec('CREATE TYPE "'+name+'" AS ENUM ('+values.map(v=>"'"+v+"'").join(',')+')')}
for(const name of models){
  const body=schema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
  const columns=body.split('\n').flatMap(line=>{
    const m=line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/);if(!m||/\[\]/.test(line))return []
    const scalar=({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision'} as Record<string,string>)[m[2]!]
    const type=scalar??(enums.some(e=>e[1]===m[2])?'"'+m[2]+'"':null);if(!type)return []
    const defaultValue=line.match(/@default\(("[^"]*"|true|false|[0-9]+|[A-Z_]+)\)/)?.[1]
    const defaultSql=defaultValue?defaultValue.startsWith('"')?"'"+defaultValue.slice(1,-1).replaceAll("'","''")+"'":/^[A-Z_]+$/.test(defaultValue)?"'"+defaultValue+"'":defaultValue:['createdAt','updatedAt','admittedAt'].includes(m[1]!)?'clock_timestamp()':null
    const columnName=line.match(/@map\("([^"]+)"\)/)?.[1]??m[1]
    return ['"'+columnName+'" '+type+(m[1]==='id'||name==='BusinessBotOptionsSettings'&&m[1]==='businessId'?' PRIMARY KEY':'')+(defaultSql?' DEFAULT '+defaultSql:'')]
  });await db.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
}
await db.exec('CREATE UNIQUE INDEX deployment_channel ON "BotChannelDeployment" ("businessId",channel);CREATE UNIQUE INDEX lead_identity ON "InstagramLead" ("businessId","instagramUserId"); CREATE UNIQUE INDEX event_identity ON "BotProviderEvent" (provider,"eventKey"); CREATE UNIQUE INDEX ig_message ON "InstagramMessage" ("providerMessageId"); CREATE UNIQUE INDEX job_identity ON "BotJob" (kind,"aggregateId"); CREATE UNIQUE INDEX operation_identity ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX handoff_audit_key ON "BotHandoffAudit" ("handoffId","operationKey",action); CREATE UNIQUE INDEX outbox_identity ON "BotOutbox" ("idempotencyKey")')
await db.exec('CREATE FUNCTION pg_advisory_xact_lock_shared(bigint) RETURNS void LANGUAGE sql AS '+"'SELECT NULL::void'"+'; CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE sql AS '+"'SELECT NULL::void'")
const definition={schemaVersion:1,engineKey:'deterministic-options',conversation:{schemaVersion:1,engine:'conversational-booking-v1'},serviceContent:{version:1,businessId:'biz',services:[]}}
await db.query('INSERT INTO "Business" (id,name,"accountStatus","botEnabled",timezone) VALUES ($1,$2,$3,true,$4)',['biz','Salon','ACTIVE','UTC'])
await db.query('INSERT INTO "BusinessInstagramConfig" (id,"businessId","instagramAccountId",enabled,"accessToken") VALUES ($1,$2,$3,true,$4)',['ig-config','biz','account','offline-token'])
await db.query('INSERT INTO "BusinessBotOptionsSettings" ("businessId",timezone) VALUES ($1,$2)',['biz','UTC'])
await db.query('INSERT INTO "BusinessBotConfiguration" (id,"businessId",status,definition) VALUES ($1,$2,$3,$4)',['cfg','biz','ACTIVE',JSON.stringify(definition)])
await db.query('INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion","engineKey") VALUES ($1,$2,$3,0,0,$4,1,$5)',['dep','biz','INSTAGRAM',null,'legacy-instagram'])
await db.query('INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion","engineKey") VALUES ($1,$2,$3,1,1,$4,1,$5)',['wa-dep','biz','WHATSAPP','cfg','deterministic-options'])
await db.query('INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration","availableAt","createdAt") VALUES ($1,$2,$3,$4,$5,1,clock_timestamp()-interval \'1 day\',clock_timestamp()-interval \'1 day\')',['wa-off-job','PROCESS_INBOX','wa-inbox','biz','wa-dep'])
const instagramScope=instagramBotWorkerScope({enabled:true,businessIds:['biz']})
assert.deepEqual(instagramScope,{businessIds:['biz'],channels:['INSTAGRAM']})
assert.equal(instagramBotWorkerScope({enabled:false,businessIds:['biz']}),undefined)
assert.equal(instagramBotWorkerScope({enabled:true,businessIds:['biz']},{businessId:'biz',mode:'exclude'}),undefined)
const statements:string[]=[]
function bridge(pg:Pick<PGlite,'query'>){
  const query=async(q:InstanceType<typeof Prisma.Sql>|{text:string;values:unknown[]})=>{
    statements.push(q.text)
    const result=await pg.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v!==null&&typeof v==='object'?JSON.stringify(v):v))
    for(const field of result.fields??[])if(field.dataTypeID===20)for(const row of result.rows as Record<string,unknown>[])if(row[field.name]!==null&&row[field.name]!==undefined)row[field.name]=BigInt(String(row[field.name]))
    return result
  }
  const select=async(table:string,where:Record<string,unknown>)=>{
    const values:unknown[]=[]
    const argument=(value:unknown)=>{values.push(value instanceof Date?value.toISOString():value);return '$'+values.length}
    const expression=(criteria:Record<string,unknown>):string=>Object.entries(criteria).map(([key,value])=>{
      if(key==='OR'||key==='AND')return '('+(value as Record<string,unknown>[]).map(expression).join(' '+key+' ')+')'
      const column='"'+key+'"'
      if(value===null)return column+' IS NULL'
      if(value&&typeof value==='object'&&!(value instanceof Date))return '('+Object.entries(value).map(([op,expected])=>{
        if(op==='in')return column+' IN ('+(expected as unknown[]).map(argument).join(',')+')'
        const operator=({lt:'<',gt:'>',lte:'<=',gte:'>=',equals:'='} as Record<string,string>)[op];if(!operator)throw Error('Unsupported test where operator '+op)
        return column+operator+argument(expected)
      }).join(' AND ')+')'
      return column+'='+argument(value)
    }).join(' AND ')
    return (await pg.query('SELECT * FROM "'+table+'" WHERE '+expression(where),values)).rows as Record<string,unknown>[]
  }
  const delegates:Record<string,unknown>={}
  for(const [name,table] of Object.entries({business:'Business',professional:'Professional',service:'Service',professionalService:'ProfessionalService',businessHours:'BusinessHours',professionalHours:'ProfessionalHours',instagramLead:'InstagramLead',customer:'Customer',customerChannelIdentity:'CustomerChannelIdentity',scheduleBlock:'ScheduleBlock'}))delegates[name]={
    findMany:async({where}:{where:Record<string,unknown>})=>select(table,where),findFirst:async({where,include}:{where:Record<string,unknown>;include?:{customer?:boolean}})=>{const row=(await select(table,where))[0]??null;return row&&include?.customer?{...row,customer:(await select('Customer',{id:row.customerId}))[0]??null}:row},count:async({where}:{where:Record<string,unknown>})=>(await select(table,where)).length,
    create:async({data}:{data:Record<string,unknown>})=>{const record={id:crypto.randomUUID(),...data},keys=Object.keys(record);return (await pg.query('INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(record))).rows[0]}
  }
  return {...delegates,$queryRaw:async(q:Parameters<typeof query>[0])=>(await query(q)).rows,$executeRaw:async(q:Parameters<typeof query>[0])=>(await query(q)).affectedRows??0}
}
const client={...bridge(db),$transaction:async<T>(operation:(tx:unknown)=>Promise<T>)=>db.transaction(tx=>operation(bridge(tx)))}
await db.query('UPDATE "BusinessInstagramConfig" SET "appSecret"=$1',['offline-secret'])
await db.query('UPDATE "BusinessBotConfiguration" SET mode=$1,"routingMode"=$2,version=$3,name=$4,"phoneNumberId"=$5',['OPTIONS_ONLY','EXCLUSIVE','v1','Bot publicado','wa-phone'])
const routing=new PrismaInstagramBotRouting(client as never,{INSTAGRAM_CONVERSATIONAL_BOT_ENABLED:'true',INSTAGRAM_CONVERSATIONAL_BOT_BUSINESS_IDS:'biz',CONVERSATIONAL_INSTAGRAM_AI_ENABLED:'true',OPENAI_API_KEY:'offline-no-call'})
const beforeCfg=(await db.query('SELECT * FROM "BusinessBotConfiguration"')).rows
const beforeWa=(await db.query('SELECT * FROM "BotChannelDeployment" WHERE channel=$1',['WHATSAPP'])).rows
assert.equal((await routing.prepare({businessId:'biz',timezone:'UTC',actorId:'admin'})).id,'cfg','IG selects the exact version already published for WA')
const check=await routing.preflight({businessId:'biz',expectedGeneration:0,target:'cfg',actorId:'admin'})
assert.equal(check.kind,'CLEAN','unrelated WA jobs do not enter the IG preflight')
await assert.rejects(routing.commit({businessId:'biz',target:'cfg',actorId:'admin',handle:{...check.handle,channel:undefined} as never}),/canal/)
const assigned=await routing.commit({businessId:'biz',target:'cfg',actorId:'admin',handle:check.handle})
assert.equal(assigned.activeConfigurationId,'cfg')
assert.deepEqual((await db.query('SELECT * FROM "BusinessBotConfiguration"')).rows,beforeCfg,'assignment never rewrites, clones or archives the shared published configuration')
assert.deepEqual((await db.query('SELECT * FROM "BotChannelDeployment" WHERE channel=$1',['WHATSAPP'])).rows,beforeWa,'IG generation/fences never change WhatsApp')
console.log('IG assignment/preflight/commit same immutable WA-published version: PASS')
const admission=new PrismaInstagramBotAdmission(client as never,{enabled:true,businessIds:['biz']},true)
const now=(await db.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0]!.now
try{
  await db.query('INSERT INTO "InstagramLead" (id,"businessId","instagramUserId","referralCode","aiEnabled") VALUES ($1,$2,$3,$4,true)',['lead-pre-session','biz','new-user','pre-ref'])
  await setInstagramConversationAi({client:client as never,businessId:'biz',leadId:'lead-pre-session',actorUserId:'human-operator',aiEnabled:false})
  const pausedBefore=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:'new-user',messageId:'pre-session-mid',text:'hola',timestamp:Date.now(),instagramAccountIds:['account']} as never})
  assert.equal(pausedBefore.route==='new'&&pausedBefore.status,'paused','manual authority works before a BotSession exists')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "BotSession" WHERE "instagramLeadId"=$1',['lead-pre-session'])).rows[0]!.n,0)
  await setInstagramConversationAi({client:client as never,businessId:'biz',leadId:'lead-pre-session',actorUserId:'human-operator',aiEnabled:true})
  const delayed=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:'delayed-user',messageId:'delayed-mid',text:'si confirmar reserva',timestamp:Date.now(),instagramAccountIds:['account']} as never})
  const delayedSession=(await db.query<{id:string;instagramLeadId:string}>('SELECT * FROM "BotSession" WHERE "instagramLeadId"=$1',[delayed.route==='new'?delayed.leadId:''])).rows[0]
  await db.query("UPDATE \"BotProviderEvent\" SET \"providerOccurredAt\"=clock_timestamp()-interval '25 hours' WHERE \"providerMessageId\"=$1",['delayed-mid'])
  const delayedJob=await claimBotJob(client as never,30000,undefined,instagramScope)
  assert.ok(delayedJob)
  await processSessionJob({client:client as never,job:delayedJob!,dialogueFactory:async()=>({context:{businessId:'biz',timezone:'UTC',dbNow:new Date(now)},port:{catalog:async()=>[{id:'cut',name:'Corte',durationMinutes:30,requiresConsultation:false,price:1000}],availability:async()=>({professionals:[],slots:[]})}})})
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "BotOutbox"')).rows[0]!.n,0,'A job delayed beyond the signed window must not produce effects or replies')
  assert.deepEqual((await db.query('SELECT * FROM "BotSession" WHERE id=$1',[delayedSession!.id])).rows[0],delayedSession,'Delayed processing cannot renew or reopen the draft')
  const admitted=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:'5491112345678',messageId:'mid-first',text:'Que servicios tienen',timestamp:new Date(now).getTime(),instagramAccountIds:['account']} as never})
  assert.equal(admitted.route,'new')
  const job=await claimBotJob(client as never,30000,undefined,instagramScope)
  assert.equal(job?.channel,'INSTAGRAM')
  assert.equal((await db.query<{status:string}>('SELECT status FROM "BotJob" WHERE id=$1',['wa-off-job'])).rows[0]!.status,'READY','IG ON never consumes an earlier WA job while WA is OFF')
  assert.ok(job,'IG-only consumer must claim its admitted job while WhatsApp workers are disabled')
  const result=await processSessionJob({client:client as never,job:job!,dialogueFactory:async()=>({context:{businessId:'biz',timezone:'UTC',dbNow:new Date(now)},port:{catalog:async()=>[{id:'cut',name:'Corte',durationMinutes:30,requiresConsultation:false,price:1000}],availability:async()=>({professionals:[],slots:[]})}})})
  assert.equal(result,'PROCESSED')
  const outbox=(await db.query<{payload:Record<string,unknown>}>('SELECT payload FROM "BotOutbox"')).rows
  assert.ok(outbox.length,'shared core must persist an Instagram reply')
  assert.equal(outbox[0]!.payload.channel,'INSTAGRAM')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "Conversation"')).rows[0]!.n,0,'IG never invents a WA conversation')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "Message"')).rows[0]!.n,0,'IG projection stays in InstagramMessage')
  const subject=(outbox[0]!.payload.subject) as {channel:'INSTAGRAM';instagramLeadId:string;instagramAccountId:string;externalUserId:string}
  const rendered=planPersistedView({view:textView('Texto para Instagram. '.repeat(160)),transitionId:'long-ig',toPhone:subject.externalUserId,subject,promptToken:'',idFactory:()=>crypto.randomUUID()} as never)
  assert.ok(rendered.outboxRows.length>1,'IG replies use existing safe short message limit')
  assert.ok(rendered.outboxRows.every(row=>row.item.type==='informative_text'&&row.item.body.length<=900),'IG never receives WhatsApp lists or oversized bodies')
  assert.ok(rendered.outboxRows.slice(1).every((row,index)=>row.dependsOnSequence===index),'every IG part depends on acceptance of the previous part')
  let sends=0
  const pending=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(pending)
  const delivery=await sendClaimedOutbox({client:client as never,item:pending!,provider:new InstagramOutboxProvider({client:client as never,api:new InstagramApi(async(url,init)=>{sends++;assert.ok(String(url).includes('/account/messages'));assert.equal(JSON.parse(String(init?.body)).recipient.id,subject.externalUserId);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer offline-token');return new Response(JSON.stringify({message_id:'outbound-mid',recipient_id:subject.externalUserId}),{status:200})})})})
  assert.equal(delivery,'ACCEPTED','Instagram delivery uses its own channel dispatch fence')
  assert.equal(sends,1)
  const projected=(await db.query<{direction:string;body:string;status:string;providerMessageId:string}>('SELECT direction,body,status,"providerMessageId" FROM "InstagramMessage" WHERE direction=$1',['OUTBOUND'])).rows
  assert.equal(projected.length,1,'accepted IG reply is projected in InstagramMessage in the same final transaction')
  assert.equal(projected[0]!.providerMessageId,'outbound-mid')
  const session=(await db.query<{id:string;revision:string}>('SELECT id,revision::text FROM "BotSession" WHERE channel=$1 AND "instagramLeadId"=$2',['INSTAGRAM',subject.instagramLeadId])).rows[0]!
  const persist=async(text:string,transitionId:string)=>client.$transaction(tx=>persistView(tx as never,{businessId:'biz',sessionId:session.id,revision:BigInt(session.revision),transitionId,toPhone:subject.externalUserId,subject,view:textView(text),dbNow:new Date(now)}))
  await persist('Mensaje largo y ordenado. '.repeat(120),'ordered-ig')
  const first=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(first)
  assert.equal(await sendClaimedOutbox({client:client as never,item:first!,provider:{send:async()=>({kind:'accepted',providerMessageId:'ordered-first'})}}),'ACCEPTED')
  const second=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(second,'second part waits for acceptance of the first')
  let ambiguousPosts=0
  assert.equal(await sendClaimedOutbox({client:client as never,item:second!,provider:{send:async()=>{ambiguousPosts++;throw Error('network_after_post')}}}),'UNKNOWN')
  assert.equal(await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']}),null,'unknown part is never automatically resent and blocks following parts')
  assert.equal(ambiguousPosts,1)
  await db.query('UPDATE "BotProviderEvent" SET "providerOccurredAt"=clock_timestamp()-interval \'25 hours\',"admittedAt"=clock_timestamp()')
  const replay=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:subject.externalUserId,messageId:'mid-first',text:'replay',timestamp:new Date(now).getTime(),instagramAccountIds:['account']} as never})
  assert.equal(replay.route==='new'&&replay.status,'duplicate')
  await persist('Mensaje vencido','expired-window')
  const expired=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(expired)
  let forbiddenPosts=0
  assert.equal(await sendClaimedOutbox({client:client as never,item:expired!,provider:{send:async()=>{forbiddenPosts++;return {kind:'accepted',providerMessageId:'forbidden'}}}}),'STALE')
  assert.equal(forbiddenPosts,0,'arrival time and replay cannot extend the signed user event window')
  await db.exec('UPDATE "BotProviderEvent" SET "providerOccurredAt"=clock_timestamp()')
  await db.query('UPDATE "InstagramLead" SET "aiEnabled"=false,"botPausedByUserId"=$1',['human-operator'])
  await persist('Mensaje durante atención humana','paused-human')
  const paused=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(paused)
  assert.equal(await sendClaimedOutbox({client:client as never,item:paused!,provider:{send:async()=>{forbiddenPosts++;return {kind:'accepted',providerMessageId:'forbidden'}}}}),'STALE')
  assert.equal(forbiddenPosts,0,'human pause is rechecked immediately before a POST')
  await db.query('UPDATE "BotOutbox" SET status=$1 WHERE status=$2',['SKIPPED','UNKNOWN'])
  await db.query('UPDATE "BotDispatchClaim" SET status=$1 WHERE status=$2',['DONE','UNKNOWN'])
  const humanTarget={client:client as never,businessId:'biz',instagramLeadId:subject.instagramLeadId,actorUserId:'human-operator',operationKey:'ig-human-take',drainMs:0}
  const taken=await takeConversationForManualAttention(humanTarget as never)
  assert.equal(taken.kind,'TAKEN','CRM can take an IG session using the same durable handoff lifecycle')
  assert.equal((await db.query<{status:string}>('SELECT status FROM "BotSession" WHERE id=$1',[session.id])).rows[0]!.status,'HUMAN_TAKEN')
  const afterTake=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:subject.externalUserId,messageId:'mid-human-paused',text:'otro mensaje',timestamp:Date.now(),instagramAccountIds:['account']} as never})
  assert.equal(afterTake.route==='new'&&afterTake.status,'paused','human authority persists across another admitted webhook')
  await assert.rejects(resolveBotHandoff({...humanTarget,actorUserId:'another-operator',operationKey:'foreign-resolve',resolution:'HOME'} as never),/owner/)
  const resolved=await resolveBotHandoff({...humanTarget,operationKey:'ig-human-resolve',resolution:'HOME'} as never)
  assert.equal(resolved.status,'RESOLVED')
  const lead=(await db.query<{aiEnabled:boolean;botPausedAt:Date|null}>('SELECT "aiEnabled","botPausedAt" FROM "InstagramLead" WHERE id=$1',[subject.instagramLeadId])).rows[0]!
  assert.equal(lead.aiEnabled,true);assert.equal(lead.botPausedAt,null)
  assert.equal((await resolveBotHandoff({...humanTarget,operationKey:'ig-human-resolve',resolution:'HOME'} as never)).status,'RESOLVED','operator resolution replay is stable')
  await db.exec(`INSERT INTO "ServiceCategory" (id,"businessId","isActive") VALUES ('category','biz',true);
INSERT INTO "Service" (id,"businessId","catalogCategoryId",name,duration,price,"priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode") VALUES ('cut','biz','category','Corte',30,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE'),('color','biz','category','Color',60,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE');
INSERT INTO "Professional" (id,"businessId",name,"isActive","acceptsBotBookings","botBookingPriority") VALUES ('pro','biz','Elisa',true,true,0);
INSERT INTO "ProfessionalService" (id,"professionalId","serviceId") VALUES ('ps','pro','cut');`)
  for(let day=0;day<7;day++){await db.query('INSERT INTO "BusinessHours" (id,"businessId","dayOfWeek","startTime","endTime") VALUES ($1,$2,$3,$4,$5)',['bh'+day,'biz',day,'09:00','20:00']);await db.query('INSERT INTO "ProfessionalHours" (id,"professionalId","dayOfWeek","startTime","endTime") VALUES ($1,$2,$3,$4,$5)',['ph'+day,'pro',day,'09:00','20:00'])}
  await db.query('UPDATE "BusinessBotOptionsSettings" SET "bookingHorizonDays"=30,"bookingLeadTimeHours"=0')
  const {createPrismaDialoguePort}=await import('../src/conversational-bot/prisma-dialogue-port.js')
  const {prepareGroupRescheduleOffers}=await import('../src/conversational-bot/prisma-appointment-management.js')
  const actualRead=await createPrismaDialoguePort(bridge(db) as never,'biz')
  const slotsFor=(date:string)=>[10,11].map(hour=>({professionalId:'pro',professionalName:'Elisa',date,band:'MORNING' as const,time:String(hour)+':00',startAt:date+'T'+hour+':00:00.000Z',occupiedMinutes:30}))
  let turnNumber=0
  const turn=async(text:string)=>{
    for(let i=0;i<30;i++) {const send=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']});if(!send)break;assert.equal(await sendClaimedOutbox({client:client as never,item:send,provider:{send:async()=>({kind:'accepted',providerMessageId:'multi-out-'+crypto.randomUUID()})}}),'ACCEPTED')}
    const messageId='multi-'+(++turnNumber)
    await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:subject.externalUserId,messageId,text,timestamp:Date.now(),instagramAccountIds:['account']} as never})
    const next=await claimBotJob(client as never,30000,undefined,instagramScope);assert.ok(next)
    await processSessionJob({client:client as never,job:next!,dialogueFactory:async()=>({context:{businessId:'biz',timezone:'UTC',dbNow:new Date()},port:{prepareRuntimeBooking:actualRead.port.prepareRuntimeBooking,managementRescheduleOffers:(snapshot:any,date:string)=>prepareGroupRescheduleOffers(snapshot,date,async(member:any)=>slotsFor(date).map(slot=>({date,startAt:slot.startAt,professionalId:slot.professionalId,serviceIds:member.serviceIds,durationMinutes:member.durationMinutes,customerDurationMinutes:member.customerDurationMinutes??member.durationMinutes}))),catalog:async()=>[{id:'cut',name:'Corte',durationMinutes:30,requiresConsultation:false,price:1000},{id:'color',name:'Color',durationMinutes:60,requiresConsultation:false,price:2000}],availability:async(_service:any,date:string)=>({professionals:[{id:'pro',name:'Elisa',priority:0}],slots:slotsFor(date)}),availabilityBasket:async(services:any,date:string)=>({ok:true as const,services,durationMinutes:30,customerDurationMinutes:30,totalPrice:1000,professionals:[{id:'pro',name:'Elisa',priority:0}],slots:slotsFor(date)})}})})
    return (await db.query<{payload:any}>('SELECT payload FROM "BotOutbox" WHERE "sessionId"=$1 ORDER BY "createdAt",sequence',[session.id])).rows
  }
  const choicesOut=await turn('quiero reservar')
  const openPrompt=(await db.query<{id:string}>('SELECT * FROM "BotPrompt" WHERE "sessionId"=$1 AND status=$2',[session.id,'OPEN'])).rows[0]
  assert.ok(openPrompt,'Actual IG conversation presents a stored current question')
  assert.ok(choicesOut.every(row=>row.payload.channel==='INSTAGRAM'&&row.payload.item.type==='informative_text'),'Every actual choice turn uses the IG text fallback, never WA lists')
  for(let i=0;i<30;i++){const send=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']});if(!send)break;await sendClaimedOutbox({client:client as never,item:send,provider:{send:async()=>({kind:'accepted',providerMessageId:'choices-out-'+crypto.randomUUID()})}})}
  const currentChoice=(await db.query<{payload:{choiceId:string}}>('SELECT payload FROM "BotPromptChoice" WHERE "promptId"=$1 ORDER BY "sortOrder"',[openPrompt.id])).rows[0]!.payload.choiceId
  const beforeChoice=(await db.query('SELECT * FROM "BotSession" WHERE id=$1',[session.id])).rows[0]
  for(const choicePayload of ['foreign-opaque-payload',currentChoice]) {
    const rejected=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:subject.externalUserId,messageId:'bad-choice-'+choicePayload,text:'1',choicePayload,timestamp:Date.now(),instagramAccountIds:['account']} as never})
    assert.equal(rejected.route==='new'&&rejected.status,'rejected_choice','Provider payloads never fall through to text/number operations; IG only emitted plain text')
    assert.deepEqual((await db.query('SELECT * FROM "BotSession" WHERE id=$1',[session.id])).rows[0],beforeChoice)
  }
  const older=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:subject.externalUserId,messageId:'older-choice',text:'1',timestamp:Date.now()-10000,instagramAccountIds:['account']} as never})
  assert.equal(older.route==='new'&&older.status,'rejected_choice','A reply predating the current question cannot authorize its operation')
  await turn('1')
  assert.equal((await db.query<{actionType:string}>('SELECT "actionType" FROM "BotActionInbox" WHERE "providerMessageId"=$1',['multi-2'])).rows[0]!.actionType,'conversation.choice','Number fallback must resolve the persisted current question, never generic text')
  await turn('mañana')
  await turn('cualquiera')
  await turn('1')
  await turn('Soy Ana')
  const proposed=(await db.query<{state:any}>('SELECT state FROM "BotSession" WHERE id=$1',[session.id])).rows[0]!.state.conversationDraft.dialogue
  assert.ok(proposed.bookingReservation?.presented,'Actual current shared Prisma port must issue an IG booking proposal without a WA Conversation')
  await turn('1')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,1,'Actual admitted numbered confirmation executes the shared booking primitive exactly once')
  const booked=(await db.query<{id:string;customerId:string;coordinationGroupId:string}>('SELECT * FROM "Appointment"')).rows[0]!
  const linked=(await db.query<{phone:string}>('SELECT phone FROM "Customer" WHERE id=$1',[booked.customerId])).rows[0]!
  assert.equal(linked.phone,'','No telephone is invented during the multitur booking')
  const {loadOwnConfirmedRuntimeGroupSnapshot}=await import('../src/conversational-bot/prisma-appointment-management.js')
  const live=(await db.query<{revision:string}>('SELECT revision::text FROM "BotSession" WHERE id=$1',[session.id])).rows[0]!
  await client.$transaction(async tx=>assert.equal((await loadOwnConfirmedRuntimeGroupSnapshot(tx as never,{businessId:'biz',sessionId:session.id,subject,expectedRevision:BigInt(live.revision)})).groupId,booked.coordinationGroupId,'Current IG receipt reread must retain its exact no-phone authority'))
  await turn('que turnos tengo')
  await turn('quiero reprogramar mi turno para mañana a las 11:00')
  const management=(await db.query<{state:any}>('SELECT state FROM "BotSession" WHERE id=$1',[session.id])).rows[0]!.state.conversationDraft.dialogue.appointmentManagement
  assert.ok(management?.context.proposal,'The current IG appointment must receive a freshly checked reschedule proposal')
  await turn('si confirmo')
  const moved=(await db.query<{startAt:Date;status:string}>('SELECT "startAt",status FROM "Appointment" WHERE id=$1',[booked.id])).rows[0]!
  assert.equal(moved.startAt.toISOString().slice(11,16),'11:00','Real IG messages confirm the reschedule through the current shared domain')
  assert.equal(moved.status,'CONFIRMED')
  const beforeCancellation=(await db.query('SELECT * FROM "Appointment" WHERE id=$1',[booked.id])).rows[0]
  await turn('quiero cancelar mi turno')
  assert.deepEqual((await db.query('SELECT * FROM "Appointment" WHERE id=$1',[booked.id])).rows[0],beforeCancellation,'Referral must not mutate the appointment, version, time or money')
  assert.equal((await db.query<{status:string}>('SELECT status FROM "BotSession" WHERE id=$1',[session.id])).rows[0]!.status,'HUMAN_QUEUED','Actual cancellation request goes to the same human handoff')
  const queuedReply=await claimOutbox(client as never,30000,undefined,{businessId:'biz',channels:['INSTAGRAM']})
  assert.ok(queuedReply,'Queued cancellation has a durable acknowledgement')
  assert.equal(await sendClaimedOutbox({client:client as never,item:queuedReply!,provider:{send:async()=>({kind:'accepted',providerMessageId:'cancellation-ack'})}}),'ACCEPTED','Handoff acknowledgement retains the final IG session revision')
  await takeConversationForManualAttention({...humanTarget,operationKey:'cancel-request-human-take'} as never)
  await resolveBotHandoff({...humanTarget,operationKey:'cancel-request-human-resolve',resolution:'HOME'} as never)
  const beforeRestart=(await db.query('SELECT * FROM "Appointment" ORDER BY id')).rows
  await turn('reiniciar')
  assert.deepEqual((await db.query('SELECT * FROM "Appointment" ORDER BY id')).rows,beforeRestart,'Existing restart cannot erase or mutate confirmed appointments')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "BotPrompt" WHERE "sessionId"=$1 AND status=$2',[session.id,'OPEN'])).rows[0]!.n,0,'Restart invalidates former questions and consents')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM "Conversation"')).rows[0]!.n,0)
  for(const [messageId,text] of [['order-first','quiero reservar'],['order-second','Corte']])await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:'ordered-user',messageId,text,timestamp:Date.now(),instagramAccountIds:['account']} as never})
  const firstInput=await claimBotJob(client as never,30000,undefined,instagramScope),secondInput=await claimBotJob(client as never,30000,undefined,instagramScope)
  assert.ok(firstInput&&secondInput)
  const simpleFactory=async()=>({context:{businessId:'biz',timezone:'UTC',dbNow:new Date()},port:{catalog:async()=>[{id:'cut',name:'Corte',durationMinutes:30,requiresConsultation:false,price:1000},{id:'color',name:'Color',durationMinutes:60,requiresConsultation:false,price:2000}],availability:async()=>({professionals:[],slots:[]})}})
  const orderSession=(await db.query<{id:string;instagramLeadId:string}>('SELECT * FROM "BotSession" WHERE "instagramLeadId"=(SELECT id FROM "InstagramLead" WHERE "instagramUserId"=$1)',['ordered-user'])).rows[0]!
  await processSessionJob({client:client as never,job:secondInput!,dialogueFactory:simpleFactory})
  assert.notEqual((await db.query<{status:string}>('SELECT status FROM "BotJob" WHERE id=$1',[secondInput!.id])).rows[0]!.status,'DONE','A later IG input must remain retryable behind an earlier uncommitted input')
  assert.deepEqual((await db.query('SELECT * FROM "BotSession" WHERE id=$1',[orderSession.id])).rows[0],orderSession)
  await processSessionJob({client:client as never,job:firstInput!,dialogueFactory:simpleFactory})
  await db.query('UPDATE "BotJob" SET "availableAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[secondInput!.id])
  const retriedSecond=await claimBotJob(client as never,30000,undefined,instagramScope);assert.ok(retriedSecond)
  await processSessionJob({client:client as never,job:retriedSecond!,dialogueFactory:simpleFactory})
  await db.query(`UPDATE "BotSession" SET status='HUMAN_QUEUED',state=jsonb_set(jsonb_set(state,'{handoff}','"QUEUED"'::jsonb),'{flow}','"HANDOFF_QUEUED"'::jsonb) WHERE id=$1`,[orderSession.id])
  await db.query(`UPDATE "InstagramLead" SET "aiEnabled"=false,"botPausedAt"=clock_timestamp(),"botPausedByUserId"=NULL WHERE id=$1`,[orderSession.instagramLeadId])
  await db.query(`INSERT INTO "BotHandoff" (id,"businessId","sessionId",status,context,"queuedAt","updatedAt") VALUES ('queued-for-customer','biz',$1,'QUEUED','{}'::jsonb,clock_timestamp(),clock_timestamp())`,[orderSession.id])
  const resume=await admission.admit({businessId:'biz',accountId:'account',signatureVerified:true,event:{senderId:'ordered-user',messageId:'resume-current-queue',text:'volver al bot',timestamp:Date.now(),instagramAccountIds:['account']} as never})
  assert.equal(resume.route==='new'&&resume.status,'admitted','The customer may withdraw only their current unclaimed nonfinancial queue')
  const resumeJob=await claimBotJob(client as never,30000,undefined,instagramScope);assert.ok(resumeJob)
  await processSessionJob({client:client as never,job:resumeJob!,dialogueFactory:simpleFactory})
  assert.equal((await db.query<{status:string}>('SELECT status FROM "BotSession" WHERE id=$1',[orderSession.id])).rows[0]!.status,'ACTIVE')
  assert.equal((await db.query<{aiEnabled:boolean}>('SELECT "aiEnabled" FROM "InstagramLead" WHERE id=$1',[orderSession.instagramLeadId])).rows[0]!.aiEnabled,true)
  console.log('IG actual admitted multitur → current proposal → booking → own read → reschedule → human cancellation → sender: PASS')
  console.log('IG CRM take/owner-only resolve/durable pause/replay: PASS')
  console.log('IG sender ordering/ambiguous-no-resend/signed-window/replay/human-pause: PASS')
  console.log('IG signed admission → actual consumer → shared core → IG outbox: PASS (PGlite, fake catalog, no providers; no cross-process lock claim)')
} finally {await db.close()}
