import { normalizeAssistantPersonality } from '../src/services/assistant-personality-config.js'
import type { DialoguePersonality, DialoguePersonalityPort } from '../src/conversational-bot/dialogue-identity.js'
import { canonicalJsonHash } from '../src/conversational-bot/canonical-json.js'
import { prismaHandoffEffectExecutor } from '../src/bot-options/infrastructure/prisma-handoff-effect-executor.js'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../src/generated/prisma/client.js'
import { readFileSync } from 'node:fs'
import { runtimeBookingFingerprint, runtimeBookingRequestHash, runtimeBookingChildInput, runtimeBookingChildRequestHash, runtimeServiceConfigurationHash, type RuntimeHeldReceipt, type RuntimePresentedBooking, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { coordinationKey } from '../src/conversational-bot/coordinated-booking.js'
import { createQueueMilestoneTracker, type QueueMilestoneTracker } from '../src/bot-options/observability/queue-milestones.js'
import assert from 'node:assert/strict'
import {issueChoiceQuestion,publicChoiceQuestion,type ConversationChoiceOperation} from '../src/conversational-bot/choices.js'
import { subscribeToCrmRealtimeEvents } from '../src/services/crm-realtime-events.js'
import type { AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { readConversationDraft, projectConversationDraft, reconcileConversationDraft } from '../src/conversational-bot/session-state.js'
import type { AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { resolveGuidance } from '../src/conversational-bot/service-guidance.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../src/bot-options/domain/state.js'

// Keep stage logs quiet outside explicit metric assertions; production logging is unchanged.
const runtimeInfo = console.info
console.info = (...args: unknown[]) => { if (args[0] !== '[bot-options-attempt-stage]') runtimeInfo(...args) }

const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1,
  configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' }, serviceContent: { version: 1, businessId: 'biz', services: [] } } }
const policy = resolveConversationPolicy(config)!
assert.ok(policy)
assert.equal(resolveConversationPolicy({ ...config, definition: {} }), null)
for (const wrong of [{ customerCode: 'other' }, { configurationBusinessId: 'other' }, { configurationStatus: 'DRAFT' },
  { definition: { conversation: { schemaVersion: 2, engine: 'conversational-booking-v1' } } }]) {
  assert.throws(() => resolveConversationPolicy({ ...config, ...wrong }))
}
const initial = createInitialBotOptionsState()
assert.deepEqual(readConversationDraft(initial, policy, 'UTC'), initialDialogueState('biz'))
const draft = { ...initialDialogueState('biz'), pending: 'date' as const, serviceId: 'cut' }
const projected = projectConversationDraft(draft, policy)
assert.equal(projected.flow, 'DATE_SELECT')
assert.equal(projected.booking, 'DRAFT')
assert.deepEqual(projected.cart, [{ serviceId: 'cut' }])
assert.equal(parseBotOptionsState(projected).ok, true)
assert.deepEqual(readConversationDraft(projected, policy, 'UTC'), draft)
assert.deepEqual(readConversationDraft(JSON.parse(JSON.stringify(projected)), policy, 'UTC'), draft, 'equivalent metadata survives JSON persistence')
assert.throws(() => readConversationDraft(projected, { ...policy, serviceContent: { version: 1, businessId: 'biz', services: [{ serviceId: 'changed' }] } }, 'UTC'), /policy changed/, 'changed classification requires a reset')
const { serviceContent: _content, ...withoutContent } = policy
assert.throws(() => readConversationDraft(projected, withoutContent, 'UTC'), /policy changed/, 'metadata removal cannot reuse staged evidence')
assert.throws(() => readConversationDraft(projected, { ...policy, generation: policy.generation + 1 }, 'UTC'), /policy changed/)
assert.throws(() => readConversationDraft(projected, { ...policy, configurationId: 'other' }, 'UTC'))
assert.throws(() => readConversationDraft({ ...initial, flow: 'NAME_INPUT' }, policy, 'UTC'))
assert.deepEqual(readConversationDraft(createInitialBotOptionsState(), policy, 'UTC'), initialDialogueState('biz'))
console.log('conversational runtime policy/session: PASS')

// The public worker entry must select the new engine, not just expose unused helpers.
const { processSessionJob } = await import('../src/bot-options/application/process-session-job.js')
let sawWorkerPolicy = false
const entryClient = {
  $queryRaw: async (query: { sql: string }) => {
    if (query.sql.includes('conversation-policy')) { sawWorkerPolicy = true; throw new Error('POLICY_ENTRY_REACHED') }
    throw new Error('legacy entry reached instead')
  }
} as never
await assert.rejects(processSessionJob({ client: entryClient, job: { id: 'job', kind: 'PROCESS_INBOX', businessId: 'biz', deploymentId: 'dep', deploymentGeneration: 1, aggregateId: 'inbox', attempts: 1 } as never }), /POLICY_ENTRY_REACHED/)
assert.equal(sawWorkerPolicy, true)

const { PrismaAuthoritativeAdmissionRepository } = await import('../src/bot-options/infrastructure/prisma-admission.js')
async function admit(marked: boolean, type = 'text', interactiveReplyId?: string) {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  let nameReads = 0
  const tx = { $queryRaw: async (q: { sql: string; values: unknown[] }) => {
    if (q.sql.includes('initial-classification-batch')) { writes.push(q); return [{ inboxCount: 1n, jobCount: 1n }] }
    if (q.sql.includes('conversation-policy')) return [{ ...config, definition: marked ? config.definition : {} }]
    if (q.sql.includes('FROM "BotPrompt" p')) return [{ promptId: 'old' }]
    if (q.sql.includes('AS "flow"')) { nameReads++; return [{ sessionId: 'session', revision: 5n, flow: 'NAME_INPUT', dbNow: new Date() }] }
    return []
  }, $executeRaw: async (q: { sql: string; values: unknown[] }) => { writes.push(q); return 1 } }
  await new PrismaAuthoritativeAdmissionRepository(tx as never, { depositProofIngressEnabled: true }).classifyProviderEventTx(tx as never, {
    route: { kind: 'new', businessId: 'biz', deploymentId: 'dep', generation: 1, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    event: { kind: 'message', interactiveReplyId, messageType: type, textBody: 'que servicios hay', fromPhone: 'phone', providerMessageId: 'msg', phoneNumberId: 'channel' } as never,
    providerEventId: 'event'
  })
  return { writes, nameReads }
}
const admitted = await admit(true)
assert.equal(admitted.nameReads, 0, 'marked conversational NAME_INPUT must not intercept information as name.submit')
assert.ok(admitted.writes.some(q => q.values.includes('PROCESS_INBOX')))
const legacyAdmission = await admit(false)
assert.equal(legacyAdmission.nameReads, 1)
assert.ok(legacyAdmission.writes.some(q => q.values.includes('name.submit')))
const mediaAdmission = await admit(true, 'image')
assert.ok(mediaAdmission.writes.some(q => q.values.includes('PROCESS_INBOX')))
assert.ok(!mediaAdmission.writes.some(q => q.values.includes('RECEIVE_DEPOSIT_PROOF')))

// Stateful offline client: execute the public entry, real engine, claims, CRM and persistView.
// SQL tags identify statements; this proves orchestration/fencing, not PostgreSQL contention.
type Query = { sql: string; text: string; values: unknown[] }
function runtimeFixture(options: { financialRead?: { rows: Record<string,unknown>[]; lines: unknown[]; items: unknown[] }; pendingEffect?: string; personality?: () => Promise<DialoguePersonality>; bookingDb?:PGlite;bookingPort?:DialoguePort;bookingFault?:{secondChild:boolean};publicPorts?:boolean; availabilityReason?: 'COMBINATION_REVIEW'; basketCatalog?: boolean; guidedCatalog?: boolean; sessionDb?: PGlite; computeDb?: PGlite; handoffDb?: PGlite; jobPrefix?: string; businessId?: string; phone?: string; now?: Date; failAfterSessionCreate?: boolean; failSnapshotCommit?: boolean; onPreparingReply?: (context: { businessId: string; providerPhoneNumberId: string; providerMessageId: string }) => void | Promise<void>; queueMilestones?: QueueMilestoneTracker } = {}) {
  const now = options.now ?? new Date('2026-10-01T12:00:00Z')
  let sessionSql: Transaction | undefined
  let computeSql: Transaction | undefined
  let handoffSql: Transaction | undefined
  let bookingSql: Transaction | undefined
  const businessId = options.businessId ?? 'biz'
  let inTransaction = false
  let row = { ...config, businessId, configurationBusinessId: businessId, id: 'inbox', actionType:'input.initial',expectedRevision:null as bigint|null, deploymentGeneration: 1, fenceEpoch: 1, payload: { fromPhone: options.phone ?? 'phone', textBody: 'Corte', messageType: 'text', contextWindowEvaluated: true, conversationChoice:undefined as unknown },
    providerEventId: 'event', providerMessageId: 'msg', providerPhoneNumberId: 'channel', status: 'ADMITTED', dbNow: now, businessTimezone: 'UTC', admittedAt: now, providerOccurredAt: now, botEnabled: true }
  let session: { sessionId: string; conversationId: string; revision: bigint; status: string; state: unknown; businessTimezone: string; handoffFenceEpoch: number; handoffClaimsPausedAt: Date | null; deploymentId: string; deploymentGeneration: number } | null = null
  let replies: string[] = []
  let settled = 0
  let retried = 0
  let messages = 0
  let blocked = false
  let failCommit = false
  let invalidClaim = false
  let pendingEffect = options.pendingEffect
  const statements: Query[] = []
  let prepareHook: (() => void) | undefined
  let inputs: Array<{ id: string; text: string }> | undefined
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      assert.equal(inTransaction, false)
      const backup = structuredClone({ row, session, replies, settled, retried, messages })
      inTransaction = true
      try {
        const execute = async () => {
          const result = await operation(client)
          if (options.failSnapshotCommit && messages > backup.messages) throw new Error('SNAPSHOT COMMIT failed')
          if (failCommit && replies.length > backup.replies.length) throw new Error('COMMIT failed')
          return result
        }
        if (options.bookingDb) return await options.bookingDb.transaction(async tx=>{bookingSql=tx;return execute()})
        if (options.handoffDb) return await options.handoffDb.transaction(async tx => { handoffSql = tx; return execute() })
        if (options.computeDb) return await options.computeDb.transaction(async tx => { computeSql = tx; return execute() })
        return options.sessionDb ? await options.sessionDb.transaction(async tx => {
          sessionSql = tx
          return execute()
        }) : await execute()
      } catch (error) {
        ;({ row, session, replies, settled, retried, messages } = backup)
        throw error
      } finally { inTransaction = false; sessionSql = undefined; computeSql = undefined; handoffSql = undefined;bookingSql=undefined }
    },
    async $queryRaw(q: Query) {
      statements.push(q)
      if(options.financialRead && q.sql.includes('runtime-booking-deposit-receipt'))return options.financialRead.rows
      if(options.financialRead && q.sql.includes('FROM "BookingDepositLine"'))return options.financialRead.lines
      if(options.financialRead && q.sql.includes('FROM "AppointmentServiceItem"'))return options.financialRead.items
      if(bookingSql && q.sql.includes('extract(minute FROM'))return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).rows
      if(bookingSql && q.sql.includes('pg_advisory_xact_lock'))return [{locked:1}]
      if(bookingSql && q.sql.includes('conversation-inbox-lock'))return [structuredClone(row)]
      if (handoffSql && (q.sql.includes('"BotOperation"') || q.sql.includes('"BotHandoff"') ||
          q.sql.includes('conversational-handoff-') || q.sql.includes('UPDATE "BotSession" SET "status" =') || q.sql.includes('SELECT "status"::text AS "status"') || q.sql.includes('humanHandoffAtText') || q.sql.includes('UPDATE "Conversation" c SET "currentStep"'))) {
        return (await handoffSql.query(q.text,q.values)).rows
      }
      if (q.sql.includes('test-reset-pending-effects')) {
        assert.ok(q.values.includes(businessId) && q.values.includes(session!.sessionId), 'reset effect guard must be scoped')
        assert.match(q.sql, /'PENDING','CLAIMED','RETRY','SENDING','UNKNOWN'/)
        assert.match(q.sql, /IS DISTINCT FROM 'COMPLETED'/)
        return bookingSql ? (await bookingSql.query(q.text, q.values)).rows : [{ blocked: Boolean(pendingEffect) }]
      }
      if (q.sql.includes('consolidation-inbox-identity')) return [{ phone: row.payload.fromPhone }]
      if (q.sql.includes('consolidation-previous')) return []
      if (q.sql.includes('consolidation-candidates') && blocked) return [{ id: 'barrier', admittedAt: now, payload: { messageType: 'image' }, actionType: 'input.initial' }]
      if (q.sql.includes('consolidation-candidates')) return (inputs ?? [{ id: row.providerEventId, text: row.payload.textBody }]).map(part => ({ id: part.id, admittedAt: now,
        payload: { ...row.payload, textBody: part.text }, actionType: 'input.initial' }))
      if (q.sql.includes('conversation-choice-policy-guard')) return [{actionType:row.actionType}]
      if (q.sql.includes('conversation-policy')) return [row]
      if (q.sql.includes('FROM "BotProviderEvent" e') && q.sql.includes('d."id" AS "deploymentId"')) return [row]
      if (q.sql.includes('SELECT e."businessId", d."generation"')) return [row]
      if (q.sql.includes('b."name" AS "businessName"') && q.sql.includes('FROM "BotActionInbox"')) return [row]
      if (q.sql.includes('lazy-context:session')) return session ? [{ ...structuredClone(session), id: session.sessionId,
        draftTouchedAt: null, draftExpiresAt: new Date(now.getTime() + 86_400_000), dbNow: now,
        hasInbox: false, durableProtection: false, botEnabled: true }] : []
      if (q.sql.includes('lazy-context:greeting')) return [{ ...row, businessName: 'Salon', customerName: null }]
      if (q.sql.includes('conversation-feature-lock')) return []
      if (q.sql.includes('conversation-target')) return [{ fenceEpoch: row.fenceEpoch, phone: row.payload.fromPhone }]
      if (q.sql.includes('conversation-compute-defer')) return (await computeSql!.query(q.text, q.values)).rows
      if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) {
        if(options.bookingDb)await (bookingSql ?? options.bookingDb).query(`UPDATE "BotDispatchClaim" SET status='CLAIMED' WHERE id=$1`,[row.id])
        return computeSql ? (await computeSql.query(q.text, q.values)).rows : [{ claimToken: options.bookingDb ? 'dispatch-token-'+row.id : 'dispatch-token' }]
      }
      if (q.sql.includes('conversation-choice-persist')) {
        const payloads=q.values.filter(v=>typeof v==='string' && v.startsWith('{')).map(v=>JSON.parse(v as string))
        const choiceCount=payloads.filter(value=>value.question).length
        const outbox=payloads.filter(value=>value.item)
        for(const payload of outbox) replies.push(payload.item.body)
        return [{choiceCount:BigInt(choiceCount),outboxCount:BigInt(outbox.length)}]
      }
      if (q.sql.includes('conversation-turn-persist')) {
        assert.ok(session)
        const backupState = structuredClone(session.state)
        session.state = JSON.parse(q.values.find(v => typeof v === 'string' && v.includes('"schemaVersion"')) as string)
        const previous = session.revision
        if (handoffSql) {
          await handoffSql.query(`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone",
            "state","revision","status","handoffFenceEpoch","handoffClaimsPausedAt") VALUES ($1,$2,'conversation','dep',1,'UTC',$3,$4,$5,0,NULL)
            ON CONFLICT ("id") DO UPDATE SET "state"=$3,"revision"=$4,"status"=$5`,
            [session.sessionId,businessId,JSON.stringify(backupState),String(previous),session.status])
          await handoffSql.query(`INSERT INTO "BotActionInbox" VALUES ($1,$2,$3,'ADMITTED',NULL) ON CONFLICT ("id") DO UPDATE SET "status"='ADMITTED'`,[row.id,businessId,row.providerEventId])
          await handoffSql.query(`INSERT INTO "BotProviderEvent" VALUES ($1,$2,'ADMITTED') ON CONFLICT ("id") DO UPDATE SET "status"='ADMITTED'`,[row.providerEventId,businessId])
          await handoffSql.query(`INSERT INTO "BotDispatchClaim" VALUES ('claim','dispatch-token','CLAIMED',NULL) ON CONFLICT ("id") DO UPDATE SET "status"='CLAIMED'`)
          await handoffSql.query(`INSERT INTO "BotJob" VALUES ($1,'LEASED','job-token',NULL,NULL,NULL) ON CONFLICT ("id") DO UPDATE SET "status"='LEASED'`,[`job-${number}`])
        }
        session.revision = q.values.find(v => typeof v === 'bigint') as bigint
        const physical = (bookingSql ?? handoffSql) ? (await (bookingSql ?? handoffSql)!.query<Record<string,unknown>>(q.text,q.values)).rows[0]! : null
        const payloads = q.values.filter(v => typeof v === 'string' && v.startsWith('{')).map(v => JSON.parse(v as string)).filter(v => v.item)
        for (const payload of payloads) replies.push(payload.item.body)
        if (q.sql.includes('settled_inbox')) {
          if (computeSql) await computeSql.query(`UPDATE "BotDispatchClaim" SET "status"='DONE' WHERE "claimToken"=ANY($1::text[])`, [q.values.filter(value => typeof value === 'string')])
          row.status = 'PROCESSED'; settled++
        }
        if (physical) return [Object.fromEntries(Object.entries(physical).map(([key,value]) => [key,key.endsWith('Count')?BigInt(value as string|number):value]))]
        return [{ sessionCount: 1n, transitionCount: 1n, stepCount: 1n, outboxCount: BigInt(payloads.length),
          inboxCount: 1n, dispatchCount: 1n, jobCount: 1n, conversationId: 'conversation', updatedAt: now }]
      }
      if (q.sql.includes('settled_inbox')) {
        if (computeSql) await computeSql.query(`UPDATE "BotDispatchClaim" SET "status"='DONE' WHERE "claimToken"=ANY($1::text[])`, [q.values.filter(value => typeof value === 'string')])
        row.status = 'PROCESSED'; settled++; return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }] }
      if (q.sql.includes('conversation-claims-assert')) {
        if (computeSql) {
          const result = await computeSql.query<{jobCount: string | number | bigint; dispatchCount: string | number | bigint}>(q.text,q.values)
          return result.rows.map(row => ({jobCount:BigInt(row.jobCount),dispatchCount:BigInt(row.dispatchCount)}))
        }
        return [{ jobCount: invalidClaim ? 0n : 1n, dispatchCount: invalidClaim ? 0n : 1n }]
      }
      if (q.sql.includes('SELECT j."id" FROM "BotJob"')) return invalidClaim ? [] : [{ id: 'job' }]
      if (q.sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return invalidClaim ? [] : [{ id: 'claim' }]
      if (q.sql.includes('conversation-inbox-lock')) return [structuredClone(row)]
      if (q.sql.includes('conversation-order')) return [{ blocked }]
      if (q.sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
      if (q.sql.includes('s."id" AS "sessionId", c."id" AS "conversationId"')) return session ? [structuredClone(session)] : []
      if (q.sql.includes('"BotHandoff"') && q.sql.includes('FOR UPDATE')) return [{ handoffId: 'handoff' }]
      if (q.sql.includes('AS "conversationId" FROM "Conversation"')) return [{ conversationId: 'conversation' }]
      if (q.sql.includes('INSERT INTO "Message"')) { messages++; return [] }
      if (q.sql.includes('conversation-create-session')) {
        // Execute the parameterized production statement, not a copy of its SQL.
        const inserted = sessionSql ? (await sessionSql.query<{ id: string }>(q.text, q.values)).rows : [{ id: 'session' }]
        if (options.failAfterSessionCreate) throw new Error('session creation interrupted')
        session = { sessionId: inserted[0]!.id, conversationId: 'conversation', revision: 0n, status: 'ACTIVE', state: createInitialBotOptionsState(), businessTimezone: 'UTC', handoffFenceEpoch: 0, handoffClaimsPausedAt: null, deploymentId: 'dep', deploymentGeneration: 1 }
        return inserted
      }
      if (q.sql.includes('UPDATE "Conversation" conversation')) return []
      if (q.sql.includes('inserted_outbox')) {
        const payloads = q.values.filter(v => typeof v === 'string' && v.startsWith('{')).map(v => JSON.parse(v as string)).filter(v => v.item)
        for (const payload of payloads) { assert.ok(['informative_text', 'interactive'].includes(payload.item.type)); replies.push(payload.item.body) }
        return [{ choiceCount: q.sql.includes('INSERT INTO "BotPromptChoice"') ? 5n : 0n, outboxCount: BigInt(payloads.length) }]
      }
      if(bookingSql) {
        if(options.bookingFault?.secondChild && q.sql.includes('INSERT INTO "Appointment"') && q.values.includes('s2'))throw new Error('controlled second booking child failure')
        return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).rows
      }
      throw new Error(`unhandled runtime query: ${q.sql.slice(0, 160)}`)
    },
    async $executeRaw(q: Query) {
      statements.push(q)
      if (handoffSql && (q.sql.includes('"BotOperation"') || q.sql.includes('"BotHandoff"') ||
          q.sql.includes('conversational-handoff-') || q.sql.includes('UPDATE "BotSession" SET "status" =') || q.sql.includes('SET "status" = \'HUMAN_QUEUED\'') ||
          q.sql.includes('SET "currentStep" = \'HUMAN_HANDOFF\''))) {
        const result = await handoffSql.query(q.text,q.values)
        const saved = (await handoffSql.query<{status:string;state:unknown;revision:string|number}>('SELECT "status","state","revision" FROM "BotSession"')).rows[0]
        if(session && saved) {session.status=saved.status;session.state=saved.state;session.revision=BigInt(saved.revision)}
        return result.affectedRows ?? 0
      }
      if(bookingSql && options.bookingFault?.secondChild && q.sql.includes('INSERT INTO "Appointment"') && q.values.includes('s2'))throw new Error('controlled second booking child failure')
      if(bookingSql && /"Appointment"|"BookingVisit"|"BotOperation"|"BotDispatchClaim"/.test(q.sql))return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).affectedRows??0
      if (options.computeDb && (q.sql.includes('pg_advisory') || q.sql.includes('UPDATE "BotDispatchClaim"'))) {
        const result = computeSql ? await computeSql.query(q.text, q.values) : await options.computeDb.query(q.text, q.values)
        return result.affectedRows ?? 1
      }
      assert.ok(!q.sql.includes('INSERT INTO "Appointment"') && !q.sql.includes('INSERT INTO "BookingVisit"'), 'proposal must never create bookings')
      if (q.sql.includes('conversation-generation-reset')) { assert.ok(session); session.deploymentGeneration = 1; session.state = createInitialBotOptionsState(); session.revision++ }
      if (q.sql.includes('conversation-financial-projection') || q.sql.includes('conversation-save') || (q.sql.includes('UPDATE "BotSession" SET "state"') && q.values.some(v => typeof v === 'string' && v.includes('schemaVersion')))) {
        assert.ok(session)
        session.state = JSON.parse(q.values.find(v => typeof v === 'string' && v.includes('"schemaVersion"')) as string)
        session.revision = q.values.find(v => typeof v === 'bigint') as bigint
      }
      if (q.sql.includes('conversation-settle')) row.status = 'PROCESSED'
      if (q.sql.includes('UPDATE "BotJob" SET "status" = \'DONE\'')) settled++
      if (q.sql.includes('UPDATE "BotJob" SET "status" = \'READY\'')) {
        if (computeSql) await computeSql.query(q.text,q.values)
        retried++
      }
      return 1
    }
  }
  // Prisma delegates used by the existing F7 revalidation, bound to the caller transaction.
  if(options.bookingDb) {
    const select=async(table:string,where:Record<string,unknown>)=>{
      if(!bookingSql)throw new Error('booking delegate outside TX')
      const values:unknown[]=[],clauses=Object.entries(where).map(([key,value])=>{
        if(value && typeof value==='object' && 'in' in value){const list=(value as {in:unknown[]}).in;return '"'+key+'" IN ('+list.map(v=>{values.push(v);return '$'+values.length}).join(',')+')'}
        values.push(value);return '"'+key+'"=$'+values.length
      })
      return (await bookingSql.query('SELECT * FROM "'+table+'" WHERE '+clauses.join(' AND '),values)).rows
    }
    for(const [name,table] of Object.entries({professional:'Professional',service:'Service',professionalService:'ProfessionalService',businessHours:'BusinessHours',professionalHours:'ProfessionalHours'}))Object.assign(client,{[name]:{
      findMany:({where}:{where:Record<string,unknown>})=>select(table,where),findFirst:async({where}:{where:Record<string,unknown>})=>(await select(table,where))[0]??null,count:async({where}:{where:Record<string,unknown>})=>(await select(table,where)).length}})
    Object.assign(client,{scheduleBlock:{findFirst:async()=>null}})
  }
  let basketAgendaCalls = 0, singularAgendaCalls = 0
  const dialogueFactory = async (_client: unknown, tenant: string, content?: unknown) => {
    assert.deepEqual(content, tenant === 'biz' ? policy.serviceContent : undefined, 'runtime passes already loaded scoped metadata without another config read')
    assert.equal(inTransaction, false, 'repository preparation must execute outside transaction')
    prepareHook?.()
    const outside = () => assert.equal(inTransaction, false, 'engine repository query must execute outside transaction')
    const port: DialoguePort & DialoguePersonalityPort = {
      ...(options.personality ? { personality: async function () {
        assert.equal(this, port, 'personality receiver must be preserved'); outside()
        return options.personality!()
      } } : {}),
      catalog: async function () {
        assert.equal(this, port, 'catalog receiver must be preserved'); outside()
        if (!options.basketCatalog && !options.guidedCatalog) return [{ id: 'cut', name: 'Corte', durationMinutes: 30, requiresConsultation: false, price: 1000 }]
        return [{ id: 'cut', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 1000 },
          { id: 'woman', name: 'Corte mujer', durationMinutes: 30, requiresConsultation: false, price: 1000 },
          { id: 'smooth', name: 'Alisado', durationMinutes: 90, requiresConsultation: false, price: options.guidedCatalog ? 85000 : 9000,
            ...(options.guidedCatalog ? { professionalDurationMinutes: 90, customerDurationMinutes: 150, priceMode: 'STARTING_AT' as const,
              bookingPolicy: { id: 'smooth', name: 'Alisado', price: 85000, priceMode: 'STARTING_AT' as const, attentionMode: 'GUIDED_ESTIMATE' as const,
                estimateAllowsBooking: true, estimateQuestion: '¿Qué largo tiene tu cabello?', estimateExplanation: 'El presupuesto depende del largo.',
                estimateDisclaimer: 'Presupuesto estimado sujeto a evaluación.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null,
                estimateOptions: [{ id: 'short', label: 'Hasta los hombros', priceMin: 85000, priceMax: 95000, note: null },
                  { id: 'long', label: 'Debajo de los hombros', priceMin: 95000, priceMax: 110000, note: null }] } } : {}) }]
      },
      availability: async function () { assert.equal(this, port, 'availability receiver must be preserved'); outside(); singularAgendaCalls++; return { professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ date: '2026-10-02', time: '14:00', startAt: '2026-10-02T14:00:00Z', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] } }
    }
    if (options.basketCatalog || options.guidedCatalog) port.availabilityBasket = async function (services, date, _professional, selections) {
      assert.equal(this, port, 'basket availability receiver must be preserved'); outside(); basketAgendaCalls++
      if (options.availabilityReason) return { ok: false, reason: options.availabilityReason }
      if (options.guidedCatalog) {
        assert.equal(selections?.smooth?.optionId, 'short', 'worker wrapper preserves fourth argument')
        assert.equal(resolveGuidance(services, selections).pending, null)
      }
      return { ok: true, services, durationMinutes: services.reduce((sum, service) => sum + service.durationMinutes!, 0), totalPrice: options.guidedCatalog ? null : services.reduce((sum, service) => sum + service.price!, 0),
        ...(options.guidedCatalog ? { customerDurationMinutes: services.reduce((sum, service) => sum + (service.customerDurationMinutes ?? service.durationMinutes!), 0) } : {}),
        professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ date, time: '14:00', startAt: date + 'T14:00:00Z', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON', occupiedMinutes: 0 }] }
    }
    if(options.publicPorts) {
      port.businessTimeContext=function(date,times){assert.equal(this,port,'business hours receiver preserved');outside();return {businessId,timezone:'UTC',date,candidateTimes:[...times],candidates:times.map(time=>({time,status:time>='11:00'&&time<'20:00'?'open' as const:'closed' as const}))}}
      port.identity=async function(){assert.equal(this,port);outside();return {businessId,businessName:'Nombre real',assistantName:'Asistente real',treatment:'vos'}}
      port.professionalInformation=async function(){assert.equal(this,port);outside();return {businessId,complete:true,professionals:[{id:'ana',name:'Ana',services:[{id:'cut',name:'Corte hombre'}],schedule:'Sábado: 10:00 a 14:00. Jornada habitual, no turnos libres.'}]}}
      port.verifiedDateChoices=async function(services){assert.equal(this,port);outside();return {ok:true,services,durationMinutes:services.reduce((total,service)=>total+service.durationMinutes!,0),totalPrice:1000,
        professionals:[{id:'ana',name:'Ana',priority:0}],slots:[{date:'2026-10-02',time:'14:00',startAt:'2026-10-02T14:00:00Z',professionalId:'ana',professionalName:'Ana',band:'AFTERNOON',occupiedMinutes:0}]}}
    }
    return { context: { businessId, timezone: 'UTC', dbNow: now }, port:options.bookingPort??port }
  }
  let number = 0
  const run = (kind = 'PROCESS_INBOX', conversationalAi?: { provider: AiInterpretationProvider; timeoutMs: number; onDiagnostic?: (value: unknown) => void }) => processSessionJob({ client: client as never, dialogueFactory, ...(conversationalAi?{conversationalAi}:{}), ...(options.queueMilestones?{queueMilestones:options.queueMilestones}:{}), ...(options.onPreparingReply?{onPreparingReply:options.onPreparingReply}:{}), job: { id: `${options.jobPrefix ?? 'job'}-${number}`, kind, businessId, deploymentId: 'dep', deploymentGeneration: 1, aggregateId: row.id, attempts: 1, claimToken: 'job-token', expectedRevision: null } as never })
  return { run, get basketAgendaCalls() { return basketAgendaCalls }, get singularAgendaCalls() { return singularAgendaCalls }, get session() { return session! }, get row() { return row }, get replies() { return replies }, get settled() { return settled }, get retried() { return retried }, get messages() { return messages }, statements,
    pendingEffect(status?: string) { pendingEffect = status },
    inputs(parts: Array<{ id: string; text: string }>) { inputs = parts },
    next(text: string, type = 'text') { number++; row = { ...row, id: `inbox-${number}`, providerEventId: `event-${number}`, providerMessageId: `msg-${number}`, status: 'ADMITTED', actionType:'input.initial',expectedRevision:null, payload: { ...row.payload, textBody: text, messageType: type,conversationChoice:undefined } } },
    choice(operation:ConversationChoiceOperation) {
      assert.ok(session)
      const draft=readConversationDraft(session.state,policy,'UTC')
      const question=issueChoiceQuestion({businessId,conversationKey:session.sessionId,policyKey:'cfg',policyGeneration:1,revision:String(session.revision)},draft,
        {kind:'service',title:'Servicios',choices:[{label:'UNTRUSTED LABEL',operation}]})
      this.next('FORGED LABEL','interactive')
      row.actionType='conversation.choice';row.expectedRevision=session.revision
      row.payload.conversationChoice={question,choiceId:publicChoiceQuestion(question).choices[0]!.id}
    },
    assertOutside() { assert.equal(inTransaction, false, 'AI must run outside transactions') }, hook(fn: () => void) { prepareHook = fn }, block(value: boolean) { blocked = value }, failCommit() { failCommit = true }, allowCommit(){failCommit=false}, invalidateClaim() { invalidClaim = true } }
}
const runtimeEv = (evidence: string) => ({ evidence, confidence: .99 })
const runtimeMember = (mode: string, serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...runtimeEv(evidence) })
const runtimeBasket = (mutation: string, members: object[], evidence: string, targets: string[] = []) => ({ kind: 'basket', mutation, members, scope: targets.length ? 'members' : 'all', targetMemberIds: targets, ...runtimeEv(evidence) })
const runtimeAct = (kind: string, field: string, evidence: string, operationIndexes: number[], mention: string | null = null) => ({kind,field,...runtimeEv(evidence),mention,operationIndexes})
const runtimeCandidate = (...operations: object[]) => ({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations } })
// Public receiver proof: style is private context, never a booking operation or extra AI call.
let personalityReads = 0, personalityCalls = 0
let currentPersonality = normalizeAssistantPersonality({ preset: 'elegant', name: 'Alba', commercialName: 'Local público',
  role: 'asistente del local', treatment: 'usted', emojiLevel: 'none', responseLength: 'detailed',
  preferredEmojis: ['✨'], customInstructions: 'PRIVATE_RUNTIME_STYLE' })
