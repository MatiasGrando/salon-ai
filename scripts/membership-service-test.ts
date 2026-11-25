import assert from 'node:assert/strict'
import { CustomerBenefitsService, reserveBenefit } from '../src/services/customer-benefits.js'
import type { PrismaClient, Prisma } from '../src/generated/prisma/client.js'

let catalogPrice=40000, plan:any, purchase:any, income:any, cashOpen=true
let cashWrites=0, useWrites=0, discounts:number[]=[]
let appointment:any={id:'a',businessId:'b',customerId:'c',status:'CONFIRMED',startAt:new Date('2027-01-20T15:00:00Z'),serviceId:'cut',service:{price:40000},serviceItems:[{serviceId:'cut',price:40000}],benefitUse:null,bookingDeposit:null,manualDepositPaid:false}
const uses:any[]=[]
const account={id:'account',businessId:'b',pricingMode:'FIXED',agreedAmount:40000,originalAmount:40000,minimumAmount:0,discountAmount:0}
const tx:any={
  $queryRaw:async (sql:Prisma.Sql)=>sql.text.includes('pg_advisory')?[]:sql.text.includes('"CashSession"')?(cashOpen?[{id:'session',registerDayId:'day'}]:[]):sql.text.includes('"AppointmentAccount"')?[account]:[],
  service:{findMany:async({where}:any)=>where.businessId==='b'&&where.id.in.every((id:string)=>id==='cut')?[{id:'cut',name:'Corte',price:catalogPrice,priceMode:'FIXED'}]:[]},
  benefitPlan:{findFirst:async()=>plan,create:async({data}:any)=>(plan={id:'plata',...data}),update:async({data}:any)=>(plan={...plan,...data})},
  business:{findUniqueOrThrow:async()=>({timezone:'America/Argentina/Buenos_Aires'})},
  customer:{findFirst:async({where}:any)=>where.businessId==='b'&&where.id==='c'?{id:'c'}:null},
  customerBenefit:{findUnique:async()=>purchase,findFirst:async()=>null,create:async({data}:any)=>(purchase={id:'paid',...data,uses}),findMany:async({where}:any)=>purchase&&where.businessId==='b'&&where.customerId==='c'&&where.startsOn.lte>=purchase.startsOn&&where.endsOn.gte<=purchase.endsOn?[{...purchase,uses}]:[]},
  businessPaymentMethod:{findFirst:async()=>({id:'cash',kind:'CASH'})},
  cashExpenseCategory:{upsert:async()=>({id:'membership-category',isActive:true})},
  cashEntry:{create:async({data}:any)=>{cashWrites++;return income={id:'income',...data}},count:async()=>0},
  appointment:{findFirst:async({where}:any)=>where.businessId==='b'&&where.customerId==='c'?appointment:null},
  appointmentAccountLink:{findMany:async()=>[{appointment:{customerId:'c',coordinationGroupId:null}}]},productSale:{findFirst:async()=>null},
  appointmentAccount:{update:async({data}:any)=>{discounts.push(data.discountAmount);return {...account,...data}}},
  benefitUse:{findMany:async()=>[],create:async({data}:any)=>{useWrites++;uses.push({...data,state:'RESERVED'});appointment.benefitUse=data;return data}}
}
const db={...tx,$transaction:async(work:any)=>work(tx)} as PrismaClient
const service=new CustomerBenefitsService(db)
await service.savePlan('b',{name:'Plata',kind:'MEMBERSHIP',serviceRules:[{serviceId:'cut',uses:3,pricingMode:'FIXED',fixedPrice:10000}],price:34999,validityDays:30,cancellationHours:24,consumeLateCancellation:false,consumeNoShow:false} as any)
catalogPrice=90000
const request={businessId:'b',customerId:'c',planId:'plata',startsOn:'2027-01-01',cashSessionId:'session',paymentMethodId:'cash',requestKey:'purchase-1234'}
await service.purchase(request)
assert.equal(purchase.endsOn,'2027-01-30')
assert.equal(purchase.serviceRules[0].unitPrice,10000,'la compra conserva la base de comision por corte')
assert.equal(purchase.price,34999)
assert.equal(income.amount,34999,'Caja registra el precio de venta aunque la base total sea $30.000')
assert.equal(income.expenseCategoryId,'membership-category','los ingresos de Caja requieren una categoria valida')
await service.purchase(request)
assert.equal(cashWrites,1,'el replay de compra no cobra dos veces')
await assert.rejects(()=>service.purchase({...request,startsOn:'2027-02-01'}),{code:'REQUEST_CONFLICT'})
const applied=await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'a'})
assert.equal(applied!.coveredAmount,40000,'bonifica el precio habitual completo, no solo el valor interno')
assert.equal(applied!.commissionBase,10000)
assert.deepEqual(discounts,[40000])
assert.equal(cashWrites,1,'la reserva no genera otro ingreso')
await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'a'})
assert.equal(useWrites,1,'reaplicar el mismo beneficio no duplica usos')
appointment={...appointment,id:'outside',startAt:new Date('2027-01-31T15:00:00Z'),benefitUse:null}
assert.equal(await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'outside',optional:true}),null,'fuera de vigencia permite continuar a precio normal')
appointment={...appointment,id:'second',startAt:new Date('2027-01-30T15:00:00Z'),benefitUse:null}
await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'second'})
appointment={...appointment,id:'third',benefitUse:null}
await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'third'})
appointment={...appointment,id:'fourth',benefitUse:null}
assert.equal(await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'fourth',optional:true}),null,'cupo agotado no bloquea la reserva habitual')
await assert.rejects(()=>reserveBenefit(tx,{businessId:'other',customerId:'c',appointmentId:'fourth'}),{code:'APPOINTMENT_NOT_FOUND'})
purchase.serviceIds=[...purchase.serviceIds,'color']
purchase.serviceRules=[...purchase.serviceRules,{serviceId:'color',name:'Coloracion',uses:1,unitPrice:50000}]
appointment={...appointment,id:'shared-color',serviceId:'color',service:{price:60000},serviceItems:[{serviceId:'color',price:60000}],quotedPrice:60000,coordinationGroupId:'group'}
account.agreedAmount=100000;account.discountAmount=40000
tx.appointmentAccountLink.findMany=async()=>[{appointment:{customerId:'c',coordinationGroupId:'group'}},{appointment:{customerId:'c',coordinationGroupId:'group'}}]
tx.benefitUse.findMany=async()=>[{coveredAmount:40000}]
const shared=await reserveBenefit(tx,{businessId:'b',customerId:'c',appointmentId:'shared-color'})
assert.equal(shared!.originalPrice,60000,'en una visita coordinada conserva el precio de su propio servicio')
assert.equal(shared!.commissionBase,50000)
assert.equal(discounts.at(-1),100000,'la cobertura compartida acumula los servicios incluidos sin pisar el anterior')
purchase=undefined; cashOpen=false
await assert.rejects(()=>service.purchase({...request,requestKey:'price-changed',expectedPrice:80000}),{code:'PLAN_PRICE_CHANGED'})
await assert.rejects(()=>service.purchase({...request,requestKey:'new-purchase'}),{code:'CASH_CLOSED'})
assert.equal(cashWrites,1)
console.log('OK compra y reserva: precio conservado, cobro unico, idempotencia, cobertura total, cupos y tenant.')
