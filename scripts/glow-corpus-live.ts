import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { respondWithAiInterpreter, type InterpretationDiagnostics, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { initialDialogueState, parseDialogueState, type DialogueState } from '../src/conversational-bot/engine.js'
import { validateDialogueIdentity, type DialogueIdentity } from '../src/conversational-bot/dialogue-identity.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import { fixturePort, type EvalFixture, type Expected } from './glow-offline-eval.js'

export type LiveExpected = Expected & { introduced?: boolean; maxCalls?: number; copyMode?: InterpretationDiagnostics['copyMode']; requiredServiceIds?:string[]; timePreference?:DialogueState['timePreference'] }
type SampleEntry = { episodeId:string;sourceConversationId:string;sourceMessageId:string;sourceBodySha256:string;createdAt:string;
  fixtureId:string;body:string;privacyReviewed:boolean;sourceFlags:{privacyMarked:boolean;hasMedia:boolean;isInteractiveReply:boolean};
  contextMode:'ordered_prefix'|'isolated_adapted';category:string;expected:LiveExpected;fixtureGap?:string;manualReviewPending?:string[];
  counterfactualContinuation?:boolean;initialState?:Partial<Omit<DialogueState,'businessId'|'engine'|'schemaVersion'>> }
export type LiveSample = {schemaVersion:1;sourceCorpusSha256:string;sourceCorpusPath?:string;sourcePrivacyMessageIds?:string[];fixtureVersion:string;fixtures:Record<string,EvalFixture & {identity?:DialogueIdentity}>;
  pseudonyms:Record<string,string>;publicStaffNames:string[];limits:string[];entries:SampleEntry[]}
type LiveOptions = { mode:'controlled'|'openai_responses';journalPath:string;resume?:boolean;maxEntries?:number;fetchImpl?:typeof fetch;fingerprint?:()=>string;timeoutMs?:number }
type TurnRecord = {key:string;episodeId:string;sourceConversationId:string;sourceMessageId:string;contextMode:string;category:string;
  fixtureGap:string|null;contextIncomplete:boolean;counterfactualContinuation:boolean;manualReviewPending:string[];stateAfter:DialogueState;
  diagnostics:InterpretationDiagnostics;reply:string;failures:string[];evaluation:'criteria_met'|'failed'|'fallback'|'fixture_gap'|'context_incomplete'|'no_scored'}
type RequestRecord = {key:string;phase:string;requestHash:string;httpStatus:number|null;requestId:string|null;usage:Record<string,unknown>|null;outcome:string}
type JournalRecord = {event:string;[key:string]:unknown}
const repoRoot=fileURLToPath(new URL('../',import.meta.url))
const endpoint='https://api.openai.com/v1/responses'
const sha=(value:string)=>createHash('sha256').update(value).digest('hex')
const keyOf=(entry:SampleEntry)=>entry.sourceConversationId+'/'+entry.sourceMessageId
const privateRoot=resolve(repoRoot,'tmp/e223-corpus-replay')
export function liveRuntimeFingerprint() {
  const root=new URL('../src/conversational-bot/',import.meta.url)
  return sha(JSON.stringify(readdirSync(root).filter(name=>name.endsWith('.ts')).sort().map(name=>[name,sha(readFileSync(new URL(name,root),'utf8'))])
    .concat(['glow-offline-eval.ts','glow-corpus-live.ts'].map(name=>[name,sha(readFileSync(new URL(name,import.meta.url),'utf8'))]))))
}
export function privacyReasons(entry:SampleEntry):string[] {
  const text=entry.body
  return [...(entry.sourceFlags.privacyMarked?['privacy_marked']:[]),...(entry.sourceFlags.hasMedia?['media_unavailable']:[]),
    ...(entry.sourceFlags.isInteractiveReply?['historical_interactive_unbound']:[]),
    ...(/https?:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{9,}\b/i.test(text)?['contact_url_or_identifier']:[]),
    ...(/\b(cbu|cvu|dni|cuit|alias|cuenta bancaria|transferencia realizada|comprobante)\b/i.test(text)?['bank_or_identity_data']:[])]
}
export function validateLiveSample(sample:LiveSample) {
  assert(sample?.schemaVersion===1 && typeof sample.sourceCorpusSha256==='string' && sample.fixtureVersion &&
    Array.isArray(sample.entries) && sample.entries.length>0 && sample.entries.length<=2101,'invalid sample')
  assert(Array.isArray(sample.publicStaffNames) && sample.pseudonyms && Array.isArray(sample.limits),'privacy/source declaration required')
  const keys=new Set<string>(), episodes=new Map<string,{time:number;conversation:string;fixture:string}>()
  for(const entry of sample.entries) {
    assert(entry.privacyReviewed===true,'explicit privacy review required')
    assert(typeof entry.body==='string' && entry.body.trim() && entry.body.length<=2000 && Number.isFinite(Date.parse(entry.createdAt)),'invalid sample input')
    assert(entry.sourceFlags && typeof entry.sourceFlags.privacyMarked==='boolean' && typeof entry.sourceFlags.hasMedia==='boolean' &&
      typeof entry.sourceFlags.isInteractiveReply==='boolean','source privacy flags required')
    assert(!keys.has(keyOf(entry)),'duplicate source input'); keys.add(keyOf(entry))
    assert(entry.episodeId && entry.sourceBodySha256 && ['ordered_prefix','isolated_adapted'].includes(entry.contextMode),'source/context required')
    const previous=episodes.get(entry.episodeId)
    assert(!previous || previous.time<=Date.parse(entry.createdAt) && previous.conversation===entry.sourceConversationId &&
      previous.fixture===entry.fixtureId,'episode chronology/isolation')
    episodes.set(entry.episodeId,{time:Date.parse(entry.createdAt),conversation:entry.sourceConversationId,fixture:entry.fixtureId})
    const fixture=sample.fixtures[entry.fixtureId]
    assert(fixture && fixture.businessId.startsWith('qa-'),'QA fixture required')
    new Intl.DateTimeFormat('en',{timeZone:fixture.timezone})
    if(fixture.identity) {validateDialogueIdentity(fixture.identity);assert.equal(fixture.identity.businessId,fixture.businessId,'identity tenant')}
    if(entry.initialState) assert(!previous && entry.contextMode==='isolated_adapted' &&
      !['businessId','engine','schemaVersion'].some(k=>Object.hasOwn(entry.initialState!,k)),'only explicit adapted initial context')
    assert(entry.expected && typeof entry.expected==='object','independent criteria required before traffic')
    const expectedKeys=['state','basketServiceIds','proposal','action','interpretationMode','replyIncludes','replyExcludes','introduced','maxCalls','copyMode','requiredServiceIds','timePreference']
    assert(Object.keys(entry.expected).every(k=>expectedKeys.includes(k)),'unknown expectation')
  }
}
export function verifyLiveSource(sample:LiveSample) {
  assert(sample.sourceCorpusPath && Array.isArray(sample.sourcePrivacyMessageIds),'pinned reviewed source required before traffic')
  const raw=readFileSync(sample.sourceCorpusPath,'utf8');assert(sha(raw)===sample.sourceCorpusSha256,'source corpus hash changed')
  const sources=raw.trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line)) as Array<{conversationId:string;messages:Array<{messageId:string;direction:string;body:string;createdAt:string;hasMedia?:boolean;isInteractiveReply?:boolean}>}>
  for(const entry of sample.entries) {
    const original=sources.find(c=>c.conversationId===entry.sourceConversationId)?.messages.find(m=>m.messageId===entry.sourceMessageId)
    assert(original && original.direction==='INBOUND' && original.createdAt===entry.createdAt && sha(original.body)===entry.sourceBodySha256 &&
      original.body===entry.body,'source input/hash differs; privacy edits require new reviewed manifest')
    assert(!!original.hasMedia===entry.sourceFlags.hasMedia && !!original.isInteractiveReply===entry.sourceFlags.isInteractiveReply &&
      sample.sourcePrivacyMessageIds.includes(entry.sourceMessageId)===entry.sourceFlags.privacyMarked,'source privacy flags differ')
  }
}
function projectKey() {
  // Read only this project credential, never process.env, other profiles or an ambient client.
  const raw=readFileSync(resolve(repoRoot,'.env'),'utf8')
  const matches=[...raw.matchAll(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/gm)]
  assert(matches.length===1,'one project OPENAI_API_KEY required')
  let value=matches[0]![1]!
  if(value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value=value.slice(1,-1)
  assert(value && value.length<=4096 && !/[\r\n]/.test(value),'valid project OPENAI_API_KEY required')
  return value
}
function score(entry:SampleEntry,state:DialogueState,diagnostics:InterpretationDiagnostics,reply:string,proposal:boolean) {
  const failed:string[]=[]
  for(const [key,value] of Object.entries(entry.expected.state??{})) if(!isDeepStrictEqual(state[key as keyof DialogueState],value)) failed.push('state.'+key)
  if(entry.expected.requiredServiceIds?.some(id=>!basketServiceIds(state).includes(id))) failed.push('requiredServiceIds')
  if(entry.expected.timePreference!==undefined && !isDeepStrictEqual(state.timePreference,entry.expected.timePreference)) failed.push('timePreference')
  if(entry.expected.basketServiceIds && !isDeepStrictEqual([...basketServiceIds(state)].sort(),[...entry.expected.basketServiceIds].sort())) failed.push('basketServiceIds')
  if(entry.expected.proposal!==undefined && entry.expected.proposal!==proposal) failed.push('proposal')
  if(entry.expected.action && entry.expected.action!==diagnostics.decision.acceptedAction) failed.push('action')
  if(diagnostics.mode!==(entry.expected.interpretationMode??'ai')) failed.push('interpretationMode')
  if(entry.expected.introduced!==undefined && !!state.introduced!==entry.expected.introduced) failed.push('introduced')
  if(entry.expected.copyMode!==undefined && entry.expected.copyMode!==diagnostics.copyMode) failed.push('copyMode')
  if(entry.expected.maxCalls!==undefined && (diagnostics.aiCalls??0)>entry.expected.maxCalls) failed.push('aiCalls')
  if(entry.expected.replyIncludes?.some(text=>!reply.includes(text))) failed.push('replyIncludes')
  if(entry.expected.replyExcludes?.some(text=>reply.includes(text))) failed.push('replyExcludes')
  return failed
}
export async function runLiveSample(sample:LiveSample,options:LiveOptions) {
  validateLiveSample(sample)
  assert(['controlled','openai_responses'].includes(options.mode),'invalid transport origin')
  assert(options.mode!=='controlled' || options.fetchImpl,'controlled runs require fake transport')
  assert(options.mode!=='openai_responses' || !options.fetchImpl && !options.fingerprint && options.timeoutMs===undefined,'real mode uses the fixed project transport/fingerprint')
  assert(options.maxEntries===undefined || Number.isInteger(options.maxEntries) && options.maxEntries>0 && options.maxEntries<=2101,'invalid sample budget')
  const journalPath=resolve(options.journalPath)
  if(options.mode==='openai_responses') assert(journalPath.startsWith(privateRoot+sep),'real journal must remain private in workspace')
  const fingerprint=options.fingerprint??liveRuntimeFingerprint, frozen=fingerprint(), digest=sha(JSON.stringify(sample))
  const prior:JournalRecord[]=existsSync(journalPath)?readFileSync(journalPath,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[]
  if(prior.length) {
    assert(options.resume===true,'explicit resume required; never replay completed inputs automatically')
    assert(prior[0]!.manifestSha256===digest && prior[0]!.runtimeFingerprint===frozen && prior[0]!.mode===options.mode,'manifest/runtime fingerprint changed')
    const terminal=new Set(prior.filter(r=>['completed','skipped'].includes(r.event)).map(r=>String(r.key)))
    assert(!prior.some(r=>r.event==='started'&&!terminal.has(String(r.key))),'previous in-flight entry blocks resend; resolve manually')
  }
  mkdirSync(dirname(journalPath),{recursive:true})
  const lockPath=journalPath+'.lock',lock=openSync(lockPath,'wx')
  const records=[...prior]
  const append=(record:JournalRecord)=>{
    const fd=openSync(journalPath,'a')
    try {writeSync(fd,JSON.stringify(record)+'\n',undefined,'utf8');fsyncSync(fd)} finally {closeSync(fd)}
    records.push(record)
  }
  const checkFrozen=()=>assert(fingerprint()===frozen && sha(JSON.stringify(sample))===digest,'runtime/manifest fingerprint changed; stop before another request')
  try {
    if(!prior.length) append({event:'header',manifestSha256:digest,runtimeFingerprint:frozen,mode:options.mode,
      model:'gpt-6-luna',endpoint,store:false,fixtureVersion:sample.fixtureVersion,createdAt:new Date().toISOString()})
    const states=new Map<string,DialogueState>(), incomplete=new Set<string>()
    const completed=new Map(prior.filter(r=>r.event==='completed').map(r=>[String(r.key),r.turn as TurnRecord]))
    const skipped=new Set(prior.filter(r=>r.event==='skipped').map(r=>String(r.key)))
    if(options.mode==='openai_responses') verifyLiveSource(sample)
    const apiKey=options.mode==='controlled'?'offline-test-key':projectKey()
    let remaining=options.maxEntries??sample.entries.length
    for(const entry of sample.entries) {
      const key=keyOf(entry),fixture=sample.fixtures[entry.fixtureId]!
      if(completed.has(key)) {states.set(entry.episodeId,completed.get(key)!.stateAfter);if(completed.get(key)!.contextIncomplete)incomplete.add(entry.episodeId);continue}
      if(skipped.has(key)) {incomplete.add(entry.episodeId);continue}
      if(remaining<=0)break
      checkFrozen()
      const reasons=privacyReasons(entry)
      if(reasons.length) {append({event:'skipped',key,episodeId:entry.episodeId,reasons});incomplete.add(entry.episodeId);continue}
      const state=states.get(entry.episodeId)??parseDialogueState({...initialDialogueState(fixture.businessId),...entry.initialState},fixture.businessId,fixture.timezone)
      append({event:'started',key,episodeId:entry.episodeId,sourceBodySha256:entry.sourceBodySha256,transmittedBodySha256:sha(entry.body),
        stateBefore:state,createdAt:entry.createdAt,contextMode:entry.contextMode})
      const phases=new Set<string>();let guardFailed=false,activeRequests=0
      const guardedFetch:typeof fetch=async(url,init)=>{
        activeRequests++
        try {
          checkFrozen();assert.equal(String(url),endpoint,'only approved Responses endpoint');assert.equal(init?.method,'POST','only approved POST')
          assert(typeof init?.body==='string','JSON body required')
          const body=JSON.parse(init.body) as Record<string,unknown>,input=JSON.parse(String(body.input)) as Record<string,unknown>
          assert(body.model==='gpt-6-luna' && body.store===false && (body.reasoning as {effort?:string})?.effort==='none','approved model/store/reasoning')
          assert(!['oracle','expected','history','messages','previous_response_id','conversation','tools'].some(k=>Object.hasOwn(body,k)||Object.hasOwn(input,k)),'unapproved oracle/history/continuation')
          assert(input.message===entry.body,'only the reviewed current input')
          assert(!privacyReasons(entry).length,'privacy guard')
          const phase=(body.text as {format?:{name?:string}})?.format?.name
          assert(phase==='conversational_turn_interpretation'||phase==='grounded_qa_reply','approved request phase')
          assert(!phases.has(phase),'no retry of request phase');phases.add(phase)
          const requestHash=sha(init.body)
          append({event:'request_started',key,phase,requestHash,at:new Date().toISOString()})
          let response:Response
          try {response=await(options.fetchImpl??fetch)(endpoint,{...init,redirect:'error'})}
          catch {append({event:'request_done',key,phase,requestHash,httpStatus:null,requestId:null,usage:null,outcome:'transport_error_usage_unknown'});throw new Error('approved transport failed')}
          let usage:Record<string,unknown>|null=null
          try {const data=await response.clone().json() as {usage?:Record<string,unknown>};usage=data.usage??null}catch {}
          append({event:'request_done',key,phase,requestHash,httpStatus:response.status,requestId:response.headers.get('x-request-id'),
            usage,outcome:response.ok?'http_ok':'http_error'})
          checkFrozen()
          return response
        } catch(error) {if(error instanceof Error && /approved transport failed/.test(error.message))throw error;guardFailed=true;throw new Error('request guard/fingerprint failed')} finally {activeRequests--}
      }
      const interpret=createOpenAiInterpretationProvider({apiKey,model:'gpt-6-luna',fetchImpl:guardedFetch})
      const provider:AiInterpretationProvider=Object.assign(async(input:AiInterpretationInput,signal:AbortSignal)=>{
        const candidate=await interpret(input,signal);append({event:'interpreted',key,candidate});return candidate
      },
        {respond:createOpenAiResponseProvider({apiKey,model:'gpt-6-luna',fetchImpl:guardedFetch})})
      const port={...fixturePort(fixture),...(fixture.identity?{identity:async()=>structuredClone(fixture.identity!)}:{})}
      const response=await respondWithAiInterpreter({businessId:fixture.businessId,timezone:fixture.timezone,dbNow:new Date(entry.createdAt)},
        state,entry.body,port,provider,options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})
      // Interpreter fallback must never hide a fatal request/fingerprint guard as a successfully completed turn.
      assert(activeRequests===0,'request still in-flight; no resend')
      assert(!guardFailed,'request guard/fingerprint stopped this entry; no resend')
      checkFrozen()
      const failures=score(entry,response.state,response.interpretation,response.reply,response.proposal!==null)
      const turn:TurnRecord={key,episodeId:entry.episodeId,sourceConversationId:entry.sourceConversationId,sourceMessageId:entry.sourceMessageId,
        category:entry.category,contextMode:entry.contextMode,fixtureGap:entry.fixtureGap??null,contextIncomplete:incomplete.has(entry.episodeId),
        counterfactualContinuation:!!entry.counterfactualContinuation,manualReviewPending:entry.manualReviewPending??[],stateAfter:response.state,diagnostics:response.interpretation,reply:response.reply,failures,
        evaluation:entry.fixtureGap?'fixture_gap':incomplete.has(entry.episodeId)?'context_incomplete':response.interpretation.mode==='fallback'?'fallback':
          !Object.keys(entry.expected).length?'no_scored':failures.length?'failed':'criteria_met'}
      append({event:'completed',key,turn});states.set(entry.episodeId,response.state);remaining--
    }
    const turns=records.filter(r=>r.event==='completed').map(r=>r.turn as TurnRecord)
    const requests=records.filter(r=>r.event==='request_done').map(r=>r as unknown as RequestRecord)
    const usage={inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningTokens:0,unknownRequests:0}
    const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0?Number(x):0
    for(const request of requests) {
      if(!request.usage){usage.unknownRequests++;continue}
      usage.inputTokens+=count(request.usage.input_tokens);usage.outputTokens+=count(request.usage.output_tokens)
      usage.cachedInputTokens+=count((request.usage.input_tokens_details as {cached_tokens?:unknown})?.cached_tokens)
      usage.reasoningTokens+=count((request.usage.output_tokens_details as {reasoning_tokens?:unknown})?.reasoning_tokens)
    }
    return {mode:options.mode,comprehensionEvaluated:options.mode==='openai_responses'&&turns.some(t=>t.diagnostics.mode==='ai'),
      runtimeFingerprint:frozen,manifestSha256:digest,limits:sample.limits,fixtureVersion:sample.fixtureVersion,
      counts:{planned:sample.entries.length,completed:turns.length,skipped:records.filter(r=>r.event==='skipped').length,
        passed:turns.filter(t=>t.evaluation==='criteria_met').length,failed:turns.filter(t=>t.evaluation==='failed').length,
        fallback:turns.filter(t=>t.diagnostics.mode==='fallback').length,fixtureGap:turns.filter(t=>t.evaluation==='fixture_gap').length,
        contextIncomplete:turns.filter(t=>t.evaluation==='context_incomplete').length,noScored:turns.filter(t=>t.evaluation==='no_scored').length,
        fallbackVerdicts:turns.filter(t=>t.evaluation==='fallback').length,requests:requests.length},usage,turns,requests}
  } finally {closeSync(lock);unlinkSync(lockPath)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [action,samplePath,journalPath]=process.argv.slice(2)
  assert(samplePath,'Usage: tsx scripts/glow-corpus-live.ts --validate|--execute|--resume sample.json private-journal.jsonl')
  const sample=JSON.parse(readFileSync(samplePath,'utf8')) as LiveSample
  validateLiveSample(sample)
  if(action==='--validate' && sample.sourceCorpusPath)verifyLiveSource(sample)
  if(action==='--validate')console.log(JSON.stringify({entries:sample.entries.length,privacySkipped:sample.entries.filter(e=>privacyReasons(e).length).length,
    manifestSha256:sha(JSON.stringify(sample)),fixtureVersion:sample.fixtureVersion,networkExecuted:false}))
  else {
    assert((action==='--execute'||action==='--resume')&&journalPath,'explicit execution required')
    const report=await runLiveSample(sample,{mode:'openai_responses',journalPath,...(action==='--resume'?{resume:true}:{})})
    console.log(JSON.stringify({mode:report.mode,counts:report.counts,usage:report.usage,manifestSha256:report.manifestSha256,
      comprehensionEvaluated:report.comprehensionEvaluated}))
  }
}
