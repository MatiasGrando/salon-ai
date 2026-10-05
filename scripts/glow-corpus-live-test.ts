import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLiveSample, validateLiveSample, verifyLiveSource, type LiveSample } from './glow-corpus-live.js'
const fixture = {businessId:'qa-live',timezone:'America/Argentina/Buenos_Aires',
  services:[{id:'cut',name:'Corte',durationMinutes:30,price:1000,requiresConsultation:false}],
  professionals:[{id:'qa-staff',name:'Rama',priority:0}],slots:[],
  identity:{businessId:'qa-live',businessName:'Peluqueria QA',assistantName:'Cami',treatment:'vos' as const}}
const sample: LiveSample = {schemaVersion:1,sourceCorpusSha256:'source-fixture',fixtureVersion:'synthetic-v1',
  fixtures:{all:fixture},pseudonyms:{'canitas-1':'CLIENTE_001'},publicStaffNames:['Rama'],
  limits:['Adapted QA sample; no real catalog/agenda or blind evaluation.'],entries:[
    {episodeId:'prefix',sourceConversationId:'canitas-1',sourceMessageId:'m1',sourceBodySha256:'h1',createdAt:'2026-08-20T12:00:00Z',
      fixtureId:'all',body:'Hola',privacyReviewed:true,sourceFlags:{privacyMarked:false,hasMedia:false,isInteractiveReply:false},
      contextMode:'ordered_prefix',category:'greeting',expected:{introduced:true,maxCalls:1,proposal:false,copyMode:'ai'}},
    {episodeId:'prefix',sourceConversationId:'canitas-1',sourceMessageId:'m2',sourceBodySha256:'h2',createdAt:'2026-08-20T12:01:00Z',
      fixtureId:'all',body:'Gracias',privacyReviewed:true,sourceFlags:{privacyMarked:false,hasMedia:false,isInteractiveReply:false},
      contextMode:'ordered_prefix',category:'social',expected:{introduced:true,maxCalls:1,proposal:false,copyMode:'ai'}}
  ]}
validateLiveSample(sample)
let calls=0
const fake: typeof fetch = async (url, init) => {
  calls++; assert.equal(url,'https://api.openai.com/v1/responses'); assert.equal(init?.method,'POST')
  assert.equal(init?.redirect,'error')
  const data=JSON.parse(init!.body as string), input=JSON.parse(data.input)
  assert.equal(data.model,'gpt-6-luna'); assert.equal(data.store,false); assert.equal(data.reasoning.effort,'none')
  assert.equal(Object.hasOwn(input,'expected'),false,'independent expected criteria never enter request')
  assert.equal(Object.hasOwn(input,'oracle'),false)
  assert.equal(data.input.includes('maxCalls'),false)
  const draft={salutation:input.message==='Hola'?'greeting':null,opening:input.message==='Hola'?'Qué gusto saludarte.':'De nada.',factIds:input.firstReplyFacts?.map((f:{id:string})=>f.id)??[],closing:null}
  const value={intent:'other',serviceId:null,serviceEvidence:null,professionalMention:null,serviceConfidence:'certain',serviceCandidateIds:[],serviceCorrection:false,informationTarget:null,intakeReply:null,turnPlan:{version:1,operations:[]},firstReply:draft}
  return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],
    usage:{input_tokens:120,output_tokens:20,input_tokens_details:{cached_tokens:5},output_tokens_details:{reasoning_tokens:0}}}),
    {status:200,headers:{'x-request-id':'req-offline-'+calls,'content-type':'application/json'}})
}
const dir=mkdtempSync(join(tmpdir(),'glow-live-contract-'))
const result=await runLiveSample(sample,{mode:'controlled',fetchImpl:fake,journalPath:join(dir,'journal.jsonl'),fingerprint:()=> 'frozen-v1'})
assert.equal(calls,2)
assert.equal(result.comprehensionEvaluated,false)
assert.equal(result.counts.completed,2)
assert.equal(result.requests.length,2)
assert.equal(result.usage.inputTokens,240)
assert.equal(result.usage.cachedInputTokens,10)
assert.ok(result.turns.every(t=>t.stateAfter.introduced))
assert.ok(result.turns.every(t=>t.diagnostics.aiCalls===1))
assert.ok(result.turns.every(t=>t.diagnostics.copyMode==='ai'), 'intro state does not substitute for AI copy evidence')
assert.equal(result.counts.passed,2)
await assert.rejects(runLiveSample(sample,{mode:'controlled',fetchImpl:fake,journalPath:join(dir,'journal.jsonl'),fingerprint:()=> 'frozen-v1'}),/explicit resume/)
const resumed=await runLiveSample(sample,{mode:'controlled',fetchImpl:fake,journalPath:join(dir,'journal.jsonl'),fingerprint:()=> 'frozen-v1',resume:true})
assert.equal(calls,2,'resume restores checkpoints without requesting old entries again')
assert.equal(resumed.counts.completed,2)
const records=readFileSync(join(dir,'journal.jsonl'),'utf8')
assert.equal(records.includes('Authorization'),false)
assert.equal(records.includes('offline-test-key'),false)
assert.equal(records.includes('instructions'),false)
const dirty=structuredClone(sample);dirty.entries[0]!.body='alias de banco: test.bank.alias'
const blocked=await runLiveSample(dirty,{mode:'controlled',fetchImpl:fake,journalPath:join(dir,'privacy.jsonl'),fingerprint:()=> 'frozen-v1'})
assert.equal(blocked.counts.skipped,1)
assert.equal(calls,3)
const unknown=structuredClone(sample);unknown.entries[0]!.privacyReviewed=false
assert.throws(()=>validateLiveSample(unknown),/privacy review/)
const duplicate=structuredClone(sample);duplicate.entries[1]!.sourceMessageId='m1'
assert.throws(()=>validateLiveSample(duplicate),/duplicate source/)
const inflight=join(dir,'inflight.jsonl')
writeFileSync(inflight,records.split('\n').filter(Boolean).slice(0,2).join('\n')+'\n','utf8')
await assert.rejects(runLiveSample(sample,{mode:'controlled',fetchImpl:fake,journalPath:inflight,fingerprint:()=> 'frozen-v1',resume:true}),/in-flight/)
assert.equal(calls,3)
const changed=join(dir,'changed.jsonl')
let reads=0
await assert.rejects(runLiveSample(sample,{mode:'controlled',fetchImpl:fake,journalPath:changed,fingerprint:()=> ++reads<3?'a':'b'}),/fingerprint/)
assert.equal(calls,3,'changed sources abort before traffic')
const failed=await runLiveSample(sample,{mode:'controlled',fetchImpl:async()=>new Response('{}',{status:429}),
  journalPath:join(dir,'failed.jsonl'),fingerprint:()=> 'frozen-v1'})
