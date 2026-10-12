import assert from 'node:assert/strict'
import { initialDialogueState, continueCompletedBooking, respond, finalizeRuntimeBooking, type DialogueContext, type DialoguePort, type DialogueState, type DialogueResponse } from '../src/conversational-bot/engine.js'
import { runtimeBookingFingerprint, type RuntimeShownScope, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { beginAppointmentManagement, managementRescheduleOfferKey, presentGroupCancellation, confirmGroupCancellation } from '../src/conversational-bot/appointment-management.js'
import type { AppointmentManagementContext, CancellationSnapshot, GroupCancellationCommand, GroupRescheduleCommand } from '../src/conversational-bot/appointment-management.js'

// First public RED uses controlled server ports and a controlled COMMITTED result.
// This is NOT caller/F7/F9 integration proof; real caller/PGlite coverage must follow before closure.
const scope: RuntimeShownScope = { businessId: 'b', sessionId: 'session', deploymentId: 'deployment', generation: 1, revision: '1', configurationId: 'configuration', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 }
const services = [{ id: 'cut', name: 'Corte', durationMinutes: 30, price: 1000, requiresConsultation: false }]
const slot = { date: '2026-10-12', time: '10:00', startAt: '2026-10-12T10:00:00.000Z', professionalId: 'elisa', professionalName: 'Elisa', band: 'MORNING' as const, occupiedMinutes: 30 }
const context: DialogueContext = { businessId: 'b', timezone: 'UTC', dbNow: new Date('2026-10-07T12:00:00Z'), serverRuntimeBookingScope: scope }
const port: DialoguePort = {
  catalog: async () => services,
  availability: async () => ({ professionals: [{ id: 'elisa', name: 'Elisa', priority: 0 }], slots: [slot] }),
  availabilityBasket: async () => ({ ok: true, services, durationMinutes: 30, totalPrice: 1000, professionals: [{ id: 'elisa', name: 'Elisa', priority: 0 }], slots: [slot] }),
  prepareRuntimeBooking: async (state, shownScope) => {
    const terms: RuntimeBookingTerms = { version: 1, businessId: 'b', timezone: 'UTC', date: state.date!, customerName: state.customerName!, preference: state.professional!, totalPriceMinor: 1000,
      segments: [{ serviceId: 'cut', serviceName: 'Corte', professionalId: 'elisa', professionalName: 'Elisa', startAt: slot.startAt, endAt: '2026-10-12T10:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30, priceMinor: 1000, priceMode: 'FIXED', configurationHash: null }] }
    return { slot, presented: { scope: shownScope, version: 1, nonce: '11111111-1111-4111-8111-111111111111', fingerprint: runtimeBookingFingerprint(terms), conditionsPresented: true, terms } }
  }
}
let state: DialogueState = initialDialogueState('b')
for (const message of ['Quiero Corte para el lunes con Elisa.', 'A las 10:00.', 'Mi nombre es Ana.']) {
  state = (await respond(context, state, message, port)).state
}
assert.ok(state.bookingReservation, 'public prefix must reach a real server-presented booking')
const confirmation = await respond({ ...context, serverRuntimeBookingScope: { ...scope, revision: '2' } }, state, 'Confirmo el turno.', port)
assert.equal(confirmation.bookingCommand?.kind, 'CONFIRM_BOOKING')
const presented = state.bookingReservation.presented
const booked = finalizeRuntimeBooking(confirmation, { kind: 'COMMITTED', coordinationGroupId: 'owned-group', proposalNonce: presented.nonce, fingerprint: presented.fingerprint, appointments: [{ segmentIndex: 0, appointmentId: 'owned-appointment', visitId: 'owned-visit' }] })
const snapshot: CancellationSnapshot = { scope: { businessId: 'b', customerId: 'owned-customer', sessionId: 'session', normalizedPhone: '5491112345678' }, groupId: 'owned-group', dbNow: context.dbNow.toISOString(), members: [{ appointmentId: 'owned-appointment', version: 0, status: 'CONFIRMED', visitId: 'owned-visit', visitVersion: 0, visitStatus: 'CONFIRMED', professionalId: 'elisa', serviceIds: ['cut'], startAt: slot.startAt, durationMinutes: 30, customerDurationMinutes: 30, quotedPrice: 1000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null }] }
const original = structuredClone(booked.state)
const managementContext = { ...context, serverRuntimeBookingScope: { ...scope, revision: '3' }, serverManagementSnapshot: snapshot }
const requested = await respond(managementContext, booked.state, 'Quiero cancelar mi turno confirmado.', port, { serviceId: null, candidateIds: [], correction: false,
  turnPlan: { version: 1, operations: [{ kind: 'unsupported_action', action: 'CANCEL', evidence: 'Quiero cancelar mi turno confirmado.', confidence: 1 }] } })
type ManagementResponse = DialogueResponse & { state: DialogueState & { appointmentManagement?: { context: AppointmentManagementContext; presentedScope?: RuntimeShownScope } }; managementCommand?: GroupCancellationCommand | GroupRescheduleCommand }
const actual = requested as ManagementResponse
assert.equal(actual.bookingCommand, undefined, 'management intent cannot reserve again')
assert.equal(actual.managementCommand, undefined, 'cancellation intent alone is not effects consent')
assert.deepEqual(booked.state, original, 'public input remains immutable')
assert.deepEqual(actual.state.bookingReservation, original.bookingReservation, 'original immutable booking proof remains unchanged')
assert.equal(actual.state.appointmentManagement, undefined, 'customer cancellation cannot start automatic management')
assert.equal(actual.confirmedCancellationHandoff?.snapshot.groupId, snapshot.groupId)
assert.match(actual.reply, /cancel|anul/i)
assert.match(actual.reply, /equipo/i)
assert.match(actual.reply, /sigue vigente/i)
assert.doesNotMatch(actual.reply, /fue cancelad|cancelación realizada|reserva fue confirmada/i)
console.log('runtime management customer cancellation routes to team: PASS (controlled ports; caller proof still required)')

const approved = await respond({ ...managementContext, serverRuntimeBookingScope: { ...scope, revision: '4' } }, actual.state, 'Confirmo la cancelación.', port) as ManagementResponse
assert.equal(approved.managementCommand, undefined)
const fullActionConsent = await respond({ ...managementContext, serverRuntimeBookingScope: { ...scope, revision: '4' } }, actual.state, 'Confirmo cancelar todos los turnos.', port)
assert.equal(fullActionConsent.managementCommand, undefined, 'literal action consent cannot auto-cancel')
assert.deepEqual(approved.state.bookingReservation ?? approved.state.completedBooking, original.bookingReservation)
for (const body of ['¿Confirmo la cancelación?', 'Confirmo si no tiene costo.', 'Sí, pero cambiá la fecha.', 'No confirmo la cancelación.']) {
  const negative = await respond({ ...managementContext, serverRuntimeBookingScope: { ...scope, revision: '4' } }, actual.state, body, port) as ManagementResponse
  assert.equal(negative.managementCommand, undefined, 'full literal consent only: ' + body)
}
for (const altered of [{ revision: '5' }, { sessionId: 'foreign' }, { dispatchFenceEpoch: 9 }, { handoffFenceEpoch: 9 }, { generation: 2 }, { configurationId: 'foreign' }]) {
  const negative = await respond({ ...managementContext, serverRuntimeBookingScope: { ...scope, revision: '4', ...altered } }, actual.state, 'Confirmo la cancelación.', port) as ManagementResponse
  assert.equal(negative.managementCommand, undefined)
}
assert.deepEqual((await respond({ ...context, serverRuntimeBookingScope: { ...scope, revision: '4' } }, actual.state, 'Confirmo la cancelación.', port) as ManagementResponse).managementCommand, undefined)
console.log('runtime management current literal scope and conditional denial: PASS')
const reschedulePort: DialoguePort = { ...port, managementRescheduleOffers: async (current, date) => { const moves = [{ appointmentId: 'owned-appointment', newStartAt: date + 'T10:00:00.000Z' }]; return [{ key: managementRescheduleOfferKey(current, date, moves), date, moves }] } }
const change = await respond(managementContext, booked.state, 'Quiero reprogramar mi turno.', reschedulePort)
const approximate = await respond(managementContext, change.state, 'Para el 2026-10-19 alrededor de las 10:00.', reschedulePort)
assert.equal(approximate.state.appointmentManagement?.context.proposal, undefined, 'an approximate preference is not explicit selection of a management offer')
assert.equal(approximate.managementCommand, undefined)
assert.equal(approximate.state.appointmentManagement?.selectedTime, undefined)

import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { publicAppointmentManagement } from '../src/conversational-bot/dialogue-context.js'
const internalManagementState=structuredClone(actual.state)
internalManagementState.appointmentManagement={context:beginAppointmentManagement('CANCEL',snapshot),presentedScope:scope}
const archivedManagement=structuredClone(internalManagementState)
archivedManagement.completedBooking=archivedManagement.bookingReservation
delete archivedManagement.bookingReservation
assert.deepEqual(publicAppointmentManagement(archivedManagement),publicAppointmentManagement(internalManagementState),'archived completed receipt preserves the public management context')

let capturedPublicPayload: Record<string, unknown> | undefined
const captureOnly = createOpenAiInterpretationProvider({ apiKey: 'synthetic-unused-key', fetchImpl: (async (_url, init) => {
  capturedPublicPayload = JSON.parse(JSON.parse(String(init?.body)).input)
  throw new Error('LOCAL_CAPTURE_ONLY')
}) as typeof fetch })
await assert.rejects(() => captureOnly({ message: 'Para mañana a las 11:00.', state: internalManagementState, services }, new AbortController().signal), /LOCAL_CAPTURE_ONLY/)
assert.deepEqual(capturedPublicPayload!.management, publicAppointmentManagement(internalManagementState))
const payloadText = JSON.stringify(capturedPublicPayload)
for (const privateValue of [snapshot.scope.normalizedPhone, 'owned-group', 'owned-customer', 'owned-appointment', 'owned-visit', internalManagementState.appointmentManagement!.context.proposal!.nonce, internalManagementState.appointmentManagement!.context.proposal!.fingerprint]) assert.ok(!payloadText.includes(privateValue), 'private management proof must not enter provider payload')
assert.equal(capturedPublicPayload!.date, null, 'management date is independent of immutable booking date')
console.log('management provider whitelist: no private snapshot/IDs/phone/nonce/hash; local fake-fetch only PASS')
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { readConversationDraft, projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../src/bot-options/domain/state.js'
import { processSessionJob } from '../src/bot-options/application/process-session-job.js'
import { issueChoiceQuestion, publicChoiceQuestion, type ConversationChoiceOperation } from '../src/conversational-bot/choices.js'
import type { AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import type { QueueMilestoneTracker } from '../src/bot-options/observability/queue-milestones.js'
import { resolveGuidance } from '../src/conversational-bot/service-guidance.js'
import { runtimeServiceConfigurationHash } from '../src/conversational-bot/prisma-conversational-booking.js'
import { coordinationKey } from '../src/conversational-bot/coordinated-booking.js'
import { prepareGroupRescheduleOffers, loadOwnConfirmedRuntimeGroupSnapshot, cancelGroupInTransaction } from '../src/conversational-bot/prisma-appointment-management.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1, configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options', definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' }, serviceContent: { version: 1, businessId: 'biz', services: [] } } }
const policy = resolveConversationPolicy(config)!
let managementSecondId = ''
const runtimeInfo = console.info
console.info = (...args: unknown[]) => { if (args[0] !== '[bot-options-attempt-stage]') runtimeInfo(...args) }
// Existing runtimeFixture copied locally: admission/claims controlled; production caller SQL/effects real PGlite.
type Query = { sql: string; text: string; values: unknown[] }
function runtimeFixture(options: { bookingDb?:PGlite;bookingPort?:DialoguePort;bookingFault?:{secondChild:boolean;managementSecond?:boolean};publicPorts?:boolean; availabilityReason?: 'COMBINATION_REVIEW'; basketCatalog?: boolean; guidedCatalog?: boolean; sessionDb?: PGlite; computeDb?: PGlite; handoffDb?: PGlite; jobPrefix?: string; businessId?: string; phone?: string; now?: Date; failAfterSessionCreate?: boolean; failSnapshotCommit?: boolean; onPreparingReply?: (context: { businessId: string; providerPhoneNumberId: string; providerMessageId: string }) => void | Promise<void>; queueMilestones?: QueueMilestoneTracker } = {}) {
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
      if(bookingSql && (q.sql.includes('FROM "BotSession" bs') || q.sql.includes('FROM "BookingVisit" v') || q.sql.includes('FROM "BookingDepositProof"') || q.sql.includes('"AppointmentChangeHistory"')))return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).rows
      if(bookingSql && q.sql.includes('extract(minute FROM'))return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).rows
      if(bookingSql && q.sql.includes('pg_advisory_xact_lock'))return [{locked:1}]
      if(bookingSql && q.sql.includes('conversation-inbox-lock'))return [structuredClone(row)]
      if (handoffSql && (q.sql.includes('"BotOperation"') || q.sql.includes('"BotHandoff"') ||
          q.sql.includes('conversational-handoff-') || q.sql.includes('UPDATE "BotSession" SET "status" =') || q.sql.includes('SELECT "status"::text AS "status"') || q.sql.includes('humanHandoffAtText') || q.sql.includes('UPDATE "Conversation" c SET "currentStep"'))) {
        return (await handoffSql.query(q.text,q.values)).rows
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
      if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) return computeSql ? (await computeSql.query(q.text, q.values)).rows : [{ claimToken: 'dispatch-token' }]
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
        if (bookingSql) {
          const result = (await bookingSql.query<Record<string, unknown>>(q.text, q.values)).rows[0]!
          row.status = 'PROCESSED'; settled++
          return [Object.fromEntries(Object.entries(result).map(([key, value]) => [key, key.endsWith('Count') ? BigInt(value as string | number) : value]))]
        }
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
      if(bookingSql && options.bookingFault?.managementSecond && /UPDATE "Appointment"/.test(q.sql) && q.values.includes(managementSecondId))throw new Error('controlled second management child failure')
      if(bookingSql && /"Appointment"|"AppointmentServiceItem"|"BookingVisit"|"BotOperation"|"AppointmentChangeHistory"/.test(q.sql))return (await bookingSql.query(q.text,q.values.map(v=>v instanceof Date?v.toISOString():v))).affectedRows??0
      if (options.computeDb && (q.sql.includes('pg_advisory') || q.sql.includes('UPDATE "BotDispatchClaim"'))) {
        const result = computeSql ? await computeSql.query(q.text, q.values) : await options.computeDb.query(q.text, q.values)
        return result.affectedRows ?? 1
      }
      assert.ok(!q.sql.includes('INSERT INTO "Appointment"') && !q.sql.includes('INSERT INTO "BookingVisit"'), 'proposal must never create bookings')
      if (q.sql.includes('conversation-generation-reset')) { assert.ok(session); session.deploymentGeneration = 1; session.state = createInitialBotOptionsState(); session.revision++ }
      if (q.sql.includes('conversation-save') || (q.sql.includes('UPDATE "BotSession" SET "state"') && q.values.some(v => typeof v === 'string' && v.includes('schemaVersion')))) {
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
    const port: DialoguePort = {
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

const bookingDb=new PGlite()
const realNow=(await bookingDb.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0]!.now
const day=new Date(realNow);day.setUTCDate(day.getUTCDate()+14);while(day.getUTCDay()!==1)day.setUTCDate(day.getUTCDate()+1)
const bookingDate=day.toISOString().slice(0,10), targetDay=new Date(day);targetDay.setUTCDate(targetDay.getUTCDate()+7);const targetDate=targetDay.toISOString().slice(0,10)
try {
  const prismaSchema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8')
  for(const match of prismaSchema.matchAll(/enum (\w+) \{([\s\S]*?)\n\}/g)) {
    const values=match[2]!.split('\n').flatMap(line=>{const label=line.trim().match(/^([A-Z_]+)(?:\s|$)/)?.[1];return label?[line.match(/@map\("([^"]+)"\)/)?.[1]??label]:[]})
    await bookingDb.exec('CREATE TYPE "'+match[1]+'" AS ENUM ('+values.map(v=>"'"+v+"'").join(',')+')')
  }
  const models=['Business','Conversation','Customer','BotSession','BotChannelDeployment','BusinessBotConfiguration','BusinessBotOptionsSettings','ServiceCategory','Service','Professional','ProfessionalService','BusinessHours','ProfessionalHours','ScheduleBlock','Appointment','AppointmentServiceItem','BookingVisit','BookingDeposit','ServiceCombinationRule','BotOperation','BotTransitionLog','BotPrompt','BotPromptChoice','BotOutbox','BotActionInbox','BotProviderEvent','BotDispatchClaim','BotJob','AppointmentChangeHistory','BookingDepositProof']
  for(const name of models) {
    const body=prismaSchema.match(new RegExp('model '+name+' \\{([\\s\\S]*?)\\n\\}'))![1]!
    const columns=body.split('\n').flatMap(line=>{
      const field=line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
      if(!field||/\[\]/.test(line))return []
      const scalar=({String:'text',Int:'integer',Boolean:'boolean',DateTime:'timestamptz',Json:'jsonb',Decimal:'numeric',BigInt:'bigint',Float:'double precision'} as Record<string,string>)[field[2]!]
      const type=scalar??(prismaSchema.includes('enum '+field[2]+' {')?'"'+field[2]+'"':null)
      const column=line.match(/@map\("([^"]+)"\)/)?.[1]??field[1]
      return type?['"'+column+'" '+type+(field[1]===(name==='BusinessBotOptionsSettings'?'businessId':'id')?' PRIMARY KEY':'')+(line.match(/@default\((0|false)\)/)?.[1]?' DEFAULT '+line.match(/@default\((0|false)\)/)![1]:'')+(['createdAt','updatedAt'].includes(field[1]!)?' DEFAULT clock_timestamp()':'')]:[]
    })
    await bookingDb.exec('CREATE TABLE "'+name+'" ('+columns.join(',')+')')
  }
  await bookingDb.exec('CREATE UNIQUE INDEX booking_operation_key ON "BotOperation" ("operationKey"); CREATE UNIQUE INDEX booking_visit_unique ON "Appointment" ("visitId"); CREATE UNIQUE INDEX booking_outbox_key ON "BotOutbox" ("idempotencyKey")')
  await bookingDb.exec(`
    INSERT INTO "Business" (id,name,"botEnabled","publicAddress") VALUES ('biz','Salón ficticio',true,'Calle ficticia 123');
    INSERT INTO "Conversation" (id,"businessId",phone) VALUES ('conversation','biz','5491112345678');
    INSERT INTO "Customer" (id,"businessId",phone,"normalizedPhone",name) VALUES ('customer','biz','5491112345678','5491112345678','Ana');
    INSERT INTO "BotChannelDeployment" (id,"businessId",channel,generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES ('dep','biz','WHATSAPP',1,1,'cfg',1);
    INSERT INTO "BusinessBotConfiguration" (id,"businessId",status) VALUES ('cfg','biz','ACTIVE');
    INSERT INTO "BotSession" (id,"businessId","conversationId","deploymentId","deploymentGeneration",status,revision,"handoffFenceEpoch","businessTimezone",state) VALUES ('session','biz','conversation','dep',1,'ACTIVE',0,0,'UTC','{}');
    INSERT INTO "BusinessBotOptionsSettings" ("businessId",timezone,"bookingHorizonDays","bookingLeadTimeHours") VALUES ('biz','UTC',30,0);
    INSERT INTO "ServiceCategory" (id,"businessId","isActive") VALUES ('category','biz',true);
    INSERT INTO "Service" (id,"businessId","catalogCategoryId",name,duration,price,"priceMode","isBookable","isActive","attentionMode","requiresPhoto","validationEnabled","estimateAllowsBooking","depositMode") VALUES
    ('s1','biz','category','Corte',30,1000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE'),('s2','biz','category','Crema',30,2000,'FIXED',true,true,'DIRECT_BOOKING',false,false,false,'NONE');
    INSERT INTO "Professional" (id,"businessId",name,"isActive","acceptsBotBookings","botBookingPriority") VALUES ('p1','biz','Elisa',true,true,0);
    INSERT INTO "ProfessionalService" (id,"professionalId","serviceId") VALUES ('ps1','p1','s1'),('ps2','p1','s2');
    INSERT INTO "BusinessHours" (id,"businessId","dayOfWeek","startTime","endTime") VALUES ('bh','biz',1,'09:00','20:00');
    INSERT INTO "ProfessionalHours" (id,"professionalId","dayOfWeek","startTime","endTime") VALUES ('ph','p1',1,'09:00','20:00');
  `)
  await bookingDb.query('UPDATE "BusinessBotOptionsSettings" SET "cancellationLeadMinutes"=60,"rescheduleLeadMinutes"=60,"morningCutTime"=$1,"eveningCutTime"=$2', ['12:00','19:00'])
  const services=[{id:'s1',name:'Corte',durationMinutes:30,price:1000,requiresConsultation:false},{id:'s2',name:'Crema',durationMinutes:30,price:2000,requiresConsultation:false}]
  const segments=services.map((service,index)=>({serviceId:service.id,serviceName:service.name,professionalId:'p1',professionalName:'Elisa',startAt:bookingDate+'T10:'+String(index*30).padStart(2,'0')+':00.000Z',endAt:index?bookingDate+'T11:00:00.000Z':bookingDate+'T10:30:00.000Z',durationMinutes:30,customerDurationMinutes:30}))
  const bookingSlot={date:bookingDate,time:'10:00',startAt:segments[0]!.startAt,professionalId:'p1',professionalName:'Elisa',band:'MORNING' as const,occupiedMinutes:60,coordination:{key:coordinationKey('biz',segments),segments}}
  const bookingPort:DialoguePort={catalog:async()=>services,availability:async()=>{throw new Error('singular port not used')},availabilityBasket:async()=>({ok:true,services,durationMinutes:60,totalPrice:3000,professionals:[{id:'p1',name:'Elisa',priority:0}],slots:[bookingSlot]}),prepareRuntimeBooking:async(state,scope)=>{
    const raw=(await bookingDb.query<Record<string,unknown>>('SELECT * FROM "Service" ORDER BY id')).rows
    const terms:RuntimeBookingTerms={version:1,businessId:'biz',timezone:'UTC',date:state.date!,customerName:state.customerName!,preference:state.professional!,segments:segments.map((segment,index)=>({...segment,priceMinor:services[index]!.price,priceMode:'FIXED',configurationHash:runtimeServiceConfigurationHash(raw[index]!)})),totalPriceMinor:3000}
    return {slot:bookingSlot,presented:{scope,version:1,nonce:randomUUID(),fingerprint:runtimeBookingFingerprint(terms),conditionsPresented:true,terms}}
  }, managementRescheduleOffers: (snapshot,date) => prepareGroupRescheduleOffers(snapshot,date,async member=>[{date,startAt:member.startAt.replace(bookingDate,date),professionalId:member.professionalId,serviceIds:member.serviceIds,durationMinutes:member.durationMinutes,customerDurationMinutes:member.customerDurationMinutes??member.durationMinutes}])}
  const fault={secondChild:false,managementSecond:false}, live=runtimeFixture({bookingDb,bookingPort,bookingFault:fault,phone:'5491112345678',now:realNow})
  const seed=async()=>{
    const id=live.row.id,event=live.row.providerEventId,job='job-'+id.replace('inbox-','').replace('inbox','0')
    await bookingDb.query(`INSERT INTO "BotActionInbox" (id,"businessId","providerEventId",status) VALUES ($1,'biz',$2,'ADMITTED')`,[id,event])
    await bookingDb.query(`INSERT INTO "BotProviderEvent" (id,"businessId",status) VALUES ($1,'biz','ADMITTED')`,[event])
    await bookingDb.query(`INSERT INTO "BotDispatchClaim" (id,"claimToken",status) VALUES ($1,'dispatch-token','CLAIMED')`,[id])
    await bookingDb.query(`INSERT INTO "BotJob" (id,status,"leaseToken") VALUES ($1,'LEASED','job-token')`,[job])
  }
  const turn=async(body:string)=>{live.next(body);await seed();return live.run()}
  await seed();await live.run()
  // Controlled public server draft fixture, NOT an old bot response/history bootstrap.
  // Confirmation below goes through the production caller and real F7 SQL children.
  const ready={...initialDialogueState('biz'),customerName:'Ana',date:bookingDate,professional:{kind:'specific' as const,id:'p1'},pending:'proposal' as const,slot:bookingSlot,basket:{version:1 as const,nextMemberId:3,members:services.map((service,index)=>({memberId:'m'+(index+1),mode:'single' as const,serviceIds:[service.id],evidence:service.name}))}}
  live.session.state=projectConversationDraft(ready,policy)
  await bookingDb.query(`UPDATE "BotSession" SET state=$1::jsonb,revision=$2 WHERE id='session'`,[JSON.stringify(live.session.state),String(live.session.revision)])
  await turn('Quiero reservar ambos servicios.')
  await turn('Confirmo el turno.')
  assert.equal((live.session.state as {booking:string}).booking,'CONFIRMED')
  const origin=structuredClone(readConversationDraft(live.session.state,policy,'UTC').bookingReservation!)
  assert.equal(origin.receipt!.appointments.length,2)
  assert.equal((await bookingDb.query<{n:number}>('SELECT count(*)::int n FROM "AppointmentServiceItem"')).rows[0]!.n,2, 'both F7 child service items must be physically persisted before F9')
  // Ordinary verification of an already-supported archive path, not a new RED claim.
  const durableBeforeArchive=(await bookingDb.query('SELECT state FROM "BotSession" WHERE id=$1',['session'])).rows[0]!.state
  await assert.rejects(bookingDb.transaction(async raw=>{
    const tx={
      professional:{findMany:async({where}:{where:{businessId:string;id:{in:string[]}}})=>(await raw.query('SELECT id FROM "Professional" WHERE "businessId"=$1 AND id=ANY($2::text[])',[where.businessId,where.id.in])).rows},
      $queryRaw:async(q:Query)=>(await raw.query(q.text,q.values.map(value=>value instanceof Date?value.toISOString():value))).rows,
      $executeRaw:async(q:Query)=>(await raw.query(q.text,q.values.map(value=>value instanceof Date?value.toISOString():value))).affectedRows??0
    }
    const ownedScope={businessId:'biz',sessionId:'session',canonicalPhone:'5491112345678',expectedRevision:live.session.revision}
    const currentSnapshot=await loadOwnConfirmedRuntimeGroupSnapshot(tx as never,ownedScope)
    const archived=continueCompletedBooking(readConversationDraft(live.session.state,policy,'UTC'))
    assert.equal(archived.bookingReservation,undefined)
    assert.deepEqual(archived.completedBooking,origin,'archive keeps the original tenant, identifiers, fingerprint and nonce')
    await raw.query('UPDATE "BotSession" SET state=$1::jsonb WHERE id=$2',[JSON.stringify(projectConversationDraft(archived,policy)),'session'])
    const archivedSnapshot=await loadOwnConfirmedRuntimeGroupSnapshot(tx as never,ownedScope)
    assert.deepEqual(archivedSnapshot.scope,currentSnapshot.scope)
    assert.deepEqual(archivedSnapshot.members,currentSnapshot.members)
    assert.equal(archivedSnapshot.groupId,currentSnapshot.groupId)
    await assert.rejects(()=>loadOwnConfirmedRuntimeGroupSnapshot(tx as never,{...ownedScope,businessId:'foreign'}),/ownership unavailable/)
    const shownScope={...origin.presented.scope,revision:String(live.session.revision)}
    const managedContext:DialogueContext={businessId:'biz',timezone:'UTC',dbNow:realNow,serverRuntimeBookingScope:shownScope,serverManagementSnapshot:archivedSnapshot}
    const proposal=await respond(managedContext,archived,'Quiero cancelar mi turno confirmado.',bookingPort,{serviceId:null,candidateIds:[],correction:false,
      turnPlan:{version:1,operations:[{kind:'unsupported_action',action:'CANCEL',evidence:'Quiero cancelar mi turno confirmado.',confidence:1}]}})
    assert.equal(proposal.managementCommand,undefined,'archive customer route cannot auto-cancel')
    assert.equal(proposal.confirmedCancellationHandoff?.snapshot.groupId,archivedSnapshot.groupId)
    assert.deepEqual(proposal.state.completedBooking,origin)
    // Legacy domain cancellation remains independently guarded, but is no longer the customer route.
    const internalProposal=presentGroupCancellation(archivedSnapshot)
    const internalCommand=confirmGroupCancellation(internalProposal,{nonce:internalProposal.nonce,fingerprint:internalProposal.fingerprint})
    assert.notEqual(internalCommand.nonce,origin.presented.nonce,'old booking nonce cannot authorize cancellation')
    const cancelled=await cancelGroupInTransaction(tx as never,internalCommand)
    assert.equal(cancelled.appointmentIds.length,2)
    assert.ok((await raw.query<{status:string}>('SELECT status FROM "Appointment"')).rows.every(member=>member.status==='CANCELLED'))
    throw Error('rollback archived management verification')
  }),/rollback archived management verification/)
  assert.deepEqual((await bookingDb.query('SELECT state FROM "BotSession" WHERE id=$1',['session'])).rows[0]!.state,durableBeforeArchive)
  assert.ok((await bookingDb.query<{status:string}>('SELECT status FROM "Appointment"')).rows.every(member=>member.status==='CONFIRMED'))
  console.log('archived receipt SQL loader, team routing and independent domain cancellation rollback: PASS')
  managementSecondId=origin.receipt!.appointments[1]!.appointmentId
  // Existing Prisma port, actual catalog/availability SQL in the same in-memory database.
  // Only the Prisma delegate surface is adapted; no availability results or offers are fabricated.
  const availabilityClient = {
    $queryRaw: async (query: Query) => (await bookingDb.query(query.text, query.values.map(value => value instanceof Date ? value.toISOString() : value))).rows,
    business: { findFirst: async () => (await bookingDb.query('SELECT * FROM "Business" WHERE id=$1', ['biz'])).rows[0] },
    serviceCategory: { findMany: async () => (await bookingDb.query('SELECT * FROM "ServiceCategory" WHERE "businessId"=$1 AND "isActive"=true', ['biz'])).rows },
    service: {
      findFirst: async ({ where }: { where: { businessId: string; id?: string } }) => where.id ? (await bookingDb.query('SELECT * FROM "Service" WHERE id=$1 AND "businessId"=$2 AND "isActive"=true AND "isBookable"=true', [where.id, where.businessId])).rows[0] ?? null : null,
      findMany: async ({ where }: { where: { businessId: string; parentServiceId?: unknown } }) => where.parentServiceId !== null ? [] : (await bookingDb.query('SELECT * FROM "Service" WHERE "businessId"=$1 AND "isActive"=true AND "isBookable"=true AND "parentServiceId" IS NULL', [where.businessId])).rows
    }
  }
  const actualAvailability = await createPrismaDialoguePort(availabilityClient as never, 'biz')
  bookingPort.managementRescheduleOffers = actualAvailability.port.managementRescheduleOffers!
  await turn('Quiero reprogramar mi turno.')
  assert.equal(readConversationDraft(live.session.state,policy,'UTC').appointmentManagement?.context.action,'RESCHEDULE')
  await turn('Para el '+targetDate+' a las 10:00.')
  const offered=readConversationDraft(live.session.state,policy,'UTC').appointmentManagement!
  assert.equal(offered.context.proposal?.kind,'GROUP_RESCHEDULE_PROPOSAL')
  assert.match(live.replies.at(-1)!,/Corte/);assert.match(live.replies.at(-1)!,/Crema/)
  assert.equal(offered.context.proposal!.snapshot.members.length, 2)
  assert.equal(offered.context.offers!.every(offer => offer.moves.length === 2), true, 'real Prisma availability must cover every current assignment')
  const snapshotAll=async()=>({appointments:(await bookingDb.query('SELECT * FROM "Appointment" ORDER BY id')).rows,visits:(await bookingDb.query('SELECT * FROM "BookingVisit" ORDER BY id')).rows,operations:(await bookingDb.query('SELECT * FROM "BotOperation" ORDER BY id')).rows,history:(await bookingDb.query('SELECT * FROM "AppointmentChangeHistory" ORDER BY id')).rows,session:(await bookingDb.query('SELECT * FROM "BotSession" ORDER BY id')).rows,outbox:(await bookingDb.query('SELECT * FROM "BotOutbox" ORDER BY id')).rows})
  const beforeMove=await snapshotAll(),stateBefore=structuredClone(live.session.state)
  live.next('Confirmo la reprogramación.');await seed();fault.managementSecond=true
  await assert.rejects(()=>live.run(),/second management child/)
  assert.deepEqual(await snapshotAll(),beforeMove);assert.deepEqual(live.session.state,stateBefore)
  fault.managementSecond=false;live.failCommit()
  await assert.rejects(()=>live.run(),/COMMIT failed/)
  assert.deepEqual(await snapshotAll(),beforeMove);assert.deepEqual(live.session.state,stateBefore)
  live.allowCommit();await live.run()
  const currentBooking = readConversationDraft(live.session.state,policy,'UTC').bookingReservation!
  const { currentSchedule, ...sealedReceipt } = currentBooking.receipt!
  assert.deepEqual({ presented: currentBooking.presented, receipt: sealedReceipt }, origin, 'sealed original booking authority is unchanged')
  assert.deepEqual(currentSchedule, origin.receipt!.appointments.map(entry => ({ appointmentId: entry.appointmentId,
    startAt: origin.presented.terms.segments[entry.segmentIndex]!.startAt,
    professionalId: origin.presented.terms.segments[entry.segmentIndex]!.professionalId,
    professionalName: origin.presented.terms.segments[entry.segmentIndex]!.professionalName })), 'current names and assignments come from the verified pre-write snapshot')
  const moved=(await bookingDb.query<{startAt:Date}>('SELECT "startAt" FROM "Appointment" ORDER BY "startAt"')).rows
  assert.ok(moved.every(member=>member.startAt.toISOString().startsWith(targetDate)))
  assert.equal(readConversationDraft(live.session.state,policy,'UTC').appointmentManagement?.outcome?.kind,'RESCHEDULED')
  assert.match(live.replies.at(-1)!,/reprogramad/i)
  assert.ok(!live.replies.at(-1)!.includes(bookingDate), 'no original time summary after rescheduling')
  await bookingDb.query('UPDATE "Customer" SET "normalizedPhone"=NULL WHERE id=$1',['customer'])
  await turn('¿Cómo quedó mi turno?')
  assert.ok(!live.replies.at(-1)!.includes(bookingDate), 'failed management loader must never restate the original booking date after rescheduling')
  assert.match(live.replies.at(-1)!,/verificar|revisi|equipo/i)
  await bookingDb.query('UPDATE "Customer" SET "normalizedPhone"=$1 WHERE id=$2',['5491112345678','customer'])
  await turn('Quiero cancelar mi turno confirmado.')
  assert.equal(readConversationDraft(live.session.state,policy,'UTC').appointmentManagement,undefined,'customer request must not create cancellation proposal')
  assert.equal((live.session.state as {handoff:string}).handoff,'QUEUED')
  assert.equal((live.session.state as {booking:string}).booking,'CONFIRMED')
  assert.match(live.replies.at(-1)!,/sigue vigente/i)
  assert.ok(live.statements.some(query=>query.sql.includes('INSERT INTO "BotHandoff"') &&
    query.values.includes('confirmed_booking_cancellation_request')), 'caller must invoke handoff queue effect')
  assert.ok((await bookingDb.query<{status:string}>('SELECT status FROM "Appointment"')).rows.every(member=>member.status==='CONFIRMED'))
  assert.ok((await bookingDb.query<{status:string}>('SELECT status FROM "BookingVisit"')).rows.every(member=>member.status==='CONFIRMED'))
  const handoffBooking = readConversationDraft(live.session.state,policy,'UTC').bookingReservation!
  const { currentSchedule: handoffSchedule, ...handoffSealedReceipt } = handoffBooking.receipt!
  assert.deepEqual({ presented: handoffBooking.presented, receipt: handoffSealedReceipt }, origin, 'staff referral preserves sealed original booking authority')
  assert.ok(handoffSchedule?.every(entry => entry.startAt.startsWith(targetDate)), 'staff referral carries the verified reprogrammed date')
  const beforeRepeat=await snapshotAll()
  await turn('Confirmo la cancelación.')
  assert.deepEqual(await snapshotAll(),beforeRepeat,'queued handoff cannot become an automatic cancellation')
  assert.equal(parseBotOptionsState(live.session.state).ok,true)
  console.log('runtime management caller F7→ALL F9 reschedule; cancellation invokes queued effect without changing visits (handoff adapter controlled): PASS')
} finally {await bookingDb.close();console.info=runtimeInfo}
