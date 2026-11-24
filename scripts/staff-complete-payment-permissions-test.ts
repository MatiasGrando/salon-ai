import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveStaffPermissions, canStaffAccessRoute } from '../src/services/staff-permission-service.js'
const professional = resolveStaffPermissions({ staffProfile: 'PROFESSIONAL', permissionPreset: 'CUSTOM', canEditAppointments: false, canCompleteAppointments: true, canRecordAppointmentPayments: true } as any)
assert.equal((professional.permissions as any).canCompleteAppointments, true, 'completar independiente de editar')
assert.equal(professional.permissions.canEditAppointments, false)
assert.equal(professional.permissions.canRecordAppointmentPayments, true)
assert.equal(canStaffAccessRoute({ role: 'STAFF', businessId: 'b', professionalId: 'p', ...professional, ...professional.permissions } as any, 'PATCH', '/appointments/a/status'), true)
const schema = await readFile('prisma/schema.prisma', 'utf8')
assert.match(schema, /canCompleteAppointments\s+Boolean/)
console.log('staff completion model: OK')

process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/staff_permissions'
const [{default: Fastify}, { prisma }, {appointmentRoutes}, {cashRegisterRoutes}, {AppointmentService}] = await Promise.all([import('fastify'), import('../src/config/prisma.js'), import('../src/routes/appointment.js'), import('../src/routes/cash-register.js'), import('../src/services/appointment-service.js')])
let calls = 0
let statusCalls = 0
const db = prisma as any
const originalFind = db.appointment.findFirst
const originalStatus = AppointmentService.prototype.updateStatus
// Every dependency that could access a database is replaced. No live data is used.
db.appointment.findFirst = async ({where}: any) => where.id === 'own' ? {id: 'own',professionalId:'p',professional:{businessId:'b'}} : where.id === 'other' ? {id:'other',professionalId:'other-p',professional:{businessId:'b'}} : null
AppointmentService.prototype.updateStatus = async () => { statusCalls++; return {ok:true,appointment:{id:'own'}} as any }
const cashService = new Proxy({}, { get: () => async () => { calls++; return {serviceCorrections:[]} } })
let actor: any = {id:'u',name:'User',role:'STAFF',businessId:'b',professionalId:'p',staffProfile:'PROFESSIONAL',agendaScope:'OWN',...professional.permissions}
const app = Fastify()
app.addHook('preHandler', async request => { request.auth = {user: actor} })
await app.register(appointmentRoutes, {cashService: cashService as any})
await app.register(cashRegisterRoutes, {cashService: cashService as any,authorizeBusiness: async()=>true})
try {
  const payload = {cashSessionId:'s',lines:[{amount:1,method:'CASH'}]}
  for (const complete of [false,true]) for (const pay of [false,true]) {
    actor = {...actor,canEditAppointments:false,canCompleteAppointments:complete,canRecordAppointmentPayments:pay}
    assert.equal((await app.inject({method:'PATCH',url:'/appointments/own/status',payload:{status:'COMPLETED'}})).statusCode, complete?200:403)
    for (const combined of [false,true]) {
      const before = calls
      const response = await app.inject({method:'POST',url:'/appointments/own/payments',payload:{...payload,completeAppointment:combined}})
      assert.equal(response.statusCode, pay && (!combined || complete)?200:403)
      assert.equal(calls-before, pay && (!combined || complete)?1:0, 'denial has no payment effects')
    }
  }
  actor = {...actor,canRecordAppointmentPayments:true,canCompleteAppointments:true,canApplyDiscounts:true}
  for (const id of ['other','foreign','missing']) for (const [method,suffix,data] of [['GET','finance',undefined],['PATCH','estimated-total',{agreedAmount:1,reason:'x'}],['PATCH','adjust-total',{newAmount:1,reason:'x'}],['PATCH','discount',{discountAmount:0}],['POST','payments',payload]] as const) {
    const before = calls
    assert.equal((await app.inject({method,url:'/appointments/'+id+'/'+suffix,...(data?{payload:data}:{})})).statusCode,404, suffix+' denies inaccessible appointment')
    assert.equal(calls,before,'denial has no financial effects')
  }
  const before = calls
  assert.equal((await app.inject({method:'POST',url:'/cash-register/entries/entry/reverse',payload:{cashSessionId:'s'}})).statusCode,403)
  assert.equal(calls,before,'professional cannot reverse payments')
} finally {await app.close();db.appointment.findFirst=originalFind;AppointmentService.prototype.updateStatus=originalStatus;await prisma.$disconnect()}
console.log('staff completion/payment authorization matrix: OK')

// A reassignment after the route check must still reject inside the financial transaction.
const { CashService } = await import('../src/services/cash-service.js')
let writes = 0
let locks = 0
const tx = {
  lockBusiness: async () => ({}),
  lockAppointmentForProfessional: async () => { locks++; return false },
  lockAppointmentAccount: async () => { writes++; throw new Error('scope must be checked before account creation or mutation') }
}
const scopedService = new CashService({transaction: async (work: any) => work(tx)} as any)
const scoped = {businessId:'b',appointmentId:'own',allowedProfessionalId:'p'}
for (const work of [
  () => scopedService.setEstimatedAppointmentTotal({...scoped,agreedAmount:1}),
  () => scopedService.adjustAppointmentTotal({...scoped,newAmount:1,reason:'x',actorUserId:'u',actorName:'User'}),
  () => scopedService.setAppointmentDiscount({...scoped,discountAmount:0}),
  () => scopedService.recordAppointmentPayment({...scoped,cashSessionId:'s',origin:'AGENDA',lines:[{amount:1,method:'CASH'}]})
]) await assert.rejects(work, (error: any) => error.code === 'APPOINTMENT_ACCOUNT_NOT_FOUND')
assert.equal(locks,4)
assert.equal(writes,0,'concurrent reassignment leaves no accounting effects')
console.log('transactional professional scope: OK')

const ui = await readFile('src/routes/crm-ui.ts','utf8')
for (const id of ['staff-can-complete-appointments','staff-can-record-appointment-payments']) {
  const label = ui.slice(ui.lastIndexOf('<label',ui.indexOf('id="'+id+'"')),ui.indexOf('</label>',ui.indexOf('id="'+id+'"')))
  assert.doesNotMatch(label,/data-staff-permission-scope/, 'both permissions visible to professionals')
}
assert.match(ui,/canCompleteAppointments: els.staffCanCompleteAppointments/)
assert.match(ui,/for \(const \[key, field\] of Object.entries\(staffPermissionFields\(\)\)\) field.checked = user\[key\] === true/)
const { PGlite } = await import('@electric-sql/pglite')
const memory = new PGlite()
try {
  await memory.exec(`CREATE TABLE "User" (id text, "canEditAppointments" boolean NOT NULL, "canRecordAppointmentPayments" boolean NOT NULL); INSERT INTO "User" VALUES ('editor',true,false),('readonly',false,true)`)
  await memory.exec(await readFile('prisma/migrations/20261123190000_staff_completion_permission/migration.sql','utf8'))
  assert.deepEqual((await memory.query('SELECT * FROM "User" ORDER BY id')).rows,[{id:'editor',canEditAppointments:true,canRecordAppointmentPayments:false,canCompleteAppointments:true},{id:'readonly',canEditAppointments:false,canRecordAppointmentPayments:true,canCompleteAppointments:false}])
} finally {await memory.close()}
console.log('staff permission UI and migration: OK')