const personalityInputs: unknown[] = [], personalityDiagnostics: unknown[] = []
const personalityRuntime = runtimeFixture({ publicPorts: true, personality: async () => {
  personalityReads++; return { businessId: 'biz', profile: currentPersonality }
} })
const personalityProvider: AiInterpretationProvider = async input => {
  personalityCalls++; personalityInputs.push(input.personality)
  return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [] },
    firstReply: { salutation: 'greeting', opening: null, closing: null,
      factIds: input.firstReplyFacts!.map(fact => fact.id) } }
}
personalityRuntime.next('hola')
await personalityRuntime.run('PROCESS_INBOX', { provider: personalityProvider, timeoutMs: 15000,
  onDiagnostic: value => { personalityDiagnostics.push(value) } })
assert.equal(personalityReads, 1, 'public receiver must forward current scoped personality')
assert.deepEqual(personalityInputs[0], { businessId: 'biz', profile: currentPersonality })
assert.match(personalityRuntime.replies[0]!, /^Hola\./)
assert.match(personalityRuntime.replies[0]!, /Soy Alba, de Local público/)
currentPersonality = { ...currentPersonality, responseLength: 'short', customInstructions: 'CURRENT_RUNTIME_STYLE' }
personalityRuntime.next('gracias')
await personalityRuntime.run('PROCESS_INBOX', { provider: personalityProvider, timeoutMs: 15000 })
assert.equal(personalityReads, 2); assert.equal(personalityCalls, 2)
assert.deepEqual(personalityInputs[1], { businessId: 'biz', profile: currentPersonality })
assert.doesNotMatch(personalityRuntime.replies[1]!, /Soy Alba/)
const personalityDraft = readConversationDraft(personalityRuntime.session.state, policy, 'UTC')
assert.equal(personalityDraft.serviceId, null); assert.equal(personalityDraft.slot, null)
assert.equal(personalityDraft.basket?.members.length ?? 0, 0)
assert.equal(personalityDraft.bookingReservation, undefined)
assert.equal(personalityRuntime.singularAgendaCalls, 0); assert.equal(personalityRuntime.basketAgendaCalls, 0)
assert.equal(JSON.stringify(personalityDraft).includes('PRIVATE_RUNTIME_STYLE'), false)
assert.equal(JSON.stringify(personalityDiagnostics).includes('PRIVATE_RUNTIME_STYLE'), false)
console.log('P4 public receiver: fresh scoped profile/receiver/AI input/once intro/no agenda/no private diagnostics PASS')

const clockRuntime=runtimeFixture({publicPorts:true})
clockRuntime.next('hola');await clockRuntime.run()
clockRuntime.session.state=projectConversationDraft({...initialDialogueState('biz'),date:'2026-10-02'},policy)
clockRuntime.next('Masomenos a las 5 tenés lugar?')
let commercialInput:unknown
await clockRuntime.run('PROCESS_INBOX',{provider:async input=>{commercialInput=input.businessTimeContext;return {intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations:[]}}},timeoutMs:15000})
assert.deepEqual((commercialInput as {candidates:unknown})?.candidates,[{time:'05:00',status:'closed'},{time:'17:00',status:'open'}],'WhatsApp wrapper forwards commercial meaning without querying occupied slots')
console.log('P12 WhatsApp commercial clock receiver/proof: PASS')
// Focal mode does not change or waive the default suite's original assertions.
if (!process.argv.includes('--handoff-only')) {
// Full basket runs through the public worker, real interpreter/motor and production state projection.
const basketRuntime = runtimeFixture({ basketCatalog: true })
let basketOutput: unknown
let basketInterpretations = 0, basketCopies = 0
const basketProvider: AiInterpretationProvider = Object.assign(async () => { basketRuntime.assertOutside(); basketInterpretations++; return basketOutput }, {
  respond: async (input: { facts: readonly { id: string; text: string }[] }) => { basketRuntime.assertOutside(); basketCopies++; return { opening: null, closing: null, factIds: input.facts.map(fact => fact.id) } }
})
basketRuntime.next('Matias corte y alisado mañana con Ana')
basketOutput = runtimeCandidate(runtimeBasket('set', [runtimeMember('single', ['cut'], 'corte'), runtimeMember('single', ['smooth'], 'alisado')], 'corte y alisado'),
  { kind: 'name', value: 'Matias', ...runtimeEv('Matias') }, { kind: 'date', expression: 'mañana', value: null, ...runtimeEv('mañana') },
  { kind: 'professional', mode: 'specific', mention: 'Ana', ...runtimeEv('Ana') })
basketOutput = {...basketOutput as object, communicativeActs:{version:1,acts:[
  runtimeAct('request','service','corte y alisado',[0]),runtimeAct('request','name','Matias',[1]),
  runtimeAct('request','date','mañana',[2]),runtimeAct('request','professional','Ana',[3],'Ana')]}}
await basketRuntime.run('PROCESS_INBOX', { provider: basketProvider, timeoutMs: 4500 })
const runtimeFirst = readConversationDraft(basketRuntime.session.state, policy, 'UTC')
assert.equal(runtimeFirst.basket?.members.length, 2, 'public runtime must preserve every requested basket member')
assert.equal(runtimeFirst.basket!.members[0]!.mode, 'alternatives')
assert.deepEqual(runtimeFirst.basket!.members[1]!.serviceIds, ['smooth'])
assert.deepEqual((basketRuntime.session.state as typeof projected).cart, [], 'public runtime cannot project a partial basket')
assert.equal(basketRuntime.basketAgendaCalls, 0)
assert.equal(basketRuntime.singularAgendaCalls, 0)
assert.equal(runtimeFirst.customerName, 'Matias')
basketRuntime.next('corte hombre')
basketOutput = runtimeCandidate(runtimeBasket('replace', [runtimeMember('single', ['cut'], 'corte hombre')], 'corte hombre', [runtimeFirst.basket!.members[0]!.memberId]))
basketOutput = {...basketOutput as object,communicativeActs:{version:1,acts:[runtimeAct('answer','service','corte hombre',[0])]}}
await basketRuntime.run('PROCESS_INBOX', { provider: basketProvider, timeoutMs: 4500 })
assert.deepEqual((basketRuntime.session.state as typeof projected).cart.map(item => item.serviceId), ['cut', 'smooth'])
const copiesBeforeProposal = basketCopies
basketRuntime.next('14hs')
basketOutput = runtimeCandidate({ kind: 'time', value: '14:00', ...runtimeEv('14hs') })
basketOutput = {...basketOutput as object,communicativeActs:{version:1,acts:[runtimeAct('answer','time','14hs',[0])]}}
await basketRuntime.run('PROCESS_INBOX', { provider: basketProvider, timeoutMs: 4500 })
const runtimeComplete = readConversationDraft(JSON.parse(JSON.stringify(basketRuntime.session.state)), policy, 'UTC')
assert.equal(runtimeComplete.pending, 'proposal', JSON.stringify({ date: runtimeComplete.date, hasName: Boolean(runtimeComplete.customerName), hasProfessional: Boolean(runtimeComplete.professional), memberCount: runtimeComplete.basket?.members.length, memberModes: runtimeComplete.basket?.members.map(member => member.mode), hasSlot: Boolean(runtimeComplete.slot), lastReply: basketRuntime.replies.at(-1) }))
assert.equal(runtimeComplete.basket?.members.length, 2)
assert.equal(runtimeComplete.slot?.startAt, '2026-10-02T14:00:00Z')
assert.deepEqual((basketRuntime.session.state as typeof projected).cart.map(item => item.serviceId), ['cut', 'smooth'])
assert.match(basketRuntime.replies.at(-1)!, /Corte hombre.*Alisado/)
assert.match(basketRuntime.replies.at(-1)!, /120 min/)
assert.match(basketRuntime.replies.at(-1)!, /Todavía no está reservado/)
assert.equal(basketCopies, copiesBeforeProposal, 'complete runtime proposal bypasses model framing')
assert.equal(basketInterpretations, 3)
assert.equal(basketRuntime.singularAgendaCalls, 0)
assert.ok(basketRuntime.basketAgendaCalls > 0)
assert.ok(!basketRuntime.statements.some(query => /INSERT INTO "(?:Appointment|BookingVisit)"/.test(query.sql)), 'public basket worker never reserves')
console.log('conversational public runtime complete basket/ambiguity/sidecar/proposal-only: PASS')

const legacyBasket = runtimeFixture({basketCatalog:true})
legacyBasket.next('Matias corte y alisado mañana con Ana')
await legacyBasket.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
  runtimeBasket('set',[runtimeMember('single',['cut'],'corte'),runtimeMember('single',['smooth'],'alisado')],'corte y alisado'),
  {kind:'name',value:'Matias',...runtimeEv('Matias')},{kind:'date',expression:'mañana',value:null,...runtimeEv('mañana')},
  {kind:'professional',mode:'specific',mention:'Ana',...runtimeEv('Ana')}),timeoutMs:15000})
const legacyFirst = readConversationDraft(legacyBasket.session.state,policy,'UTC')
assert.equal(legacyFirst.customerName,'Matias')
assert.equal(legacyFirst.date,'2026-10-02')
assert.equal(legacyFirst.basket?.members.length,2)
assert.equal(legacyFirst.professional,null,'legacy model-only professional has no current owner')
assert.equal(legacyFirst.questionContext,undefined)
legacyBasket.next('corte hombre')
await legacyBasket.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
  runtimeBasket('replace',[runtimeMember('single',['cut'],'corte hombre')],'corte hombre',[legacyFirst.basket!.members[0]!.memberId])),timeoutMs:15000})
const legacyAfter = readConversationDraft(legacyBasket.session.state,policy,'UTC')
assert.deepEqual(legacyAfter.basket,legacyFirst.basket,'no old question scope means no legacy answer replacement')
assert.equal(legacyAfter.customerName,legacyFirst.customerName)
assert.equal(legacyAfter.date,legacyFirst.date)
assert.deepEqual((legacyBasket.session.state as typeof projected).cart,[])
assert.equal(legacyBasket.basketAgendaCalls+legacyBasket.singularAgendaCalls,0)
assert.ok(!legacyBasket.statements.some(q=>/INSERT INTO "(?:Appointment|BookingVisit)"/.test(q.sql)))
assert.match(legacyBasket.replies.at(-1)!,/¿|eleg|no pude/i)
console.log('original legacy basket fixture retained: no owner/no scope does not authorize replacement PASS')

// Guided services traverse the same public worker/sidecar contract, including the fourth port argument.
const guidedRuntime = runtimeFixture({ basketCatalog: true, guidedCatalog: true })
let guidedOutput: unknown
let guidedCopies = 0
const guidedProvider: AiInterpretationProvider = Object.assign(async () => { guidedRuntime.assertOutside(); return guidedOutput }, {
  respond: async (input: { facts: readonly { id: string; text: string }[] }) => { guidedCopies++; return { opening: null, closing: null, factIds: input.facts.map(fact => fact.id) } }
})
guidedRuntime.next('Matias corte y alisado mañana con Ana')
guidedOutput = runtimeCandidate(runtimeBasket('set', [runtimeMember('single', ['cut'], 'corte'), runtimeMember('single', ['smooth'], 'alisado')], 'corte y alisado'),
  { kind: 'name', value: 'Matias', ...runtimeEv('Matias') }, { kind: 'date', expression: 'mañana', value: null, ...runtimeEv('mañana') },
  { kind: 'professional', mode: 'specific', mention: 'Ana', ...runtimeEv('Ana') })
guidedOutput = {...guidedOutput as object, communicativeActs:{version:1,acts:[
  runtimeAct('request','service','corte y alisado',[0]),runtimeAct('request','name','Matias',[1]),
  runtimeAct('request','date','mañana',[2]),runtimeAct('request','professional','Ana',[3],'Ana')]}}
