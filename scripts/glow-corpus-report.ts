import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type JsonObject=Record<string,unknown>
export type ReportSnapshot={id:string;manifest:unknown;coverage:unknown;journalText:string;runtimeFingerprint:string;
  paths?:{manifest:string;coverage:string;journal:string};rawHashes?:{manifest:string;coverage:string}}
type IntegrityIssue={code:string;key:string|null}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex')
const object=(value:unknown):JsonObject=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value),'expected report object')
  return value as JsonObject
}
const optionalObject=(value:unknown):JsonObject=>value==null?{}:object(value)
const list=(value:unknown):unknown[]=>{if(value===undefined)return[];assert(Array.isArray(value),'expected report array');return value}
const text=(value:unknown):string=>{assert(typeof value==='string','expected report string');return value}
const field=(value:unknown):string|null=>typeof value==='string'?value:null
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const tokens=(value:unknown):number|null=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null
const histogram=(values:Array<string|null>)=>values.reduce<Record<string,number>>((result,value)=>{
  const key=value??'unknown';result[key]=(result[key]??0)+1;return result
},{})
function latency(values:unknown[]) {
  const valid=values.flatMap(value=>number(value)===null?[]:[number(value)!]).sort((a,b)=>a-b)
  const percentile=(p:number)=>valid[Math.max(0,Math.ceil(valid.length*p)-1)]??null
  return {count:valid.length,unknown:values.length-valid.length,total:valid.reduce((sum,value)=>sum+value,0),
    min:valid[0]??null,max:valid.at(-1)??null,p50:percentile(.5),p95:percentile(.95)}
}
function summarizeObserved(turn:JsonObject,candidate:JsonObject) {
  const state=optionalObject(turn.stateAfter),diagnostics=optionalObject(turn.diagnostics),decision=optionalObject(diagnostics.decision)
  const request=optionalObject(state.serviceRequest),focus=optionalObject(state.informationFocus)
  const professional=optionalObject(typeof state.professional==='object'?state.professional:null),preference=optionalObject(state.timePreference)
  return {intent:field(candidate.intent),candidateOperationKinds:list(optionalObject(candidate.turnPlan).operations).map(op=>field(object(op).kind)),
    acceptedOperationKinds:list(optionalObject(optionalObject(diagnostics.validation).turnPlan).validationAcceptedKinds).map(field),
    action:field(decision.acceptedAction),interpretationMode:field(diagnostics.mode),copyMode:field(diagnostics.copyMode),copyReason:field(diagnostics.copyReason),
    callRoute:field(diagnostics.replyRoute),deliveryOrigin:field(diagnostics.deliveryOrigin),aiCalls:number(diagnostics.aiCalls),
    state:{pending:field(state.pending),serviceId:field(state.serviceId),date:field(state.date),requestedTime:field(state.requestedTime),
      professionalId:field(professional.id)??field(state.professional)??field(state.professionalId),
      timePreference:state.timePreference?{kind:field(preference.kind),anchor:field(preference.anchor),time:field(preference.time),
        band:field(preference.band),start:field(preference.start),end:field(preference.end)}:null,customerNamePresent:!!state.customerName,
      basket:list(optionalObject(state.basket).members).map(value=>{const member=object(value);return{mode:field(member.mode),serviceIds:list(member.serviceIds).map(text)}}),
      serviceRequest:state.serviceRequest?{purpose:field(request.purpose),disposition:field(request.disposition),serviceIds:list(request.serviceIds).map(text)}:null,
      informationFocus:state.informationFocus?{topic:field(focus.topic),aspect:field(focus.aspect),serviceId:field(focus.serviceId)}:null}}
}
function buildRun(input:ReportSnapshot) {
  const manifest=object(input.manifest),coverage=object(input.coverage),entries=list(manifest.entries).map(object)
  assert(manifest.schemaVersion===1&&entries.length>0,'manifest schema required')
  const manifestHash=sha(JSON.stringify(input.manifest))
  assert(!coverage.manifestLogicalSha256||coverage.manifestLogicalSha256===manifestHash,'coverage manifest hash differs')
  if(input.rawHashes&&coverage.manifestRawSha256)assert.equal(coverage.manifestRawSha256,input.rawHashes.manifest,'raw manifest hash differs')
  const coverageSource=optionalObject(coverage.sources).sourceCorpusSha256
  assert(!coverageSource||coverageSource===manifest.sourceCorpusSha256,'coverage source hash differs')
  const truncatedTail=!!input.journalText&&!input.journalText.endsWith('\n')
  const prefix=truncatedTail?input.journalText.slice(0,input.journalText.lastIndexOf('\n')+1):input.journalText
  const records=prefix.split(/\r?\n/).filter(line=>line.trim()).map(line=>object(JSON.parse(line)))
  const header=records[0];assert(header?.event==='header','snapshot header required')
  assert.equal(header.manifestSha256,manifestHash,'journal manifest hash differs')
  assert.equal(header.runtimeFingerprint,input.runtimeFingerprint,'runtime fingerprint differs')
  assert(['controlled','openai_responses'].includes(text(header.mode))&&header.model==='gpt-6-luna'&&header.store===false,'approved transport header required')
  if(header.mode==='openai_responses')assert.equal(header.endpoint,'https://api.openai.com/v1/responses','journal endpoint differs')
  const integrityIssues:IntegrityIssue[]=[]
  const issue=(code:string,key:string|null=null)=>integrityIssues.push({code,key})
  const entryKeys=entries.map(entry=>text(entry.sourceConversationId)+'/'+text(entry.sourceMessageId))
  assert(new Set(entryKeys).size===entries.length,'duplicate manifest source')
  const entryByKey=new Map(entries.map((entry,index)=>[entryKeys[index]!,entry]))
  for(const entry of entries)if(entry.transmittedBodySha256!==undefined)assert.equal(entry.transmittedBodySha256,sha(text(entry.body)),'transmitted body hash differs')
  const selected=new Set(entryKeys),byKey=new Map<string,JsonObject[]>(),eventIds=new Set<string>()
  const omitted=list(coverage.omitted).map(object)
  const previous=new Set(omitted.filter(row=>text(row.reason).startsWith('previous')).map(row=>text(row.key)))
  for(const [index,record] of records.entries()) {
    if(index===0)continue
    if(record.event==='header'){issue('duplicate_header');continue}
    const key=text(record.key),event=text(record.event)
    if(!selected.has(key))issue('unexpected_source',key)
    if(event==='started'&&previous.has(key))issue('prior_source_reused',key)
    const entry=entryByKey.get(key)
    if(event==='started'&&entry?.sourceBodySha256!==undefined&&record.sourceBodySha256!==entry.sourceBodySha256)issue('started_source_hash_differs',key)
    if(event==='started'&&entry?.transmittedBodySha256!==undefined&&record.transmittedBodySha256!==entry.transmittedBodySha256)issue('started_transmitted_hash_differs',key)
    if(!['started','completed','skipped','local_error','interpreted','request_started','request_done'].includes(event))issue('unknown_event',key)
    const identity=event+'/'+key+(event.startsWith('request_')?'/'+text(record.phase):'')
    if(eventIds.has(identity))issue('duplicate_event',key);eventIds.add(identity)
    byKey.set(key,[...(byKey.get(key)??[]),record])
    if(event==='completed') {
      const turn=object(record.turn)
      if(turn.evaluation==='criteria_met'&&entry&&!Object.keys(optionalObject(entry.expected)).length)issue('runner_pass_without_typed_criteria',key)
      if(text(turn.sourceConversationId)+'/'+text(turn.sourceMessageId)!==key)issue('completed_source_mismatch',key)
      const state=optionalObject(turn.stateAfter)
      if(!field(state.businessId)?.startsWith('qa-'))issue('non_qa_state',key)
    }
  }
  const observations=entries.map((entry,index)=>{
    const key=entryKeys[index]!,events=byKey.get(key)??[],terminals=events.filter(event=>['completed','skipped','local_error'].includes(text(event.event)))
    if(terminals.length>1)issue('multiple_terminals',key)
    const terminal=terminals[0],started=events.some(event=>event.event==='started')
    if(terminal?.event!=='skipped'&&terminal&&!started)issue('terminal_without_start',key)
    const status=terminal?text(terminal.event):started?'incomplete':'pending'
    const turn=terminal?.event==='completed'?object(terminal.turn):null
    const capture=events.find(event=>event.event==='interpreted'),candidate=optionalObject(capture?.candidate)
    return {key,conversationId:text(entry.sourceConversationId),episodeId:field(entry.episodeId),status,
      contextIncomplete:turn?!!turn.contextIncomplete:terminal?.event==='local_error'||list(terminal?.reasons).includes('historical_context_unbound')?true:null,counterfactualContinuation:!!entry.counterfactualContinuation,
      fixtureGap:field(turn?.fixtureGap)??field(entry.fixtureGap),skipReasons:list(terminal?.reasons).map(text),
      localError:terminal?.event==='local_error'?{code:field(terminal.errorCode),stage:field(terminal.stage)}:null,
      capturedCandidate:capture?{intent:field(candidate.intent),operationKinds:list(optionalObject(candidate.turnPlan).operations).map(op=>field(object(op).kind))}:null,
      observed:turn?summarizeObserved(turn,candidate):null,
      evidence:{started:started,candidateCaptured:events.some(event=>event.event==='interpreted'),completedEventIndex:turn?records.indexOf(terminal!):null}}
  })
  const requestsStarted=records.filter(row=>row.event==='request_started'),requestsDone=records.filter(row=>row.event==='request_done')
  const requestId=(row:JsonObject)=>text(row.key)+'/'+text(row.phase)+'/'+text(row.requestHash)
  const startedIds=new Set(requestsStarted.map(requestId)),doneIds=new Set(requestsDone.map(requestId))
  const pendingRequests=requestsStarted.filter(row=>!doneIds.has(requestId(row))).length
  for(const row of requestsDone)if(!startedIds.has(requestId(row)))issue('request_done_without_start',text(row.key))
  const usage={inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningTokens:0,knownRequests:0,unknownRequests:pendingRequests,
    cachedUnknownRequests:0,reasoningUnknownRequests:0,recordedDoneTotalsOnly:true}
  for(const row of requestsDone) {
    const raw=optionalObject(row.usage),inputTokens=tokens(raw.input_tokens),outputTokens=tokens(raw.output_tokens)
    if(inputTokens===null||outputTokens===null){usage.unknownRequests++;continue}
    usage.knownRequests++;usage.inputTokens+=inputTokens;usage.outputTokens+=outputTokens
    const cached=tokens(optionalObject(raw.input_tokens_details).cached_tokens),reasoning=tokens(optionalObject(raw.output_tokens_details).reasoning_tokens)
    if(cached===null)usage.cachedUnknownRequests++;else usage.cachedInputTokens+=cached
    if(reasoning===null)usage.reasoningUnknownRequests++;else usage.reasoningTokens+=reasoning
  }
  const diagnostics=records.filter(row=>row.event==='completed').map(row=>optionalObject(object(row.turn).diagnostics))
  const counts={planned:entries.length,started:records.filter(row=>row.event==='started').length,
    completed:observations.filter(row=>row.status==='completed').length,completedEvents:diagnostics.length,
    skipped:observations.filter(row=>row.status==='skipped').length,localErrors:observations.filter(row=>row.status==='local_error').length,
    incompleteAttempts:observations.filter(row=>row.status==='incomplete').length,pending:observations.filter(row=>row.status==='pending').length,
    contextIncomplete:observations.filter(row=>row.contextIncomplete===true).length,contextUnknown:observations.filter(row=>row.contextIncomplete===null).length,fixtureGaps:observations.filter(row=>row.fixtureGap).length,
    typedExpectations:entries.filter(row=>Object.keys(optionalObject(row.expected)).length).length}
  const reviewRows=list(coverage.entryReviews).map(object),definitions=new Map(list(coverage.independentCriteria).map(object).map(row=>[text(row.id),row]))
  const criteria=reviewRows.filter(row=>list(row.independentCriterionRefs).length).map(row=>{
    const key=text(row.key),observation=observations.find(o=>o.key===key)
    if(!observation)issue('criterion_source_not_selected',key)
    const status=observation&&['skipped','local_error','incomplete'].includes(observation.status)?'no_evaluable':'pending_manual'
    return {key,status,reasons:observation?[...(observation.skipReasons),...(observation.fixtureGap?['fixture_gap_requires_partial_review']:[]),
      ...(observation.contextIncomplete?['context_gap_preserve_independent_fields']:[]),...(observation.status==='pending'?['not_yet_observed']:[])]:['source_not_selected'],
      expected:list(row.independentCriterionRefs).map(ref=>{const id=text(ref),definition=definitions.get(id);if(!definition)issue('missing_independent_criterion',key)
        return{id,expectedAction:field(definition?.expectedAction)}}),observed:observation?.observed??null,
      observationStatus:observation?.status??'missing',manualVerdict:null}
  })
  const declared=optionalObject(coverage.counts)
  if(number(declared.entriesWithIndependentPartialRefs)!==null&&declared.entriesWithIndependentPartialRefs!==criteria.length)issue('criterion_count_differs')
  const conversations=[...new Set(observations.map(row=>row.conversationId))].map(conversationId=>{
    const rows=observations.filter(row=>row.conversationId===conversationId)
    return{conversationId,planned:rows.length,statuses:histogram(rows.map(row=>row.status)),contextGaps:rows.filter(row=>row.contextIncomplete).length,
      fixtureGaps:rows.filter(row=>row.fixtureGap).length,fullHistoricalReplayGuaranteed:false}
  })
  return {id:input.id,transportOrigin:field(header.mode),runtimeFingerprint:input.runtimeFingerprint,manifestSha256:manifestHash,
    sourceCorpusSha256:field(manifest.sourceCorpusSha256),fixtureVersion:field(manifest.fixtureVersion),paths:input.paths??null,
    inputHashes:input.rawHashes??null,coverageDeclaredCounts:declared,
    snapshot:{sha256:sha(input.journalText),byteLength:Buffer.byteLength(input.journalText),parsedPrefixSha256:sha(prefix),parsedPrefixBytes:Buffer.byteLength(prefix),truncatedTail},
    executionFinished:!truncatedTail&&!integrityIssues.length&&!counts.pending&&!counts.incompleteAttempts&&!pendingRequests,
    counts,requests:{started:requestsStarted.length,done:requestsDone.length,pending:pendingRequests,phases:histogram(requestsStarted.map(row=>field(row.phase)))},usage,
    candidateIntents:histogram(observations.filter(row=>row.capturedCandidate).map(row=>row.capturedCandidate!.intent)),
    candidateOperationKinds:histogram(observations.flatMap(row=>row.capturedCandidate?.operationKinds??[])),
    acceptedActions:histogram(diagnostics.map(row=>field(optionalObject(row.decision).acceptedAction))),
    interpretationModes:histogram(diagnostics.map(row=>field(row.mode))),copyModes:histogram(diagnostics.map(row=>field(row.copyMode))),
    callRoutes:histogram(diagnostics.map(row=>field(row.replyRoute))),callCounts:histogram(diagnostics.map(row=>number(row.aiCalls)?.toString()??null)),
    runnerVerdictsNotIndependentScores:histogram(records.filter(row=>row.event==='completed').map(row=>field(object(row.turn).evaluation))),
    latencies:Object.fromEntries(['providerMs','validationMs','engineMs','responseMs','totalMs'].map(key=>[key,latency(diagnostics.map(row=>row[key]))])) as Record<'providerMs'|'validationMs'|'engineMs'|'responseMs'|'totalMs',ReturnType<typeof latency>>,
    observations,conversations,criteria,integrityIssues}
}
export function buildCorpusReport(inputs:ReportSnapshot[]) {
  assert(inputs.length>0&&new Set(inputs.map(input=>input.id)).size===inputs.length,'unique runs required')
  const runs=inputs.map(buildRun),integrityIssues:Array<IntegrityIssue&{runId:string}>=runs.flatMap(run=>run.integrityIssues.map(issue=>({runId:run.id,...issue})))
  const seenAttempts=new Set<string>(),seenSkipped=new Set<string>()
  for(const run of runs)for(const observation of run.observations) {
    if(observation.evidence.started) {
      if(seenAttempts.has(observation.key)||seenSkipped.has(observation.key))integrityIssues.push({runId:run.id,code:'source_reused_across_runs',key:observation.key})
      seenAttempts.add(observation.key)
    }
    if(observation.status==='skipped')seenSkipped.add(observation.key)
  }
  const conversationIds=[...new Set(runs.flatMap(run=>run.conversations.map(row=>row.conversationId)))]
  const conversations=conversationIds.map(conversationId=>({conversationId,
    distinctPlannedSourceKeys:new Set(runs.flatMap(run=>run.observations.filter(row=>row.conversationId===conversationId).map(row=>row.key))).size,
    runs:runs.flatMap(run=>run.conversations.filter(row=>row.conversationId===conversationId).map(row=>({runId:run.id,...row}))),
    stateAcrossVersions:'not_merged_or_bootstrapped',fullHistoricalReplayGuaranteed:false}))
  return {schemaVersion:1,purpose:'immutable-journal-observations-and-independent-manual-criteria',
    limitations:['Execution is not a PASS score; no accuracy or training is inferred.','Holdout was reserved after corpus review, not blind.',
      'Versions and gaps remain separate; incomplete attempts are never retried by this report.','Raw bodies, model replies, names and evidence are not copied into this report.',
      'Duplicate journal records invalidate terminal completeness; recorded usage totals are not a deduplicated billing claim.'],
    runtimeVersions:[...new Set(runs.map(run=>run.runtimeFingerprint))],allRunSnapshotsTerminal:runs.every(run=>run.executionFinished)&&!integrityIssues.length,
    lastRunSnapshotTerminal:runs.at(-1)!.executionFinished,uniqueStartedSourceKeys:seenAttempts.size,integrityIssues,runs,conversations}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [action,manifestPath,coveragePath,journalPath,outputPath,fingerprint,...additional]=process.argv.slice(2)
  assert(action==='--snapshot'&&manifestPath&&coveragePath&&journalPath&&outputPath&&fingerprint&&additional.length%4===0,
    'Usage: report --snapshot manifest coverage journal NEW-output runtime-fingerprint [manifest coverage journal runtime-fingerprint ...]')
  const tuples=[[manifestPath,coveragePath,journalPath,fingerprint],...Array.from({length:additional.length/4},(_,index)=>additional.slice(index*4,index*4+4))]
  const output=resolve(outputPath),repo=fileURLToPath(new URL('../',import.meta.url))
  assert([resolve(repo,'tmp/e223-corpus-replay/private'),resolve(repo,'tmp/glow-corpus-report-test')].some(root=>output.startsWith(root+sep)),'report output must remain private')
  const inputs=tuples.map((tuple,index)=>{
    const [mp,cp,jp,fp]=tuple.map(value=>text(value)),paths={manifest:resolve(mp!),coverage:resolve(cp!),journal:resolve(jp!)}
    assert(!Object.values(paths).includes(output),'never write an input file')
    const manifestRaw=readFileSync(paths.manifest,'utf8'),coverageRaw=readFileSync(paths.coverage,'utf8')
    return{id:'run-'+(index+1),manifest:JSON.parse(manifestRaw),coverage:JSON.parse(coverageRaw),journalText:readFileSync(paths.journal,'utf8'),
      runtimeFingerprint:fp!,paths,rawHashes:{manifest:sha(manifestRaw),coverage:sha(coverageRaw)}}
  })
  const report=buildCorpusReport(inputs),serialized=JSON.stringify(report,null,2)+'\n'
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,serialized,{encoding:'utf8',flag:'wx'})
  console.log(JSON.stringify({output,sha256:sha(serialized),runs:report.runs.map(run=>({id:run.id,counts:run.counts,executionFinished:run.executionFinished})),networkExecuted:false}))
}