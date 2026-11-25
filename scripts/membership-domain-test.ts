import assert from 'node:assert/strict'
import { allocateMembership, hasServiceBenefit, membershipBalances, membershipEnd, priceMembership } from '../src/services/membership-domain.js'
import { calculateProfessionalCompensation } from '../src/services/professional-compensation.js'

const services = [{ id:'cut', name:'Corte', price:40000, priceMode:'FIXED' }, { id:'color', name:'Coloracion', price:60000, priceMode:'FIXED' }, { id:'combo', name:'Corte + barba', price:50000, priceMode:'FIXED' }]
const silver = priceMembership([{serviceId:'cut',uses:2,pricingMode:'FIXED',fixedPrice:25000}],services)
const gold = priceMembership([{serviceId:'cut',uses:4,pricingMode:'PERCENTAGE',discountPercent:50}],services)
assert.equal(silver.rules[0]!.unitPrice,25000)
assert.equal(gold.rules[0]!.unitPrice,20000)
for (const [plan, expected] of [[silver,12500],[gold,10000]] as const) assert.equal(calculateProfessionalCompensation({baseAmount:plan.rules[0]!.unitPrice,rule:{mode:'PERCENTAGE',percentage:50,fixedAmount:null}}),expected)
assert.equal(membershipEnd('2027-01-31',30),'2027-03-01','vigencia exacta en dias, no mes calendario')
assert.equal(membershipEnd('2028-02-28',2),'2028-02-29')
assert.equal(membershipEnd('2027-03-01',1),'2027-03-01')
const mixed = priceMembership([{serviceId:'cut',uses:4,pricingMode:'FIXED',fixedPrice:25000},{serviceId:'color',uses:1,pricingMode:'PERCENTAGE',discountPercent:20}],services)
const grant = {serviceRules:mixed.rules,serviceIds:['cut','color'],totalUses:5,uses:[] as Array<{state:string;allocations:unknown}>}
const initial = allocateMembership(grant,[{serviceId:'cut',price:40000},{serviceId:'color',price:60000},{serviceId:'combo',price:50000}])
assert.equal(initial.length,2,'el adicional no queda bonificado')
grant.uses.push({state:'RESERVED',allocations:initial})
assert.equal(hasServiceBenefit(grant,'color'),false,'un corte disponible no permite repetir la coloracion')
assert.equal(hasServiceBenefit(grant,'cut'),true)
assert.equal(hasServiceBenefit(grant,'combo'),false,'corte + barba es un servicio distinto')
grant.uses.push({state:'RELEASED',allocations:[initial[0]!]})
let balances=membershipBalances(grant.serviceRules,grant.uses,'2027-01-01','2027-01-30','2027-01-01')
assert.equal(balances[0]!.available,3,'cancelar a tiempo libera el cupo')
assert.equal(balances[1]!.available,0)
grant.uses[0]!.state='CONSUMED'
balances=membershipBalances(grant.serviceRules,grant.uses,'2027-01-01','2027-01-30','2027-01-30')
assert.equal(balances[0]!.used,1)
assert.equal(balances[0]!.available,3,'ultimo dia incluido')
assert.equal(membershipBalances(grant.serviceRules,grant.uses,'2027-01-01','2027-01-30','2027-01-31')[0]!.available,0)
assert.equal(membershipBalances(grant.serviceRules,grant.uses,'2027-01-01','2027-01-30','2026-12-31')[0]!.available,0)
assert.equal(membershipBalances(grant.serviceRules,grant.uses,'2027-01-01','2027-01-30','2027-01-15',true)[0]!.available,0)
assert.equal(priceMembership([{serviceId:'cut',uses:1,pricingMode:'FIXED',fixedPrice:0}],services).rules[0]!.unitPrice,0)
assert.throws(()=>priceMembership([{serviceId:'cut',uses:2,pricingMode:'PERCENTAGE',discountPercent:101}],services))
assert.throws(()=>priceMembership([{serviceId:'cut',uses:0,pricingMode:'FIXED',fixedPrice:25000}],services))
assert.throws(()=>priceMembership([{serviceId:'cut',uses:1,pricingMode:'FIXED',fixedPrice:25000},{serviceId:'cut',uses:1,pricingMode:'FIXED',fixedPrice:25000}],services))
assert.throws(()=>priceMembership([{serviceId:'other',uses:2,pricingMode:'FIXED',fixedPrice:25000}],services))
console.log('OK membresias: Plata/Oro, comisiones, cupos independientes, combos, adicionales y vigencia en dias.')
