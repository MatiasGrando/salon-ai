import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH='__instagram_crm_no_env__'
process.env.DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline'
const {loadChannelConversation,listChannelConversations,countChannelConversations}=await import('../src/services/conversation-channel-service.js')
const lead={id:'lead',businessId:'biz',instagramUserId:'sender',username:'cliente',displayName:'Ana',aiEnabled:false,botPausedAt:new Date(),botPausedByUserId:'human',createdAt:new Date(),updatedAt:new Date(),messages:[],botSessions:[{status:'HUMAN_TAKEN',handoffs:[{id:'handoff',status:'TAKEN',queuedAt:new Date(),resolvedAt:null}]}]}
const client={instagramLead:{findFirst:async({where}:any)=>where.id==='lead'&&where.businessId==='biz'?lead:null,findMany:async()=>[lead],count:async()=>1}}
const selected=await loadChannelConversation({businessId:'biz',id:'instagram:lead',client})
assert.equal(selected?.aiEnabled,false,'IG CRM projection must reflect the durable human authority instead of hardcoding AI on')
assert.equal(selected?.currentStep,'HUMAN_HANDOFF')
assert.equal(selected?.botHandoffStatus,'TAKEN')
assert.equal(await loadChannelConversation({businessId:'foreign',id:'instagram:lead',client}),null)
const taken=await listChannelConversations({businessId:'biz',filter:'handoff',client} as never)
assert.equal(taken.length,1,'handoff filter includes Instagram human ownership')
assert.equal(await countChannelConversations('biz',client,'handoff'),1)
console.log('IG CRM durable AI/handoff read model and tenant/filter contract: PASS')

let searchWhere:unknown
await listChannelConversations({businessId:'biz',filter:'handoff',search:'Ana',client:{...client,instagramLead:{...client.instagramLead,findMany:async({where}:any)=>{searchWhere=where;return [lead]}}}})
const actualSearch=searchWhere as {OR?:unknown;AND?:Array<{OR:unknown[]}>}
assert.ok(actualSearch.AND?.some(condition=>condition.OR.some((item:any)=>item.aiEnabled===false)),'Searching within the human filter must retain the durable human condition')
