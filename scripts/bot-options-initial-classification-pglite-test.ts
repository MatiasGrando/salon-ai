import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import type { Prisma } from '../src/generated/prisma/client.js'
import { PrismaAuthoritativeAdmissionRepository, upsertJob } from '../src/bot-options/infrastructure/prisma-admission.js'
import { createQueueMilestoneTracker, jobQueueKey, observeQueueProducerTransaction, type QueueMilestoneDiagnostic } from '../src/bot-options/observability/queue-milestones.js'

// Production classifier SQL on an ephemeral in-memory PostgreSQL engine; no fake query results.
const db = new PGlite()
const classifier = new PrismaAuthoritativeAdmissionRepository({} as never)
const route = (businessId: string) => ({ kind: 'new' as const, businessId, deploymentId: `deployment-${businessId}`, generation: 3,
  appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null })
const event = (id: string) => ({ kind: 'message' as const, eventKey: id, providerMessageId: `wamid.${id}`,
  phoneNumberId: 'synthetic-phone-id', displayPhoneNumber: null, fromPhone: 'synthetic-phone', textBody: 'synthetic text',
  messageType: 'text' as const, interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null })
try {
  await db.exec(`
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED','PROCESSED');
    CREATE TYPE "BotJobStatus" AS ENUM ('READY','RETRY','LEASED','DONE','POISON');
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN');
    CREATE TYPE "BotHandoffStatus" AS ENUM ('QUEUED','TAKEN');
    CREATE TABLE "Business" (id text PRIMARY KEY, "customerCode" text);
    CREATE TABLE "BusinessBotConfiguration" (id text PRIMARY KEY, "businessId" text, status text, definition jsonb);
    CREATE TABLE "BotChannelDeployment" (id text PRIMARY KEY, "businessId" text, channel "BotChannel", generation integer,
      "engineKey" text, "activeConfigurationId" text, "claimsPausedAt" timestamptz, UNIQUE ("businessId",id));
    CREATE TABLE "Conversation" (id text PRIMARY KEY, "businessId" text, phone text);
    CREATE TABLE "BotSession" (id text PRIMARY KEY, "businessId" text, "conversationId" text, "deploymentId" text,
      "deploymentGeneration" integer, status "BotSessionStatus", state jsonb, revision bigint);
    CREATE TABLE "BotHandoff" (id text PRIMARY KEY, "businessId" text, "sessionId" text, status "BotHandoffStatus");
    CREATE TABLE "BotProviderEvent" (id text PRIMARY KEY, "businessId" text NOT NULL, UNIQUE ("businessId",id));
    CREATE TABLE "BotActionInbox" (id text PRIMARY KEY, "businessId" text NOT NULL, "providerEventId" text NOT NULL,
      "providerMessageId" text, "actionType" text, "deploymentId" text, "deploymentGeneration" integer, payload jsonb, status "BotInboxStatus",
      UNIQUE ("businessId","providerEventId"), FOREIGN KEY ("businessId","providerEventId") REFERENCES "BotProviderEvent"("businessId",id),
      FOREIGN KEY ("businessId","deploymentId") REFERENCES "BotChannelDeployment"("businessId",id));
    CREATE TABLE "BotJob" (id text PRIMARY KEY, kind text, "aggregateId" text, "businessId" text, "deploymentId" text,
      "deploymentGeneration" integer, "expectedRevision" bigint, "availableAt" timestamptz, status "BotJobStatus", "updatedAt" timestamptz,
      "leaseToken" text, "leasedUntil" timestamptz, UNIQUE (kind,"aggregateId"),
      FOREIGN KEY ("businessId","deploymentId") REFERENCES "BotChannelDeployment"("businessId",id));
    CREATE TABLE "Fixture" ("failJob" boolean DEFAULT false, "failCommit" boolean DEFAULT false);
    INSERT INTO "Fixture" DEFAULT VALUES;
    CREATE TABLE "Audit" (seq serial, operation text, aggregate text);
    CREATE FUNCTION audit_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO "Audit"(operation,aggregate) VALUES ('inbox',NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER inbox_audit AFTER INSERT ON "BotActionInbox" FOR EACH ROW EXECUTE FUNCTION audit_inbox();
    CREATE FUNCTION audit_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (SELECT "failJob" FROM "Fixture") THEN RAISE EXCEPTION 'injected job failure'; END IF;
      INSERT INTO "Audit"(operation,aggregate) VALUES ('job',NEW."aggregateId"); RETURN NEW; END $$;
    CREATE TRIGGER job_audit AFTER INSERT OR UPDATE ON "BotJob" FOR EACH ROW EXECUTE FUNCTION audit_job();
    CREATE FUNCTION reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (SELECT "failCommit" FROM "Fixture") THEN RAISE EXCEPTION 'injected commit failure'; END IF; RETURN NEW; END $$;
    CREATE CONSTRAINT TRIGGER job_commit AFTER INSERT OR UPDATE ON "BotJob" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_commit();
    INSERT INTO "Business" VALUES ('tenant-a','WX-38N6UG'),('tenant-b','WX-38N6UG');
    INSERT INTO "BusinessBotConfiguration" SELECT 'config-'||id,id,'ACTIVE',
      '{"conversation":{"schemaVersion":1,"engine":"conversational-booking-v1"}}'::jsonb FROM "Business";
    INSERT INTO "BotChannelDeployment" SELECT 'deployment-'||id,id,'WHATSAPP',3,'deterministic-options','config-'||id,NULL FROM "Business";
  `)
  const counts: number[] = []
  async function classify(id: string, options: { tenant?: string; eventTenant?: string; rollback?: boolean; beforeCommitClaim?: boolean; jobStatus?: string } = {}) {
    const tenant = options.tenant ?? 'tenant-a'
    await db.query('INSERT INTO "BotProviderEvent" VALUES ($1,$2) ON CONFLICT DO NOTHING', [id,options.eventTenant ?? tenant])
    const diagnostics: QueueMilestoneDiagnostic[] = []
    const tracker = createQueueMilestoneTracker({ businessId: tenant, emit: value => { diagnostics.push(value) } })
    let writes = 0, inboxId = ''
    const consume = () => {
      const claim = tracker.beginClaim()
      tracker.claimEnded(claim, jobQueueKey({ businessId: tenant, kind: 'PROCESS_INBOX', aggregateId: inboxId }), 1)
      tracker.handlerStarted(claim)
      return diagnostics.at(-1)!.readiness
    }
    const operation = observeQueueProducerTransaction(tracker, body => db.transaction(async pg => {
      const execute = async (q: Prisma.Sql) => {
        // Seed a real conflicting job for the newly generated inbox ID before production SQL.
        // No result is mocked: both conflict resolution and row counts come from PostgreSQL.
        if (options.jobStatus && q.text.includes('INSERT INTO "BotActionInbox"')) {
          await pg.query(`INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration",
            "expectedRevision","availableAt",status,"updatedAt","leaseToken","leasedUntil")
            VALUES ($1,'PROCESS_INBOX',$1,$2,$3,1,7,'2020-01-01',$4,clock_timestamp(),'old-lease','2099-01-01')`,
          [q.values[0],tenant,route(tenant).deploymentId,options.jobStatus])
        }
        if (q.text.includes('INSERT INTO "BotActionInbox"') || q.text.includes('INSERT INTO "BotJob"')) writes++
        return pg.query(q.text,q.values)
      }
      const result = await body({ async $queryRaw(q: Prisma.Sql) {
        const result = await execute(q)
        // Prisma exposes PostgreSQL int8 as bigint; PGlite defaults to number.
        return result.rows.map(value => {
          const row = value as Record<string, unknown>
          for (const field of result.fields) if (field.dataTypeID === 20 && row[field.name] != null) row[field.name] = BigInt(String(row[field.name]))
          return row
        })
      },
        async $executeRaw(q: Prisma.Sql) { return (await execute(q)).affectedRows ?? 0 } })
      inboxId = (await pg.query<{ id: string }>('SELECT id FROM "BotActionInbox" WHERE "providerEventId"=$1',[id])).rows[0]!.id
      assert.equal(diagnostics.length,0)
      if (options.beforeCommitClaim) assert.equal(consume(),'overlap_censored','never observed before commit')
      if (options.rollback) throw new Error('injected body rollback')
      return result
    }), tx => classifier.classifyProviderEventTx(tx as never, { route: route(tenant),event: event(id),providerEventId: id,contextWindowEvaluated: true }))
    try { assert.deepEqual(await operation,{ outboundMessage: null }) }
    catch (error) { assert.equal(tracker.retainedCount,0,'rollback cannot retain readiness'); throw error }
    counts.push(writes)
    if (!options.beforeCommitClaim) {
      const produced = !options.jobStatus || ['READY','RETRY'].includes(options.jobStatus)
      assert.equal(consume(),produced ? 'observed' : 'unavailable')
      assert.equal(consume(),'unavailable','marker consumed once')
    }
    return inboxId
  }
  const initial = await classify('initial')
  const saved = (await db.query<{ inboxTenant: string; jobTenant: string; actionType: string; payload: { contextWindowEvaluated: boolean; textBody: string };
    deploymentId: string; deploymentGeneration: number; expectedRevision: null; status: string; lag: string }>(`
    SELECT i."businessId" AS "inboxTenant",j."businessId" AS "jobTenant",i."actionType",i.payload,j."deploymentId",j."deploymentGeneration",
      j."expectedRevision",j.status,abs(extract(epoch FROM (clock_timestamp()-j."availableAt"))) AS lag
    FROM "BotActionInbox" i JOIN "BotJob" j ON j."aggregateId"=i.id WHERE i.id=$1`,[initial])).rows[0]!
  assert.equal(saved.inboxTenant,'tenant-a'); assert.equal(saved.jobTenant,'tenant-a'); assert.equal(saved.actionType,'input.initial')
  assert.equal(saved.payload.contextWindowEvaluated,true); assert.equal(saved.payload.textBody,'synthetic text')
  assert.equal(saved.deploymentId,'deployment-tenant-a'); assert.equal(saved.deploymentGeneration,3); assert.equal(saved.expectedRevision,null)
  assert.equal(saved.status,'READY'); assert.ok(Number(saved.lag)<2,'immediate enqueue uses DB clock')
  assert.deepEqual((await db.query('SELECT operation,aggregate FROM "Audit" ORDER BY seq')).rows,
    [{ operation: 'inbox',aggregate: initial },{ operation: 'job',aggregate: initial }],'inbox precedes dependent enqueue')
  await assert.rejects(classify('initial'),/duplicate key/)
  await assert.rejects(classify('wrong-tenant',{ eventTenant: 'tenant-b' }),/foreign key/)
  await classify('second-tenant',{ tenant: 'tenant-b' }); await classify('overlap',{ beforeCommitClaim: true })
  const size = async () => (await db.query('SELECT (SELECT count(*)::integer FROM "BotActionInbox") AS inbox,(SELECT count(*)::integer FROM "BotJob") AS jobs')).rows
  const before = await size()
  await assert.rejects(classify('rollback',{ rollback: true }),/injected body rollback/); assert.deepEqual(await size(),before)
  await db.exec('UPDATE "Fixture" SET "failJob"=true')
  await assert.rejects(classify('job-fail'),/injected job failure/); assert.deepEqual(await size(),before)
  await db.exec('UPDATE "Fixture" SET "failJob"=false,"failCommit"=true')
  await assert.rejects(classify('commit-fail'),/injected commit failure/); assert.deepEqual(await size(),before)
  await db.exec('UPDATE "Fixture" SET "failCommit"=false')
  // Default batch must preserve standalone enqueue's affected-row/milestone semantics.
  for (const status of ['READY','RETRY','LEASED','DONE','POISON']) {
    const inboxId = await classify(`batch-conflict-${status}`,{ jobStatus: status })
    const actual = (await db.query<{ status: string; deploymentGeneration: number; leaseToken: string | null }>(
      'SELECT status,"deploymentGeneration","leaseToken" FROM "BotJob" WHERE "aggregateId"=$1',[inboxId])).rows[0]!
    const updated = status==='READY' || status==='RETRY'
    assert.equal(actual.status,updated ? 'READY' : status)
    assert.equal(actual.deploymentGeneration,updated ? 3 : 1)
    assert.equal(actual.leaseToken,updated ? null : 'old-lease')
  }
  // Shared enqueue contract must remain unchanged for all conflict outcomes.
  for (const status of ['READY','RETRY','LEASED','DONE','POISON']) {
    const aggregateId = `existing-${status}`
    await db.query(`INSERT INTO "BotJob" (id,kind,"aggregateId","businessId","deploymentId","deploymentGeneration","expectedRevision",
      "availableAt",status,"updatedAt","leaseToken","leasedUntil") VALUES ($1,'PROCESS_INBOX',$1,'tenant-a','deployment-tenant-a',1,7,
      '2020-01-01',$2,clock_timestamp(),'old-lease','2099-01-01')`,[aggregateId,status])
    const diagnostics: QueueMilestoneDiagnostic[] = []
    const tracker = createQueueMilestoneTracker({ businessId: 'tenant-a',emit: value => { diagnostics.push(value) } })
    await observeQueueProducerTransaction(tracker,body => db.transaction(pg => body({
      async $executeRaw(q: Prisma.Sql) { return (await pg.query(q.text,q.values)).affectedRows ?? 0 }
    })),tx => upsertJob(tx as never,'PROCESS_INBOX',aggregateId,'tenant-a','deployment-tenant-a',3,null,'immediate'))
    const actual = (await db.query<{ status: string; deploymentGeneration: number; leaseToken: string | null; expectedRevision: number | null }>(
      'SELECT status,"deploymentGeneration","leaseToken","expectedRevision" FROM "BotJob" WHERE id=$1',[aggregateId])).rows[0]!
    const updated = status==='READY' || status==='RETRY'
    assert.equal(actual.status,updated ? 'READY' : status); assert.equal(actual.deploymentGeneration,updated ? 3 : 1)
    assert.equal(actual.leaseToken,updated ? null : 'old-lease'); assert.equal(Number(actual.expectedRevision ?? 0),updated ? 0 : 7)
    const claim = tracker.beginClaim()
    tracker.claimEnded(claim,jobQueueKey({ businessId: 'tenant-a',kind: 'PROCESS_INBOX',aggregateId }),1); tracker.handlerStarted(claim)
    assert.equal(diagnostics[0]!.readiness,updated ? 'observed' : 'unavailable')
  }
  console.log('PASS semantic baseline: production classifier SQL, tenant, dependency, rollback/commit failure, DB clock, milestones and upsert.')
  assert.deepEqual(counts,counts.map(() => 1),'default classification inbox + enqueue must use one DB statement, not two')
  console.log('OK initial classification batches inbox and enqueue in one production SQL statement.')
} finally { await db.close() }
