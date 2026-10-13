import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { selectConsolidationGroupTx, supersedeConsolidationOutboxTx, guardConsolidatedOutboxTx,
  lockConversationInputTx, canonicalConversationPhone, type ConsolidationEnvelope } from '../src/conversational-bot/inbound-consolidation.js'

const db = new PGlite()
const base = { conversationDraft: { value: 'original' } }
const session = { businessId: 'biz', sessionId: 'session', revision: 1n, deploymentId: 'dep',
  generation: 2, handoffFenceEpoch: 3, state: base }
const queries: Prisma.Sql[] = []
const transaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => db.transaction(async pg => run({
  async $queryRaw(q: Prisma.Sql) { queries.push(q); return (await pg.query(q.text, q.values)).rows },
  async $executeRaw(q: Prisma.Sql) { queries.push(q); return (await pg.query(q.text, q.values)).affectedRows ?? 0 }
} as never))
async function add(id: string, text: string, extra: { status?: string; type?: string; admittedAt?: string; business?: string; inbox?: boolean; reply?: string } = {}) {
  const business = extra.business ?? 'biz'
  await db.query(`INSERT INTO "BotProviderEvent" ("id","businessId","eventType","payload","admittedAt","status") VALUES ($1,$2,'MESSAGE',$3::jsonb,$4::timestamptz,$5)`,
    [id,business,JSON.stringify({fromPhone:'5491100000000',textBody:text,messageType:extra.type??'text',interactiveReplyId:extra.reply??null}),
      extra.admittedAt??'2026-09-30T10:00:00Z', extra.status??'ADMITTED'])
  if (extra.inbox !== false) await db.query(`INSERT INTO "BotActionInbox" VALUES ($1,$2,$3,$4,'dep',2,'input.initial','ADMITTED')`, ['inbox-'+id,business,id,'session'])
}
async function group(current = 'a', revision = 1n) {
  return transaction(tx => selectConsolidationGroupTx(tx, { ...session, revision, phone: '+5491100000000', currentEventId: current, isRestart: value => value === '/restart' }))
}
async function save(envelope: ConsolidationEnvelope, revision = 1n, statuses = ['PENDING']) {
  await db.query(`INSERT INTO "BotTransitionLog" VALUES ($1,'biz','session','dep',2,$2,'conversation.message',$3::jsonb)`,
    ['transition:session:'+revision,revision,JSON.stringify({ consolidation: envelope })])
  for (let n=0;n<statuses.length;n++) await db.query(`INSERT INTO "BotOutbox" VALUES ($1,'biz','session',$2,$3,$4,'',NULL,NULL)`,
    ['out-'+revision+'-'+n,'transition:session:'+revision,statuses[n],JSON.stringify({to:'5491100000000',consolidation:envelope})])
}
try {
  await db.exec(`
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','CLAIMED','SELECTED','CONFLICT','PROCESSED','STALE','FAILED');
    CREATE TYPE "BotProviderEventStatus" AS ENUM ('ADMITTED','PROCESSED','REJECTED');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','CLAIMED','RETRY','SKIPPED','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ');
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY,"businessId" text,"eventType" text,"payload" jsonb,"admittedAt" timestamptz,"status" "BotProviderEventStatus", "phoneNumberId" text DEFAULT 'channel', "providerMessageId" text);
    CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY,"businessId" text,"providerEventId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" int,"actionType" text,"status" "BotInboxStatus");
    CREATE TABLE "BotTransitionLog" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"deploymentId" text,"deploymentGeneration" int,"revisionTo" bigint,"actionType" text,"detail" jsonb);
    CREATE TABLE "BotOutbox" ("id" text PRIMARY KEY,"businessId" text,"sessionId" text,"transitionId" text,"status" "BotOutboxStatus","payload" jsonb,"errorCode" text,"leaseToken" text,"leasedUntil" timestamptz);
    ALTER TABLE "BotActionInbox" ADD "claimToken" text, ADD "claimedUntil" timestamptz, ADD "operationKey" text, ADD "error" text;
    ALTER TABLE "BotTransitionLog" ADD "providerEventId" text;
    CREATE TABLE "BotJob" ("id" text,"kind" text,"aggregateId" text,"businessId" text,"deploymentId" text,"deploymentGeneration" int,"status" text,"attempts" int,"maxAttempts" int,"leaseToken" text,"leasedUntil" timestamptz);
    CREATE TABLE "BotSession" ("id" text,"businessId" text,"conversationId" text);
    CREATE TABLE "Conversation" ("id" text,"businessId" text,"phone" text);
    CREATE TABLE "BotOperation" ("businessId" text,"sessionId" text,"status" text);
    CREATE TABLE "BotDispatchClaim" ("businessId" text,"sessionId" text,"resourceId" text,"claimToken" text,"status" text,"claimedUntil" timestamptz);
  `)
  assert.equal(canonicalConversationPhone('+54 9 11 0000-0000'), '5491100000000')
  await transaction(tx => lockConversationInputTx(tx, 'biz', '+5491100000000'))
  assert.equal(queries.at(-2)!.values[0], 'bot-cutover:biz:WHATSAPP')
  assert.match(String(queries.at(-1)!.values[0]), /^bot-conversation-input:/)
  assert.ok(!String(queries.at(-1)!.values[0]).includes('549110'))
  for (const [id,text] of [['a','quiero'],['b','corte'],['c','hoy'],['d','no, mañana'],['e','con Ana']]) await add(id!,text!)
  await add('foreign','private tenant', {business:'foreign'})
  await db.exec(`UPDATE "BotProviderEvent" SET "providerMessageId"='msg-' || "id";`)
  const first = await group()
  assert.ok(first)
  assert.equal(first!.text, 'quiero corte hoy no, mañana con Ana')
  assert.deepEqual(first!.envelope.eventIds, ['a','b','c','d','e'])
  assert.deepEqual((first as unknown as { receipts: unknown[] }).receipts, ['a','b','c','d','e'].map(id => ({ businessId: 'biz', providerPhoneNumberId: 'channel', providerMessageId: 'msg-' + id })), 'all grouped provider identities must remain tenant scoped and ephemeral')
  assert.deepEqual(first!.envelope.baseState, base)

  // Before/during compute: membership changes invalidate the old computation.
  await add('late','a las tres',{inbox:false,admittedAt:'2026-09-30T09:59:00Z'})
  const changed = await group()
  assert.ok(changed!.envelope.eventIds.includes('late'), 'late commit with older admission timestamp is not lost')
  assert.notEqual(changed!.signature, first!.signature)
  // Repeated snapshot is deterministic and no history-only PROCESSED event joins.
  await add('historical','not included',{status:'PROCESSED',inbox:false})
  assert.deepEqual((await group())!.envelope.eventIds, changed!.envelope.eventIds)

  // Restore an original group after process restart, not from the derived state.
  await save(changed!.envelope)
  await db.exec(`UPDATE "BotProviderEvent" SET "status"='PROCESSED'; UPDATE "BotActionInbox" SET "status"='PROCESSED';`)
  await add('new','preferiría a las cuatro',{admittedAt:'2026-09-30T10:01:00Z'})
  const restarted = await group('new')
  assert.deepEqual(restarted!.envelope.baseState, base)
  assert.ok(restarted!.envelope.eventIds.includes('late'))
  assert.ok(restarted!.envelope.eventIds.includes('new'))
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED', "leaseToken"='token';`)
  const item = { id:'out-1-0',businessId:'biz',sessionId:'session',payload:{to:'5491100000000',consolidation:changed!.envelope},claimToken:'token' }
  assert.equal(await transaction(tx => guardConsolidatedOutboxTx(tx,item)), 'superseded')
  assert.equal((await db.query<{status:string}>(`SELECT "status" FROM "BotOutbox"`)).rows[0]!.status, 'SKIPPED')
  assert.deepEqual((await group('new'))!.envelope.baseState, base)

  // SENDING/UNKNOWN/accepted pieces close the old group: no rewind/cancel/replay.
  for (const status of ['SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ']) {
    await db.query(`UPDATE "BotOutbox" SET "status"=$1::"BotOutboxStatus"`,[status])
    const afterSending = await group('new')
    assert.deepEqual(afterSending!.envelope.eventIds,['new'])
    assert.equal(afterSending!.previousTransitionId,null)
    assert.equal(await transaction(tx=>supersedeConsolidationOutboxTx(tx,'biz','session','transition:session:1')),false)
    assert.equal((await db.query<{status:string}>(`SELECT "status" FROM "BotOutbox"`)).rows[0]!.status,status)
  }
  await db.exec(`UPDATE "BotOutbox" SET "status"='PENDING';`)
  // Generation/fence/revision mismatches do not reuse an obsolete base.
  assert.equal(await transaction(tx=>selectConsolidationGroupTx(tx,{...session,generation:3,phone:'5491100000000',currentEventId:'new',isRestart:()=>false})),null,'an actionable old-generation inbox is a barrier, not replayable input')
  assert.equal((await group('new',2n))!.previousTransitionId,null)
  assert.equal((await transaction(tx=>selectConsolidationGroupTx(tx,{...session,handoffFenceEpoch:4,phone:'5491100000000',currentEventId:'new',isRestart:()=>false})))!.previousTransitionId,null)

  // Reset/media/interactive action are hard barriers, never concatenated or replayed.
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  await add('a','hola')
  await add('b','/restart')
  await add('c','más texto')
  assert.deepEqual((await group('a'))!.envelope.eventIds,['a'])
  assert.equal(await group('b'),null)
  assert.equal(await group('c'),null,'cannot bypass an earlier actionable barrier')
  for (const barrier of [{type:'image'}, {type:'interactive',reply:'confirm'}]) {
    await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox";`)
    await add('a','hola'); await add('b','barrier',barrier); await add('c','later')
    assert.deepEqual((await group('a'))!.envelope.eventIds,['a'])
  }

  // Exact-count locking is all-or-none; rollback restores superseded pending rows.
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  await add('a','hola'); const single=(await group())!
  await save(single.envelope,1n,['PENDING','CLAIMED'])
  await assert.rejects(transaction(async tx=>{assert.equal(await supersedeConsolidationOutboxTx(tx,'biz','session','transition:session:1'),true);throw new Error('rollback')}),/rollback/)
  assert.deepEqual((await db.query<{status:string}>(`SELECT "status" FROM "BotOutbox" ORDER BY "id"`)).rows.map(row=>row.status),['PENDING','CLAIMED'])
  const before=queries.length
  let call=0
  assert.equal(await supersedeConsolidationOutboxTx({async $queryRaw(){return ++call===1?[{id:'x',status:'PENDING'},{id:'y',status:'PENDING'}]:[{id:'x',status:'PENDING'}]},async $executeRaw(){throw new Error('partial lock must not write')}} as never,'biz','session','transition:session:1'),false)
  assert.ok(queries.slice(before).length===0)
  // Once any piece is irreversible, remaining pieces complete that frozen delivery group.
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  await add('a','first'); const chunks=(await group())!; await save(chunks.envelope,1n,['ACCEPTED','CLAIMED'])
  await db.exec(`UPDATE "BotProviderEvent" SET "status"='PROCESSED'; UPDATE "BotActionInbox" SET "status"='PROCESSED';
    UPDATE "BotOutbox" SET "leaseToken"='token' WHERE "id"='out-1-1';`)
  await add('b','new independent turn')
  assert.equal(await transaction(tx=>guardConsolidatedOutboxTx(tx,{...item,id:'out-1-1',payload:{to:'5491100000000',consolidation:chunks.envelope}})),'ready',
    'accepted first chunk freezes the group, not endless defer of its remaining piece')
  // Capacity creates a sealed group and a durable remainder, not truncation or endless supersession.
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  for (let n=0;n<129;n++) await add('part-'+String(n).padStart(3,'0'),'x')
  const capped=(await group('part-000'))!
  assert.equal(capped.envelope.eventIds.length,128); assert.equal(capped.envelope.sealed,true)
  assert.equal(capped.text.split(' ').length,128)
  await save(capped.envelope)
  await db.query(`UPDATE "BotProviderEvent" SET "status"='PROCESSED' WHERE "id"<>$1`,['part-128'])
  await db.query(`UPDATE "BotActionInbox" SET "status"='PROCESSED' WHERE "providerEventId"<>$1`,['part-128'])
  const remainder=(await group('part-128',2n))!
  assert.deepEqual(remainder.envelope.eventIds,['part-128']); assert.equal(remainder.text,'x')
  await save(remainder.envelope,2n)
  await db.query(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='token' WHERE "id"='out-2-0'`)
  const remainderItem={...item,id:'out-2-0',payload:{to:'5491100000000',consolidation:remainder.envelope}}
  assert.equal(await transaction(tx=>guardConsolidatedOutboxTx(tx,remainderItem)),'defer','later bounded turn cannot overtake older pending turn')
  await db.query(`UPDATE "BotOutbox" SET "status"='ACCEPTED' WHERE "id"='out-1-0'`)
  assert.equal(await transaction(tx=>guardConsolidatedOutboxTx(tx,remainderItem)),'ready')
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  await add('a','x'.repeat(1900)); const large=(await group())!
  await save(large.envelope)
  await db.exec(`UPDATE "BotProviderEvent" SET "status"='PROCESSED'; UPDATE "BotActionInbox" SET "status"='PROCESSED';
    UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='token';`)
  await add('b','y'.repeat(101))
  assert.equal(await group('b'),null,'whole remainder waits for the full old group to close')
  assert.equal(await transaction(tx=>guardConsolidatedOutboxTx(tx,{...item,payload:{to:'5491100000000',consolidation:large.envelope}})),'ready','an impossible combined group cannot supersede forever')
  await db.exec(`UPDATE "BotOutbox" SET "status"='ACCEPTED';`)
  assert.equal((await group('b'))!.text,'y'.repeat(101))
  // R3-1: earlier-timestamp arrivals cannot evict only part of an existing bounded group.
  const overflowOutcomes: Array<{ bound: string; guard: string; status: string }> = []
  for (const bound of ['text', 'events'] as const) {
    await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
    if (bound === 'text') await add('old', 'x'.repeat(1900))
    else for (let n = 0; n < 128; n++) await add('old-'+String(n).padStart(3,'0'), 'x')
    const currentId = bound === 'text' ? 'old' : 'old-000'
    const existing = (await group(currentId))!
    assert.equal(existing.envelope.sealed, false, 'group was unsealed before the late commit')
    await save(existing.envelope)
    await db.exec(`UPDATE "BotProviderEvent" SET "status"='PROCESSED'; UPDATE "BotActionInbox" SET "status"='PROCESSED';
      UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='token';`)
    const lateText = bound === 'text' ? 'y'.repeat(101) : 'late'
    await add('earlier-commit', lateText, { inbox: false, admittedAt: '2026-09-30T09:59:00Z' })
    assert.equal(await group('earlier-commit'), null, 'replacement cannot cover every previous event within the bound')
    const guard = await transaction(tx => guardConsolidatedOutboxTx(tx, {
      ...item, payload: { to: '5491100000000', consolidation: existing.envelope }
    }))
    const status = (await db.query<{ status: string }>(`SELECT "status" FROM "BotOutbox"`)).rows[0]!.status
    overflowOutcomes.push({ bound, guard, status })
    // Acceptance closes the original group; the untouched journal event then uses derived state.
    await db.exec(`UPDATE "BotOutbox" SET "status"='ACCEPTED';`)
    const derivedState = { conversationDraft: { value: 'derived-after-old-group' } }
    const next = await transaction(tx => selectConsolidationGroupTx(tx, { ...session, revision: 2n,
      state: derivedState, phone: '5491100000000', currentEventId: 'earlier-commit', isRestart: () => false }))
    assert.deepEqual(next!.envelope.eventIds, ['earlier-commit'])
    assert.deepEqual(next!.envelope.baseState, derivedState)
    assert.equal(next!.text, lateText, 'the remainder is neither truncated nor replayed with old text')
    assert.equal(next!.previousTransitionId, null)
  }
  assert.deepEqual(overflowOutcomes, [
    { bound: 'text', guard: 'ready', status: 'CLAIMED' },
    { bound: 'events', guard: 'ready', status: 'CLAIMED' }
  ], 'both overflow bounds preserve a deliverable original group until acceptance')
  // A stale token never supersedes a newly owned group, even with newer journal input.
  await db.exec(`TRUNCATE "BotProviderEvent","BotActionInbox","BotTransitionLog","BotOutbox";`)
  await add('a','hola'); const owned=(await group())!; await save(owned.envelope)
  await db.exec(`UPDATE "BotOutbox" SET "status"='CLAIMED',"leaseToken"='other';`); await add('b','mañana')
  assert.equal(await transaction(tx=>guardConsolidatedOutboxTx(tx,{...item,payload:{to:'5491100000000',consolidation:owned.envelope}})),'defer')
  assert.equal((await db.query<{status:string}>(`SELECT "status" FROM "BotOutbox"`)).rows[0]!.status,'CLAIMED')
  console.log('PASS consolidation SQL: five fragments, fresh coverage, restart base, barriers, irreversible groups, exact locks and rollback.')
} finally {await db.close()}
