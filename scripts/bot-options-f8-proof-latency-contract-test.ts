import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { Prisma } from '../src/generated/prisma/client.js'
import { processDepositProofJob } from '../src/bot-options/application/process-deposit-proof-job.js'
import { writeValidatedDepositProof } from '../src/services/deposit-proof-writer.js'
import { downloadMetaDepositProof, type MetaMediaHttp } from '../src/bot-options/infrastructure/meta-deposit-proof-media.js'
import { validateDepositProof } from '../src/services/deposit-proof-validation.js'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'

// Offline fake transaction instrumentation; no credentials or real media.
const job: ClaimedBotJob = { id: 'fixture-job', kind: 'RECEIVE_DEPOSIT_PROOF', aggregateId: 'fixture-event', businessId: 'fixture-business', deploymentId: 'fixture-deployment', deploymentGeneration: 2, expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: 'fixture-token', claimedUntil: new Date(Date.now() + 30_000), queueWaitMs: 0 }
const failures: string[] = []
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.info('PASS', name) }
  catch (error) { failures.push(name); console.error('FAIL', name, error instanceof Error ? error.message : 'test failure') }
}
function fixture(failClaim = false, failDeployment = false, withTarget = false) {
  const options: unknown[] = [], queries: Prisma.Sql[] = [], diagnostics: unknown[] = []
  const tx = {
    $queryRaw: async (query: Prisma.Sql) => {
      queries.push(query)
      if (query.text.includes('FOR UPDATE OF j')) return failClaim ? [] : [{ id: job.id }]
      if (query.text.includes('AS "deploymentId"')) {
        if (failDeployment) throw new Error('Transaction already closed: confidential fixture SQL parameters')
        return [{ deploymentId: job.deploymentId, generation: 2 }]
      }
      if (withTarget && query.text.includes('deposit."id" AS "depositId"')) return [{depositId:'fixture-deposit', groupId:null, sessionId:'fixture-session', conversational:false}]
      return []
    },
    $executeRaw: async (query: Prisma.Sql) => { queries.push(query); return 1 }
  }
  const client = {
    $queryRaw: async () => withTarget ? [{id:job.aggregateId,businessId:job.businessId,providerMessageId:'fixture-message',phoneNumberId:'fixture-channel',payload:{kind:'message',fromPhone:'fictitious',messageType:'image',mediaId:'fictitious',mediaMimeType:'image/png'}}] : [],
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>, transactionOptions?: unknown) => {
      options.push(transactionOptions)
      return run(tx)
    }
  }
  const input = { client: client as never, job, capabilityEnabled: true, onDiagnostic: (value: unknown) => diagnostics.push(value) }
  return { input, client, options, queries, diagnostics }
}
await test('proof transactions explicitly permit up to 15 s', async () => {
  const f = fixture()
  assert.equal(await processDepositProofJob(f.input), 'FALLBACK')
  assert.ok(f.options.length >= 2)
  for (const options of f.options) assert.deepEqual(options, { maxWait: 2_000, timeout: 15_000 })
})
await test('standalone writer uses same bounded budget', async () => {
  let observed: unknown
  const sentinel = new Error('stop before persistence')
  const client = { $transaction: async (_run: unknown, options: unknown) => { observed = options; throw sentinel } }
  await assert.rejects(writeValidatedDepositProof(client as never, {} as never), error => error === sentinel)
  assert.deepEqual(observed, { maxWait: 2_000, timeout: 15_000 })
})
await test('renewal is proof-only and requires live tenant/token/generation', async () => {
  const f = fixture()
  await processDepositProofJob(f.input)
  const renewals = f.queries.filter(q => q.text.includes('UPDATE "BotJob"') && q.text.includes('"leasedUntil" = clock_timestamp()'))
  assert.ok(renewals.length >= 2)
  for (const q of renewals) {
    assert.match(q.text, /"kind"\s*=\s*'RECEIVE_DEPOSIT_PROOF'/)
    assert.match(q.text, /"leasedUntil"\s*>\s*clock_timestamp\(\)/)
    for (const column of ['"businessId"', '"leaseToken"', '"deploymentId"', '"deploymentGeneration"']) assert.ok(q.text.includes(column))
    assert.ok(q.values.includes(60_000))
  }
})
await test('expired/stolen claim cannot renew or persist evidence', async () => {
  const f = fixture(true)
  await assert.rejects(processDepositProofJob(f.input), /stale or fenced/)
  assert.equal(f.queries.some(q => q.text.includes('UPDATE "BotJob"')), false)
  assert.equal(f.queries.some(q => q.text.includes('BookingDepositProof')), false)
})
await test('transaction error identifies phase without error text/identifiers', async () => {
  const f = fixture(false, true)
  await assert.rejects(processDepositProofJob(f.input))
  const error = f.diagnostics.find(value => (value as { outcome?: string }).outcome === 'error') as Record<string, unknown>
  assert.equal(error?.phase, 'deployment')
  assert.equal(error?.reason, 'transaction_expired')
  assert.equal(typeof error?.durationMs, 'number')
  assert.ok(Number.isFinite(error.durationMs) && Number(error.durationMs) >= 0)
  const serialized = JSON.stringify(f.diagnostics)
  for (const secret of ['confidential', 'fixture-job', 'fixture-event', 'fixture-business', 'fixture-token', 'parameters']) assert.equal(serialized.includes(secret), false)
})
await test('diagnostic observer failure cannot change outcome', async () => {
  const f = fixture()
  assert.equal(await processDepositProofJob({ ...f.input, onDiagnostic: () => { throw new Error('observer broke') } } as never), 'FALLBACK')
})
await test('diagnostics reach existing Barber and server sinks', () => {
  for (const [file, sink] of [['barber-local.ts', "diagnosticSink.emit('barber-local-deposit-proof'"], ['server.ts', "console.info('[bot-options-deposit-proof]'"]] as const) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf("if (job.kind === 'RECEIVE_DEPOSIT_PROOF')"), source.indexOf("if (job.kind === 'BRIDGE_DEPOSIT_NOTIFICATION')"))
    assert.ok(handler.includes('onDiagnostic:'))
    assert.ok(handler.includes(sink))
  }
})
const pdf = await PDFDocument.create(); pdf.addPage()
const formats = [
  ['image/jpeg', await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer()],
  ['image/png', await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()],
  ['image/webp', await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).webp().toBuffer()],
  ['application/pdf', Buffer.from(await pdf.save({ useObjectStreams: false }))]
] as const
for (const [mime, bytes] of formats) await test('supported bounded media ' + mime + ' ignores misleading extension', async () => {
  let calls = 0
  const fetch: MetaMediaHttp = async () => {
    calls++
    return calls === 1
      ? { ok: true, headers: { get: () => null }, body: null, json: async () => ({ url: 'https://lookaside.fbsbx.com/fixture', mime_type: mime, file_size: bytes.length }) }
      : { ok: true, headers: { get: key => key === 'content-type' ? mime : key === 'content-length' ? String(bytes.length) : null }, body: (async function* () { yield bytes })() }
  }
  const downloaded = await downloadMetaDepositProof({ mediaId: 'fictitious', accessToken: 'fictitious', fetch })
  const evidence = await validateDepositProof({ data: downloaded.data, declaredMimeType: downloaded.mimeType, filename: 'receipt.zip' })
  assert.equal(evidence.sourceMimeType, mime)
  assert.notEqual(evidence.sourceFilename, 'receipt.zip')
})
console.info(passed + ' passed; ' + failures.length + ' failed')
assert.equal(failures.length, 0, failures.join('; '))


