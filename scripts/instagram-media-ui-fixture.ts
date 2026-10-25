import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
process.env.DOTENV_CONFIG_PATH = '__instagram_ui_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { instagramMediaScript } = await import('../src/routes/crm-ui/instagram-media.js')
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
const code = ['escapeHtml', 'getJson', 'instagramReelStatusMeta', 'renderInstagramReels', 'loadInstagramReels', 'refreshInstagramPublication'].map(fn).join('\n') + '\n' + instagramMediaScript
const fixture = String.raw`
const state = { businessId: 'qa-business', marketingView: 'instagram-reels', instagramReels: [], instagramReelsLoaded: false, instagramMedia: null, instagramMediaGeneration: 0 };
const els = { appShell: document.getElementById('qa-shell'), instagramReelsManager: document.getElementById('instagram-reels-manager'), instagramReelsTableBody: document.getElementById('instagram-reels-table-body'), instagramReelsFeedback: document.getElementById('instagram-reels-feedback') };
const buildGetJsonRequestOptions = value => value;
const requests = [];
const local = [{id:'imported-local',caption:'Reel ya importado',status:'PUBLISHED',videoAvailable:false},{id:'draft-local',caption:'Corte en preparación',status:'DRAFT',videoAvailable:true},{id:'queued-local',caption:'Color en cola',status:'READY',videoAvailable:true},{id:'published-local',caption:'Publicado desde el CRM, aún no importado',status:'PUBLISHED',videoAvailable:false}];
const metrics = (reach, views, status='complete') => ({latestMetrics:{values:{reach,views,likes:reach===null?null:20,comments:reach===null?null:2,shares:reach===null?null:1,saved:reach===null?null:0,total_interactions:reach===null?null:23},observedAtByMetric:{reach:'2026-10-24T10:00:00Z',views:'2026-10-24T10:00:00Z',likes:'2026-10-25T11:00:00Z',comments:'2026-10-25T11:00:00Z',shares:'2026-10-25T11:00:00Z',saved:'2026-10-25T11:00:00Z',total_interactions:'2026-10-25T11:00:00Z'}},insightsStatus:status,lastInsightAttemptAt:'2026-10-25T12:00:00Z'});
const fixtureRows = [{id:'qa-media-1',caption:'Transformación de color · técnica y cuidado',publishedAt:'2026-10-01T12:00:00Z',permalink:'https://www.instagram.com/reel/fixture/',...metrics(987,1234,'partial')},{id:'qa-media-2',caption:'Corte clásico: lectura con cero vistas',publishedAt:'2026-10-02T12:00:00Z',...metrics(0,0)},{id:'qa-media-3',caption:'Reel sin métricas disponibles',publishedAt:'2026-10-03T12:00:00Z',...metrics(null,null,'unavailable')}];
const opaque = '12345678-1234-4234-8234-123456789abc';
const stages = new Map();
let deferred = null;
const qa = window.__qa = { state, els, requests, mode:'normal', defer:'', accountId:'qa-account', failed:false,
  async scenario(mode) { this.mode=mode; this.failed=false; return loadInstagramReels(); },
  release() { const pending=deferred; deferred=null; if(pending) pending.resolve(new Response(JSON.stringify(pending.body),{status:pending.status})); },
  async business(id,accountId) { state.businessId=id; this.accountId=accountId; resetInstagramMediaState(); state.instagramReels=[]; state.instagramReelsLoaded=false; return loadInstagramReels(); },
  section(name) { els.appShell.dataset.section=name; },
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
const fetch = async (url, options={}) => {
  const parsed=new URL(url,'https://fixture.invalid');
  const method=options.method||'GET'; requests.push({url,method,body:options.body?JSON.parse(options.body):null});
  let status=200,body;
  const kind=parsed.pathname.endsWith('/sync')?'sync':parsed.pathname.endsWith('/history')?'history':parsed.pathname.includes('instagram-publications')?'local':'catalogue';
  const accountId=qa.accountId;
  if(kind==='local') { status=qa.mode==='local503'?503:200; body=status===503?{message:'Creaciones temporalmente no disponibles'}:parsed.pathname.endsWith('/instagram-publications')?local:local.find(row=>row.id==='draft-local'); }
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
  if(qa.defer===kind) { qa.defer=''; return new Promise(resolve=>{deferred={resolve,body,status};}); }
  return new Response(JSON.stringify(body),{status});
};
`
const script = fixture + '\n' + code + '\nbindInstagramMediaControls();loadInstagramReels();'
await mkdir(output, { recursive: true })
const path = join(output, 'index.html')
await writeFile(path, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram · prueba local neutral</title>${html.match(/<style>[\s\S]*?<\/style>/)?.[0]}<style>body{height:auto;overflow:visible;margin:0;padding:16px;background:#f3f6fb}#qa-shell{max-width:1240px;margin:auto;min-width:0;height:auto;overflow:visible}</style><body><main id="qa-shell" data-section="campaigns">${panel}</main><script>${script}</script></body></html>`, 'utf8')
console.log('Neutral fixture with production bindings and fake fetch: ' + path)