await guidedRuntime.run('PROCESS_INBOX', { provider: guidedProvider, timeoutMs: 4500 })
const guidedFirst = readConversationDraft(guidedRuntime.session.state, policy, 'UTC')
assert.equal(guidedFirst.pending, 'service'); assert.equal(guidedRuntime.basketAgendaCalls, 0)
guidedRuntime.next('corte hombre')
guidedOutput = runtimeCandidate(runtimeBasket('replace', [runtimeMember('single', ['cut'], 'corte hombre')], 'corte hombre', [guidedFirst.basket!.members[0]!.memberId]))
guidedOutput = {...guidedOutput as object,communicativeActs:{version:1,acts:[runtimeAct('answer','service','corte hombre',[0])]}}
await guidedRuntime.run('PROCESS_INBOX', { provider: guidedProvider, timeoutMs: 4500 })
const guidedQuestion = readConversationDraft(guidedRuntime.session.state, policy, 'UTC')
assert.equal(guidedQuestion.pending, 'estimate'); assert.equal(guidedRuntime.basketAgendaCalls, 0)
assert.match(guidedRuntime.replies.at(-1)!, /Qué largo/)
assert.equal(guidedQuestion.customerName, 'Matias'); assert.equal(guidedQuestion.date, '2026-10-02')
guidedRuntime.next('hasta los hombros')
guidedOutput = runtimeCandidate({ kind: 'estimate', serviceId: 'smooth', optionId: 'short', ...runtimeEv('hasta los hombros') })
guidedOutput = {...guidedOutput as object,communicativeActs:{version:1,acts:[runtimeAct('answer','estimate','hasta los hombros',[0])]}}
await guidedRuntime.run('PROCESS_INBOX', { provider: guidedProvider, timeoutMs: 4500 })
const guidedChosen = readConversationDraft(JSON.parse(JSON.stringify(guidedRuntime.session.state)), policy, 'UTC')
assert.equal(guidedChosen.pending, 'time'); assert.equal(guidedChosen.serviceEstimates?.smooth?.optionId, 'short')
assert.ok(guidedRuntime.basketAgendaCalls > 0); assert.equal(guidedRuntime.singularAgendaCalls, 0)
const copiesBeforeGuidedProposal = guidedCopies
guidedRuntime.next('14hs')
guidedOutput = runtimeCandidate({ kind: 'time', value: '14:00', ...runtimeEv('14hs') })
guidedOutput = {...guidedOutput as object,communicativeActs:{version:1,acts:[runtimeAct('answer','time','14hs',[0])]}}
await guidedRuntime.run('PROCESS_INBOX', { provider: guidedProvider, timeoutMs: 4500 })
const guidedProposal = readConversationDraft(guidedRuntime.session.state, policy, 'UTC')
assert.equal(guidedProposal.pending, 'proposal'); assert.equal(guidedProposal.serviceEstimates?.smooth?.optionId, 'short')
assert.deepEqual((guidedRuntime.session.state as typeof projected).cart.map(item => item.serviceId), ['cut', 'smooth'])
assert.match(guidedRuntime.replies.at(-1)!, /120 min/); assert.match(guidedRuntime.replies.at(-1)!, /85\.000 a \$ 95\.000/)
assert.match(guidedRuntime.replies.at(-1)!, /Presupuesto estimado/); assert.match(guidedRuntime.replies.at(-1)!, /Todavía no está reservado/)
assert.equal(guidedCopies, copiesBeforeGuidedProposal)
assert.ok(!guidedRuntime.statements.some(query => /INSERT INTO "(?:Appointment|BookingVisit)"/.test(query.sql)))
console.log('conversational public runtime guided choice/dual duration120-180/fourth argument/sidecar/proposal-only: PASS')
// Typing starts only after a durable active text snapshot; it never delays computation.
let typingCalls = 0
const typing = runtimeFixture({ onPreparingReply(context) {
  typing.assertOutside(); typingCalls++
  assert.equal(typing.messages, 1, 'snapshot projection committed before hook')
  assert.deepEqual(context, { businessId: 'biz', providerPhoneNumberId: 'channel', providerMessageId: 'msg' })
  return new Promise<void>(() => {})
} })
await typing.run()
assert.equal(typingCalls, 1, 'public entry forwards the optional post-snapshot hook')
assert.equal(typing.replies.length, 1, 'an unresolved typing request must not block the reply')
for (const fail of ['throw', 'reject'] as const) {
  const broken = runtimeFixture({ onPreparingReply() {
    if (fail === 'throw') throw new Error('typing failure')
    return Promise.reject(new Error('typing failure'))
  } })
  await broken.run(); await Promise.resolve()
  assert.equal(broken.replies.length, 1, 'typing errors are fail-open')
}
for (const guard of ['image', 'processed', 'handoff', 'disabled', 'rollback'] as const) {
  let calls = 0
  const guarded = runtimeFixture({ failSnapshotCommit: guard === 'rollback', onPreparingReply() { calls++ } })
  if (guard === 'image') guarded.next('', 'image')
  if (guard === 'processed') guarded.row.status = 'PROCESSED'
  if (guard === 'disabled') guarded.row.botEnabled = false
  if (guard === 'handoff') {
    await guarded.run(); calls = 0
    guarded.next('hola'); guarded.session.status = 'HUMAN_TAKEN'
  }
  if (guard === 'rollback') await assert.rejects(guarded.run(), /SNAPSHOT COMMIT failed/)
  else await guarded.run()
  assert.equal(calls, 0, `typing must skip ${guard}`)
}
console.log('conversational post-snapshot typing guard/fail-open: PASS')
// Five durable parts are one computation; a new durable input during compute invalidates it.
const five = runtimeFixture()
five.inputs([{ id: 'event', text: 'quiero' }, { id: 'b', text: 'corte' }, { id: 'c', text: 'hoy' },
  { id: 'd', text: 'no, mañana' }, { id: 'e', text: 'con Ana' }])
let fullText = ''
await five.run('PROCESS_INBOX', { provider: async input => {
  fullText = input.message
  return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
    firstReply: { opening: 'Entendido', factIds: [], closing: null } }
}, timeoutMs: 4500 })
assert.equal(fullText, 'quiero corte hoy no, mañana con Ana', 'all durable text belongs to one input, not five replies')
assert.equal(five.replies.length, 1)
// Execute the exact production settlement statement, including covered unclassified journal rows.
const settlementSql = five.statements.find(q => q.sql.includes('settled_inbox'))!
const settlementDb = new PGlite()
try {
  await settlementDb.exec(`

    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TYPE "ConversationStep" AS ENUM ('BOOKING_IN_PROGRESS','IDLE');
    CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','INVALIDATED','RESOLVED');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','SENDING','UNKNOWN');
    CREATE TABLE "BotSession" ("id" text PRIMARY KEY,"businessId" text,"conversationId" text,"state" jsonb,"revision" bigint,"status" "BotSessionStatus",
      "handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" integer,"updatedAt" timestamptz,"draftTouchedAt" timestamptz,"draftExpiresAt" timestamptz);
    CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" integer,
      "revisionFrom" bigint,"revisionTo" bigint,"actionType" text,"outcome" text,"providerEventId" text,"detail" jsonb);
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY,"businessId" text,"currentStep" "ConversationStep","updatedAt" timestamptz);
    CREATE TABLE "BotPrompt" ("id" text PRIMARY KEY,"sessionId" text,"status" "BotPromptStatus","resolvedAt" timestamptz);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"deliveryGroupId" text,"sequence" integer,
      "kind" text,"payload" jsonb,"idempotencyKey" text UNIQUE,"status" "BotOutboxStatus","dependsOnSequence" integer,"availableAt" timestamptz,"updatedAt" timestamptz);
    INSERT INTO "BotSession" VALUES ('session','biz','conversation','{}',0,'ACTIVE',NULL,0,NULL,NULL,NULL);
    INSERT INTO "Conversation" VALUES ('conversation','biz','IDLE',NULL);
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','CLAIMED','SELECTED','CONFLICT','PROCESSED');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','DONE');
    CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','DONE');
    CREATE TABLE "BotActionInbox" ("id" text,"businessId" text,"providerEventId" text,"status" "BotInboxStatus","error" text);
    CREATE TABLE "BotProviderEvent" ("id" text,"businessId" text,"status" "BotProviderEventStatus");
    CREATE TABLE "BotDispatchClaim" ("id" text,"claimToken" text,"status" "BotDispatchStatus","updatedAt" timestamptz);
    CREATE TABLE "BotJob" ("id" text,"status" "BotJobStatus","leaseToken" text,"leasedUntil" timestamptz,"lastError" text,"updatedAt" timestamptz);
    INSERT INTO "BotActionInbox" VALUES ('inbox','biz','event','ADMITTED',NULL),('other-inbox','biz','b','CLAIMED',NULL),('foreign-inbox','foreign','c','ADMITTED',NULL);
    INSERT INTO "BotProviderEvent" VALUES ('event','biz','ADMITTED'),('b','biz','ADMITTED'),('c','biz','ADMITTED'),('d','biz','ADMITTED'),('e','biz','ADMITTED'),('c','foreign','ADMITTED');
    INSERT INTO "BotDispatchClaim" VALUES ('own','dispatch-token','CLAIMED',clock_timestamp()),('other','other-token','CLAIMED',clock_timestamp());
    INSERT INTO "BotJob" VALUES ('job-0','LEASED','job-token',clock_timestamp(),NULL,clock_timestamp()),('other-job','LEASED','other-lease',clock_timestamp(),NULL,clock_timestamp());
  `)
  const before = await settlementDb.query(`SELECT * FROM "BotProviderEvent" ORDER BY "businessId","id"`)
  await assert.rejects(settlementDb.transaction(async tx => { await tx.query(settlementSql.text,settlementSql.values); throw new Error('settlement rollback') }), /settlement rollback/)
  assert.deepEqual((await settlementDb.query(`SELECT * FROM "BotProviderEvent" ORDER BY "businessId","id"`)).rows,before.rows)
  const counts=(await settlementDb.query<{inboxCount:number;dispatchCount:number;jobCount:number}>(settlementSql.text,settlementSql.values)).rows[0]!
  assert.equal(Number(counts.inboxCount),1);assert.equal(Number(counts.dispatchCount),1);assert.equal(Number(counts.jobCount),1)
  assert.deepEqual((await settlementDb.query<{status:string}>(`SELECT "status" FROM "BotProviderEvent" WHERE "businessId"='biz'`)).rows.map(r=>r.status),Array(5).fill('PROCESSED'))
  assert.equal((await settlementDb.query<{status:string}>(`SELECT "status" FROM "BotActionInbox" WHERE "id"='other-inbox'`)).rows[0]!.status,'PROCESSED')
  assert.equal((await settlementDb.query<{status:string}>(`SELECT "status" FROM "BotActionInbox" WHERE "id"='foreign-inbox'`)).rows[0]!.status,'ADMITTED')
  assert.equal((await settlementDb.query<{status:string}>(`SELECT "status" FROM "BotJob" WHERE "id"='other-job'`)).rows[0]!.status,'LEASED')
  assert.equal((await settlementDb.query<{status:string}>(`SELECT "status" FROM "BotDispatchClaim" WHERE "id"='other'`)).rows[0]!.status,'CLAIMED')
  console.log('conversational exact settlement SQL: coverage, raw journal, foreign leases, tenant, rollback PASS')
} finally { await settlementDb.close() }
const during = runtimeFixture()
let release!: () => void
let entered!: () => void
const computing = new Promise<void>(resolve => { entered = resolve })
const aiGate = new Promise<void>(resolve => { release = resolve })
const pending = during.run('PROCESS_INBOX', { provider: async () => {
  entered(); await aiGate
  return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
    firstReply: { opening: 'Obsolete', factIds: [], closing: null } }
}, timeoutMs: 4500 })
await computing
during.inputs([{ id: 'event', text: 'hoy' }, { id: 'late', text: 'no, mañana' }])
release()
assert.equal(await pending, 'STALE_REVISION')
assert.equal(during.replies.length, 0, 'no outbox survives a changed coverage set')
assert.equal(during.retried, 1)
await during.run()
assert.equal(during.replies.length, 1, 'the existing durable job can retry the latest complete input')
console.log('conversational consolidation public worker/compute invalidation: PASS')
// Final ACK evidence comes from the existing final transaction, never snapshot or rollback.
for (const fail of [false, true]) {
  const queueMilestones = createQueueMilestoneTracker({ businessId: 'biz', now: () => 100, emit() {} })
  const measured = runtimeFixture({ queueMilestones })
  const unmeasured = runtimeFixture()
  if (fail) { measured.failCommit(); unmeasured.failCommit() }
  if (fail) {
    await assert.rejects(measured.run(), /COMMIT failed/)
    await assert.rejects(unmeasured.run(), /COMMIT failed/)
  } else {
    assert.equal(await measured.run(), await unmeasured.run())
  }
  assert.equal(queueMilestones.retainedCount, fail ? 0 : 1, 'only committed outbox gains an ACK marker')
  assert.deepEqual(measured.statements.map(q => q.sql), unmeasured.statements.map(q => q.sql), 'queue instrumentation does not change SQL/ordering')
  assert.deepEqual(measured.replies, unmeasured.replies)
}
// The combined write projects CRM data, but the public entry only emits after commit.
for (const fail of [false, true]) {
  const projected = runtimeFixture()
  if (fail) projected.failCommit()
  let events = 0
  const unsubscribe = subscribeToCrmRealtimeEvents({ businessId: 'biz', send(event) {
    if (event.type === 'conversation_updated') { projected.assertOutside(); events++ }
  } })
  try {
    if (fail) await assert.rejects(projected.run(), /COMMIT failed/)
    else await projected.run()
    assert.equal(events, fail ? 0 : 1)
  } finally { unsubscribe() }
}

// C09: creation and lazy context retain the second lock; an unchanged locked session does not need it.
const snapshotLocks = runtimeFixture()
const sessionLockCount = () => snapshotLocks.statements.filter(q => q.sql.includes('s."id" AS "sessionId", c."id" AS "conversationId"')).length
await snapshotLocks.run()
assert.equal(sessionLockCount(), 3, 'new session snapshot must reload after insertion plus final lock')
snapshotLocks.next('hola')
const locksBeforeExisting = sessionLockCount()
await snapshotLocks.run()
assert.equal(sessionLockCount() - locksBeforeExisting, 2, 'existing evaluated context reuses locked session; final transaction still locks freshly')
snapshotLocks.next('hola')
snapshotLocks.row.payload.contextWindowEvaluated = false
const locksBeforeLazy = sessionLockCount()
await snapshotLocks.run()
assert.equal(sessionLockCount() - locksBeforeLazy, 3, 'lazy context path always reloads session')

async function captureRuntimeMetrics<T>(operation: () => Promise<T>, events: AttemptMetricEvent[], throwingSink = false): Promise<T> {
  const original = console.info
  console.info = (...args: unknown[]) => {
    if (args[0] === '[bot-options-attempt-stage]') {
      events.push(JSON.parse(String(args[1])) as AttemptMetricEvent)
      if (throwingSink) throw new Error('metrics sink private unavailable')
    }
  }
  try { return await operation() } finally { console.info = original }
}
const { processConversationInbox } = await import('../src/conversational-bot/process-inbox-job.js')
const { withAttemptMetrics } = await import('../src/bot-options/observability/attempt-metrics.js')
const absentPolicy: AttemptMetricEvent[] = []
assert.equal(await withAttemptMetrics({ jobId: 'missing-policy', attempt: 1 }, () => processConversationInbox({
  client: { $queryRaw: async () => [] }, job: { businessId: 'biz', deploymentId: 'dep', deploymentGeneration: 1 }
} as never), { emit: event => absentPolicy.push(event) }), null)
assert.deepEqual(absentPolicy.map(event => event.stage), ['conversation_policy_load', 'attempt'], 'absent policy never begins claims or transactions')
const spanRuntime = runtimeFixture()
const spans: AttemptMetricEvent[] = []
await captureRuntimeMetrics(() => spanRuntime.run(), spans)
const stages = spans.map(event => event.stage)
assert.equal(spanRuntime.statements.filter(q => q.sql.includes('conversation-turn-persist') || q.sql.includes('inserted_outbox') || q.sql.includes('settled_inbox')).length, 1, 'final text persistence uses one SQL trip, not three')
assert.equal(spanRuntime.statements.filter(q => q.sql.includes('conversation-turn-persist')).length, 1, 'final session/transition/step use one production statement')
assert.equal(spanRuntime.statements.filter(q => q.sql.includes('conversation-claims-assert')).length, 2,
  'snapshot and final each batch claim guards into one query')
for (const guard of spanRuntime.statements.filter(q => q.sql.includes('conversation-claims-assert'))) {
  const position = spanRuntime.statements.indexOf(guard)
  const gate = spanRuntime.statements[position - 3]
  const identity = spanRuntime.statements[position - 2]
  const phoneGate = spanRuntime.statements[position - 1]
  assert.ok(gate?.sql.includes('pg_advisory_xact_lock_shared'), 'one standalone cutover gate precedes identity and phone acquisition')
  assert.ok(identity?.sql.includes('consolidation-inbox-identity'))
  assert.ok(phoneGate?.sql.includes('pg_advisory_xact_lock('), 'fresh claims validation follows phone acquisition without reacquiring cutover')
  assert.ok(!guard.sql.includes('pg_advisory_xact_lock_shared'), 'guard SQL must not take its snapshot before the gate wait')
}
for (const stage of [
  'conversation_policy_load', 'conversation_target_read', 'conversation_dispatch_acquire',
  'conversation_snapshot_transaction_start_wait', 'conversation_snapshot_transaction_body',
  'conversation_snapshot_transaction_tail', 'conversation_snapshot_transaction_total',
  'conversation_claims_assert', 'conversation_feature_lock', 'conversation_inbox_lock',
  'conversation_order_read', 'conversation_conversation_upsert', 'conversation_session_lock', 'conversation_inbound_project',
  'conversation_session_create', 'conversation_inbox_attach', 'conversation_context_load', 'conversation_catalog_load', 'conversation_compute',
  'conversation_final_transaction_start_wait', 'conversation_final_transaction_body',
  'conversation_final_transaction_tail', 'conversation_final_transaction_total',
  'conversation_turn_persist'
]) assert.ok(stages.includes(stage as never), `missing runtime span: ${stage}`)
assert.ok(spans.every(event => event.durationMs >= 0 && event.outcome === 'ok'))
assert.ok(!stages.some(stage => ['conversation_session_save', 'conversation_step_project', 'conversation_transition_insert'].includes(stage)), 'combined final write has no fictitious individual timings')
assert.doesNotMatch(JSON.stringify(spans), /phone|Corte|SELECT|INSERT|job-0|dispatch-token/, 'metrics must exclude values, recipient and SQL')
assert.equal(spanRuntime.statements.filter(q => q.sql.includes('settled_inbox')).length, 1,
  'successful final transaction settles inbox/event/dispatch/job in one query')