// Actual SQL fences and rollback, in process; PGlite replaces cross-process
// advisory locking only. PostgreSQL concurrency suites remain separate.
const { PGlite } = await import('@electric-sql/pglite')
const { renewProofJobLeaseTx } = await import('../src/bot-options/application/process-deposit-proof-job.js')
const { assertClaimedBotJobTx } = await import('../src/bot-options/infrastructure/postgres-worker.js')
const db = new PGlite()
await db.exec('CREATE TYPE "BotJobStatus" AS ENUM (\'LEASED\',\'DONE\'); CREATE TABLE "BotJob" (id text PRIMARY KEY,kind text,"businessId" text,status "BotJobStatus","leaseToken" text,"leasedUntil" timestamptz,"deploymentId" text,"deploymentGeneration" int,"updatedAt" timestamptz); CREATE TABLE "BotChannelDeployment" (id text PRIMARY KEY,"businessId" text,generation int,"activeConfigurationId" text,"legacyDispatchCoverageVersion" int,"claimsPausedAt" timestamptz);')
await db.query('INSERT INTO "BotChannelDeployment" VALUES ($1,$2,2,\'cfg\',1,NULL)', [job.deploymentId,job.businessId])
async function seedLease() {
  await db.exec('DELETE FROM "BotJob"')
  await db.query('INSERT INTO "BotJob" VALUES ($1,$2,$3,\'LEASED\',$4,clock_timestamp()+interval \'30 seconds\',$5,2,clock_timestamp())',
    [job.id,job.kind,job.businessId,job.claimToken,job.deploymentId])
}
function sqlTx(database: { query: typeof db.query }) {
  return {
    $queryRaw: async (q: Prisma.Sql) => q.text.includes('pg_advisory_xact_lock') ? [] : (await database.query(q.text,q.values)).rows,
    $executeRaw: async (q: Prisma.Sql) => q.text.includes('pg_advisory_xact_lock') ? 1 : (await database.query(q.text,q.values)).affectedRows
  } as unknown as Prisma.TransactionClient
}
await test('committed renewal survives a later financial transaction rollback', async () => {
  await seedLease()
  await db.transaction(tx => renewProofJobLeaseTx(sqlTx(tx as never), job))
  const renewed = (await db.query<{leasedUntil: Date}>('SELECT "leasedUntil" FROM "BotJob"')).rows[0]!.leasedUntil
  assert.ok(+new Date(renewed) > Date.now()+55_000)
  await assert.rejects(db.transaction(async tx => {
    await assertClaimedBotJobTx(sqlTx(tx as never), job)
    await tx.exec('UPDATE "BotJob" SET status=\'DONE\'')
    throw new Error('simulate rolled-back proof insertion')
  }), /rolled-back/)
  const after = (await db.query<{status:string;leasedUntil:Date}>('SELECT status,"leasedUntil" FROM "BotJob"')).rows[0]!
  assert.equal(after.status,'LEASED')
  assert.equal(+new Date(after.leasedUntil),+new Date(renewed))
})
await test('real SQL renewal rejects tenant/token/generation/non-proof/expired changes', async () => {
  for (const change of [{businessId:'foreign'},{claimToken:'stolen'},{deploymentGeneration:3},{kind:'PROCESS_INBOX'}]) {
    await seedLease()
    await assert.rejects(db.transaction(tx => renewProofJobLeaseTx(sqlTx(tx as never),{...job,...change})))
    const row = (await db.query<{ttl:number}>('SELECT EXTRACT(EPOCH FROM ("leasedUntil"-clock_timestamp())) AS ttl FROM "BotJob"')).rows[0]!
    assert.ok(Number(row.ttl)<35)
  }
  await seedLease()
  await db.exec('UPDATE "BotJob" SET "leasedUntil"=clock_timestamp()-interval \'1 second\'')
  await assert.rejects(db.transaction(tx => renewProofJobLeaseTx(sqlTx(tx as never),job)), /stale or fenced/)
})
await test('new owner after renewal fences previous claimant before mutation', async () => {
  await seedLease()
  await db.transaction(tx => renewProofJobLeaseTx(sqlTx(tx as never),job))
  await db.exec('UPDATE "BotJob" SET "leaseToken"=\'new-owner\'')
  await assert.rejects(db.transaction(tx => assertClaimedBotJobTx(sqlTx(tx as never),job)), /stale or fenced/)
  assert.equal((await db.query<{status:string}>('SELECT status FROM "BotJob"')).rows[0]!.status,'LEASED')
})
await db.close()
await test('5.108 s simulated query passes scoped 15 s and exceeds old 5 s budget', async () => {
  const elapsedMs = 5_108
  const f = fixture()
  const original = f.client.$transaction as unknown as (run: unknown,options?:{timeout?:number})=>Promise<unknown>
  f.client.$transaction = (async (run: unknown, options?: {timeout?:number}) => {
    assert.ok(elapsedMs < (options?.timeout ?? 5_000),'query would be rejected by the former implicit budget')
    return original(run,options)
  }) as never
  assert.equal(await processDepositProofJob(f.input),'FALLBACK')
})
console.info(passed + ' passed; ' + failures.length + ' failed')
assert.equal(failures.length,0,failures.join('; '))

