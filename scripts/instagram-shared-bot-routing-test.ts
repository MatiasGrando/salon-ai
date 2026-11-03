
import assert from 'node:assert/strict'
import Fastify from 'fastify'
process.env.DOTENV_CONFIG_PATH='__instagram_routing_no_env__'
process.env.DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline'
const {businessBotRoutingRoutes}=await import('../src/routes/business-bot-routing.js')
const calls:Array<Record<string,unknown>>=[]
const service={state:async(value:Record<string,unknown>)=>{calls.push(value);return {channel:value.channel??'WHATSAPP'}},prepare:async(value:Record<string,unknown>)=>{calls.push(value);return {id:'same-published-config'}},preflight:async(value:Record<string,unknown>)=>{calls.push(value);return {kind:'CLEAN',handle:{channel:'INSTAGRAM',businessId:'biz',deploymentId:'ig-deployment',generation:0,fenceEpoch:1,pausedAt:new Date()}}},commit:async(value:Record<string,unknown>)=>{calls.push(value);return {kind:'SWITCHED'}},abort:async(value:Record<string,unknown>)=>{calls.push(value)}}
const app=Fastify();let user={id:'admin',role:'BUSINESS_ADMIN',businessId:'biz'}
app.addHook('onRequest',async request=>{Object.assign(request,{auth:{user}})})
await app.register(businessBotRoutingRoutes,{service:service as never})
try{
  const state=await app.inject({method:'GET',url:'/crm/bot-routing?businessId=biz&channel=INSTAGRAM'})
  assert.equal(state.statusCode,200);assert.equal(state.json().channel,'INSTAGRAM','the existing authenticated routing flow must select IG explicitly instead of changing WA')
  assert.equal((await app.inject({method:'GET',url:'/crm/bot-routing?businessId=biz&channel=WHATSAPP'})).statusCode,200)
  assert.equal((await app.inject({method:'GET',url:'/crm/bot-routing?businessId=biz&channel=TIKTOK'})).statusCode,400)
  const preflight=await app.inject({method:'POST',url:'/crm/bot-routing/preflight',payload:{businessId:'biz',channel:'INSTAGRAM',expectedGeneration:0,target:'same-published-config'}})
  assert.equal(preflight.statusCode,200);assert.equal(calls.at(-1)?.channel,'INSTAGRAM')
  const wrong=await app.inject({method:'POST',url:'/crm/bot-routing/commit',payload:{businessId:'biz',channel:'WHATSAPP',target:'same-published-config',confirmation:'CONFIRM_ROUTING_CHANGE',handle:preflight.json().handle}})
  assert.equal(wrong.statusCode,400,'a pause handle cannot be replayed against another channel')
  user={id:'staff',role:'STAFF',businessId:'biz'}
  assert.equal((await app.inject({method:'GET',url:'/crm/bot-routing?businessId=biz&channel=INSTAGRAM'})).statusCode,403)
  console.log('IG routing uses existing authenticated routes and binds channel/handle/roles: PASS')
}finally{await app.close()}