assert.equal(spanRuntime.replies.length, 1)
const cleanRuntime = runtimeFixture()
await captureRuntimeMetrics(() => cleanRuntime.run(), [], true)
assert.deepEqual(cleanRuntime.statements.map(q => q.sql), spanRuntime.statements.map(q => q.sql), 'failed metric sink must not alter SQL or ordering')
assert.deepEqual(cleanRuntime.replies, spanRuntime.replies)
for (const failure of ['commit', 'body'] as const) {
  const failed = runtimeFixture({ failAfterSessionCreate: failure === 'body' })
  if (failure === 'commit') failed.failCommit()
  const errors: AttemptMetricEvent[] = []
  await assert.rejects(captureRuntimeMetrics(() => failed.run(), errors, true), failure === 'commit' ? /COMMIT failed/ : /session creation interrupted/)
  const phase = failure === 'commit' ? 'final' : 'snapshot'
  assert.equal(errors.find(event => event.stage === `conversation_${phase}_transaction_tail`)!.outcome, 'error')
  assert.equal(errors.find(event => event.stage === `conversation_${phase}_transaction_total`)!.outcome, 'error')
  assert.equal(errors.find(event => event.stage === 'conversation_dispatch_release')!.outcome, 'ok')
  assert.equal(failed.row.status, 'ADMITTED'); assert.equal(failed.replies.length, 0)
}
const metricRetry = runtimeFixture()
metricRetry.block(true)
const retrySpans: AttemptMetricEvent[] = []
await captureRuntimeMetrics(() => metricRetry.run(), retrySpans)
assert.ok(retrySpans.some(event => event.stage === 'conversation_job_reschedule'))
assert.ok(!retrySpans.some(event => event.stage === 'conversation_final_transaction_total'))
assert.equal(metricRetry.retried, 1)
console.log('conversational detailed runtime spans/rollback/fail-open: PASS')
// Only session creation executes against real PostgreSQL/WASM; other fixture paths stay offline.
// Default PGlite storage is memory-only: no DATABASE_URL, persistent files or remote effects.
const sessionDb = new PGlite()
try {
  await sessionDb.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE "BotSession" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "conversationId" text,
      "deploymentId" text NOT NULL, "deploymentGeneration" integer NOT NULL,
      "businessTimezone" text NOT NULL, "state" jsonb NOT NULL, "revision" bigint NOT NULL,
      "updatedAt" timestamp(3) NOT NULL, "draftTouchedAt" timestamp(3), "draftExpiresAt" timestamp(3)
    );
  `)
  const admittedAt = new Date('2026-10-01T23:45:12.345Z')
  const midnight = runtimeFixture({ sessionDb, now: admittedAt })
  try { await midnight.run() } catch (error) {
    console.error('real conversation-create-session SQL failure:', (error as { code?: string }).code)
    throw error
  }
  const saved = (await sessionDb.query<{ id: string; draftTouchedAt: Date; draftExpiresAt: Date }>(
    `SELECT "id", "draftTouchedAt" AT TIME ZONE 'UTC' AS "draftTouchedAt",
      "draftExpiresAt" AT TIME ZONE 'UTC' AS "draftExpiresAt" FROM "BotSession"`
  )).rows
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.id, midnight.session.sessionId, 'fixture and SQL share the actual inserted ID')
  assert.equal(saved[0]!.draftTouchedAt.toISOString(), admittedAt.toISOString(), 'admitted time persists exactly')
  assert.equal(saved[0]!.draftExpiresAt.toISOString(), '2026-10-02T23:45:12.345Z', 'expiry advances into the next day')
  assert.equal(saved[0]!.draftExpiresAt.getTime() - admittedAt.getTime(), 24 * 60 * 60 * 1000)
  assert.equal(midnight.row.status, 'PROCESSED')
  assert.equal(midnight.replies.length, 1, 'successful SQL creation reaches the reply')

  await sessionDb.exec('TRUNCATE "BotSession"')
  const interrupted = runtimeFixture({ sessionDb, now: admittedAt, failAfterSessionCreate: true })
  await assert.rejects(interrupted.run(), /session creation interrupted/)
  assert.equal((await sessionDb.query('SELECT "id" FROM "BotSession"')).rows.length, 0, 'SQL creation rolls back with the fixture transaction')
  assert.equal(interrupted.session, null)
  assert.equal(interrupted.row.status, 'ADMITTED')
  assert.equal(interrupted.messages, 0)
  assert.equal(interrupted.replies.length, 0)
  console.log('conversational real PostgreSQL session timestamps/rollback: PASS')
} finally { await sessionDb.close() }

const runtime = runtimeFixture()
await runtime.run()
assert.equal(runtime.session.state && (runtime.session.state as typeof projected).flow, 'DATE_SELECT')
assert.equal(runtime.replies.length, 1)
assert.match(runtime.replies[0]!, /día/)
assert.equal(runtime.row.status, 'PROCESSED')
runtime.next('mañana'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02')
runtime.next('Ana'); await runtime.run()
runtime.next('14:00'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).flow, 'NAME_INPUT')
runtime.next('soy Lucia'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).flow, 'BOOKING_SUMMARY')
assert.equal((runtime.session.state as typeof projected).booking, 'DRAFT')
assert.equal((runtime.session.state as typeof projected).selections.professionalId, 'ana')
const beforeInfo = structuredClone((runtime.session.state as typeof projected).conversationDraft.dialogue)
runtime.next('que servicios hay'); await runtime.run()
assert.deepEqual((runtime.session.state as typeof projected).conversationDraft.dialogue, beforeInfo)
runtime.next('', 'image'); await runtime.run()
assert.deepEqual((runtime.session.state as typeof projected).conversationDraft.dialogue, beforeInfo)
assert.match(runtime.replies.at(-1)!, /Recibí tu archivo, pero no analicé su contenido/, 'no-AI attachment fallback is honest and asks its purpose')

// P16: an attachment is a conversational event, not evidence of payment.
// Only bounded metadata and its caption may enter the existing interpreter.
for (const [type, caption] of [['image', 'este es el color que quiero'], ['document', 'te paso una referencia'], ['image', '']] as const) {
  const attachmentRuntime = runtimeFixture()
  await attachmentRuntime.run()
  const beforeAttachment = structuredClone(readConversationDraft(attachmentRuntime.session.state, policy, 'UTC'))
  attachmentRuntime.next(caption, type)
  Object.assign(attachmentRuntime.row.payload, { mediaId: 'PRIVATE_MEDIA_ID', mediaMimeType: type === 'image' ? 'image/jpeg' : 'application/pdf', filename: 'PRIVATE_CUSTOMER_FILE.pdf' })
  const inputs: unknown[] = []
  const provider: AiInterpretationProvider = async input => {
    attachmentRuntime.assertOutside()
    inputs.push(input)
    return { ...runtimeCandidate(), attachmentIntent: caption ? 'service_reference' : 'unclear' }
  }
  await attachmentRuntime.run('PROCESS_INBOX', { provider, timeoutMs: 1000 })
  assert.equal(inputs.length, 1, 'P16 non-financial media must use one contextual AI interpretation, not the text-only rejection')
  const input = inputs[0] as { message: string; attachment?: { messageType: string; mimeType: string | null; proofExpected: boolean } }
  assert.equal(input.attachment?.messageType, type)
  assert.equal(input.attachment?.proofExpected, false, 'an arbitrary attachment cannot acquire a payment target')
  assert.doesNotMatch(JSON.stringify(input), /PRIVATE_MEDIA_ID|PRIVATE_CUSTOMER_FILE|https:\/\//, 'no attachment identifier, filename or download URL is sent to AI')
  assert.deepEqual(readConversationDraft(attachmentRuntime.session.state, policy, 'UTC'), beforeAttachment, 'non-financial attachment must retain the booking draft')
  assert.doesNotMatch(attachmentRuntime.replies.at(-1)!, /necesito que me escribas.*texto|comprobante recibido|pago aprobado/i)
  assert.ok(!attachmentRuntime.statements.some(q => q.values.includes('RECEIVE_DEPOSIT_PROOF')), 'service references cannot enqueue financial mutations')
}
runtime.next('/reiniciar'); await runtime.run()
assert.deepEqual(runtime.session.state, createInitialBotOptionsState(), 'restart removes the sidecar')
runtime.next('hola'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)


const barberResetId = 'cmpvr0oqo0000o0vcnhgyv054'
const barberResetPolicy = { businessId: barberResetId, deploymentId: 'dep', generation: 1, configurationId: 'cfg' }
const resetRuntime = runtimeFixture({ businessId: barberResetId })
await resetRuntime.run()
const resetBeforeRevision = resetRuntime.session.revision
const resetBeforeMessages = resetRuntime.messages
resetRuntime.session.state = projectConversationDraft({ ...initialDialogueState(barberResetId), introduced: true, customerName: 'Ana',
  date: '2026-10-02', serviceId: 'cut', pending: 'date',
  referral: { businessId: barberResetId, status: 'pending', reason: 'UNVERIFIED_SERVICE', request: 'otro', serviceId: null } }, barberResetPolicy)
resetRuntime.next('/reset')
await resetRuntime.run('PROCESS_INBOX', { provider: async () => { throw new Error('scoped reset must not call AI') }, timeoutMs: 10 })
assert.deepEqual(resetRuntime.session.state, createInitialBotOptionsState(), '/reset Barber clears the complete sidecar')
assert.equal(resetRuntime.session.revision, resetBeforeRevision + 1n)
assert.equal(resetRuntime.messages, resetBeforeMessages + 1, 'reset appends the inbound without removing CRM history')
assert.match(resetRuntime.replies.at(-1)!, /no.*cancel|conserv/i)
for (const ownership of ['HUMAN_QUEUED', 'HUMAN_TAKEN']) {
  const owned = runtimeFixture({ businessId: barberResetId }); await owned.run()
  owned.session.status = ownership; const before = structuredClone(owned.session)
  owned.next('/reset'); await owned.run()
  assert.deepEqual(owned.session, before, 'reset must not take human ownership: ' + ownership)
}
const foreignReset = runtimeFixture(); await foreignReset.run()
const foreignBefore = structuredClone(foreignReset.session.state)
foreignReset.next('/reset')
await foreignReset.run('PROCESS_INBOX', { provider: async () => ({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }), timeoutMs: 100 })
assert.deepEqual(foreignReset.session.state, foreignBefore, 'other businesses do not gain /reset')
for (const status of ['PENDING', 'CLAIMED', 'RETRY', 'SENDING', 'UNKNOWN', 'STARTED']) {
  const pending = runtimeFixture({ businessId: barberResetId, pendingEffect: status }); await pending.run()
  const before = structuredClone(pending.session)
  pending.next('/reset'); await pending.run('PROCESS_INBOX', { provider: async () => { throw new Error('reset cannot call AI') }, timeoutMs: 10 })
  assert.deepEqual(pending.session, before, 'pending effect is not erased: ' + status)
  assert.equal(pending.retried, 0, 'reset cannot retry an uncertain effect')
  assert.match(pending.replies.at(-1)!, /No reinicié/)
}
const lateEffect = runtimeFixture({ businessId: barberResetId }); await lateEffect.run()
const lateBefore = structuredClone(lateEffect.session)
lateEffect.hook(() => lateEffect.pendingEffect('UNKNOWN')); lateEffect.next('/reset'); await lateEffect.run()
assert.deepEqual(lateEffect.session, lateBefore, 'fresh commit guard preserves effects appearing after snapshot')
assert.match(lateEffect.replies.at(-1)!, /No reinicié/)
assert.equal(resetRuntime.statements.filter(q => q.sql.includes('test-reset-pending-effects')).length, 2, 'snapshot and commit both check effects')
console.log('scoped Barber reset: zero AI, complete draft, CRM, pending effects and real human ownership guards PASS')

// Actual worker -> scoped financial reader -> session/transition/CRM persistence.
const financialRead={rows:[] as Record<string,unknown>[],lines:[] as unknown[],items:[] as unknown[]}
const financialRuntime=runtimeFixture({businessId:barberResetId,phone:'5491112345678',financialRead});await financialRuntime.run()
const financialScope={businessId:barberResetId,sessionId:financialRuntime.session.sessionId,deploymentId:'dep',generation:1,revision:String(financialRuntime.session.revision),configurationId:'cfg',dispatchFenceEpoch:1,handoffFenceEpoch:0}
const financialTerms:RuntimeBookingTerms={version:1,businessId:barberResetId,timezone:'UTC',date:'2026-10-02',customerName:'Ana',preference:{kind:'specific',id:'p1'},totalPriceMinor:1000,
  segments:[{serviceId:'cut',serviceName:'Corte',professionalId:'p1',professionalName:'Ana',startAt:'2026-10-02T10:00:00.000Z',endAt:'2026-10-02T10:30:00.000Z',durationMinutes:30,customerDurationMinutes:30,priceMinor:1000,priceMode:'FIXED',configurationHash:null}],
  deposit:{financial:{amount:100,ttlMinutes:60,ttlProvenance:'BUSINESS_POLICY',lines:[{serviceId:'cut',sortOrder:0,serviceName:'Corte',mode:'FIXED',configuredValue:100,baseAmount:null,amount:100}]},payment:{transferEnabled:true,alias:'salon.test',cbu:null,cvu:null,paymentLinkEnabled:false,paymentLink:null}}}
const financialPresented:RuntimePresentedBooking={version:1,scope:financialScope,nonce:randomUUID(),fingerprint:runtimeBookingFingerprint(financialTerms),conditionsPresented:true,terms:financialTerms}
const financialReceipt:RuntimeHeldReceipt={kind:'HELD',coordinationGroupId:'group',proposalNonce:financialPresented.nonce,fingerprint:financialPresented.fingerprint,appointments:[{segmentIndex:0,appointmentId:'appointment',visitId:'visit'}],operationKey:'financial-operation',depositId:'deposit',amount:100,expiresAt:'2026-10-01T13:00:00.000Z',depositStatus:'PENDING_PROOF'}
financialRuntime.session.state=projectConversationDraft({...initialDialogueState(barberResetId),serviceId:'cut',customerName:'Ana',date:financialTerms.date,professional:financialTerms.preference,pending:'proposal',slot:{date:financialTerms.date,time:'10:00',startAt:financialTerms.segments[0]!.startAt,professionalId:'p1',professionalName:'Ana',band:'MORNING',occupiedMinutes:0},bookingReservation:{presented:financialPresented,receipt:financialReceipt}},barberResetPolicy)
financialRead.lines=financialTerms.deposit!.financial.lines
financialRead.items=[{serviceId:'cut',sortOrder:0,durationMinutes:30,price:1000}]
financialRead.rows=[{appointmentId:'appointment',visitId:'visit',serviceId:'cut',professionalId:'p1',startAt:financialTerms.segments[0]!.startAt,duration:30,quotedPrice:1000,appointmentStatus:'CONFIRMED',visitStatus:'CONFIRMED',scheduledStartAt:financialTerms.segments[0]!.startAt,visitDuration:30,visitPrice:1000,depositId:'deposit',amount:100,expiresAt:financialReceipt.expiresAt,depositStatus:'APPROVED',holdTtlMinutes:60,holdTtlProvenance:'BUSINESS_POLICY',snapshotSealedAt:new Date(),businessAddress:'Calle ficticia 123',parentHash:runtimeBookingRequestHash({kind:'RUNTIME',...financialScope,revision:financialRuntime.session.revision,canonicalPhone:'5491112345678',operationKey:'read',newBookingAllowed:false},financialPresented),childHash:runtimeBookingChildRequestHash(runtimeBookingChildInput(financialPresented,financialReceipt.operationKey,0,false),true)}]
// P16 public worker: the bound financial job is produced without falsely
// acknowledging a received proof. The proof worker owns validation and the ack.
const approvedFinancialRows = structuredClone(financialRead.rows)
for (const [type,mime] of [['image','image/jpeg'],['document','application/pdf'],['document','image/png']] as const) {
  financialRead.rows = approvedFinancialRows.map(row => ({...row,appointmentStatus:'PENDING',visitStatus:'HELD',depositStatus:'PENDING_PROOF'}))
  financialRuntime.next('',type)
  Object.assign(financialRuntime.row.payload,{mediaId:'PRIVATE_PROOF_ID',mediaMimeType:mime,filename:'PRIVATE_BANK_FILE'})
  let calls=0
  const replyCount=financialRuntime.replies.length
  const jobsBefore=financialRuntime.statements.filter(q=>q.values.includes('RECEIVE_DEPOSIT_PROOF')).length
  await financialRuntime.run('PROCESS_INBOX',{provider:async input=>{
    calls++
    assert.equal((input as {attachment?:{proofExpected:boolean}}).attachment?.proofExpected,true)
    assert.doesNotMatch(JSON.stringify(input),/PRIVATE_PROOF_ID|PRIVATE_BANK_FILE/)
    return {...runtimeCandidate(),attachmentIntent:'deposit_proof'}
  },timeoutMs:1000})
  assert.equal(calls,1)
  assert.equal(financialRuntime.statements.filter(q=>q.values.includes('RECEIVE_DEPOSIT_PROOF')).length,jobsBefore+1)
  assert.equal(financialRuntime.replies.length,replyCount,'no proof success or payment confirmation precedes durable validation')
  const bindingSql=financialRuntime.statements.filter(q=>q.sql.includes('conversation-proof-bind')).at(-1)!
  const binding=JSON.parse(bindingSql.values.find(v=>typeof v==='string'&&v.startsWith('{')) as string)
  assert.equal(binding.depositId,'deposit')
  assert.equal(binding.sessionId,financialRuntime.session.sessionId)
  assert.equal(binding.proposalNonce,financialPresented.nonce)
  assert.equal((financialRuntime.session.state as {deposit:string}).deposit,'PENDING_PROOF')
}
// Context beats an available financial target: a color reference remains non-financial.
const proofJobCount=financialRuntime.statements.filter(q=>q.values.includes('RECEIVE_DEPOSIT_PROOF')).length
financialRuntime.next('este es el color que quiero','image')
await financialRuntime.run('PROCESS_INBOX',{provider:async()=>({...runtimeCandidate(),attachmentIntent:'service_reference'}),timeoutMs:1000})
assert.equal(financialRuntime.statements.filter(q=>q.values.includes('RECEIVE_DEPOSIT_PROOF')).length,proofJobCount)
assert.match(financialRuntime.replies.at(-1)!,/referencia/)
assert.equal((financialRuntime.session.state as {deposit:string}).deposit,'PENDING_PROOF')
financialRuntime.next('','image')
await financialRuntime.run('PROCESS_INBOX',{provider:async()=>({...runtimeCandidate(),attachmentIntent:'unclear'}),timeoutMs:1000})
assert.match(financialRuntime.replies.at(-1)!,/reenviá el comprobante/, 'ambiguous attachment has an actionable next step, not an unbound yes loop')
assert.equal(financialRuntime.statements.filter(q=>q.values.includes('RECEIVE_DEPOSIT_PROOF')).length,proofJobCount)
financialRead.rows=approvedFinancialRows
console.log('P16 contextual image/document proof binding, privacy, one AI call and no premature ack: PASS')
const protectedBefore=structuredClone(financialRuntime.session)
financialRuntime.next('/reset');await financialRuntime.run('PROCESS_INBOX',{provider:async()=>{throw new Error('financial reset cannot call AI')},timeoutMs:10})
assert.deepEqual(financialRuntime.session,protectedBefore,'financial obligation cannot be reset even with empty outbox/complete operation')
assert.match(financialRuntime.replies.at(-1)!,/No reinicié/)
const persistedBefore=financialRuntime.statements.filter(q=>q.sql.includes('conversation-turn-persist')).length
financialRuntime.next('Ya pagué');await financialRuntime.run('PROCESS_INBOX',{provider:async()=>{throw new Error('protected financial status uses real rows, not AI')},timeoutMs:10})
assert.equal((financialRuntime.session.state as {booking:string}).booking,'CONFIRMED')
assert.equal((financialRuntime.session.state as {deposit:string}).deposit,'APPROVED')
assert.match(financialRuntime.replies.at(-1)!,/La reserva fue confirmada/)
assert.equal(financialRuntime.statements.filter(q=>q.sql.includes('conversation-turn-persist')).length,persistedBefore+1,'financial status needs normal revision/transition and CRM projection')
const financialPersist=financialRuntime.statements.filter(q=>q.sql.includes('conversation-turn-persist')).at(-1)!
assert.ok(financialPersist.values.includes('conversation.financial.reconcile'))
assert.ok(financialPersist.values.includes('COMPLETED'))
console.log('P12 financial protected public reader/reset/session/history/CRM projection: PASS')

// P17: durable expired holds are history, not permission to replay their proposals.
async function expiredRuntime(status = 'EXPIRED', pendingEffect?: string) {
  const reads = structuredClone(financialRead)
  const runtime = runtimeFixture({ businessId: barberResetId, phone: '5491112345678', financialRead: reads, ...(pendingEffect ? { pendingEffect } : {}) })
  await runtime.run()
  const presented = structuredClone(financialPresented)
  presented.scope = { ...presented.scope, sessionId: runtime.session.sessionId, revision: String(runtime.session.revision) }
  const receipt = { ...financialReceipt, depositStatus: 'EXPIRED' as const, businessAddress: 'Calle ficticia 123' }
  const draft = { ...initialDialogueState(barberResetId), customerName: 'Ana', introduced: true,
    serviceId: 'cut', date: financialTerms.date, professional: financialTerms.preference, pending: 'proposal' as const,
    slot: { date: financialTerms.date, time: '10:00', startAt: financialTerms.segments[0]!.startAt,
      professionalId: 'p1', professionalName: 'Ana', band: 'MORNING' as const, occupiedMinutes: 0 },
    bookingReservation: { presented, receipt } }
  runtime.session.state = projectConversationDraft(draft, barberResetPolicy)
  reads.rows = approvedFinancialRows.map(row => ({ ...row, depositStatus: status,
    appointmentStatus: status === 'EXPIRED' ? 'CANCELLED' : 'PENDING',
    visitStatus: status === 'EXPIRED' ? 'EXPIRED' : status === 'PROOF_RECEIVED' ? 'PENDING_PAYMENT_REVIEW' : 'HELD',
    parentHash: runtimeBookingRequestHash({ kind: 'RUNTIME', ...presented.scope, revision: runtime.session.revision,
      canonicalPhone: '5491112345678', operationKey: 'read', newBookingAllowed: false }, presented) }))
  return { runtime, reads }
}
const expiredFailures: string[] = []
async function expiredCheck(label: string, work: () => Promise<void>) {
  try { await work(); console.log('PASS P17 ' + label) }
  catch (error) { expiredFailures.push(label + ': ' + String(error)); console.error('FAIL P17 ' + label + ': ' + String(error)) }
}
await expiredCheck('greeting and new booking intent reach AI without the expired proposal', async () => {
  for (const text of ['hola soy Matías', 'quiero reservar corte']) {
    const { runtime, reads } = await expiredRuntime(), before = structuredClone(reads)
    let calls = 0
    let sentState: ReturnType<typeof initialDialogueState> | undefined
    runtime.next(text)
    await runtime.run('PROCESS_INBOX', { provider: async input => {
      calls++
      sentState = structuredClone(input.state)
      return runtimeCandidate()
    }, timeoutMs: 1000 })
    assert.equal(calls, 1, 'a fresh intention after durable expiry must reach the existing AI path')
    assert.ok(sentState, 'the input must be observed independently of provider fallback')
    assert.equal(sentState.bookingReservation, undefined)
    assert.equal(sentState.slot, null)
    assert.notEqual(sentState.pending, 'proposal')
    assert.doesNotMatch(runtime.replies.at(-1)!, /Venció el plazo|no inicié otra reserva/)
    assert.deepEqual(reads, before, 'conversation recovery never changes financial records')
    assert.ok(!runtime.statements.some(q => /INSERT INTO "Appointment"|UPDATE "BookingDeposit"|DELETE FROM/.test(q.sql)))
  }
})
await expiredCheck('Barber reset clears only conversation memory after durable expiry', async () => {
  const { runtime, reads } = await expiredRuntime(), before = structuredClone(reads), messages = runtime.messages
  runtime.next('/reset')
  await runtime.run('PROCESS_INBOX', { provider: async () => { throw new Error('reset AI forbidden') }, timeoutMs: 10 })
  assert.deepEqual(runtime.session.state, createInitialBotOptionsState())
  assert.deepEqual(reads, before)
  assert.equal(runtime.messages, messages + 1, 'CRM history remains and reset is appended')
  assert.match(runtime.replies.at(-1)!, /reinicié/)
})
await expiredCheck('pending and unknown effects still block both recovery paths', async () => {
  for (const effect of ['PENDING', 'CLAIMED', 'RETRY', 'SENDING', 'UNKNOWN', 'STARTED']) {
    for (const text of ['hola', '/reset']) {
      const { runtime } = await expiredRuntime('EXPIRED', effect), before = structuredClone(runtime.session)
      runtime.next(text)
      await runtime.run('PROCESS_INBOX', { provider: async () => { throw new Error('pending recovery AI forbidden') }, timeoutMs: 10 })
      assert.deepEqual(runtime.session, before, effect + ' preserves the expired session')
    }
  }
})
await expiredCheck('sidecar expiry cannot override a live hold, review or corrupt lineage', async () => {
  for (const status of ['PENDING_PROOF', 'PROOF_RECEIVED', 'CORRUPT_HASH']) {
    const { runtime, reads } = await expiredRuntime(status === 'CORRUPT_HASH' ? 'EXPIRED' : status)
    if (status === 'CORRUPT_HASH') reads.rows[0]!.parentHash = '0'.repeat(64)
    runtime.next('hola')
    let calls = 0
    await runtime.run('PROCESS_INBOX', { provider: async () => { calls++; return runtimeCandidate() }, timeoutMs: 1000 })
    assert.equal(calls, 0, status + ' cannot authorize fresh conversation')
    assert.ok(readConversationDraft(runtime.session.state, barberResetPolicy, 'UTC').bookingReservation)
  }
})
await expiredCheck('late attachment cannot erase context or enqueue expired proof', async () => {
  const { runtime } = await expiredRuntime()
  runtime.next('comprobante', 'image')
  Object.assign(runtime.row.payload, { mediaId: 'LATE_PROOF', mediaMimeType: 'image/jpeg' })
  await runtime.run('PROCESS_INBOX', { provider: async () => ({ ...runtimeCandidate(), attachmentIntent: 'deposit_proof' }), timeoutMs: 1000 })
  assert.equal(runtime.statements.some(q => q.values.includes('RECEIVE_DEPOSIT_PROOF')), false)
  assert.equal((runtime.session.state as { deposit: string }).deposit, 'EXPIRED')
})
await expiredCheck('effect appearing during computation prevents recovered state commit', async () => {
  const { runtime } = await expiredRuntime(), before = structuredClone(runtime.session)
  runtime.next('hola')
  let calls = 0
  await runtime.run('PROCESS_INBOX', { provider: async () => { calls++; runtime.pendingEffect('UNKNOWN'); return runtimeCandidate() }, timeoutMs: 1000 })
  assert.equal(calls, 1)
  assert.deepEqual(runtime.session, before, 'final transaction must recheck pending effects')
})

await expiredCheck('handoff, stale generation and rejected receipts remain protected', async () => {
  for (const change of ['handoff','generation','rejected'] as const) {
    for (const text of ['hola','/reset']) {
      const { runtime, reads } = await expiredRuntime()
      if (change === 'handoff') {
        const state = runtime.session.state as { handoff: string; flow: string }
        state.handoff = 'QUEUED'; state.flow = 'HANDOFF_QUEUED'
      }
      if (change === 'generation') runtime.session.deploymentGeneration = 0
      if (change === 'rejected') {
        const draft = readConversationDraft(runtime.session.state, barberResetPolicy, 'UTC')
        const receipt = draft.bookingReservation!.receipt!
        assert.equal(receipt.kind, 'HELD')
        if (receipt.kind === 'HELD') receipt.depositStatus = 'REJECTED'
        reads.rows = reads.rows.map(row => ({ ...row, depositStatus: 'REJECTED', visitStatus: 'CANCELLED', appointmentStatus: 'CANCELLED' }))
        runtime.session.state = projectConversationDraft(draft, barberResetPolicy)
      }
      const before = structuredClone(runtime.session)
      runtime.next(text)
      await runtime.run('PROCESS_INBOX', { provider: async () => { throw new Error('protected terminal recovery cannot call AI') }, timeoutMs: 10 })
      assert.deepEqual(runtime.session, before, change + ' cannot be discarded')
    }
  }
})
await expiredCheck('financial change during computation prevents recovered state commit', async () => {
  const { runtime, reads } = await expiredRuntime(), before = structuredClone(runtime.session)
  runtime.next('hola')
  await runtime.run('PROCESS_INBOX', { provider: async () => {
    reads.rows = reads.rows.map(row => ({ ...row, depositStatus: 'PROOF_RECEIVED', visitStatus: 'PENDING_PAYMENT_REVIEW', appointmentStatus: 'PENDING' }))
    return runtimeCandidate()
  }, timeoutMs: 1000 })
  assert.deepEqual(runtime.session, before, 'financial authority is re-read before committing fresh context')
})
assert.deepEqual(expiredFailures, [], 'P17 durable-expiry worker regressions')



// P14 projection/reset: appointment zero can be NONE while the financial anchor
// belongs to another professional. A HELD receipt never projects as confirmed.
const jointRuntime = runtimeFixture({ businessId: barberResetId, phone: '5491112345678' })
await jointRuntime.run()
const jointTerms: RuntimeBookingTerms = structuredClone(financialTerms)
jointTerms.preference = { kind: 'any' }
jointTerms.totalPriceMinor = 3000
jointTerms.segments = [...jointTerms.segments, { ...jointTerms.segments[0]!, serviceId: 'cream', serviceName: 'Crema',
  professionalId: 'p2', professionalName: 'Leo', startAt: '2026-10-02T10:30:00.000Z',
  endAt: '2026-10-02T11:00:00.000Z', priceMinor: 2000 }]
jointTerms.deposit!.financial.lines = [{ serviceId: 'cream', serviceName: 'Crema', sortOrder: 1,
  mode: 'FIXED', configuredValue: 100, baseAmount: null, amount: 100 }]
const jointPresented: RuntimePresentedBooking = { ...financialPresented, nonce: randomUUID(),
  scope: { ...financialScope, sessionId: jointRuntime.session.sessionId, revision: String(jointRuntime.session.revision) },
  terms: jointTerms, fingerprint: runtimeBookingFingerprint(jointTerms) }
const jointReceipt: RuntimeHeldReceipt = { ...financialReceipt, coordinationGroupId: 'joint-group',
  proposalNonce: jointPresented.nonce, fingerprint: jointPresented.fingerprint, depositId: 'deposit-second-segment',
  coordinatedDepositGroup: { version: 1, groupId: 'joint-group', requestHash: 'a'.repeat(64) },
  appointments: [{ segmentIndex: 0, appointmentId: 'none-appointment', visitId: 'none-visit' },
    { segmentIndex: 1, appointmentId: 'financial-appointment', visitId: 'financial-visit' }] }
const jointSegments = jointTerms.segments.map(({ priceMinor, priceMode, configurationHash, ...segment }) => segment)
const jointDialogue = { ...initialDialogueState(barberResetId), customerName: 'Ana', date: jointTerms.date,
  professional: jointTerms.preference, pending: 'proposal' as const,
  basket: { version: 1 as const, nextMemberId: 3, members: jointTerms.segments.map((segment, index) => ({
    memberId: 'm' + (index + 1), mode: 'single' as const, serviceIds: [segment.serviceId], evidence: segment.serviceName })) },
  slot: { date: jointTerms.date, time: '10:00', startAt: jointTerms.segments[0]!.startAt,
    professionalId: 'p1', professionalName: 'Ana', band: 'MORNING' as const, occupiedMinutes: 60,
    coordination: { key: coordinationKey(barberResetId, jointSegments), segments: jointSegments } },
  bookingReservation: { presented: jointPresented, receipt: jointReceipt } }
assert.doesNotThrow(() => projectConversationDraft(jointDialogue, barberResetPolicy), 'P14 multi-professional financial receipt must remain a valid protected dialogue')
const jointProjection = projectConversationDraft(jointDialogue, barberResetPolicy)
assert.equal(jointProjection.booking, 'HELD', 'P14 projects ALL services pending payment, including NONE first member')
assert.equal(jointProjection.deposit, 'PENDING_PROOF')
assert.equal(jointProjection.flow, 'DEPOSIT_INSTRUCTIONS')
assert.equal(jointProjection.selections.appointmentId, 'none-appointment', 'UI selection is not the financial proof anchor')
assert.deepEqual(readConversationDraft(jointProjection, barberResetPolicy, 'UTC').bookingReservation, jointDialogue.bookingReservation)
assert.throws(() => reconcileConversationDraft(jointProjection, { ...barberResetPolicy, generation: 2 }, 'UTC'),
  /protected/, 'configuration replacement cannot discard an active group obligation')
jointRuntime.session.state = jointProjection
const jointProtected = structuredClone(jointRuntime.session)
jointRuntime.next('/reset')
await jointRuntime.run('PROCESS_INBOX', { provider: async () => { throw new Error('group financial reset cannot call AI') }, timeoutMs: 10 })
assert.deepEqual(jointRuntime.session, jointProtected, 'reset never abandons any financial group member')
assert.match(jointRuntime.replies.at(-1)!, /No reinicié/)
for (const status of ['PROOF_RECEIVED', 'APPROVED', 'EXPIRED', 'REJECTED'] as const) {
  const state = projectConversationDraft({ ...jointDialogue,
    bookingReservation: { presented: jointPresented, receipt: { ...jointReceipt, depositStatus: status } } }, barberResetPolicy)
  assert.equal(state.booking === 'CONFIRMED', status === 'APPROVED', 'group projects real payment status, not client claim')
}
console.log('P14 group HELD projection/readback, NONE-first anchor and protected reset: PASS')
for (const change of ['revision', 'config', 'human', 'disabled', 'fence', 'order'] as const) {
  const race = runtimeFixture()
  race.hook(() => {
    if (change === 'revision') race.session.revision++
    if (change === 'config') race.row.configurationId = 'replacement'
    if (change === 'human') race.session.status = 'HUMAN_TAKEN'
    if (change === 'disabled') race.row.botEnabled = false
    if (change === 'fence') race.session.handoffFenceEpoch++
    if (change === 'order') race.block(true)
  })
  await race.run()
  assert.equal(race.replies.length, 0, `${change} suppresses stale preparation`)
  assert.equal(race.messages, 1, 'inbound remains in CRM')
  if (change === 'human' || change === 'disabled') assert.equal(race.row.status, 'PROCESSED')
  else { assert.equal(race.row.status, 'ADMITTED'); assert.equal(race.retried, 1) }
}
const retryRuntime = runtimeFixture()
retryRuntime.hook(() => { retryRuntime.session.revision++; retryRuntime.hook(() => {}) })
await retryRuntime.run(); assert.equal(retryRuntime.row.status, 'ADMITTED')
await retryRuntime.run(); retryRuntime.next('mañana'); await retryRuntime.run()
assert.equal(retryRuntime.replies.length, 2, 'two independent inputs survive revision retry')
assert.equal((retryRuntime.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02')
const rollback = runtimeFixture(); rollback.failCommit()
await assert.rejects(rollback.run(), /COMMIT failed/)
assert.equal(rollback.row.status, 'ADMITTED'); assert.equal(rollback.replies.length, 0)
assert.equal(rollback.session.revision, 0n, 'state and output roll back together')
const fenced = runtimeFixture(); fenced.hook(() => fenced.invalidateClaim())
await assert.rejects(fenced.run(), /stale or fenced/)
assert.equal(fenced.replies.length, 0); assert.equal(fenced.row.status, 'ADMITTED')
console.log('conversational public worker/admission: PASS')

const switched = runtimeFixture(); await switched.run(); switched.next('mañana')
switched.hook(() => { switched.row.configurationId = 'cfg-new'; switched.hook(() => {}) })
await switched.run(); assert.equal(switched.row.status, 'ADMITTED')
await switched.run()
assert.equal(switched.row.status, 'PROCESSED', 'replacement config must retry the same durable event successfully')
assert.equal((switched.session.state as typeof projected).conversationDraft.dialogue.serviceId, null, 'replacement never reuses old booking fields')
assert.equal((switched.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02', 'replacement preserves current durable message')

const { applyLazyContextWindowTx } = await import('../src/bot-options/application/lazy-context-window.js')
async function expireConversation(enabled: boolean) {
  let resetState: unknown = null
  let views = 0
  const fake = {
    async $queryRaw(q: Query) {
      if (q.sql.includes('lazy-context:session')) return [{ id: 'session', revision: 3n, state: projected, status: 'ACTIVE', deploymentGeneration: 1,
        draftTouchedAt: new Date('2026-09-29T12:00:00Z'), draftExpiresAt: new Date('2026-09-30T12:00:00Z'), dbNow: new Date('2026-10-01T12:00:00Z'), hasInbox: false, durableProtection: false, botEnabled: enabled }]
      if (q.sql.includes('lazy-context:guard')) return [{ busy: false, protectedDelivery: false }]
      if (q.sql.includes('lazy-context:greeting')) return [{ ...config, businessName: 'Salon', customerName: null }]
      throw new Error('unhandled expiry query')
    },
    async $executeRaw(q: Query) {
      if (q.sql.includes('lazy-context:reset */')) resetState = JSON.parse(q.values.find(v => typeof v === 'string' && v.includes('schemaVersion')) as string)
      return 1
    }
  }
  const result = await applyLazyContextWindowTx(fake as never, { businessId: 'biz', deploymentId: 'dep', generation: 1, providerEventId: 'expiry', phone: 'phone', admittedAt: new Date('2026-10-01T12:00:00Z'), providerOccurredAt: null, isMedia: false }, async (_tx, input) => {
    views++; assert.equal(input.view.choices.length, 0, 'marked expiry must render plain text')
  })
  return { result, views, resetState }
}
assert.equal((await expireConversation(false)).views, 0, 'bot-disabled expiry cannot enqueue an autoreply before admission')
const activeExpiry = await expireConversation(true)
assert.equal(activeExpiry.result.kind, 'EXPIRED')
assert.deepEqual(activeExpiry.resetState, createInitialBotOptionsState(), 'expiry removes sidecar and booking fields')

const { generatePromptToken, generateChoiceToken, buildInteractiveActionId } = await import('../src/bot-options/domain/prompt-tokens.js')
const oldInteractive = await admit(true, 'interactive', buildInteractiveActionId(generatePromptToken(), generateChoiceToken()))
assert.ok(oldInteractive.writes.some(q => q.values.includes('interactive action not supported by conversational policy')))
assert.ok(!oldInteractive.writes.some(q => q.values.includes('PROCESS_SESSION') || q.values.includes('PROCESS_INBOX')))
const migration = runtimeFixture(); await migration.run(); migration.session.state = { ...createInitialBotOptionsState(), flow: 'NAME_INPUT' }; migration.next('mañana'); await migration.run()
assert.equal(migration.row.status, 'PROCESSED')
assert.equal((migration.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)
assert.match(migration.replies.at(-1)!, /configuración/)
const removed = runtimeFixture(); await removed.run(); removed.row.definition = {} as typeof config.definition; removed.next('hola'); await removed.run()
assert.deepEqual(removed.session.state, createInitialBotOptionsState())
assert.match(removed.replies.at(-2)!, /Recibí tu mensaje/)
for (const change of ['human', 'disabled'] as const) {
  const silent = runtimeFixture(); await silent.run(); silent.row.definition = {} as typeof config.definition; silent.next('hola')
  if (change === 'human') silent.session.status = 'HUMAN_QUEUED'; else silent.row.botEnabled = false
  const count = silent.replies.length; const state = structuredClone(silent.session.state)
  await silent.run(); assert.equal(silent.replies.length, count); assert.deepEqual(silent.session.state, state)
}
console.log('conversational config/expiry/legacy boundaries: PASS')
const cutover = runtimeFixture()
await cutover.run('RECOVER_CUTOVER')
assert.equal(cutover.settled, 1, 'actual recovery job settles instead of rescheduling itself')
assert.ok(cutover.statements.some(q => q.values.includes('PROCESS_INBOX') && q.values.some(v => typeof v === 'string' && v.startsWith('cutover-recovery:'))))
assert.equal(cutover.replies.length, 0, 'recovery enqueues the existing worker, never sends inline')
await cutover.run()
assert.equal(cutover.replies.length, 1)
console.log('conversational actual cutover recovery: PASS')
const oldGeneration = runtimeFixture(); await oldGeneration.run(); oldGeneration.session.deploymentGeneration = 0; oldGeneration.next('mañana'); await oldGeneration.run()
assert.equal(oldGeneration.session.deploymentGeneration, 1)
assert.equal((oldGeneration.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)
assert.equal(oldGeneration.row.status, 'PROCESSED')

// WhatsApp opt-in reuses first-call framing for prepared facts through the public worker, with no lock retained.
const aiRuntime = runtimeFixture()
let interpretationCalls = 0
let responseCalls = 0
const diagnostics: unknown[] = []
const provider: AiInterpretationProvider = async input => {
  aiRuntime.assertOutside(); interpretationCalls++
  assert.equal(input.message, 'Corte')
  return { intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null, firstReply: { opening: 'Dale.', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
}
provider.respond = async input => {
  aiRuntime.assertOutside(); responseCalls++
  return { opening: 'Dale.', factIds: input.facts.map(fact => fact.id), closing: null }
}
await aiRuntime.run('PROCESS_INBOX', { provider, timeoutMs: 4500, onDiagnostic: value => diagnostics.push(value) })
assert.equal(interpretationCalls, 1, 'runtime must call the injected interpreter')
assert.equal(responseCalls, 0, 'runtime must not buy a style call for prepared facts')
assert.equal(aiRuntime.replies[0], 'Dale.\nPerfecto 😊 ¿Para qué día y horario querés reservar tu Corte?', 'natural framing preserves the verified combined question')
assert.equal((aiRuntime.session.state as typeof projected).conversationDraft.dialogue.serviceId, 'cut')
assert.equal(diagnostics.length, 1)
const measured = diagnostics[0] as Record<string, unknown>
assert.equal(measured.mode, 'ai'); assert.equal(measured.copyMode, 'ai')
assert.equal(measured.providerEventId, 'event'); assert.equal(measured.result, 'PROCESSED')
for (const key of ['contextMs', 'computeMs', 'interpretationMs', 'validationMs', 'engineMs', 'responseMs']) assert.ok(Number(measured[key]) >= 0, key)
assert.ok(!JSON.stringify(measured).includes('Corte') && !JSON.stringify(measured).includes('phone'), 'diagnostics exclude content and recipient')
assert.equal(measured.aiCalls, 1, 'WhatsApp diagnostics must expose actual AI calls')
assert.equal(measured.replyRoute, 'first_call')
const preparedRuntime = runtimeFixture()
const preparedDiagnostics: unknown[] = []
await preparedRuntime.run('PROCESS_INBOX', { provider: async () => ({ intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null, firstReply: null }), timeoutMs: 4500, onDiagnostic: value => preparedDiagnostics.push(value) })
const preparedDiagnostic = preparedDiagnostics[0] as Record<string, unknown>
assert.equal(preparedDiagnostic.copyMode, 'prepared'); assert.equal(preparedDiagnostic.copyReason, null)
assert.equal(preparedDiagnostic.aiCalls, 1); assert.equal(preparedDiagnostic.replyRoute, 'motor')
assert.equal(preparedRuntime.replies[0], 'Perfecto 😊 ¿Para qué día y horario querés reservar tu Corte?')
assert.equal((preparedRuntime.session.state as typeof projected).conversationDraft.dialogue.serviceId, 'cut')
const singleCallRuntime = runtimeFixture()
singleCallRuntime.next('hola')
const singleCallDiagnostics: unknown[] = []
let singleCallCount = 0
const singleCallProvider: AiInterpretationProvider = async input => {
  singleCallRuntime.assertOutside(); singleCallCount++
  return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
    firstReply: { opening: 'Hola', factIds: input.firstReplyFacts!.map(fact => fact.id), closing: null } }
}
singleCallProvider.respond = async () => { throw new Error('one-call greeting must not compose again') }
await singleCallRuntime.run('PROCESS_INBOX', { provider: singleCallProvider, timeoutMs: 4500,
  onDiagnostic: value => singleCallDiagnostics.push(value) })
assert.equal(singleCallCount, 1)
assert.equal(singleCallRuntime.replies[0], 'Hola\n¿En qué te puedo ayudar con el local?')
assert.equal((singleCallDiagnostics[0] as Record<string, unknown>).aiCalls, 1)
assert.equal((singleCallDiagnostics[0] as Record<string, unknown>).replyRoute, 'first_call')
const singleReplyValidation = (singleCallDiagnostics[0] as { replyValidation?: { firstCall: { status: string }; secondCall: { status: string } } }).replyValidation
assert.equal(singleReplyValidation?.firstCall.status, 'accepted')
assert.equal(singleReplyValidation?.secondCall.status, 'not_attempted')
assert.doesNotMatch(JSON.stringify(singleReplyValidation), /Hola|local|PRIVATE_PROVIDER_BODY/)

// New rejection detail reaches the existing post-commit sink, using only the fake runtime client.
const shapeFetch = (output: unknown): typeof fetch => (async () => new Response(JSON.stringify({
  status: 'completed', output, privateBody: 'PRIVATE_PROVIDER_BODY'
}), { status: 200, headers: { 'x-request-id': 'req_shape-worker' } })) as typeof fetch
const shapeRuntime = runtimeFixture()
shapeRuntime.next('hola')
const shapeTraces: unknown[] = []
await shapeRuntime.run('PROCESS_INBOX', {
  provider: createOpenAiInterpretationProvider({ apiKey: 'fake-key', fetchImpl: shapeFetch(null) }), timeoutMs: 15000,
  onDiagnostic: value => { shapeTraces.push(value) }
})
const shapeTrace = shapeTraces[0] as { interpretationProviderError?: { responseFormat?: { reason: string } } }
assert.equal(shapeTrace.interpretationProviderError?.responseFormat?.reason, 'output_not_array')
assert.equal(shapeRuntime.singularAgendaCalls + shapeRuntime.basketAgendaCalls, 0)
assert.equal((shapeRuntime.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)
assert.equal(shapeRuntime.replies.length, 1)
assert.doesNotMatch(JSON.stringify(shapeTrace), /PRIVATE_PROVIDER_BODY|fake-key|Corte|phone/)
const copyShapeRuntime = runtimeFixture()
copyShapeRuntime.next('Corte mañana')
const copyShapeTraces: unknown[] = []
const copyShapeProvider: AiInterpretationProvider = async () => ({
  intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null
})
copyShapeProvider.respond = createOpenAiResponseProvider({ apiKey: 'fake-key', fetchImpl: shapeFetch([
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }, { type: 'output_text', text: '{}' }] }
]) })
await copyShapeRuntime.run('PROCESS_INBOX', { provider: copyShapeProvider, timeoutMs: 15000,
  onDiagnostic: value => { copyShapeTraces.push(value) } })
const copyShapeTrace = copyShapeTraces[0] as { responseProviderError?: { responseFormat?: { reason: string } } }
assert.equal(copyShapeTrace.responseProviderError?.responseFormat?.reason, 'invalid_json')
assert.equal((copyShapeRuntime.session.state as typeof projected).conversationDraft.dialogue.serviceId, 'cut')
assert.equal(copyShapeRuntime.singularAgendaCalls + copyShapeRuntime.basketAgendaCalls, 1, 'new agenda facts justify the response stage')
assert.equal(copyShapeRuntime.replies.length, 1)
assert.doesNotMatch(JSON.stringify(copyShapeTrace), /PRIVATE_PROVIDER_BODY|fake-key|Corte|phone/)
console.log('conversational worker Responses diagnostics: fake-client new-facts response stage/no leak PASS')

const availabilityRuntime = runtimeFixture({ basketCatalog: true, availabilityReason: 'COMBINATION_REVIEW' })
availabilityRuntime.next('Corte hombre y alisado mañana cualquiera 14:00 soy Matias')
const availabilityTraces: unknown[] = []
await availabilityRuntime.run('PROCESS_INBOX', { timeoutMs: 15000,
  provider: async () => ({...runtimeCandidate(
    runtimeBasket('set', [runtimeMember('single', ['cut'], 'Corte hombre'), runtimeMember('single', ['smooth'], 'alisado')], 'Corte hombre y alisado'),
    { kind: 'date', expression: 'mañana', value: null, ...runtimeEv('mañana') },
    { kind: 'professional', mode: 'any', ...runtimeEv('cualquiera') },
    { kind: 'time', value: '14:00', ...runtimeEv('14:00') },
    { kind: 'name', value: 'Matias', ...runtimeEv('Matias') }),communicativeActs:{version:1,acts:[runtimeAct('request','service','Corte hombre y alisado',[0]),runtimeAct('request','date','mañana',[1]),runtimeAct('request','professional','cualquiera',[2]),runtimeAct('request','time','14:00',[3]),runtimeAct('request','name','Matias',[4])]}}),
  onDiagnostic: value => { availabilityTraces.push(value) } })
const availabilityTrace = availabilityTraces[0] as { availability?: unknown }
assert.deepEqual(availabilityTrace.availability, { outcome: 'blocked', phase: 'query', reason: 'COMBINATION_REVIEW', scope: 'all_compatible' })
assert.equal(availabilityRuntime.basketAgendaCalls, 1); assert.equal(availabilityRuntime.singularAgendaCalls, 0)
const blockedDraft = readConversationDraft(availabilityRuntime.session.state, policy, 'UTC')
assert.equal(blockedDraft.requestedTime, '14:00'); assert.equal(blockedDraft.slot, null); assert.equal(blockedDraft.customerName, 'Matias')
assert.equal(blockedDraft.basket?.members.length, 2)
assert.equal(Object.hasOwn(blockedDraft, 'availability'), false, 'diagnostics must never become durable availability state')
assert.deepEqual((availabilityRuntime.session.state as typeof projected).cart, [{ serviceId: 'cut' }, { serviceId: 'smooth' }], 'an exact basket remains projected without a verified slot')
assert.doesNotMatch(JSON.stringify(availabilityTrace), /Corte|alisado|Matias|phone|SELECT/)
availabilityRuntime.next('hola')
await availabilityRuntime.run('PROCESS_INBOX', { timeoutMs: 15000,
  provider: async () => runtimeCandidate(), onDiagnostic: value => { availabilityTraces.push(value) } })
assert.equal((availabilityTraces[1] as { availability?: unknown }).availability, undefined)
assert.equal(availabilityRuntime.basketAgendaCalls, 1, 'social turn does not refresh or replay agenda')
assert.match(availabilityRuntime.replies.at(-1)!, /cambiar|quitar|equipo/)

const legacyAvailability = runtimeFixture({basketCatalog:true,availabilityReason:'COMBINATION_REVIEW'})
legacyAvailability.next('Corte hombre y alisado mañana cualquiera 14:00 soy Matias')
await legacyAvailability.run('PROCESS_INBOX',{timeoutMs:15000,provider:async()=>runtimeCandidate(
  runtimeBasket('set',[runtimeMember('single',['cut'],'Corte hombre'),runtimeMember('single',['smooth'],'alisado')],'Corte hombre y alisado'),
  {kind:'date',expression:'mañana',value:null,...runtimeEv('mañana')},{kind:'professional',mode:'any',...runtimeEv('cualquiera')},
  {kind:'time',value:'14:00',...runtimeEv('14:00')},{kind:'name',value:'Matias',...runtimeEv('Matias')})})
const unownedAvailability = readConversationDraft(legacyAvailability.session.state,policy,'UTC')
assert.equal(unownedAvailability.professional,null)
assert.equal(unownedAvailability.customerName,'Matias')
assert.equal(unownedAvailability.date,'2026-10-02')
assert.equal(unownedAvailability.basket?.members.length,2)
assert.equal(legacyAvailability.basketAgendaCalls+legacyAvailability.singularAgendaCalls,0,'legacy ownerless professional cannot query agenda')
assert.ok(!legacyAvailability.statements.some(q=>/INSERT INTO "(?:Appointment|BookingVisit)"/.test(q.sql)))

console.log('conversational worker availability diagnostics: closed cause, no persistence/query/leak PASS')

const fallbackRuntime = runtimeFixture()
await fallbackRuntime.run('PROCESS_INBOX', { provider: async () => { throw new Error('SECRET raw provider failure') }, timeoutMs: 4500, onDiagnostic: value => {
  assert.ok(!JSON.stringify(value).includes('SECRET')); assert.equal((value as Record<string, unknown>).mode, 'fallback')
  throw new Error('observability unavailable')
} })
assert.equal(fallbackRuntime.replies.length, 1, 'provider/sink errors cannot prevent the safe reply')
for (const type of ['image', 'restart'] as const) {
  const bypass = runtimeFixture(); bypass.next(type === 'restart' ? '/reiniciar' : '', type === 'restart' ? 'text' : type)
  await bypass.run('PROCESS_INBOX', { provider: async () => { throw new Error('AI should not run') }, timeoutMs: 4500, onDiagnostic: () => { throw new Error('bypass should not emit AI trace') } })
  assert.equal(bypass.replies.length, 1)
}
const handoffDuringAi = runtimeFixture()
await handoffDuringAi.run('PROCESS_INBOX', { provider: async () => {
  handoffDuringAi.assertOutside(); handoffDuringAi.session.status = 'HUMAN_TAKEN'
  return { intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null }
}, timeoutMs: 4500 })
assert.equal(handoffDuringAi.replies.length, 0, 'handoff acquired during AI suppresses outbox')
console.log('conversational WhatsApp AI injection/fallback/fencing: PASS')
const wrongTenantAi = runtimeFixture(); wrongTenantAi.row.customerCode = 'OTHER'
let crossTenantCalls = 0
await assert.rejects(wrongTenantAi.run('PROCESS_INBOX', { provider: async () => { crossTenantCalls++; return null }, timeoutMs: 4500 }), /invalid conversational runtime policy/)
assert.equal(crossTenantCalls, 0, 'provider must never receive another tenant')
const expiredAi = runtimeFixture()
const timeoutTraces: unknown[] = []
await expiredAi.run('PROCESS_INBOX', { provider: () => new Promise(() => {}), timeoutMs: 1, onDiagnostic: value => { timeoutTraces.push(value) } })
assert.equal((timeoutTraces[0] as Record<string, unknown>).reason, 'timeout')
assert.equal(expiredAi.replies.length, 1, 'deadline must yield fallback, not drop the message')
const commitFailureAi = runtimeFixture(); commitFailureAi.failCommit()
await assert.rejects(commitFailureAi.run('PROCESS_INBOX', { provider: async () => ({ intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', professionalMention: null }), timeoutMs: 4500, onDiagnostic: () => { throw new Error('uncommitted trace emitted') } }), /COMMIT failed/)
assert.equal(commitFailureAi.replies.length, 0)

// The real partial unique dispatch index arbitrates computations across independent worker clients.
// PGlite serializes short transactions: this proves SQL outcomes, not cross-connection contention.
const computeDb = new PGlite()
try {
  await computeDb.exec(`
    CREATE TYPE "BotProviderEventType" AS ENUM ('MESSAGE','STATUS');
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotDispatchKind" AS ENUM ('PROCESS','SEND');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','UNKNOWN','DONE');
    CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','READY','DONE');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');
    CREATE TABLE "BotChannelDeployment" ("id" text,"businessId" text,"channel" "BotChannel","engineKey" text,
      "generation" int,"dispatchFenceEpoch" int,"claimsPausedAt" timestamptz,"activeConfigurationId" text,"legacyDispatchCoverageVersion" int);
    CREATE TABLE "BotActionInbox" ("id" text,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"providerEventId" text);
    CREATE TABLE "BotProviderEvent" ("id" text,"businessId" text,"eventType" "BotProviderEventType","payload" jsonb);
    CREATE TABLE "BotSession" ("id" text,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"status" "BotSessionStatus",
      "handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" int);
    CREATE TABLE "BotDispatchClaim" ("id" text PRIMARY KEY,"businessId" text,"channel" "BotChannel","sessionId" text,"resourceId" text,
      "engineKey" text,"generation" int,"fenceEpoch" int,"handoffFenceEpoch" int,"kind" "BotDispatchKind","status" "BotDispatchStatus",
      "claimToken" text UNIQUE,"claimedUntil" timestamptz,"updatedAt" timestamptz);
    CREATE UNIQUE INDEX "BotDispatchClaim_active_resource_key" ON "BotDispatchClaim" ("kind","engineKey","resourceId")
      WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED','SENDING','UNKNOWN');
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"aggregateId" text,"status" "BotJobStatus",
      "leaseToken" text,"leasedUntil" timestamptz,"attempts" int,"availableAt" timestamptz,"updatedAt" timestamptz);
    INSERT INTO "BotChannelDeployment" VALUES ('dep','biz','WHATSAPP','deterministic-options',1,1,NULL,'cfg',1),
      ('dep','other','WHATSAPP','deterministic-options',1,1,NULL,'cfg',1);
  `)
  const seedJob = async (prefix: string, businessId = 'biz') => computeDb.query(`INSERT INTO "BotJob" VALUES
    ($1,$2,'dep',1,'inbox','LEASED','job-token',clock_timestamp()+interval '1 minute',1,clock_timestamp(),clock_timestamp())`, [prefix+'-0',businessId])
  await seedJob('owner'); await seedJob('contender'); await seedJob('other-phone'); await seedJob('other-business', 'other')
  const owner = runtimeFixture({ computeDb, jobPrefix: 'owner', phone: '+54 9 11 1234-5678' })
  const contender = runtimeFixture({ computeDb, jobPrefix: 'contender', phone: '5491112345678' })
  let started!: () => void, unblock!: () => void, calls = 0
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  const blockedPromise = new Promise<void>(resolve => { unblock = resolve })
  const answer = { intent: 'other' as const, serviceId: null, serviceEvidence: null, professionalMention: null,
    firstReply: { opening: 'Hola', factIds: [], closing: null } }
  const ownerPending = owner.run('PROCESS_INBOX', { provider: async () => { calls++; started(); await blockedPromise; return answer }, timeoutMs: 4500 })
  await startedPromise
  const targetSql=owner.statements.find(q=>q.sql.includes('conversation-target'))!
  await computeDb.exec(`INSERT INTO "BotActionInbox" VALUES ('inbox','biz','dep',1,'target-event');
    INSERT INTO "BotProviderEvent" VALUES ('target-event','biz','MESSAGE','{"fromPhone":"+54 9 11 1234-5678"}'::jsonb);`)
  assert.deepEqual((await computeDb.query(targetSql.text,targetSql.values)).rows,[{fenceEpoch:1,phone:'+54 9 11 1234-5678'}])
  for(const mutation of [`UPDATE "BotActionInbox" SET "businessId"='foreign'`,`UPDATE "BotActionInbox" SET "deploymentGeneration"=2`,`UPDATE "BotProviderEvent" SET "eventType"='STATUS'`]) {
    await computeDb.transaction(async tx=>{await tx.exec(mutation);assert.equal((await tx.query(targetSql.text,targetSql.values)).rows.length,0);throw Error('TARGET_FIXTURE_ROLLBACK')}).catch(error=>{assert.match(String(error),/TARGET_FIXTURE_ROLLBACK/)})
  }
  try {
    const { runClaimedBotJob } = await import('../src/bot-options/infrastructure/postgres-worker.js')
    let contenderOutcome: unknown
    const workerDiagnostics: Array<{phase:string;outcome:string}>=[]
    await runClaimedBotJob({client:{} as never,job:{id:'contender-0',kind:'PROCESS_INBOX'} as never,handlerSettlesJob:true,
      handle:async()=>{ contenderOutcome=await contender.run('PROCESS_INBOX',{provider:async()=>{calls++;return answer},timeoutMs:4500}) },
      onDiagnostic:value=>{workerDiagnostics.push(value)} })
    assert.equal(contenderOutcome,'STALE_REVISION')
    assert.equal(workerDiagnostics.at(-1)!.outcome,'handler_settled','worker must not complete/retry the handler-rescheduled job')
    assert.equal(calls, 1, 'another job for this conversation must not enter AI while the owner is valid')
    const deferred = (await computeDb.query<{status:string;attempts:number}>(`SELECT "status","attempts" FROM "BotJob" WHERE "id"='contender-0'`)).rows[0]!
    assert.equal(deferred.status, 'READY', 'content stays represented by the existing durable job')
    assert.equal(deferred.attempts, 0, 'ordinary contention must not poison the job by exhausting attempts')
    assert.equal(contender.row.status, 'ADMITTED'); assert.equal(contender.replies.length, 0)
    assert.equal(contender.statements.filter(q=>q.sql.includes('conversation-target')).length,1)
    assert.ok(!contender.statements.some(q=>q.sql.includes('conversation-inbox-lock')), 'contended work skips snapshot/context/catalog entirely')
    const peer = runtimeFixture({ computeDb, jobPrefix: 'other-phone', phone: 'another-phone' })
    await peer.run('PROCESS_INBOX', { provider: async () => { calls++; return answer }, timeoutMs: 4500 })
    const tenant = runtimeFixture({ computeDb, jobPrefix: 'other-business', businessId: 'other', phone: '5491112345678' })
    await tenant.run('PROCESS_INBOX', { provider: async () => { calls++; return answer }, timeoutMs: 4500 })
    assert.equal(calls, 3, 'other conversations and tenants must remain independent')
  } finally { unblock() }
  assert.equal(await ownerPending, 'PROCESSED'); assert.equal(owner.replies.length, 1)
  assert.equal((await computeDb.query<{count:number}>(`SELECT count(*)::int AS count FROM "BotDispatchClaim" WHERE "status"='CLAIMED'`)).rows[0]!.count, 0)

  await seedJob('stale-peer')
  await computeDb.exec(`UPDATE "BotJob" SET "leaseToken"='another-worker' WHERE "id"='stale-peer-0'`)
  const stalePeer=runtimeFixture({computeDb,jobPrefix:'stale-peer',phone:'5491112345678'})
  // A foreign PROCESS owner makes acquisition contend, but our stale job token cannot refund it.
  const {acquireDispatchClaim}=await import('../src/bot-options/infrastructure/dispatch-claims.js')
  const {createHash}=await import('node:crypto')
  const sharedResource='conversation-compute:'+createHash('sha256').update(JSON.stringify(['biz','5491112345678'])).digest('hex')
  const externalClient={
    $transaction: <T>(operation:(tx:unknown)=>Promise<T>)=>computeDb.transaction(tx=>operation({
      $queryRaw:async(q:Query)=>(await tx.query(q.text,q.values)).rows,
      $executeRaw:async(q:Query)=>(await tx.query(q.text,q.values)).affectedRows??1
    })),
  } as never
  const externalToken=await acquireDispatchClaim({client:externalClient,businessId:'biz',sessionId:null,resourceId:sharedResource,generation:1,fenceEpoch:1,kind:'PROCESS'})
  assert.ok(externalToken)
  await assert.rejects(stalePeer.run(),/conversation dispatch gate closed or stale job claim/)
  const unchanged=(await computeDb.query<{status:string;attempts:number;leaseToken:string}>(`SELECT "status","attempts","leaseToken" FROM "BotJob" WHERE "id"='stale-peer-0'`)).rows[0]!
  assert.deepEqual(unchanged,{status:'LEASED',attempts:1,leaseToken:'another-worker'})
  await computeDb.query(`UPDATE "BotDispatchClaim" SET "status"='DONE' WHERE "claimToken"=$1`,[externalToken])

  // New input stays admitted while the owner computes; only a changed block needs another call.
  await seedJob('parts'); await seedJob('parts-peer')
  const parts = runtimeFixture({ computeDb, jobPrefix: 'parts', phone: 'parts-phone' })
  const partsPeer = runtimeFixture({ computeDb, jobPrefix: 'parts-peer', phone: 'parts-phone' })
  parts.inputs([{id:'event',text:'hoy'}])
  let partsStarted!: () => void, partsRelease!: () => void, partsCalls = 0
  const partsEntered = new Promise<void>(resolve => { partsStarted = resolve })
  const partsBlocked = new Promise<void>(resolve => { partsRelease = resolve })
  const oldParts = parts.run('PROCESS_INBOX', { provider: async () => { partsCalls++; partsStarted(); await partsBlocked; return answer }, timeoutMs: 10_000 })
  await partsEntered
  parts.inputs([{id:'event',text:'hoy'},{id:'later',text:'no, mañana'}])
  try {
    assert.equal(await partsPeer.run('PROCESS_INBOX', { provider: async () => { partsCalls++; return answer }, timeoutMs: 10_000 }), 'STALE_REVISION')
    assert.equal(partsCalls, 1)
  } finally { partsRelease() }
  assert.equal(await oldParts, 'STALE_REVISION'); assert.equal(parts.replies.length, 0)
  await computeDb.exec(`UPDATE "BotJob" SET "status"='LEASED',"attempts"=1,"leaseToken"='job-token',"leasedUntil"=clock_timestamp()+interval '1 minute' WHERE "id"='parts-0'`)
  let revisedText = ''
  await parts.run('PROCESS_INBOX', { provider: async input => { partsCalls++; revisedText=input.message; return answer }, timeoutMs: 10_000 })
  assert.equal(revisedText, 'hoy no, mañana'); assert.equal(partsCalls, 2); assert.equal(parts.replies.length, 1)

  // Expiration permits recovery; the late old owner cannot persist or release the new owner's claim.
  await seedJob('expired'); await seedJob('successor')
  const expired = runtimeFixture({ computeDb, jobPrefix: 'expired', phone: 'expired-phone' })
  const successor = runtimeFixture({ computeDb, jobPrefix: 'successor', phone: 'expired-phone' })
  let oldEntered!: () => void, oldRelease!: () => void, newEntered!: () => void, newRelease!: () => void
  const oldStarted = new Promise<void>(resolve => { oldEntered=resolve })
  const oldBlocked = new Promise<void>(resolve => { oldRelease=resolve })
  const newStarted = new Promise<void>(resolve => { newEntered=resolve })
  const newBlocked = new Promise<void>(resolve => { newRelease=resolve })
  const oldResult = expired.run('PROCESS_INBOX', { provider: async () => { oldEntered(); await oldBlocked; return answer }, timeoutMs: 10_000 })
    .then(value => ({value,error:null}), error => ({value:null,error}))
  await oldStarted
  const oldToken=(await computeDb.query<{claimToken:string}>(`SELECT "claimToken" FROM "BotDispatchClaim" WHERE "status"='CLAIMED'`)).rows[0]!.claimToken
  await computeDb.query(`UPDATE "BotDispatchClaim" SET "claimedUntil"=clock_timestamp()-interval '1 second' WHERE "claimToken"=$1`,[oldToken])
  const newResult = successor.run('PROCESS_INBOX', { provider: async () => { newEntered(); await newBlocked; return answer }, timeoutMs: 10_000 })
  await newStarted
  try {
    oldRelease()
    assert.match(String((await oldResult).error), /stale or fenced dispatch claim/)
    assert.equal(expired.replies.length,0)
    const current=(await computeDb.query<{claimToken:string}>(`SELECT "claimToken" FROM "BotDispatchClaim" WHERE "status"='CLAIMED'`)).rows
    assert.equal(current.length,1); assert.notEqual(current[0]!.claimToken,oldToken,'old cleanup must preserve the successor lease')
  } finally { newRelease() }
  assert.equal(await newResult,'PROCESSED'); assert.equal(successor.replies.length,1)
  // If the deployment gate closes after target read, it must not fall through to the legacy engine.
  await seedJob('closed')
  await computeDb.exec(`UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp() WHERE "businessId"='biz'`)
  const closed = runtimeFixture({ computeDb, jobPrefix: 'closed' })
  await assert.rejects(closed.run(), /conversation dispatch gate closed/)
  assert.equal(closed.messages, 0); assert.equal(closed.retried, 0)
  console.log('conversational shared compute claim SQL/independent workers/deferred durable job/tenant/closed gate: PASS')
} finally { await computeDb.close() }

// P11: candidate choice uses the current prompt/outbox and keeps peers with no IA.
const candidateRuntime=runtimeFixture({basketCatalog:true,guidedCatalog:true})
candidateRuntime.next('Corte hombre')
await candidateRuntime.run('PROCESS_INBOX',{provider:async()=>({...runtimeCandidate(runtimeBasket('set',[runtimeMember('single',['cut'],'Corte hombre')],'Corte hombre')),intent:'booking',communicativeActs:{version:1,acts:[runtimeAct('request','service','Corte hombre',[0])]},firstReply:null}),timeoutMs:15000})
candidateRuntime.next('Además quería un tratamiento')
await candidateRuntime.run('PROCESS_INBOX',{provider:async()=>({...runtimeCandidate({kind:'service_request',purpose:'booking',disposition:'unverified_variant',basis:'related_category',serviceIds:['smooth'],correction:false,continuation:false,sourceQuote:null,...runtimeEv('tratamiento')}),intent:'booking',communicativeActs:{version:1,acts:[runtimeAct('request','service','Además quería un tratamiento',[0])]},firstReply:null}),timeoutMs:15000})
assert.equal(readConversationDraft(candidateRuntime.session.state,policy,'UTC').questionContext?.role,'service')
assert.ok(candidateRuntime.statements.some(q=>q.sql.includes('conversation-choice-persist')&&q.values.some(v=>typeof v==='string'&&v.includes('"serviceId":"smooth"'))),'related option reaches prompt/outbox bridge')
candidateRuntime.choice({kind:'service',serviceId:'smooth'})
await candidateRuntime.run('PROCESS_INBOX',{provider:async()=>{throw new Error('candidate click must never call IA')},timeoutMs:15000})
const chosenCandidate=readConversationDraft(candidateRuntime.session.state,policy,'UTC')
assert.deepEqual(chosenCandidate.basket?.members.flatMap(m=>m.serviceIds),['cut','smooth'])
assert.equal(chosenCandidate.pending,'estimate');assert.equal(chosenCandidate.serviceRequest,undefined)
assert.equal(candidateRuntime.row.status,'PROCESSED');assert.match(candidateRuntime.replies.at(-1)!,/Qué largo tiene tu cabello/)
console.log('P11 candidate → native prompt/outbox → click 0 IA → companions retained: PASS')

// An admitted typed operation is not a provider label or a legacy Booking V2 command.
const typedRuntime=runtimeFixture({basketCatalog:true,publicPorts:true})
typedRuntime.next('Corte');await typedRuntime.run()
typedRuntime.choice({kind:'service',serviceId:'cut'})
await typedRuntime.run('PROCESS_INBOX',{provider:async()=>{throw new Error('choice must never call AI')},timeoutMs:15000})
assert.equal(readConversationDraft(typedRuntime.session.state,policy,'UTC').serviceId,'cut','typed stored operation reaches conversational core')
assert.equal(typedRuntime.row.status,'PROCESSED')
assert.ok(readConversationDraft(typedRuntime.session.state,policy,'UTC').introduced)
assert.match(typedRuntime.replies[0]!,/Asistente real.*Nombre real/)
assert.ok(typedRuntime.statements.some(q=>q.sql.includes('conversation-choice-persist')),'real response persists native choices')
for(const guard of ['revision','draft','tenant','generation','replay'] as const) {
  const typed=runtimeFixture({basketCatalog:true});typed.next('Corte');await typed.run();typed.choice({kind:'service',serviceId:'cut'})
  const before=structuredClone(typed.session.state),replies=typed.replies.length
  if(guard==='revision') typed.row.expectedRevision=0n
  if(guard==='draft') typed.session.state=projectConversationDraft({...readConversationDraft(typed.session.state,policy,'UTC'),customerName:'Changed'},policy)
  if(guard==='tenant') (typed.row.payload.conversationChoice as any).question.scope.businessId='other'
  if(guard==='generation') (typed.row.payload.conversationChoice as any).question.scope.policyGeneration=2
  if(guard==='replay') typed.row.status='PROCESSED'
  const expected=guard==='draft'?structuredClone(typed.session.state):before
  await typed.run();assert.deepEqual(typed.session.state,expected,guard);assert.equal(typed.replies.length,replies,guard)
}
// Newly admitted text cannot be concatenated with a selected option, and cannot erase that selection.
const followed=runtimeFixture({basketCatalog:true});followed.next('Corte');await followed.run();followed.choice({kind:'service',serviceId:'cut'})
followed.inputs([{id:followed.row.providerEventId,text:'FORGED LABEL'},{id:'later-text',text:'mañana'}])
await followed.run();assert.equal(readConversationDraft(followed.session.state,policy,'UTC').serviceId,'cut')
followed.next('mañana');followed.inputs([{id:followed.row.providerEventId,text:'mañana'}]);await followed.run()
assert.equal(readConversationDraft(followed.session.state,policy,'UTC').date,'2026-10-02')
assert.equal(readConversationDraft(followed.session.state,policy,'UTC').serviceId,'cut')
console.log('conversational typed runtime persistence/fresh revision/tenant/draft/replay/ordered text: PASS')
const unavailableTyped=runtimeFixture({basketCatalog:true});unavailableTyped.next('Corte');await unavailableTyped.run()
const unavailableBefore=structuredClone(unavailableTyped.session.state)
unavailableTyped.choice({kind:'service',serviceId:'gone'})
await unavailableTyped.run()
assert.deepEqual(unavailableTyped.session.state,unavailableBefore,'expired finite operation cannot mutate draft')
assert.match(unavailableTyped.replies.at(-1)!,/opción.*disponible/)
const typedEnvelope=typedRuntime.statements.flatMap(q=>q.values).filter((v):v is string=>typeof v==='string' && v.startsWith('{')).map(v=>JSON.parse(v)).filter(v=>v.item && v.consolidation?.eventIds?.includes('event-2'))
assert.ok(typedEnvelope.some(v=>v.consolidation.sealed),'typed response has sealed ordered envelope and is never text-replayed')

// The actual bridge statements commit CAS, transition, prompt, choices, outbox and settlement together.
const typedFinalStart=typedRuntime.statements.map(q=>q.sql).lastIndexOf(typedRuntime.statements.filter(q=>q.sql.includes('conversation-turn-persist')).at(-1)!.sql)
const typedWrites=typedRuntime.statements.slice(typedFinalStart).filter(q=>/conversation-turn-persist|conversation-choice-invalidate|conversation-choice-prompt|conversation-choice-persist|conversation-settle-batch/.test(q.sql))
assert.equal(typedWrites.length,5)
const atomicDb=new PGlite()
try {
  await atomicDb.exec(`CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_TAKEN');CREATE TYPE "ConversationStep" AS ENUM ('BOOKING_IN_PROGRESS');
    CREATE TYPE "BotPromptStatus" AS ENUM ('OPEN','STABILIZING','INVALIDATED','RESOLVED');CREATE TYPE "BotPromptMode" AS ENUM ('FUNCTIONAL');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING');CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','PROCESSED');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED');CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','DONE');CREATE TYPE "BotJobStatus" AS ENUM ('LEASED','DONE');
    CREATE TABLE "BotSession"("id" text PRIMARY KEY,"businessId" text,"conversationId" text,"revision" bigint,"deploymentGeneration" integer,"state" jsonb,"status" "BotSessionStatus","handoffClaimsPausedAt" timestamptz,"handoffFenceEpoch" integer,"updatedAt" timestamptz,"draftTouchedAt" timestamptz,"draftExpiresAt" timestamptz);
    CREATE TABLE "Conversation"("id" text,"businessId" text,"currentStep" "ConversationStep","updatedAt" timestamptz);
    CREATE TABLE "BotTransitionLog"("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" integer,"revisionFrom" bigint,"revisionTo" bigint,"actionType" text,"outcome" text,"providerEventId" text,"detail" jsonb);
    CREATE TABLE "BotPrompt"("id" text PRIMARY KEY,"sessionId" text,"promptToken" text,"stateRevision" bigint,"mode" "BotPromptMode","status" "BotPromptStatus","openedAt" timestamptz,"outboxMessageId" text,"resolvedAt" timestamptz);
    CREATE UNIQUE INDEX one_open_prompt ON "BotPrompt"("sessionId") WHERE "status" IN ('OPEN','STABILIZING');
    CREATE TABLE "BotPromptChoice"("id" text PRIMARY KEY,"promptId" text REFERENCES "BotPrompt"("id"),"choiceToken" text,"actionType" text,"entityType" text,"entityId" text,"payload" jsonb,"labelSnapshot" text,"sortOrder" integer);
    CREATE TABLE "BotOutbox"("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"deliveryGroupId" text,"sequence" integer,"kind" text,"payload" jsonb,"idempotencyKey" text UNIQUE,"status" "BotOutboxStatus","dependsOnSequence" integer,"availableAt" timestamptz,"updatedAt" timestamptz);
    CREATE TABLE "BotActionInbox"("id" text,"businessId" text,"providerEventId" text,"status" "BotInboxStatus","error" text);
    CREATE TABLE "BotProviderEvent"("id" text,"businessId" text,"status" "BotProviderEventStatus");
    CREATE TABLE "BotDispatchClaim"("id" text,"claimToken" text,"status" "BotDispatchStatus","updatedAt" timestamptz);
    CREATE TABLE "BotJob"("id" text,"status" "BotJobStatus","leaseToken" text,"leasedUntil" timestamptz,"lastError" text,"updatedAt" timestamptz);
    INSERT INTO "BotSession" VALUES ('session','biz','conversation',1,1,'{}','ACTIVE',NULL,0,NULL,NULL,NULL);
    INSERT INTO "Conversation" VALUES ('conversation','biz',NULL,NULL);
    INSERT INTO "BotPrompt" ("id","sessionId","status") VALUES ('old','session','OPEN');
    INSERT INTO "BotActionInbox" VALUES ('inbox-2','biz','event-2','ADMITTED',NULL);
    INSERT INTO "BotProviderEvent" VALUES ('event-2','biz','ADMITTED');
    INSERT INTO "BotDispatchClaim" VALUES ('claim','dispatch-token','CLAIMED',NULL);
    INSERT INTO "BotJob" VALUES ('job-2','LEASED','job-token',NULL,NULL,NULL);`)
  const run=async(fail=false)=>atomicDb.transaction(async tx=>{
    for(const q of typedWrites) await tx.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))
    if(fail)throw new Error('typed final rollback')
  })
  await assert.rejects(()=>run(true),/rollback/)
  assert.deepEqual((await atomicDb.query(`SELECT "revision"::text FROM "BotSession"`)).rows,[{revision:'1'}])
  assert.deepEqual((await atomicDb.query(`SELECT "status" FROM "BotPrompt"`)).rows,[{status:'OPEN'}])
  assert.equal((await atomicDb.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotOutbox"`)).rows[0]!.count,0)
  await run()
  assert.deepEqual((await atomicDb.query(`SELECT "revision"::text FROM "BotSession"`)).rows,[{revision:'2'}])
  assert.deepEqual((await atomicDb.query(`SELECT "status" FROM "BotActionInbox"`)).rows,[{status:'PROCESSED'}])
  assert.deepEqual((await atomicDb.query(`SELECT "status" FROM "BotDispatchClaim"`)).rows,[{status:'DONE'}])
  assert.deepEqual((await atomicDb.query(`SELECT "status" FROM "BotJob"`)).rows,[{status:'DONE'}])
  assert.ok((await atomicDb.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotPromptChoice" WHERE "actionType"='conversation.choice'`)).rows[0]!.count>0)
  assert.equal((await atomicDb.query<{count:number}>(`SELECT count(*)::integer AS count FROM "BotTransitionLog" WHERE "actionType"='conversation.choice'`)).rows[0]!.count,1)
  console.log('conversational typed bridge actual CAS/prompt/outbox/settlement single transaction rollback: PASS')
} finally {await atomicDb.close()}

const professionalRuntime=runtimeFixture({publicPorts:true})
professionalRuntime.next('¿Ana trabaja los sábados?')
await professionalRuntime.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate({kind:'information',target:{kind:'professional',actions:[],mention:'Ana',serviceIds:['cut'],date:null,weekday:6,aspect:'schedule'},...runtimeEv('Ana trabaja los sábados')}),timeoutMs:15000})
assert.match(professionalRuntime.replies.at(-1)!,/Sábado: 10:00 a 14:00/)
assert.match(professionalRuntime.replies.at(-1)!,/no turnos libres/)
assert.equal(professionalRuntime.singularAgendaCalls,0,'habitual schedule is not slot availability')
const textDuringTyped=runtimeFixture({basketCatalog:true,publicPorts:true})
textDuringTyped.next('Corte');await textDuringTyped.run();textDuringTyped.choice({kind:'service',serviceId:'cut'})
textDuringTyped.hook(()=>textDuringTyped.inputs([{id:textDuringTyped.row.providerEventId,text:'FORGED LABEL'},{id:'newer',text:'mañana'}]))
await textDuringTyped.run()
assert.equal(readConversationDraft(textDuringTyped.session.state,policy,'UTC').serviceId,'cut','durable later text during compute cannot erase the selected operation')
const choiceAfterPolicyRemoval=runtimeFixture({basketCatalog:true})
choiceAfterPolicyRemoval.next('Corte');await choiceAfterPolicyRemoval.run();choiceAfterPolicyRemoval.choice({kind:'service',serviceId:'cut'})
choiceAfterPolicyRemoval.row.definition={} as typeof config.definition
await assert.rejects(choiceAfterPolicyRemoval.run(),/conversation choice policy unavailable/)
assert.equal(readConversationDraft(choiceAfterPolicyRemoval.session.state,policy,'UTC').serviceId,null,'policy removal cannot enter legacy Booking V2')
console.log('conversational runtime public facts/identity/date receivers/choice during new text/policy removal: PASS')

