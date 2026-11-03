import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
process.env.DOTENV_CONFIG_PATH = '__instagram_ui_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { instagramMediaScript } = await import('../src/routes/crm-ui/instagram-media.js')
const { instagramPlanningScript } = await import('../src/routes/crm-ui/instagram-planning.js')
const { instagramStoriesScript } = await import('../src/routes/crm-ui/instagram-stories.js')
const { default: sharp } = await import('sharp')
const jpeg = await sharp({create:{width:180,height:320,channels:3,background:'#315c83'}}).jpeg().toBuffer()
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const output = process.argv[2]
assert.ok(output, 'Provide an explicit neutral fixture output directory')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((script) => script.includes('function loadInstagramReels('))!
function fn(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(inline)
  assert.ok(match)
  return inline.slice(match.index, inline.indexOf('\n    }', match.index) + 6)
}
const start = html.indexOf('<div class="instagram-reels-manager"')
const end = html.indexOf('\n      </div>\n    </section>', start)
assert.ok(start >= 0 && end > start)
const panel = html.slice(start, end).replace('id="instagram-reels-manager" hidden', 'id="instagram-reels-manager"')
  .replace(/(<label\b[^>]*>[^<]*<input\b[^>]*id="instagram-story-file"[^>]*><\/label>)/, '$1<button id="qa-photo" type="button">QA: preparar foto JPEG ficticia</button>')
const dialog = html.slice(html.indexOf('<div class="dialog-backdrop" id="instagram-reel-dialog"'), html.indexOf('<div class="dialog-backdrop" id="quick-replies-admin"'))
  .replace(/(<label\b[^>]*>[^<]*<input\b[^>]*id="instagram-reel-video"[^>]*><\/label>)/, '$1<button id="qa-video" type="button">QA: preparar video ficticio</button>')
assert.ok(panel.includes('id="qa-photo"') && dialog.includes('id="qa-video"'), 'Neutral file helpers must remain beside their own file fields')
const editorBindings = inline.slice(inline.indexOf("    els.instagramReelNew.addEventListener"),inline.indexOf("    els.marketingMainTabs.addEventListener",inline.indexOf("    els.instagramReelNew.addEventListener")))
const code = ['escapeHtml', 'getJson', 'setButtonLoading', 'instagramReelStatusMeta', 'renderInstagramReels', 'loadInstagramReels', 'refreshInstagramPublication', 'normalizeInstagramReelKeyword', 'setSection', 'setMarketingView',
  'submitInstagramReel','instagramReelMimeType','setInstagramReelFeedback','setInstagramReelProgress','resetInstagramReelForm','openInstagramReelDialog','closeInstagramReelDialog',
  'renderInstagramReelReview','renderInstagramReelKeywords','addInstagramReelKeyword','readInstagramReelVideo','uploadInstagramReelFile'].map(fn).join('\n') + '\n' + instagramMediaScript + '\n' + instagramPlanningScript + '\n' + instagramStoriesScript