assert.equal(failed.requests.length,2)
assert.equal(failed.counts.fallback,2)
assert.equal(failed.counts.passed,0,'fallback is not evidence of model understanding')

const unscored=structuredClone(sample)
unscored.entries[0]!.fixtureGap='No current QA staff for this independent criterion'
unscored.entries[1]!.expected={}
const gapResult=await runLiveSample(unscored,{mode:'controlled',fetchImpl:fake,
  journalPath:join(dir,'gaps.jsonl'),fingerprint:()=> 'frozen-v1'})
assert.equal(gapResult.counts.fixtureGap,1)
assert.equal(gapResult.counts.noScored,1)
assert.equal(gapResult.counts.passed+gapResult.counts.failed+gapResult.counts.fixtureGap+
  gapResult.counts.contextIncomplete+gapResult.counts.noScored+gapResult.counts.fallbackVerdicts,gapResult.counts.completed)
const sourcePath=join(dir,'source.jsonl')
const sourceText=JSON.stringify({conversationId:'canitas-1',messages:sample.entries.map(e=>({
  messageId:e.sourceMessageId,direction:'INBOUND',body:e.body,createdAt:e.createdAt}))})+'\n'
writeFileSync(sourcePath,sourceText,'utf8')
const sourceSample=structuredClone(sample)
sourceSample.sourceCorpusPath=sourcePath
sourceSample.sourceCorpusSha256=createHash('sha256').update(sourceText).digest('hex')
sourceSample.sourcePrivacyMessageIds=[]
for(const entry of sourceSample.entries)entry.sourceBodySha256=createHash('sha256').update(entry.body).digest('hex')
verifyLiveSource(sourceSample)
sourceSample.entries[0]!.body='Changed body'
assert.throws(()=>verifyLiveSource(sourceSample),/source input.*hash differs/)
const timedPath=join(dir,'timed-out.jsonl')
let pendingCalls=0
const pendingFetch:typeof fetch=async()=>{pendingCalls++;return new Promise<Response>(()=>{})}
await assert.rejects(runLiveSample(sample,{mode:'controlled',fetchImpl:pendingFetch,journalPath:timedPath,
  fingerprint:()=> 'frozen-v1',timeoutMs:1}),/still in-flight/)
assert.equal(pendingCalls,1)
await assert.rejects(runLiveSample(sample,{mode:'controlled',fetchImpl:pendingFetch,journalPath:timedPath,
  fingerprint:()=> 'frozen-v1',timeoutMs:1,resume:true}),/previous in-flight/)
assert.equal(pendingCalls,1,'timeout with an uncertain transport never permits automatic resend')

console.log('Live sample journal: PASS (privacy, real-vs-controlled, scoped POST, token usage, no retry, checkpoint, crash/fingerprint fencing)')