for (const status of ['HUMAN_QUEUED', 'HUMAN_TAKEN']) {
  const protectedReferral = runtimeFixture()
  await protectedReferral.run()
  const draft = readConversationDraft(protectedReferral.session.state, policy, 'UTC')
  draft.referral = { businessId: draft.businessId, status: 'pending', reason: 'UNVERIFIED_SERVICE', request: 'corte francés', serviceId: null }
  draft.serviceRequest = { businessId: draft.businessId, purpose: 'inquiry', disposition: 'unverified_variant',
    request: 'corte francés', serviceIds: [], correction: false, continuation: false, basis: 'related_category', sourceQuote: null }
  protectedReferral.session.state = projectConversationDraft(draft, policy)
  protectedReferral.session.status = status
  protectedReferral.next('volver al bot')
  const beforeState = structuredClone(protectedReferral.session.state)
  const beforeReplies = protectedReferral.replies.length
  let providerCalls = 0
  await protectedReferral.run('PROCESS_INBOX', { provider: async () => {
    providerCalls++
    return runtimeCandidate({ kind: 'referral', action: 'resume', ...runtimeEv('volver al bot') })
  }, timeoutMs: 15000 })
  assert.equal(providerCalls, 0, status + ' cannot use conversational resume to bypass actual human ownership')
  assert.equal(protectedReferral.session.status, status)
  assert.deepEqual(protectedReferral.session.state, beforeState)
  assert.equal(protectedReferral.replies.length, beforeReplies)
}
console.log('conversational referral real HUMAN_QUEUED/HUMAN_TAKEN ownership remains protected: PASS')

}

