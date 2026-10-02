import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
const client:any={user:{findUnique:async()=>({id:'admin',role:'BUSINESS_ADMIN',isActive:true})},business:{findFirst:async()=>({id:'qa',isDemo:true,demoType:'QA_SANDBOX'})},conversation:{findUnique:async()=>{throw new Error('scope must reject before loading')}}}
await assert.rejects(()=>runPrismaDemoPreview(client,'qa','admin','chat','hola',async()=>{throw new Error('must not compute')},undefined,undefined,{sandboxBooking:true}),/simulator booking scope rejected/)
console.log('sandbox preview authority store: OK')