await test('preflight DB or credential failure never becomes invalid-proof notification',async()=>{
  const f=fixture(false,false,true)
  const outage=new Error('Transaction already closed: bounded fixture')
  await assert.rejects(processDepositProofJob({...f.input,resolveAccessToken:async()=>{throw outage}}),error=>error===outage)
  assert.equal(f.queries.some(q=>q.text.includes('DepositNotificationOutbox')),false)
  const rejection=f.diagnostics.find(d=>(d as {phase?:string;outcome?:string}).phase==='media' && (d as {outcome?:string}).outcome==='error') as {reason?:string}
  assert.equal(rejection?.reason,'transaction_expired')
})
console.info(passed+' passed; '+failures.length+' failed')
assert.equal(failures.length,0,failures.join('; '))


await test('real Prisma P2028 is classified without retaining its exception text', async () => {
  const f=fixture()
  const error=new Prisma.PrismaClientKnownRequestError('private financial SQL',{code:'P2028',clientVersion:'7.8.0'})
  f.client.$transaction=(async()=>{throw error}) as never
  await assert.rejects(processDepositProofJob(f.input),e=>e===error)
  assert.deepEqual(f.diagnostics.map(d=>({phase:(d as {phase:string}).phase,reason:(d as {reason:string}).reason})),[{phase:'deployment',reason:'transaction_expired'}])
  assert.equal(JSON.stringify(f.diagnostics).includes('financial'),false)
})
console.info(passed+' passed; '+failures.length+' failed')
assert.equal(failures.length,0,failures.join('; '))
