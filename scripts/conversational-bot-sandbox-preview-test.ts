import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
const client:any={user:{findUnique:async()=>({id:'admin',role:'BUSINESS_ADMIN',isActive:true})},business:{findFirst:async()=>({id:'qa',isDemo:true,demoType:'QA_SANDBOX'})},conversation:{findUnique:async()=>{throw new Error('scope must reject before loading')}}}
await assert.rejects(()=>runPrismaDemoPreview(client,'qa','admin','chat','hola',async()=>{throw new Error('must not compute')},undefined,undefined,{sandboxBooking:true}),/simulator booking scope rejected/)
console.log('sandbox preview authority store: OK')

const { bookingProfessionalIds } = await import('../src/conversational-bot/coordinated-booking.js')
assert.deepEqual(bookingProfessionalIds({ professionalId: 'cin' }), ['cin'], 'singular lock scope is unchanged')
const assignments = [
  {serviceId:'cut',serviceName:'Corte',professionalId:'ramiro',professionalName:'Ramiro',startAt:'2026-10-03T20:00:00.000Z',endAt:'2026-10-03T20:30:00.000Z',durationMinutes:30,customerDurationMinutes:30},
  {serviceId:'cream',serviceName:'Crema',professionalId:'cin',professionalName:'Cin',startAt:'2026-10-03T20:30:00.000Z',endAt:'2026-10-03T21:00:00.000Z',durationMinutes:30,customerDurationMinutes:30}
]
assert.deepEqual(bookingProfessionalIds({ professionalId: 'ramiro', coordination: {key:'unused-for-lock-projection',segments:assignments} }), ['cin','ramiro'], 'caller locks the complete sorted assignment, not just its anchor')
console.log('coordinated preview lock projection: PASS (pure projection, not agenda authority)')
