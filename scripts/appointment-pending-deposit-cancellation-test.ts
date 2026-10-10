import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual adapter method using the same AST instrumentation as the
// existing Barber lifecycle tests. No Prisma client, environment or DB access.
const source = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('appointment-service.ts', source, ts.ScriptTarget.Latest, true)
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppointmentService') as ts.ClassDeclaration
const method = service.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'cancel')!
assert.ok(method, 'the existing agenda cancellation method must remain the adapter')
const code = ts.transpileModule('class Adapter {\n' + ts.createPrinter().printNode(ts.EmitHint.Unspecified, method, ast) + '\n}', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

class PendingDepositCancellationError extends Error {
  constructor(public code: string) { super(code) }
}
const admin = { id:'real-admin',role:'BUSINESS_ADMIN',businessId:'business',canCancelAppointments:true,agendaScope:'ALL' }
const allStaff = { ...admin,id:'real-staff',role:'STAFF' }
const ownStaff = { ...allStaff,agendaScope:'OWN',professionalId:'p1' }
const notFound = () => ({ok:false,statusCode:404,message:'No encuentro ese turno'})
const forbidden = () => ({ok:false,statusCode:403,message:'Sin permiso'})
const conflict = () => ({ok:false,statusCode:409,message:'El turno cambió'})
const checks: Array<[string, () => Promise<void>]> = []
const check = (name:string, run:()=>Promise<void>) => checks.push([name,run])

function fixture(input: { sealed?:boolean; status?:string; group?:boolean; missing?:boolean; blocked?:boolean; selectedCompanion?:boolean; staleOuterGroup?:boolean; lostFinalRead?:boolean } = {}) {
  const appointment = { id:input.selectedCompanion?'companion':'appointment',professionalId:input.selectedCompanion?'p2':'p1',professional:{businessId:'business'},
    status:'PENDING',origin:'BOT',coordinationGroupId:input.group?'exact-group':null,serviceItems:[] }
  const companion = {...appointment,id:input.selectedCompanion?'appointment':'companion',professionalId:input.selectedCompanion?'p1':'p2'}
  const deposit = input.status ? { id:'deposit',businessId:'business',appointmentId:'appointment',status:input.status,
    snapshotSealedAt:input.sealed?new Date('2030-01-01'):null } : null
  const state = { appointment,companion,deposit,legacyWrites:0,commonWrites:0,inside:false,businessLocked:false,loaded:null as unknown,cancelled:null as unknown }
  const db:any = {
    appointment: {
      findUnique:async()=>input.missing?null:state.appointment,
      findFirst:async()=>input.missing||(input.lostFinalRead&&state.commonWrites>0)?null:input.staleOuterGroup&&!state.inside?{...state.appointment,coordinationGroupId:null}:state.appointment,
      update:async({data}:{data:any})=>{state.legacyWrites++;Object.assign(state.appointment,data);return state.appointment}
    },
    bookingDeposit: {
      findFirst:async(args:any)=>{
        assert.equal(state.businessLocked,true,'sealed-deposit selection must follow the business agenda lock')
        assert.equal(args.where.businessId,'business','sealed probe must remain tenant scoped')
        if(input.selectedCompanion) assert.ok(JSON.stringify(args.where).includes('exact-group'),'a zero-deposit companion must probe its complete group')
        return args?.where?.snapshotSealedAt?.not===null && !state.deposit?.snapshotSealedAt ? null : state.deposit
      },
      findUnique:async()=>state.deposit,
      findMany:async()=>state.deposit?[state.deposit]:[],
      updateMany:async()=>{
        state.legacyWrites++
        if(state.deposit?.snapshotSealedAt && ['PENDING_PROOF','PROOF_RECEIVED'].includes(state.deposit.status)) {
          throw new Error('sealed F8 BookingDeposit terms are immutable')
        }
        return {count:0}
      }
    },
    $transaction:async(callback:(tx:any)=>Promise<unknown>)=>{
      const before = structuredClone({appointment:state.appointment,companion:state.companion,deposit:state.deposit})
      state.inside=true
      try {return await callback(db)} catch(error) {Object.assign(state,before);throw error} finally {state.inside=false}
    }
  }
  const dependencies = {
    prisma:db,
    authorizedAppointmentWhere:(_user:unknown,id:string)=>({id}),
    scopedAppointmentMutationWhere:(_user:unknown,id:string)=>({id}),
    staffCanUseProfessional:(user:any,id:string)=>user.role!=='STAFF'||user.agendaScope==='ALL'||user.professionalId===id,
    loadAuthorizedAppointment:async()=>state.appointment,
    acquireBusinessAgendaLock:async()=>{state.businessLocked=true},
    acquireAgendaHierarchy:async()=>undefined,
    lockAppointmentRows:async()=>undefined,
    appointmentNotFound:notFound,appointmentForbidden:forbidden,appointmentConflict:conflict,
    reopenConversationOpportunityForInvalidatedAppointment:async()=>false,
    PendingDepositCancellationError,
    loadPendingDepositCancellationTx:async(tx:any,args:any)=>{
      assert.equal(tx,db);assert.equal(state.inside,true,'common loader must run in the adapter transaction')
      state.loaded=args
      if(!args.actor?.user?.id) throw new PendingDepositCancellationError('OWNERSHIP')
      if(input.blocked) throw new PendingDepositCancellationError('UNCERTAIN')
      if(state.deposit?.status!=='PENDING_PROOF') throw new PendingDepositCancellationError('NOT_ELIGIBLE')
      if(args.actor.user.role==='STAFF'&&args.actor.user.agendaScope==='OWN'&&input.group) throw new PendingDepositCancellationError('OWNERSHIP')
      return {businessId:'business',fingerprint:'a'.repeat(64),appointmentIds:input.group?['appointment','companion']:['appointment'],depositIds:['deposit']}
    },
    cancelPendingDepositInTransaction:async(tx:any,args:any)=>{
      assert.equal(tx,db);assert.equal(state.inside,true,'common writer must run in the same transaction')
      assert.equal(args.confirmed,true,'agenda DELETE carries an explicit authorized cancellation')
      assert.equal(args.actor.kind,'STAFF');assert.ok(args.actor.user.id)
      assert.equal(args.operationKey,`pending-deposit-cancel:staff:${args.actor.user.id}:${args.snapshot.fingerprint}`)
      state.cancelled=args;state.commonWrites++
      state.appointment.status='CANCELLED'
      if(input.group) state.companion.status='CANCELLED'
      if(state.deposit) state.deposit.status='REJECTED'
      return {outcome:'CANCELLED',appointmentIds:args.snapshot.appointmentIds,depositIds:['deposit'],replayed:false}
    },
    console,Date
  }
  const Adapter = new Function(...Object.keys(dependencies),code+'\nreturn Adapter')(...Object.values(dependencies))
  return {state,adapter:new Adapter()}
}

for (const actor of [admin,allStaff]) check('sealed pending uses real '+actor.role+' actor and cancels the complete order',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',group:true})
  const result=await adapter.cancel('appointment',actor)
  assert.equal(result.ok,true)
  assert.equal(state.commonWrites,1)
  assert.equal(state.legacyWrites,0,'sealed financial state must never use the old unaudited mutation')
  assert.equal((state.loaded as any).actor.user,actor,'pass the actual route actor, not a fabricated reviewer')
  assert.equal(state.companion.status,'CANCELLED','a selected member cannot leave its companion reserved')
})
check('a selected zero-deposit companion delegates cancellation of the complete financial group',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',group:true,selectedCompanion:true})
  assert.equal((await adapter.cancel('companion',admin)).ok,true)
  assert.equal((state.loaded as any).appointmentId,'companion')
  assert.equal(state.commonWrites,1);assert.equal(state.legacyWrites,0)
  assert.equal(state.companion.status,'CANCELLED')
})
check('group membership is read again under the business lock before choosing a legacy path',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',group:true,selectedCompanion:true,staleOuterGroup:true})
  assert.equal((await adapter.cancel('companion',admin)).ok,true)
  assert.equal(state.commonWrites,1);assert.equal(state.legacyWrites,0)
})
check('a missing final appointment rolls back every member instead of committing and returning 409',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',group:true,lostFinalRead:true})
  assert.equal((await adapter.cancel('appointment',admin)).statusCode,409)
  assert.equal(state.appointment.status,'PENDING')
  assert.equal(state.companion.status,'PENDING')
  assert.equal(state.deposit?.status,'PENDING_PROOF')
})
check('protected resubmission returns the common NOT_ELIGIBLE 409 without mutation',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_RESUBMISSION'})
  const result=await adapter.cancel('appointment',admin)
  assert.equal(result.ok,false);assert.equal(result.statusCode,409)
  assert.equal(state.commonWrites+state.legacyWrites,0)
  assert.equal(state.deposit?.status,'PENDING_RESUBMISSION')
})
check('STAFF OWN cannot cancel another professional through a group member',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',group:true})
  assert.equal((await adapter.cancel('appointment',ownStaff)).statusCode,403)
  assert.equal(state.legacyWrites+state.commonWrites,0)
  assert.equal(state.companion.status,'PENDING')
})
check('missing actor cannot cancel sealed pending state',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF'})
  const result=await adapter.cancel('appointment')
  assert.equal(result.ok,false);assert.ok([403,409].includes(result.statusCode))
  assert.equal(state.legacyWrites+state.commonWrites,0)
})
for (const status of ['PROOF_RECEIVED','APPROVED']) check(status+' yields a clear 409 without review or refund',async()=>{
  const {state,adapter}=fixture({sealed:true,status})
  const result=await adapter.cancel('appointment',admin)
  assert.equal(result.ok,false);assert.equal(result.statusCode,409)
  assert.equal(state.legacyWrites+state.commonWrites,0)
  assert.equal(state.deposit?.status,status)
})
check('uncertain or processing proof is a 409 and cannot mutate',async()=>{
  const {state,adapter}=fixture({sealed:true,status:'PENDING_PROOF',blocked:true})
  assert.equal((await adapter.cancel('appointment',admin)).statusCode,409)
  assert.equal(state.legacyWrites+state.commonWrites,0)
})
for (const deposit of [false,true]) check('normal '+(deposit?'unsealed':'no-deposit')+' cancellation remains available',async()=>{
  const {state,adapter}=fixture(deposit?{status:'PENDING_PROOF'}:{})
  assert.equal((await adapter.cancel('appointment',admin)).ok,true)
  assert.equal(state.appointment.status,'CANCELLED');assert.equal(state.commonWrites,0)
})
check('missing appointment remains 404',async()=>{
  assert.equal((await fixture({missing:true}).adapter.cancel('appointment',admin)).statusCode,404)
})
check('adapter imports the shared financial operation instead of implementing another payment writer',async()=>{
  assert.ok(/import[\s\S]*loadPendingDepositCancellationTx[\s\S]*cancelPendingDepositInTransaction[\s\S]*from '\.\/pending-deposit-cancellation\.js'/.test(source), 'shared cancellation writer import is required')
})
let failures=0
for(const [name,run] of checks) {
  try {await run();console.log('PASS '+name)} catch(error) {failures++;console.error('FAIL '+name,error)}
}
console.log(`Agenda pending-deposit adapter: ${checks.length-failures} passed, ${failures} failed`)
assert.equal(failures,0)
