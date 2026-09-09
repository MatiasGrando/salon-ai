import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerWorkshopJobs } from '../src/routes/workshop-jobs.js'
import { createWorkshopJobsMemoryStore } from '../src/services/workshop-jobs-memory-store.js'
const app=Fastify(), vehicle={id:'v',plate:'AB123CD',model:'Kangoo',currentMileage:80000}
let allowed='a'
await registerWorkshopJobs(app,createWorkshopJobsMemoryStore((b,id)=>b==='a'&&id==='v'?vehicle:null),async(_r,reply,id)=>{if(id!==allowed){reply.code(403).send({message:'Forbidden'});return null}return {id}})
const baseBody={businessId:'a',vehicleId:'v',date:'2026-09-07',mileage:85000,lines:[{description:'Aceite',quantity:1,parts:'',labor:''}]}
let defaults=await app.inject({method:'GET',url:'/workshop/shortcuts?businessId=a'})
assert.equal(defaults.json().length,7)
const defaultId=defaults.json()[0].id
let edited=await app.inject({method:'PATCH',url:'/workshop/shortcuts/'+defaultId,payload:{businessId:'a',name:'Aceite premium',description:'Cambio premium',quantity:1,active:false}})
assert.equal(edited.statusCode,200,edited.body)
defaults=await app.inject({method:'GET',url:'/workshop/shortcuts?businessId=a'})
assert.equal(defaults.json().length,7)
assert.equal(defaults.json().find((x:any)=>x.id===defaultId).active,false)
assert.equal(defaults.json().find((x:any)=>x.id===defaultId).name,'Aceite premium')
let r=await app.inject({method:'POST',url:'/workshop/performers',payload:{businessId:'a',name:'Ana'}});assert.equal(r.statusCode,201,r.body);const anaId=r.json().id
const body={...baseBody,performerId:anaId}
r=await app.inject({method:'POST',url:'/workshop/jobs',payload:body});assert.equal(r.statusCode,201,r.body);assert.equal(r.json().totalCents,0);assert.equal(r.json().responsible,'Ana');assert.equal(r.json().performerId,anaId);assert.equal(vehicle.currentMileage,85000)
r=await app.inject({method:'POST',url:'/workshop/jobs',payload:{...baseBody,vehicleId:'other',performerId:anaId}});assert.equal(r.statusCode,400)
r=await app.inject({method:'POST',url:'/workshop/jobs',payload:baseBody});assert.equal(r.statusCode,400)
r=await app.inject({method:'POST',url:'/workshop/jobs',payload:{...baseBody,performerId:'not-a-performer'}});assert.equal(r.statusCode,400)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&vehicleId=v&date=2026-09-07'});assert.equal(r.json().length,1)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&date=2026-09-08'});assert.equal(r.json().length,0)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&performerId='+anaId});assert.equal(r.json().length,1)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&performerId=none'});assert.equal(r.json().length,0)
r=await app.inject({method:'GET',url:'/workshop/performers?businessId=a'});assert.equal(r.json()[0].name,'Ana');assert.equal(r.json()[0].active,true)
r=await app.inject({method:'POST',url:'/workshop/performers',payload:{businessId:'a',name:'  Bruno  '}});assert.equal(r.statusCode,201,r.body);const performerId=r.json().id;assert.equal(r.json().name,'Bruno');assert.equal(r.json().active,true)
r=await app.inject({method:'PATCH',url:'/workshop/performers/'+performerId,payload:{businessId:'a',name:'Bruno Perez',active:false}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().name,'Bruno Perez');assert.equal(r.json().active,false)
r=await app.inject({method:'GET',url:'/workshop/performers?businessId=a'});assert.ok(!r.json().some((x:any)=>x.id===performerId));assert.ok(r.json().some((x:any)=>x.name==='Ana'))
r=await app.inject({method:'GET',url:'/workshop/performers?businessId=a&includeInactive=1'});assert.equal(r.json().find((x:any)=>x.id===performerId).active,false)
r=await app.inject({method:'PATCH',url:'/workshop/performers/'+performerId,payload:{businessId:'a',name:'Bruno Perez',active:true}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().active,true)
r=await app.inject({method:'POST',url:'/workshop/performers',payload:{businessId:'a',name:'bruno perez'}});assert.equal(r.statusCode,409)
for(let i=0;i<14;i++){r=await app.inject({method:'POST',url:'/workshop/jobs',payload:{...body,date:'2026-08-'+String(i+1).padStart(2,'0')}});assert.equal(r.statusCode,201,r.body)}
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&vehicleId=v&limit=10&offset=0'});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().items.length,10);assert.equal(r.json().hasMore,true);assert.equal(r.json().nextOffset,10)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&vehicleId=v&limit=10&offset=10'});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().items.length,5);assert.equal(r.json().hasMore,false);assert.equal(r.json().nextOffset,null)
r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=a&limit=10&offset=0'});assert.ok(Array.isArray(r.json()))
r=await app.inject({method:'POST',url:'/workshop/shortcuts',payload:{businessId:'a',name:'Service',description:'Aceite especial',quantity:1}});assert.equal(r.statusCode,200);const id=r.json().id
r=await app.inject({method:'PATCH',url:'/workshop/shortcuts/'+id,payload:{businessId:'a',name:'Service',description:'Actualizado',quantity:2,active:false,position:3}});assert.equal(r.json().active,false)
allowed='b';r=await app.inject({method:'GET',url:'/workshop/jobs?businessId=b'});assert.deepEqual(r.json(),[])
defaults=await app.inject({method:'GET',url:'/workshop/shortcuts?businessId=b'});assert.equal(defaults.json().length,7);assert.ok(defaults.json().every((x:any)=>x.active));assert.ok(!defaults.json().some((x:any)=>x.id===defaultId))
r=await app.inject({method:'PATCH',url:'/workshop/shortcuts/'+id,payload:{businessId:'b',name:'Intruso',description:'x'}});assert.equal(r.statusCode,400)
r=await app.inject({method:'POST',url:'/workshop/jobs',payload:body});assert.equal(r.statusCode,403)
await app.close();console.log('Workshop jobs routes: OK (history, manual amounts, responsible, shortcuts, isolation)')