const fixture = String.raw`
const qaJpegBase64 = '__QA_REAL_JPEG__';
const storyRows = [];
let storyDeclared = false;
const state = { businessId: 'qa-business', business:{timezone:'America/New_York'}, marketingView: 'instagram-reels', instagramReels: [], instagramReelsLoaded: false, instagramMedia: null, instagramMediaGeneration: 0, instagramReelKeywords:[],instagramReelPreviewUrl:null };
const els = new Proxy({ appShell: document.getElementById('qa-shell'), instagramReelsManager: document.getElementById('instagram-reels-manager'), instagramReelsTableBody: document.getElementById('instagram-reels-table-body'), instagramReelsFeedback: document.getElementById('instagram-reels-feedback'),instagramReelProgress:document.querySelector('#instagram-reel-progress span') },{get(target,key){return target[key]??=document.getElementById(String(key).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()))||document.createElement('div')}});
const staffVisibleSections=()=>['campaigns','cash','accounts'];const isWorkshopBusiness=()=>false;const staffSettlementsLabel=()=>'Liquidaciones';const stopAgendaNowLineTimer=()=>{};const closeMobileDrawer=()=>{};const loadCashRegister=async()=>{};const loadManagedAccounts=async()=>{};const renderManagedAccountsLoadError=()=>{};
state.templatesLoaded=true;state.campaignsLoaded=true;
const buildGetJsonRequestOptions = value => value;
const requests = [];
const local = [{id:'imported-local',caption:'Reel ya importado',status:'PUBLISHED',videoAvailable:false},{id:'draft-local',caption:'Corte en preparación',status:'DRAFT',videoAvailable:true},{id:'queued-local',caption:'Color en cola',status:'READY',videoAvailable:true},{id:'published-local',caption:'Publicado desde el CRM, aún no importado',status:'PUBLISHED',videoAvailable:false}];
for(const row of local)Object.assign(row,{businessId:'qa-business',revision:0,shareToFeed:true,automation:{enabled:false,keywords:[],privateReplyEnabled:true,privateReplyText:'',publicReplyEnabled:false,publicReplyText:''}});
local.push({id:'scheduled-local',businessId:'qa-business',revision:1,caption:'Reel programado para revisar horario',status:'SCHEDULED',videoAvailable:true,shareToFeed:true,automation:{enabled:false,keywords:[],privateReplyEnabled:true,privateReplyText:'',publicReplyEnabled:false,publicReplyText:''}});
const metrics = (reach, views, status='complete') => ({latestMetrics:{values:{reach,views,likes:reach===null?null:20,comments:reach===null?null:2,shares:reach===null?null:1,saved:reach===null?null:0,total_interactions:reach===null?null:23},observedAtByMetric:{reach:'2026-10-24T10:00:00Z',views:'2026-10-24T10:00:00Z',likes:'2026-10-25T11:00:00Z',comments:'2026-10-25T11:00:00Z',shares:'2026-10-25T11:00:00Z',saved:'2026-10-25T11:00:00Z',total_interactions:'2026-10-25T11:00:00Z'}},insightsStatus:status,lastInsightAttemptAt:'2026-10-25T12:00:00Z'});
const fixtureRows = [{id:'qa-media-1',caption:'Transformación de color · técnica y cuidado',publishedAt:'2026-10-01T12:00:00Z',permalink:'https://www.instagram.com/reel/fixture/',...metrics(987,1234,'partial')},{id:'qa-media-2',caption:'Corte clásico: lectura con cero vistas',publishedAt:'2026-10-02T12:00:00Z',...metrics(0,0)},{id:'qa-media-3',caption:'Reel sin métricas disponibles',publishedAt:'2026-10-03T12:00:00Z',...metrics(null,null,'unavailable')}];
const opaque = '12345678-1234-4234-8234-123456789abc';
const stages = new Map();
const configurations = new Map();
let deferred = null;
const qa = window.__qa = { state, els, requests, mode:'normal', automationMode:'legacy', editorFailure:'', defer:'', accountId:'qa-account', failed:false,
  async scenario(mode) { this.mode=mode; this.failed=false; return loadInstagramReels(); },
  release() { const pending=deferred; deferred=null; if(pending) pending.resolve(new Response(JSON.stringify(pending.body),{status:pending.status})); },
  async business(id,accountId) { state.businessId=id; this.accountId=accountId; resetInstagramMediaState(); state.instagramReels=[]; state.instagramReelsLoaded=false; return loadInstagramReels(); },
  section(name) { setSection(name); },
  tab(view) { setMarketingView(view); },
  automationGeometry() {
    const minimum=innerWidth<=720?44:38;
    const targets=[...document.querySelectorAll('[data-instagram-automation],.instagram-automation-check')].filter(element=>element.getClientRects().length).map(element=>({height:element.getBoundingClientRect().height,label:element.textContent.trim()}));
    const checks=[...document.querySelectorAll('.instagram-automation-check')].filter(element=>element.getClientRects().length).map(label=>{const input=label.querySelector('input');const text=[...label.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());const range=document.createRange();range.selectNodeContents(text);return{inputWidth:input.getBoundingClientRect().width,textRight:range.getBoundingClientRect().right,labelRight:label.getBoundingClientRect().right}});
    if(document.documentElement.scrollWidth>innerWidth+1||targets.some(target=>target.height<minimum)||checks.some(check=>check.inputWidth>20||check.textRight>check.labelRight+1))throw new Error('Automation controls overflow or miss target geometry: '+JSON.stringify({minimum,targets,checks}));
    return{minimum,targets,checks,documentWidth:document.documentElement.scrollWidth};
  },
  historyTarget() {
    const minimum=innerWidth<=720?44:38;
    const buttons=[...document.querySelectorAll('#instagram-media-body [data-instagram-media-history]')];
    if(!buttons.length) throw new Error('Expected rendered history controls');
    const measurements=buttons.map(button=>({height:button.getBoundingClientRect().height,minHeight:getComputedStyle(button).minHeight}));
    if(measurements.some(button=>button.height<minimum)) throw new Error('History target below '+minimum+'px: '+JSON.stringify(measurements));
    return {minimum,measurements};
  },
  sse() { return refreshInstagramPublication('draft-local'); },
  poll() { return loadInstagramReels({silent:true}); }
};
class XMLHttpRequest {
  status=200;listeners={};upload={addEventListener(){}};
  open(method,url){this.url=url}setRequestHeader(){}addEventListener(type,listener){this.listeners[type]=listener}
  send(){requests.push({url:this.url,method:'PUT',kind:'fake-XHR'});this.status=qa.editorFailure==='upload'?500:200;queueMicrotask(()=>this.listeners.load?.())}
  abort(){this.listeners.abort?.()}
}
document.getElementById('qa-photo').addEventListener('click',()=>{const bytes=Uint8Array.from(atob(qaJpegBase64),letter=>letter.charCodeAt(0)),file=new File([bytes],'historia-prueba.jpg',{type:'image/jpeg'}),data=new DataTransfer();data.items.add(file);instagramStoryNode('file').files=data.files;instagramStoryNode('file').dispatchEvent(new Event('change',{bubbles:true}))});
document.getElementById('qa-video').addEventListener('click',()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(100)],'video-ficticio.mp4',{type:'video/mp4'}));els.instagramReelVideo.files=data.files;els.instagramReelVideo.dispatchEvent(new Event('change',{bubbles:true}))});
const fetch = async (url, options={}) => {
  const parsed=new URL(url,'https://fixture.invalid');
  const method=options.method||'GET'; requests.push({url,method,body:options.body?JSON.parse(options.body):null});
  let status=200,body;
  const kind=parsed.pathname.includes('instagram-calendar')?'planning':parsed.pathname.endsWith('/automation')?'automation':parsed.pathname.endsWith('/sync')?'sync':parsed.pathname.endsWith('/history')?'history':parsed.pathname.endsWith('/duplicate')?'duplicate':parsed.pathname.includes('instagram-publications')?'local':'catalogue';
  const accountId=qa.accountId;
  if(parsed.pathname.includes('/instagram-stories')) {
    const payload=options.body?JSON.parse(options.body):{},parts=parsed.pathname.split('/'),last=parts.at(-1),row=storyRows.find(item=>item.id===parts[4]);
    if(last==='capability'){if(method==='POST')storyDeclared=payload.enabled;body={accountId,automatic:storyDeclared,source:storyDeclared?'operator_declared':'unknown',runtimeReady:true,message:'Habilitado por el administrador; Instagram comprobará el permiso al publicar'}}
    else if(last==='uploads')body={uploadUrl:'https://upload.invalid/fake-only',objectPath:state.businessId+'/instagram/stories/12345678-1234-4234-8234-123456789abc.jpg',uploadHeaders:{'content-type':payload.mimeType}};
    else if(last==='verify')body={verified:true,objectPath:payload.objectPath,mimeType:payload.mimeType,sizeBytes:payload.sizeBytes};
    else if(last==='download')body={url:'data:image/jpeg;base64,'+qaJpegBase64,expiresAt:'2100-01-01'};
    else if(method==='POST'&&last==='instagram-stories'){body={...payload,id:'story-'+storyRows.length,businessId:state.businessId,publicationType:'STORY',status:'DRAFT',revision:0,videoAvailable:true,videoObjectPath:payload.objectPath,videoMimeType:payload.mimeType,videoSizeBytes:payload.sizeBytes,caption:payload.note};storyRows.push(body)}
    else if(last==='prepare-manual'){Object.assign(row,{deliveryMode:'MANUAL',status:'DRAFT',revision:row.revision+1});body=row}
    else if(last==='duplicate'){const copy={...row,id:'story-'+storyRows.length,status:'DRAFT',revision:0,scheduledAt:null,publishedAt:null,manuallyCompletedAt:null};storyRows.push(copy);body={requiresFile:false,publication:copy,content:copy}}
    else if(method==='PATCH'){Object.assign(row,payload,{revision:row.revision+1});body=row}
    else if(method==='POST'&&['publish','schedule','cancel','complete-manual'].includes(last)){if(qa.editorFailure===last){status=503;body={message:'Error de prueba'}}else{Object.assign(row,{revision:row.revision+1,status:last==='publish'?'READY':last==='schedule'?'SCHEDULED':last==='cancel'?'CANCELLED':'MANUALLY_COMPLETED',...(last==='complete-manual'?{manuallyCompletedAt:new Date().toISOString()}:{}),...(payload.scheduledAt?{scheduledAt:payload.scheduledAt}:{})});body=row}}
    else body=last==='instagram-stories'?storyRows:row;
  }else if(kind==='planning') {
    const date=parsed.searchParams.get('date'),minute=Number(parsed.searchParams.get('minute'));
    if(parsed.pathname.endsWith('/time-options')){
      const fold=date?.endsWith('-11-01')&&minute===90,gap=date?.endsWith('-03-08')&&minute===150;
      if(gap){status=400;body={message:'Horario inexistente'}}
      else body={timezone:state.business.timezone,requiresChoice:fold,candidates:fold?[{instant:date+'T05:30:00Z',offset:'UTC-4'},{instant:date+'T06:30:00Z',offset:'UTC-5'}]:[{instant:new Date(Date.parse(date+'T00:00:00Z')+(minute+240)*60000).toISOString(),offset:'UTC-4'}]};
    }else{
      const offset=Number(parsed.searchParams.get('offset')||0),from=parsed.searchParams.get('from'),day=from.slice(0,10);
      const storyCalendar=parsed.searchParams.get('publicationType')==='STORY';
      const rows=storyCalendar?storyRows.filter(row=>row.scheduledAt||row.manuallyCompletedAt).map(row=>({kind:'publication',...row,eventAt:row.manuallyCompletedAt||row.scheduledAt})): [...local.filter(row=>['PUBLISHED','SCHEDULED'].includes(row.status)).map(row=>({kind:'publication',...row,accountId,scheduledAt:row.status==='SCHEDULED'?day+'T18:00:00Z':null,publishedAt:row.status==='PUBLISHED'?day+'T16:00:00Z':null,eventAt:day+'T18:00:00Z'})),
        ...Array.from({length:50},(_,index)=>({kind:'media',id:'calendar-import-'+index,caption:'Reel importado '+(index+1)+' · sólo caché',status:'PUBLISHED',accountId,publishedAt:day+'T15:00:00Z',scheduledAt:null,eventAt:day+'T15:00:00Z'}))];
      const undated=storyCalendar?storyRows.filter(row=>!row.scheduledAt&&!row.manuallyCompletedAt).map(row=>({kind:'publication',...row,eventAt:null})): [{kind:'publication',...local.find(row=>row.id==='draft-local'),eventAt:null,publishedAt:null,scheduledAt:null},
        {kind:'publication',id:'unknown-local',businessId:state.businessId,caption:'Resultado incierto sin fecha comprobable',status:'UNKNOWN',accountId:null,unverifiedAccount:true,revision:1,eventAt:null,publishedAt:null,scheduledAt:null}];
      body={timezone:state.business.timezone,accountId,apiAccountId:'qa-app-account',offset,limit:50,items:rows.slice(offset,offset+50),total:rows.length,undatedItems:undated.slice(offset,offset+50),undatedTotal:undated.length};
      if(qa.mode==='cache-error'){status=503;body={message:'Calendario temporalmente no disponible'}}
    }
  }else if(kind==='duplicate'){
    const id=decodeURIComponent(parsed.pathname.split('/').at(-2)),source=local.find(row=>row.id===id);
    const content=source||{caption:'Copia de un Reel importado',shareToFeed:true,automation:{enabled:false,keywords:[],privateReplyEnabled:true,privateReplyText:'',publicReplyEnabled:false,publicReplyText:''}};
    let publication=null;
    if(source?.videoAvailable){publication={...structuredClone(source),id:'copy-'+local.length,status:'DRAFT',revision:0};local.push(publication)}
    body={requiresFile:!publication,publication,content};
  }else if(kind==='automation') {
    const parts=parsed.pathname.split('/');const type=parts[3];const id=decodeURIComponent(parts[4]);
    if(qa.automationMode==='error-'+method) { status=503;body={message:'Configuración temporalmente no disponible'}; }
    else { const key=state.businessId+':'+accountId+':'+id;
      if(method==='PATCH')configurations.set(key,{id:'qa-automation-'+id,...JSON.parse(options.body)});
      const legacy={id:'qa-automation-'+id,enabled:true,keywords:['precio','turno'],privateReplyEnabled:true,privateReplyText:'Completá {{weex_form:oferta}}',publicReplyEnabled:false,publicReplyText:'Texto público conservado'};
      body={accountId,mediaId:type==='instagram-media'?id:null,publicationId:type==='instagram-publications'?id:null,automation:configurations.get(key)??(qa.automationMode==='none'?null:legacy),recentActions:[{id:'action-public',kind:'PUBLIC_REPLY',status:'SENT',attempts:1,sentAt:'2026-10-26T10:00:00Z',lastError:null},{id:'action-private',kind:'PRIVATE_REPLY',status:'UNKNOWN',attempts:0,sentAt:null,lastError:'No se pudo completar esta acción.'}]};
    }
  } else if(kind==='local') {
    const payload=options.body?JSON.parse(options.body):{},parts=parsed.pathname.split('/'),last=parts.at(-1),row=local.find(item=>item.id===decodeURIComponent(parts[4]||''));
    if(qa.mode==='local503'){status=503;body={message:'Creaciones temporalmente no disponibles'}}
    else if(last==='uploads')body={uploadUrl:'https://upload.invalid/fake-only',objectPath:state.businessId+'/file.mp4',uploadHeaders:{'content-type':'video/mp4'}};
    else if(last==='verify')body={verified:true,objectPath:payload.objectPath,mimeType:payload.mimeType,sizeBytes:payload.sizeBytes};
    else if(method==='POST'&&last==='instagram-publications'){body={...payload,id:'created-'+local.length,businessId:state.businessId,status:'DRAFT',revision:0,videoAvailable:true};local.push(body)}
    else if(method==='PATCH'){Object.assign(row,payload,{revision:row.revision+1});body=row}
    else if(method==='POST'&&['publish','schedule','cancel'].includes(last)){
      if(qa.editorFailure===last){status=503;body={message:'Falla de prueba al completar '+last}}
      else{Object.assign(row,{status:last==='publish'?'READY':last==='schedule'?'SCHEDULED':'CANCELLED',revision:row.revision+1,...(payload.scheduledAt?{scheduledAt:payload.scheduledAt}:{})});body=row}
    }else body=last==='instagram-publications'?local:row;
  }
  else if(kind==='sync') {
    const scope=state.businessId+':'+accountId;
    if(!options.body||!JSON.parse(options.body).continuation) stages.set(scope,0);
    const stage=stages.get(scope)||0;
    if(qa.mode==='sync-error'&&!qa.failed) { qa.failed=true; body={status:'failed',accountId,imported:0,continuation:opaque}; }
    else { stages.set(scope,stage+1); body={status:stage===0?'more':'complete',accountId,imported:stage===0?5:2,continuation:stage===0?opaque:null}; }
  } else if(kind==='history') {
    const offset=Number(parsed.searchParams.get('offset')||0);
    body={accountId,mediaId:'qa-media-1',total:8,offset,items:Array.from({length:offset===0?5:3},(_,i)=>({id:'observation-'+(i+offset),observedAt:new Date(Date.UTC(2026,9,25-i-offset,12)).toISOString(),status:i===0?'partial':'complete',values:{reach:i===0?null:987-i,views:i===0?0:1234-i,likes:20,comments:2,shares:1,saved:0,total_interactions:23}}))};
  } else {
    if(qa.mode==='cache-error') { status=503; body={message:'Lectura temporalmente no disponible'}; }
    else { const offset=Number(parsed.searchParams.get('offset')||0); body={accountId,total:60,limit:25,offset,linkedPublicationIds:['imported-local'],items:fixtureRows.map((row,index)=>({...row,id:offset===0?row.id:'page-'+offset+'-'+index,caption:offset===0?row.caption:'Otra página · '+row.caption,accountId}))}; }
  }
  if(qa.defer===kind||qa.defer===kind+'-'+method) { qa.defer=''; return new Promise(resolve=>{deferred={resolve,body,status};}); }
  return new Response(JSON.stringify(body),{status});
};
`
const script = fixture.replace('__QA_REAL_JPEG__',jpeg.toString('base64')) + '\n' + code + '\n' + editorBindings + '\nbindInstagramStoriesControls();loadInstagramReels();instagramMediaPlanLoad();instagramStoriesLoad();'
await mkdir(output, { recursive: true })
const path = join(output, 'index.html')
await writeFile(path, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram · prueba local neutral</title>${html.match(/<style>[\s\S]*?<\/style>/)?.[0]}<style>html{height:auto;min-height:100%;overflow-y:auto;overflow-x:hidden}body{height:auto;overflow:visible;margin:0;padding:16px;background:#f3f6fb}#qa-shell{max-width:1240px;margin:auto;min-width:0;height:auto;overflow:visible}#qa-photo,#qa-video{position:static;min-height:44px;max-width:100%;padding:10px;background:#dbeafe;border:1px solid #2563eb;border-radius:8px;white-space:normal}</style><body><div class="campaigns-title" hidden><h2></h2><p></p></div><main id="qa-shell" data-section="campaigns">${panel}</main>${dialog}<script>${script}</script></body></html>`, 'utf8')
console.log('Neutral fixture with production bindings and fake fetch: ' + path)
