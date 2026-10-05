import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildCorpusReport } from './glow-corpus-report.js'
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')
const entries=['m1','m2','m3'].map(id=>({sourceConversationId:'c1',sourceMessageId:id,episodeId:'c1',body:'PRIVATE_BODY_SENTINEL',expected:{}}))
const manifest={schemaVersion:1,sourceCorpusSha256:'source-pin',fixtureVersion:'synthetic-only',entries}
const coverage={counts:{globallyStarted:1},omitted:[{key:'c1/old',reason:'previously_attempted'}],
  entryReviews:entries.map(e=>({key:'c1/'+e.sourceMessageId,independentCriterionRefs:['ref']})),
  independentCriteria:[{id:'ref',expectedAction:'Independent requirement fixed before observation.'}]}
const header={event:'header',manifestSha256:sha(JSON.stringify(manifest)),runtimeFingerprint:'runtime-v1',mode:'controlled',model:'gpt-6-luna',store:false}
const started=(key:string)=>({event:'started',key})
const request=(event:string,key:string,usage?:unknown)=>({event,key,phase:'conversational_turn_interpretation',requestHash:'request-'+key,...(usage===undefined?{}:{usage})})
const turn={sourceConversationId:'c1',sourceMessageId:'m1',evaluation:'no_scored',contextIncomplete:true,fixtureGap:null,
  reply:'PRIVATE_MODEL_ANSWER_SENTINEL',stateAfter:{businessId:'qa-test',customerName:'PRIVATE_NAME_SENTINEL',date:'2026-10-05',
    basket:{members:[{mode:'unresolved',serviceIds:[],evidence:'PRIVATE_EVIDENCE_SENTINEL'}]}},
  diagnostics:{mode:'ai',copyMode:'fallback',copyReason:'canonical_only',aiCalls:1,replyRoute:'first_call',
    providerMs:10,validationMs:2,engineMs:3,responseMs:0,totalMs:15,decision:{acceptedAction:'no_service_change'},
    validation:{turnPlan:{validationAcceptedKinds:[]}}}}
const completed={event:'completed',key:'c1/m1',turn}
const records=[header,started('c1/m1'),request('request_started','c1/m1'),
  request('request_done','c1/m1',{input_tokens:10,output_tokens:2,input_tokens_details:{cached_tokens:3},output_tokens_details:{reasoning_tokens:0}}),
  {event:'interpreted',key:'c1/m1',candidate:{intent:'booking',turnPlan:{operations:[{kind:'service_request',evidence:'PRIVATE_CANDIDATE_SENTINEL'}]}}},completed,
  started('c1/m2'),request('request_started','c1/m2'),{event:'skipped',key:'c1/m3',reasons:['historical_context_unbound']}]
const text=(items:unknown[])=>items.map(x=>JSON.stringify(x)).join('\n')+'\n'
const input=(journalText:string,id='v1',runtimeFingerprint='runtime-v1')=>({id,manifest,coverage,journalText,runtimeFingerprint})
const partial=buildCorpusReport([input(text(records)+'{"event":')])
assert.equal(partial.runs[0]!.snapshot.truncatedTail,true)
assert.equal(partial.runs[0]!.counts.completed,1)
assert.equal(partial.runs[0]!.counts.incompleteAttempts,1)
assert.equal(partial.runs[0]!.requests.pending,1)
assert.equal(partial.runs[0]!.usage.unknownRequests,1)
assert.equal(partial.runs[0]!.usage.cachedInputTokens,3)
assert.equal(partial.runs[0]!.executionFinished,false)
assert.deepEqual(partial.runs[0]!.criteria.map(c=>c.status),['pending_manual','no_evaluable','no_evaluable'])
assert.equal(partial.runs[0]!.interpretationModes.ai,1)
assert.equal(partial.runs[0]!.copyModes.fallback,1,'copy fallback is not interpretation fallback')
assert.equal(partial.runs[0]!.latencies.providerMs.p95,10)
for(const privateValue of ['PRIVATE_BODY','PRIVATE_MODEL','PRIVATE_NAME','PRIVATE_EVIDENCE','PRIVATE_CANDIDATE'])assert.equal(JSON.stringify(partial).includes(privateValue),false)
assert.equal(Object.hasOwn(partial,'accuracy'),false)
assert.equal(Object.hasOwn(partial,'passed'),false)
const localError={event:'local_error',key:'c1/m2',errorCode:'invalid_dialogue_input',stage:'dialogue_execution'}
const errorReport=buildCorpusReport([input(text([...records,request('request_done','c1/m2',null),localError]))])
assert.equal(errorReport.runs[0]!.counts.localErrors,1)
assert.equal(errorReport.runs[0]!.counts.incompleteAttempts,0)
assert.equal(errorReport.runs[0]!.criteria[1]!.status,'no_evaluable')
assert.equal(errorReport.runs[0]!.observations[1]!.observed,null,'local error never fabricates post-state/diagnostics')
const duplicate=buildCorpusReport([input(text([...records,completed,started('c1/old')]))])
assert.ok(duplicate.runs[0]!.integrityIssues.some(i=>i.code==='duplicate_event'))
assert.ok(duplicate.runs[0]!.integrityIssues.some(i=>i.code==='prior_source_reused'))
assert.equal(duplicate.runs[0]!.executionFinished,false)
assert.throws(()=>buildCorpusReport([input(text(records),'v1','different')]),/runtime fingerprint/)
const wrongManifest={...input(text(records)),manifest:{...manifest,fixtureVersion:'different'}}
assert.throws(()=>buildCorpusReport([wrongManifest]),/manifest hash/)
const repeated=buildCorpusReport([input(text(records)),input(text([{...header,runtimeFingerprint:'runtime-v2'},started('c1/m1')]),'v2','runtime-v2')])
assert.equal(repeated.runtimeVersions.length,2)
assert.ok(repeated.integrityIssues.some(i=>i.code==='source_reused_across_runs'))
assert.equal(repeated.conversations[0]!.runs.length,2)
const finalTurn={...completed,key:'c1/m2',turn:{...turn,sourceMessageId:'m2',contextIncomplete:false}}
const final=buildCorpusReport([input(text([...records,request('request_done','c1/m2',{input_tokens:5,output_tokens:1}),finalTurn]))])
assert.equal(final.runs[0]!.executionFinished,true)
assert.equal(final.runs[0]!.criteria.filter(c=>c.status==='pending_manual').length,2,'execution never grades independent criteria PASS')