const handoffDb = new PGlite()
const handoffEvents: unknown[] = []
let stopHandoffEvents = () => {}
try {
  // Reuse the already-exercised runtime final-CAS schema; extend only handoff columns.
  const runtimeSource = await import('node:fs').then(fs => fs.readFileSync('scripts/conversational-bot-runtime-test.ts','utf8'))
  const start = runtimeSource.indexOf('await atomicDb.exec(`') + 'await atomicDb.exec(`'.length
  const end = runtimeSource.indexOf('INSERT INTO "BotSession" VALUES',start)
  const schema = runtimeSource.slice(start,end)
    .replace("('ACTIVE','HUMAN_TAKEN')", "('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN')")
    .replace("('BOOKING_IN_PROGRESS')", "('BOOKING_IN_PROGRESS','HUMAN_HANDOFF','COMPLETED')")
    .replace('"deploymentGeneration" integer,"state"', '"deploymentGeneration" integer,"deploymentId" text DEFAULT \'dep\',"businessTimezone" text DEFAULT \'UTC\',"state"')
    .replace('"currentStep" "ConversationStep","updatedAt" timestamptz', '"currentStep" "ConversationStep","updatedAt" timestamptz,"aiEnabled" boolean DEFAULT true,"humanHandoffAt" timestamptz,"humanHandoffResolvedAt" timestamptz')
  assert.ok(schema.startsWith('CREATE TYPE'), 'reuse matching in-memory SQL schema only')
  await handoffDb.exec(schema + `
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN','CANCELLED','RESOLVED');
    CREATE TABLE "BotChannelDeployment" ("id" text PRIMARY KEY,"businessId" text,"generation" int,
      "activeConfigurationId" text,"claimsPausedAt" timestamptz);
    CREATE TABLE "BotOperation" ("id" text PRIMARY KEY,"operationKey" text UNIQUE,"type" text,"businessId" text,
      "sessionId" text,"status" text,"requestHash" text,"resultRef" text,"updatedAt" timestamptz);
    CREATE TABLE "BotHandoff" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"status" "BotHandoffStatus",
      "reason" text,"detail" text,"context" jsonb,"queuedAt" timestamptz,"updatedAt" timestamptz);
    CREATE UNIQUE INDEX one_active_handoff ON "BotHandoff" ("sessionId") WHERE "status" IN ('QUEUED','TAKEN');
    ALTER TABLE "BotHandoff" ADD COLUMN "cancelledAt" timestamptz;
    ALTER TABLE "BotChannelDeployment" ADD COLUMN "engineKey" text DEFAULT 'deterministic-options';
    CREATE TABLE "Business" (id text PRIMARY KEY,"customerCode" text);
    CREATE TABLE "BusinessBotConfiguration" (id text PRIMARY KEY,"businessId" text,status text,definition jsonb);
    INSERT INTO "Business" VALUES ('biz','WX-38N6UG');
    ALTER TABLE "BotActionInbox" ADD PRIMARY KEY ("id");
    ALTER TABLE "BotProviderEvent" ADD PRIMARY KEY ("id");
    ALTER TABLE "BotDispatchClaim" ADD PRIMARY KEY ("id");
    ALTER TABLE "BotJob" ADD PRIMARY KEY ("id");
    INSERT INTO "BotChannelDeployment" (id,"businessId",generation,"activeConfigurationId","claimsPausedAt") VALUES ('dep','biz',1,'cfg',NULL);
    INSERT INTO "Conversation" ("id","businessId","currentStep","updatedAt") VALUES ('conversation','biz','BOOKING_IN_PROGRESS',now());
  `)
  await handoffDb.query(`INSERT INTO "BusinessBotConfiguration" VALUES ('cfg','biz','ACTIVE',$1::jsonb)`,[JSON.stringify(config.definition)])
  const consentRuntime = runtimeFixture({handoffDb})
  let activeRuntime = consentRuntime
  stopHandoffEvents = subscribeToCrmRealtimeEvents({businessId:'biz',send(event){activeRuntime.assertOutside();handoffEvents.push(event)}})
  const inquiry = 'Demo corte francés mañana'
  consentRuntime.next(inquiry)
  await consentRuntime.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
    {kind:'service_request',purpose:'booking',disposition:'unverified_variant',serviceIds:[],correction:false,
      continuation:false,basis:'related_category',sourceQuote:null,...runtimeEv('corte francés')},
    {kind:'name',value:'Demo',...runtimeEv('Demo')},{kind:'date',expression:'mañana',value:null,...runtimeEv('mañana')}
  ),timeoutMs:15000})
  const before = structuredClone(readConversationDraft(consentRuntime.session.state,policy,'UTC'))
  assert.equal(before.referral?.status,'offered')
  const revision = consentRuntime.session.revision
  const eventCount = handoffEvents.length
  consentRuntime.next('consultar al equipo')
  await consentRuntime.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
    {kind:'referral',action:'consult',...runtimeEv('consultar al equipo')}),timeoutMs:15000})
  assert.equal(consentRuntime.session.status,'HUMAN_QUEUED','public worker must actually enqueue after consent')
  assert.equal(consentRuntime.session.revision,revision+2n,'turn CAS and enqueue have explicit successive revisions')
  const saved = readConversationDraft(consentRuntime.session.state,policy,'UTC')
  assert.equal(saved.customerName,before.customerName)
  assert.equal(saved.date,before.date)
  assert.deepEqual(saved.basket,before.basket)
  assert.equal(consentRuntime.singularAgendaCalls+consentRuntime.basketAgendaCalls,0)
  const queue = (await handoffDb.query<{status:string;detail:string}>('SELECT * FROM "BotHandoff"')).rows
  assert.equal(queue.length,1)
  assert.equal(queue[0]!.status,'QUEUED')
  assert.match(queue[0]!.detail,/^conversational-consent:[a-f0-9]{64}$/)
  const crm = (await handoffDb.query<{currentStep:string;aiEnabled:boolean}>('SELECT * FROM "Conversation"')).rows[0]!
  assert.equal(crm.currentStep,'HUMAN_HANDOFF')
  assert.equal(crm.aiEnabled,true,'queue is not human-owned TAKE')
  assert.ok(handoffEvents.length>eventCount)
  assert.doesNotMatch(consentRuntime.replies.at(-1)!,/no les envié/)
  assert.match(consentRuntime.replies.at(-1)!,/cola|envi.*consulta/i)
  const beforeDuplicate = await handoffDb.query('SELECT * FROM "BotHandoff"')
  await consentRuntime.run()
  assert.deepEqual(await handoffDb.query('SELECT * FROM "BotHandoff"'),beforeDuplicate,'same processed inbox does not create a second queue')
  console.log('visible conversational handoff: public worker, real SQL CAS/queue, CRM and preserved draft PASS')

  const freshConsent = async () => {
    await handoffDb.exec(`TRUNCATE "BotSession","BotTransitionLog","BotPrompt","BotPromptChoice","BotOutbox","BotActionInbox","BotProviderEvent","BotDispatchClaim","BotJob","BotOperation","BotHandoff" CASCADE; UPDATE "Conversation" SET "currentStep"='BOOKING_IN_PROGRESS',"aiEnabled"=true,"humanHandoffAt"=NULL`)
    const runtime = runtimeFixture({handoffDb})
    activeRuntime = runtime
    runtime.next(inquiry)
    await runtime.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
      {kind:'service_request',purpose:'booking',disposition:'unverified_variant',serviceIds:[],correction:false,
        continuation:false,basis:'related_category',sourceQuote:null,...runtimeEv('corte francés')},
      {kind:'name',value:'Demo',...runtimeEv('Demo')},{kind:'date',expression:'mañana',value:null,...runtimeEv('mañana')}
    ),timeoutMs:15000})
    assert.equal(readConversationDraft(runtime.session.state,policy,'UTC').referral?.status,'offered')
    runtime.next('consultar al equipo')
    return runtime
  }
  const queueCount = async () => (await handoffDb.query<{count:number}>('SELECT count(*)::integer AS count FROM "BotHandoff"')).rows[0]!.count
  for (const kind of ['invalid_output','provider_error','timeout'] as const) {
    const denied = await freshConsent()
    const draftBefore = readConversationDraft(denied.session.state,policy,'UTC')
    const diagnostics: Array<{mode:string;reason:string|null}> = []
    const provider: AiInterpretationProvider = kind === 'invalid_output' ? async()=>runtimeCandidate(
      {kind:'information',target:{kind:'service',actions:[],serviceIds:['foreign'],aspect:'price'},...runtimeEv('consultar al equipo')})
      : kind === 'provider_error' ? async()=>{throw new Error('synthetic provider failure')}
      : async()=>new Promise(()=>{})
    await denied.run('PROCESS_INBOX',{provider,timeoutMs:kind==='timeout'?1:15000,onDiagnostic:value=>{diagnostics.push(value as typeof diagnostics[number])}})
    assert.equal(diagnostics[0]!.mode,'fallback')
    assert.equal(diagnostics[0]!.reason,kind)
    assert.equal(denied.session.status,'ACTIVE')
    assert.equal(await queueCount(),0,'fallback cannot reconstruct dispatch consent')
    const after = readConversationDraft(denied.session.state,policy,'UTC')
    assert.equal(after.customerName,draftBefore.customerName)
    assert.equal(after.date,draftBefore.date)
    assert.deepEqual(after.basket,draftBefore.basket)
    assert.doesNotMatch(denied.replies.at(-1)!,/quedó en cola|ya.*envi/i)
    assert.match(denied.replies.at(-1)!,/consultar al equipo/i)
    assert.equal(denied.singularAgendaCalls+denied.basketAgendaCalls,0)
  }
  const rollback = await freshConsent()
  const sqlBefore = (await handoffDb.query('SELECT "state","revision"::text,"status" FROM "BotSession"')).rows
  const outboxBefore = (await handoffDb.query('SELECT * FROM "BotOutbox"')).rows
  const stateBefore = structuredClone(rollback.session.state)
  const eventsBefore = handoffEvents.length
  rollback.failCommit()
  await assert.rejects(()=>rollback.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
    {kind:'referral',action:'consult',...runtimeEv('consultar al equipo')}),timeoutMs:15000}),/COMMIT failed/)
  assert.equal(await queueCount(),0,'caller failure rolls queue back')
  assert.deepEqual((await handoffDb.query('SELECT "state","revision"::text,"status" FROM "BotSession"')).rows,sqlBefore)
  assert.deepEqual((await handoffDb.query('SELECT * FROM "BotOutbox"')).rows,outboxBefore)
  assert.deepEqual(rollback.session.state,stateBefore)
  assert.equal(handoffEvents.length,eventsBefore,'no CRM event or success escapes failed commit')
  assert.equal((await handoffDb.query<{currentStep:string}>('SELECT "currentStep" FROM "Conversation"')).rows[0]!.currentStep,'BOOKING_IN_PROGRESS')
  for (const guard of ['revision','fence','taken'] as const) {
    const rejected = await freshConsent()
    const before = structuredClone(rejected.session.state)
    if(guard==='taken') await handoffDb.query(`INSERT INTO "BotHandoff" (id,"businessId","sessionId",status,reason,detail,context,"queuedAt","updatedAt") VALUES ('taken','biz','session','TAKEN','UNVERIFIED_SERVICE',NULL,'{}',now(),now())`)
    const queuesBefore = await queueCount()
    rejected.hook(()=>{if(guard==='revision')rejected.session.revision++;else if(guard==='fence')rejected.session.handoffFenceEpoch++;else rejected.session.status='HUMAN_TAKEN'})
    await rejected.run('PROCESS_INBOX',{provider:async()=>runtimeCandidate(
      {kind:'referral',action:'consult',...runtimeEv('consultar al equipo')}),timeoutMs:15000})
    assert.equal(await queueCount(),queuesBefore,'final '+guard+' guard cannot enqueue')
    assert.deepEqual(rejected.session.state,before)
  }
  const literal = await freshConsent()
  await literal.run()
  assert.equal(literal.session.status,'HUMAN_QUEUED','server literal consent does not require an AI call')
  assert.equal(await queueCount(),1)
  console.log('handoff final transaction: fallback denial, caller rollback, revision/fence/TAKEN and no-AI literal PASS')

  const freshQueued = async () => {const runtime=await freshConsent();await runtime.run();return runtime}
  const cancelScope = async (runtime: ReturnType<typeof runtimeFixture>) => ({
    handoffId:(await handoffDb.query<{id:string}>('SELECT id FROM "BotHandoff" WHERE status=\'QUEUED\'')).rows[0]!.id,
    revision:runtime.session.revision,handoffFenceEpoch:runtime.session.handoffFenceEpoch,
    deploymentId:'dep',generation:1,configurationId:'cfg',policyHash:canonicalJsonHash(policy),evidence:'cancelar derivación'
  })
  const executeCancel = (scope: Awaited<ReturnType<typeof cancelScope>>, operationKey='conversation-handoff-cancel:controlled',businessId='biz',sessionId='session') =>
    handoffDb.transaction(async sql => prismaHandoffEffectExecutor({
      $queryRaw:async(q:Query)=>(await sql.query(q.text,q.values)).rows,
      $executeRaw:async(q:Query)=>(await sql.query(q.text,q.values)).affectedRows??0
    } as never,{businessId,sessionId,operationKey,cancelScope:scope,effects:[{kind:'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER'}]}))
  const proofRejected = await freshQueued()
  const proof = await cancelScope(proofRejected)
  await assert.rejects(()=>executeCancel({...proof,handoffId:'different'}),/scope|target|proof/,'server proof cannot cancel a different current target')
  assert.equal((await handoffDb.query<{status:string}>('SELECT status FROM "BotHandoff"')).rows[0]!.status,'QUEUED')
  for(const key of ['revision','handoffFenceEpoch','deploymentId','generation','configurationId','policyHash','evidence'] as const) {
    const wrong = {...proof,[key]:key==='revision'?proof.revision+1n:key==='handoffFenceEpoch'||key==='generation'?99:key==='evidence'?'no quiero cancelar la derivación':'different'}
    await assert.rejects(()=>executeCancel(wrong),/scope|target|proof|fence/,'wrong '+key+' cannot cancel')
  }
  for(const guard of ['paused','deployment-paused'] as const) {
    const table=guard==='paused'?'BotSession':'BotChannelDeployment',field=guard==='paused'?'handoffClaimsPausedAt':'claimsPausedAt'
    await handoffDb.exec('UPDATE "'+table+'" SET "'+field+'"=now()')
    await assert.rejects(()=>executeCancel(proof),/scope|fence|proof/)
    await handoffDb.exec('UPDATE "'+table+'" SET "'+field+'"=NULL')
  }

  await assert.rejects(()=>executeCancel(proof,'conversation-handoff-cancel:foreign','other'),/tenant|session/)
  await assert.rejects(()=>executeCancel(proof,'conversation-handoff-cancel:foreign','biz','other'),/tenant|session/)
  await assert.rejects(()=>executeCancel(proof,'legacy-key'),/namespace/)
  await assert.rejects(()=>executeCancel(undefined as never),/namespace/)
  await handoffDb.exec('UPDATE "BusinessBotConfiguration" SET status=\'DRAFT\'')
  await assert.rejects(()=>executeCancel(proof),/policy|scope/)
  await handoffDb.exec('UPDATE "BusinessBotConfiguration" SET status=\'ACTIVE\'; UPDATE "BotSession" SET status=\'HUMAN_TAKEN\'; UPDATE "BotHandoff" SET status=\'TAKEN\'')
  await assert.rejects(()=>executeCancel(proof),/cannot cancel|target|scope/)
  await handoffDb.exec('UPDATE "BotSession" SET status=\'HUMAN_QUEUED\'; UPDATE "BotHandoff" SET status=\'QUEUED\'')

  await executeCancel(proof)
  const completed=(await handoffDb.query<{requestHash:string;resultRef:string}>('SELECT "requestHash","resultRef" FROM "BotOperation" WHERE type=\'CANCEL_HUMAN_HANDOFF_BY_CUSTOMER\'')).rows[0]!
  assert.equal(completed.resultRef,proof.handoffId)
  await executeCancel(proof)
  for(const changed of [{...proof,evidence:'volver al bot'},{...proof,handoffId:'new-queue'},{...proof,revision:proof.revision+1n}]) {
    await assert.rejects(()=>executeCancel(changed),/replay|scope|target|proof/)
  }
  await handoffDb.exec('UPDATE "BotSession" SET status=\'HUMAN_QUEUED\'; INSERT INTO "BotHandoff" (id,"businessId","sessionId",status,context,"queuedAt","updatedAt") VALUES (\'new-queue\',\'biz\',\'session\',\'QUEUED\',\'{}\',now(),now())')
  await executeCancel(proof)
  assert.equal((await handoffDb.query<{status:string}>('SELECT status FROM "BotHandoff" WHERE id=\'new-queue\'')).rows[0]!.status,'QUEUED','exact replay cannot retarget a new queue')
  const customerCancel = await freshQueued()
  const beforeCancel = readConversationDraft(customerCancel.session.state,policy,'UTC')
  const cancelRevision=customerCancel.session.revision, cancelEvents=handoffEvents.length
  customerCancel.next('cancelar derivación')
  let cancelProviderCalls=0
  await customerCancel.run('PROCESS_INBOX',{provider:async()=>{cancelProviderCalls++;throw Error('must not invoke AI')},timeoutMs:15000})
  assert.equal(customerCancel.session.status,'ACTIVE','public current literal must effectively leave queue')
  assert.equal(customerCancel.session.revision,cancelRevision+1n)
  assert.equal(cancelProviderCalls,0)
  const cancelledDraft=readConversationDraft(customerCancel.session.state,policy,'UTC')
  for(const key of ['basket','date','professional','customerName','serviceEstimates','serviceRequest'] as const)assert.deepEqual(cancelledDraft[key],beforeCancel[key],key+' preserved')
  for(const key of ['referral','dialogueContext','questionContext','bookingReservation','sandboxReservation'] as const)assert.equal(cancelledDraft[key],undefined,key+' cannot retain old consent or queue')
  assert.equal(cancelledDraft.slot,null)
  assert.equal((await handoffDb.query<{status:string}>('SELECT status FROM "BotHandoff"')).rows[0]!.status,'CANCELLED')
  assert.equal(customerCancel.singularAgendaCalls+customerCancel.basketAgendaCalls,0)
  assert.match(customerCancel.replies.at(-1)!,/cancel|fuera de la cola/i)
  assert.ok(handoffEvents.length>cancelEvents)
  const countAfter=(await handoffDb.query('SELECT * FROM "BotOperation"')).rows
  await customerCancel.run()
  assert.deepEqual((await handoffDb.query('SELECT * FROM "BotOperation"')).rows,countAfter)
  for(const message of ['no quiero cancelar la derivación','si hace falta cancelar la derivación','cancelar derivación o seguir esperando']) {
    const retained=await freshQueued();const before=structuredClone(retained.session.state)
    retained.next(message);await retained.run()
    assert.equal(retained.session.status,'HUMAN_QUEUED')
    assert.deepEqual(retained.session.state,before)
  }
  const cancelledRollback=await freshQueued()
  const durableBefore=(await handoffDb.query('SELECT state,revision::text,status FROM "BotSession"')).rows
  const replyBefore=(await handoffDb.query('SELECT * FROM "BotOutbox"')).rows
  const operationBefore=(await handoffDb.query('SELECT * FROM "BotOperation"')).rows
  const crmBefore=(await handoffDb.query('SELECT * FROM "Conversation"')).rows
  const rollbackEvents=handoffEvents.length
  cancelledRollback.next('volver al bot');cancelledRollback.failCommit()
  await assert.rejects(()=>cancelledRollback.run(),/COMMIT failed/)
  assert.deepEqual((await handoffDb.query('SELECT state,revision::text,status FROM "BotSession"')).rows,durableBefore)
  assert.deepEqual((await handoffDb.query('SELECT * FROM "BotOutbox"')).rows,replyBefore)
  assert.deepEqual((await handoffDb.query('SELECT * FROM "BotOperation"')).rows,operationBefore)
  assert.deepEqual((await handoffDb.query('SELECT * FROM "Conversation"')).rows,crmBefore)
  assert.equal((await handoffDb.query<{status:string}>('SELECT status FROM "BotHandoff"')).rows[0]!.status,'QUEUED')
  assert.equal(handoffEvents.length,rollbackEvents)
  console.log('D3 queued cancellation: scoped proof/replay, public literal, preserved draft, no AI/agenda and caller rollback PASS')
} finally {stopHandoffEvents();await handoffDb.close()}


// Production caller + production F7 SQL share one PGlite transaction. Claims/admission
// are the existing controlled fixture; this does not claim cross-process contention.
const bookingDb=new PGlite()
try {
  const barberResetId = 'cmpvr0oqo0000o0vcnhgyv054'
  const barberResetPolicy = { businessId: barberResetId, deploymentId: 'dep', generation: 1, configurationId: 'cfg' }
  const resetProbe = runtimeFixture({ businessId: barberResetId }); await resetProbe.run()
  resetProbe.next('/reset'); await resetProbe.run()
  const prismaSchema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8')
  for(const match of prismaSchema.matchAll(/enum (\w+) \{([\s\S]*?)\n\}/g)) {
    const values=match[2]!.split('\n').flatMap(line=>{const label=line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1];return label?[line.match(/@map\("([^"]+)"\)/)?.[1]??label]:[]})
    await bookingDb.exec('CREATE TYPE "'+match[1]+'" AS ENUM ('+values.map(v=>"'"+v+"'").join(',')+')')
  }
  const models=['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','ServiceCombinationRule','BotOperation','BotTransitionLog','BotPrompt','BotPromptChoice','BotOutbox','BotActionInbox','BotProviderEvent','BotDispatchClaim','BotJob']
  for(const name of models) {
    const body=prismaSchema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
    const columns=body.split('\n').flatMap(line=>{
      const field=line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
      if(!field||/\[\]/.test(line))return []
      const scalar=({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision'} as Record<string,string>)[field[2]!]
      const type=scalar??(prismaSchema.includes('enum '+field[2]+' {')?'"'+field[2]+'"':null)
      const column=line.match(/@map\("([^"]+)"\)/)?.[1]??field[1]
      return type?['"'+column+'" '+type+(field[1]===(name==='BusinessBotOptionsSettings'?'businessId':'id')?' PRIMARY KEY':'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')]:[]
    })
    await bookingDb.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
  }
  // Execute the captured production guard, not a copied SQL approximation.
  const resetGuard = resetProbe.statements.find(q => q.sql.includes('test-reset-pending-effects'))!
  const guarded = async () => (await bookingDb.query<{blocked:boolean}>(resetGuard.text, resetGuard.values)).rows[0]!.blocked
  assert.equal(await guarded(), false)
  for (const status of ['PENDING','CLAIMED','RETRY','SENDING','UNKNOWN']) {
    await bookingDb.query('INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ($1,$2,$3,$4::"BotOutboxStatus")', ['reset-pending',barberResetId,'session',status])
    assert.equal(await guarded(), true, 'production SQL blocks outbox ' + status)
    await bookingDb.query('DELETE FROM "BotOutbox" WHERE id=$1', ['reset-pending'])
  }
  await bookingDb.query('INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ($1,$2,$3,$4::"BotOutboxStatus"),($5,$6,$7,$8::"BotOutboxStatus")',
    ['foreign-reset','foreign','session','UNKNOWN','other-session',barberResetId,'other','UNKNOWN'])
  assert.equal(await guarded(), false, 'pending effects in another tenant/session are not reset authority')
  await bookingDb.exec('DELETE FROM "BotOutbox"')
  for (const status of ['STARTED','UNKNOWN','FAILED',null,'COMPLETED']) {
    await bookingDb.query('INSERT INTO "BotOperation" (id,"businessId","sessionId",status) VALUES ($1,$2,$3,$4)', ['reset-operation',barberResetId,'session',status])
    assert.equal(await guarded(), status !== 'COMPLETED', 'production SQL conservatively blocks operation ' + status)
    await bookingDb.query('DELETE FROM "BotOperation" WHERE id=$1', ['reset-operation'])
  }
  console.log('reset captured production SQL: actual Prisma columns/enums, pending/terminal and tenant/session scope PASS')
  await bookingDb.exec('CREATE UNIQUE INDEX booking_operation_key ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX booking_visit_unique ON "Appointment" ("visitId"); CREATE UNIQUE INDEX booking_outbox_key ON "BotOutbox" ("idempotencyKey")')
  await bookingDb.exec(`
    INSERT INTO "Business" (id,name,"botEnabled","publicAddress") VALUES ('cmpvr0oqo0000o0vcnhgyv054','Salón ficticio',true,'Calle ficticia 123');
    INSERT INTO "Conversation" (id,"businessId",phone) VALUES ('conversation','cmpvr0oqo0000o0vcnhgyv054','5491112345678');
    INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('customer','cmpvr0oqo0000o0vcnhgyv054','5491112345678','5491112345678','Ana');
    INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','cmpvr0oqo0000o0vcnhgyv054','WHATSAPP',1,1,'cfg',1);
    INSERT INTO "BusinessBotConfiguration" (id,"businessId",status) VALUES ('cfg','cmpvr0oqo0000o0vcnhgyv054','ACTIVE');
    INSERT INTO "BotSession" (id,"businessId","conversationId","deploymentId","deploymentGeneration",status,revision,"handoffFenceEpoch","businessTimezone",state) VALUES ('session','cmpvr0oqo0000o0vcnhgyv054','conversation','dep',1,'ACTIVE',0,0,'UTC','{}');
    INSERT INTO "BusinessBotOptionsSettings" ("businessId",timezone,"bookingHorizonDays","bookingLeadTimeHours") VALUES ('cmpvr0oqo0000o0vcnhgyv054','UTC',20000,0);
    INSERT INTO "ServiceCategory" (id,"businessId","isActive") VALUES ('category','cmpvr0oqo0000o0vcnhgyv054',true);
    INSERT INTO "Service" (id,"businessId","catalogCategoryId",name,duration,price,"priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode") VALUES
    ('s1','cmpvr0oqo0000o0vcnhgyv054','category','Corte',30,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE'),('s2','cmpvr0oqo0000o0vcnhgyv054','category','Crema',30,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE');
    INSERT INTO "Professional" (id,"businessId",name,"isActive","acceptsBotBookings","botBookingPriority") VALUES ('p1','cmpvr0oqo0000o0vcnhgyv054','Elisa',true,true,0);
    INSERT INTO "ProfessionalService" (id,"professionalId","serviceId") VALUES ('ps1','p1','s1'),('ps2','p1','s2');
    INSERT INTO "BusinessHours" (id,"businessId","dayOfWeek","startTime","endTime") VALUES ('bh','cmpvr0oqo0000o0vcnhgyv054',1,'09:00','20:00');
    INSERT INTO "ProfessionalHours" (id,"professionalId","dayOfWeek","startTime","endTime") VALUES ('ph','p1',1,'09:00','20:00');
  `)
  const services=[{id:'s1',name:'Corte',durationMinutes:30,price:1000,requiresConsultation:false},{id:'s2',name:'Crema',durationMinutes:30,price:2000,requiresConsultation:false}]
  const segments=services.map((service,index)=>({serviceId:service.id,serviceName:service.name,professionalId:'p1',professionalName:'Elisa',startAt:'2030-09-02T10:'+String(index*30).padStart(2,'0')+':00.000Z',endAt:index?'2030-09-02T11:00:00.000Z':'2030-09-02T10:30:00.000Z',durationMinutes:30,customerDurationMinutes:30}))
  const bookingSlot={date:'2030-09-02',time:'10:00',startAt:segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa',band:'MORNING' as const,occupiedMinutes:60,coordination:{key:coordinationKey('cmpvr0oqo0000o0vcnhgyv054',segments),segments}}
  const bookingPort:DialoguePort={catalog:async()=>services,availability:async()=>{throw new Error('singular port not used')},availabilityBasket:async()=>({ok:true,services,durationMinutes:60,totalPrice:3000,professionals:[{id:'p1',name:'Elisa',priority:0}],slots:[bookingSlot]}),prepareRuntimeBooking:async(state,scope)=>{
    const raw=(await bookingDb.query<Record<string,unknown>>('SELECT * FROM "Service" ORDER BY id')).rows
    const terms:RuntimeBookingTerms={version:1,businessId:'cmpvr0oqo0000o0vcnhgyv054',timezone:'UTC',date:state.date!,customerName:state.customerName!,preference:state.professional!,segments:segments.map((segment,index)=>({...segment,priceMinor:services[index]!.price,priceMode:'FIXED',configurationHash:runtimeServiceConfigurationHash(raw[index]!)})),totalPriceMinor:3000}
    return {slot:bookingSlot,presented:{scope,version:1,nonce:randomUUID(),fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true,terms}}
  }}
  const fault={secondChild:false}, live=runtimeFixture({businessId:barberResetId,bookingDb,bookingPort,bookingFault:fault,phone:'5491112345678',now:new Date('2030-09-01T12:00:00Z')})
  const seed=async()=>{
    const id=live.row.id,event=live.row.providerEventId,job='job-'+id.replace('inbox-','').replace('inbox','0')
    await bookingDb.query(`INSERT INTO "BotActionInbox" (id,"businessId","providerEventId",status) VALUES ($1,'cmpvr0oqo0000o0vcnhgyv054',$2,'ADMITTED')`,[id,event])
    await bookingDb.query(`INSERT INTO "BotProviderEvent" (id,"businessId",status) VALUES ($1,'cmpvr0oqo0000o0vcnhgyv054','ADMITTED')`,[event])
    await bookingDb.query(`INSERT INTO "BotDispatchClaim" (id,"claimToken",status) VALUES ($1,$2,'CLAIMED')`,[id,'dispatch-token-'+id])
    await bookingDb.query(`INSERT INTO "BotJob" (id,status,"leaseToken") VALUES ($1,'LEASED','job-token')`,[job])
  }
  await seed();await live.run()
  const ready={...initialDialogueState('cmpvr0oqo0000o0vcnhgyv054'),customerName:'Ana',date:'2030-09-02',professional:{kind:'specific' as const,id:'p1'},pending:'proposal' as const,slot:bookingSlot,basket:{version:1 as const,nextMemberId:3,members:services.map((service,index)=>({memberId:'m'+(index+1),mode:'single' as const,serviceIds:[service.id],evidence:service.name}))}}
  live.session.state=projectConversationDraft(ready,barberResetPolicy)
  await bookingDb.query(`UPDATE "BotSession" SET state=$1::jsonb,revision=$2 WHERE id='session'`,[JSON.stringify(live.session.state),String(live.session.revision)])
  live.next('Quiero reservar ambos servicios.');await seed();await live.run()
  assert.ok(readConversationDraft(live.session.state,barberResetPolicy,'UTC').bookingReservation)
  for(const [kind,provider] of [
    ['provider_error',async()=>{throw new Error('controlled offline provider error')}],
    ['invalid_output',async()=>({intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations:[{kind:'confirm_proposal',evidence:'inventado',confidence:1}]}})],
    ['timeout',async()=>new Promise<never>(()=>{})]
  ] as const) {
    live.next('Confirmo el turno.');await seed();await live.run('PROCESS_INBOX',{provider,timeoutMs:25})
    assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,0,kind+' cannot authorize real F7 effects')
    assert.doesNotMatch(live.replies.at(-1)!,/La reserva fue confirmada|Te esperamos/)
    live.next('Quiero reservar ambos servicios.');await seed();await live.run()
    assert.ok(readConversationDraft(live.session.state,barberResetPolicy,'UTC').bookingReservation)
  }
  live.next('Confirmo el turno y cambialo a mañana.');await seed();await live.run('PROCESS_INBOX',{provider:async()=>({intent:'booking',serviceId:null,serviceEvidence:null,professionalMention:null,turnPlan:{version:1,operations:[{kind:'confirm_proposal',evidence:'Confirmo el turno y cambialo a mañana.',confidence:1}]}}),timeoutMs:15000})
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,0,'model confirmation cannot erase actual new constraints')
  live.next('Quiero reservar ambos servicios.');await seed();await live.run()
  const offeredState=structuredClone(live.session.state),offeredRevision=live.session.revision
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,0)
  fault.secondChild=true
  live.next('Confirmo el turno.');await seed()
  await assert.rejects(()=>live.run(),/second booking child/)
  assert.deepEqual(live.session.state,offeredState)
  assert.equal(live.session.revision,offeredRevision)
  for(const table of ['Appointment','BookingVisit','BotOperation'])assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "'+table+'"')).rows[0]!.n,0,'second child rollback ALL '+table)
  fault.secondChild=false;live.failCommit()
  await assert.rejects(()=>live.run(),/COMMIT failed/)
  for(const table of ['Appointment','BookingVisit','BotOperation'])assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "'+table+'"')).rows[0]!.n,0,'caller failure rollback ALL '+table)
  live.allowCommit();await live.run()
  assert.equal(parseBotOptionsState(live.session.state).ok,true)
  assert.equal((live.session.state as {booking:string}).booking,'CONFIRMED')
  const confirmed=readConversationDraft(live.session.state,barberResetPolicy,'UTC').bookingReservation!
  assert.equal(confirmed.receipt!.appointments.length,2)
  assert.equal(new Set(confirmed.receipt!.appointments.map(a=>a.visitId)).size,2)
  assert.match(live.replies.at(-1)!,/La reserva fue confirmada/)
  assert.match(live.replies.at(-1)!,/Te esperamos en Calle ficticia 123/)
  assert.doesNotMatch(live.replies.at(-1)!,/Propuesta|otra vez al confirmar|Confirmás/i)
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,2)
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "BookingVisit"')).rows[0]!.n,2)
  const body=(await bookingDb.query<{payload:{item:{body:string}}}>('SELECT payload FROM "BotOutbox" ORDER BY "createdAt" DESC LIMIT 1')).rows[0]!.payload.item.body
  assert.equal(body,live.replies.at(-1))
  live.next('Gracias.');await seed();await live.run()
  assert.deepEqual(readConversationDraft(live.session.state,barberResetPolicy,'UTC').bookingReservation,confirmed,'protected confirmed acknowledgement retains receipt')
  assert.match(live.replies.at(-1)!,/La reserva fue confirmada/)
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "Appointment"')).rows[0]!.n,2,'ack cannot book twice')
  // Simulate acceptance of previous replies before reset; no delivery/retry occurs here.
  await bookingDb.query('UPDATE "BotOutbox" SET status=$1::"BotOutboxStatus"', ['ACCEPTED'])
  // The protected acknowledgement uses fixture settlement; reflect its terminal claim before the next real SQL persist.
  await bookingDb.query('UPDATE "BotDispatchClaim" SET status=$1::"BotDispatchStatus"', ['DONE'])
  const preserved = new Map<string, unknown[]>()
  for (const table of ['Appointment','AppointmentServiceItem','BookingVisit','BotOperation','Customer']) {
    preserved.set(table, (await bookingDb.query('SELECT * FROM "'+table+'" ORDER BY 1,2')).rows)
  }
  const historyCount = live.messages
  live.next('/reset'); await seed(); await live.run('PROCESS_INBOX', {provider:async()=>{throw new Error('confirmed reset must not call AI')},timeoutMs:10})
  assert.deepEqual(live.session.state,createInitialBotOptionsState(),'confirmed reset discards only the conversation draft')
  assert.equal(live.messages,historyCount+1,'CRM history remains and reset is appended')
  assert.match(live.replies.at(-1)!,/No cancelé turnos confirmados/)
  for (const [table,before] of preserved) assert.deepEqual((await bookingDb.query('SELECT * FROM "'+table+'" ORDER BY 1,2')).rows,before,'confirmed reset preserves ALL '+table)
  console.log('runtime confirmed /reset: actual F7 appointments, visits, ledger, customer and history preserved PASS')
  // Recover the persisted JSONB value, rather than the fixture's insertion-order object.
  const restored = (await bookingDb.query<{state:unknown}>('SELECT state FROM "BotSession" WHERE id=$1',['session'])).rows[0]!.state
  const resetFailures:string[]=[]
  try { assert.deepEqual(readConversationDraft(restored,barberResetPolicy,'UTC'),initialDialogueState(barberResetId)) }
  catch (error) { resetFailures.push('JSONB initial read: '+String(error)) }
  try { assert.equal(reconcileConversationDraft(restored,barberResetPolicy,'UTC').reset,false) }
  catch (error) { resetFailures.push('JSONB initial reconcile: '+String(error)) }
  live.session.state=restored
  let nextCalls=0
  live.next('Hola, ¿qué tal?'); await seed()
  await live.run('PROCESS_INBOX',{provider:async input=>{
    nextCalls++; assert.deepEqual(input.state,initialDialogueState(barberResetId),'next AI receives only the fresh draft')
    return {intent:'other',serviceId:null,serviceEvidence:null,professionalMention:null,
      firstReply:{salutation:'greeting',opening:'Bien, gracias.',factIds:null,closing:null,variantChoices:null}}
  },timeoutMs:100})
  try { assert.doesNotMatch(live.replies.at(-1)!,/La configuración cambió|borrador nuevo/) }
  catch (error) { resetFailures.push('caller reset→greeting: '+String(error)) }
  assert.equal(nextCalls,1)
  for (const [table,before] of preserved) assert.deepEqual((await bookingDb.query('SELECT * FROM "'+table+'" ORDER BY 1,2')).rows,before,'next greeting preserves ALL '+table)
  for (const failure of resetFailures) console.error('FAIL P9 '+failure)
  assert.deepEqual(resetFailures,[])
  console.log('P9 actual JSONB reset→next greeting: no false policy reset, clean AI state, confirmed effects preserved PASS')

  console.log('runtime actual F7 ALL visits + caller CAS/outbox + second-child/caller rollback + confirmed acknowledgement: PASS')
}finally{await bookingDb.close()}