const hashedManifest={...manifest,entries:entries.map(e=>({...e,sourceBodySha256:sha(e.body),transmittedBodySha256:sha(e.body)}))}
const hashMismatch=buildCorpusReport([{...input(text([{...header,manifestSha256:sha(JSON.stringify(hashedManifest))},
  {...started('c1/m1'),sourceBodySha256:'changed',transmittedBodySha256:sha(entries[0]!.body)}])),manifest:hashedManifest}])
assert.ok(hashMismatch.integrityIssues.some(issue=>issue.code==='started_source_hash_differs'))
const capturedIncomplete=buildCorpusReport([input(text([...records,request('request_done','c1/m2',{input_tokens:7,output_tokens:1}),
  {event:'interpreted',key:'c1/m2',candidate:{intent:'booking',turnPlan:{operations:[{kind:'basket'},{kind:'professional'}]}}}]))])
assert.equal(capturedIncomplete.runs[0]!.observations[1]!.observed,null)
assert.equal(capturedIncomplete.runs[0]!.observations[1]!.capturedCandidate!.intent,'booking')
assert.deepEqual(capturedIncomplete.runs[0]!.observations[1]!.capturedCandidate!.operationKinds,['basket','professional'])
assert.equal(capturedIncomplete.runs[0]!.observations[1]!.contextIncomplete,null,'absent response cannot assert complete context')
assert.equal(capturedIncomplete.runs[0]!.requests.pending,0)
assert.equal(capturedIncomplete.runs[0]!.counts.incompleteAttempts,1)
const coverageMismatch={...input(text(records)),coverage:{...coverage,sources:{sourceCorpusSha256:'different-source'}}}
assert.throws(()=>buildCorpusReport([coverageMismatch]),/source hash/)
const undeclaredPass=buildCorpusReport([input(text([...records,{...completed,turn:{...turn,evaluation:'criteria_met'}}]))])
assert.ok(undeclaredPass.integrityIssues.some(issue=>issue.code==='runner_pass_without_typed_criteria'))
assert.equal(undeclaredPass.runs[0]!.criteria[0]!.status,'pending_manual')
assert.equal(final.runs[0]!.usage.cachedUnknownRequests,1,'omitted usage details are unknown, not known zero')


const identityTurn={...completed,turn:{...turn,stateAfter:{...turn.stateAfter,professional:{id:'qa-professional',name:'Public QA staff'},
  timePreference:{kind:'around',anchor:'18:00'}}}}
const identityReport=buildCorpusReport([input(text(records.map(record=>record===completed?identityTurn:record)))])
assert.equal(identityReport.runs[0]!.observations[0]!.observed!.state.professionalId,'qa-professional')
assert.equal(identityReport.runs[0]!.observations[0]!.observed!.state.timePreference!.anchor,'18:00')

const root=fileURLToPath(new URL('../tmp/glow-corpus-report-test/',import.meta.url));mkdirSync(root,{recursive:true})
const dir=mkdtempSync(join(root,'contract-')),mp=join(dir,'manifest.json'),cp=join(dir,'coverage.json'),jp=join(dir,'snapshot.jsonl'),out=join(dir,'report.json')
writeFileSync(mp,JSON.stringify(manifest),'utf8');writeFileSync(cp,JSON.stringify(coverage),'utf8');writeFileSync(jp,text(records),'utf8')
const before=sha(readFileSync(jp,'utf8'))
execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/glow-corpus-report.ts','--snapshot',mp,cp,jp,out,'runtime-v1'],{cwd:fileURLToPath(new URL('../',import.meta.url))})
assert.equal(JSON.parse(readFileSync(out,'utf8')).runs[0].counts.completed,1)
assert.equal(sha(readFileSync(jp,'utf8')),before,'CLI never rewrites the source journal')
assert.throws(()=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/glow-corpus-report.ts','--snapshot',mp,cp,jp,out,'runtime-v1'],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'pipe'}))

const jp2=join(dir,'snapshot-v2.jsonl'),out2=join(dir,'report-multirun.json')
writeFileSync(jp2,text([{...header,runtimeFingerprint:'runtime-v2'},started('c1/m1')]),'utf8')
execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/glow-corpus-report.ts','--snapshot',mp,cp,jp,out2,'runtime-v1',mp,cp,jp2,'runtime-v2'],
  {cwd:fileURLToPath(new URL('../',import.meta.url))})
assert.equal(JSON.parse(readFileSync(out2,'utf8')).runtimeVersions.length,2)
assert.equal(sha(readFileSync(jp,'utf8')),before)
assert.throws(()=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/glow-corpus-report.ts','--snapshot',mp,cp,jp,jp,'runtime-v1'],
  {cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'pipe'}))
assert.equal(sha(readFileSync(jp,'utf8')),before)

console.log('Corpus report: PASS (snapshot, partial/error/unknown usage, privacy, independent criteria, multirun, no effects)')