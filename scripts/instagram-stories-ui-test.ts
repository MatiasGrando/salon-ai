import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH='__instagram_stories_ui_no_dotenv__'
const {renderCrmHtml}=await import('../src/routes/crm-ui.js')
const {DISABLED_POLLING_MARKER}=await import('../src/observability/egress-baseline/types.js')
const html=renderCrmHtml({pollingMarker:DISABLED_POLLING_MARKER})
assert.ok(html.includes('id="instagram-story-new"'),'the shipped interface must offer a distinct Story entry point without replacing the Reel editor')
console.log('OK: Story entry point exists in shipped CRM markup')
const {runInNewContext}=await import('node:vm')
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]!).find(code=>code.includes('function instagramStorySubmit('))!
function fn(name:string){const match=new RegExp('    (?:async )?function '+name+'\\(').exec(script);assert.ok(match,name);return script.slice(match.index,script.indexOf('\n    }',match.index)+6)}
const nodes:any={},requests:any[]=[];let context:any,xhrCount=0,publishFails=false,deferred:any=null
function element(){return{value:'',checked:false,disabled:false,hidden:false,isConnected:true,dataset:{},files:[],textContent:'',innerHTML:'',style:{},listeners:{} as any,
 focus(){context.document.activeElement=this},reset(){},removeAttribute(name:string){if(name==='hidden')this.hidden=false},setAttribute(name:string){if(name==='hidden')this.hidden=true},addEventListener(type:string,callback:Function){(this.listeners[type]??=[]).push(callback)},querySelectorAll(){return[]},getClientRects(){return[{}]}}}
const node=(name:string)=>nodes['instagram-story-'+name]??=element()
const state:any={businessId:'a',business:{timezone:'America/New_York'},marketingView:'instagram-reels'}
let row:any=null
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status})
class XHR{status=200;listeners:any={};upload={addEventListener(){}};open(){}setRequestHeader(){}addEventListener(type:string,callback:Function){this.listeners[type]=callback}send(){xhrCount++;this.listeners.load()}abort(){this.listeners.abort?.()}}
class TestURL extends URL{static createObjectURL(){return'blob:neutral'}static revokeObjectURL(){}}
context={state,els:{appShell:{dataset:{section:'campaigns'}}},URL:TestURL,URLSearchParams,AbortController,Date,Intl,encodeURIComponent,XMLHttpRequest:XHR,
 buildGetJsonRequestOptions:(options:any)=>options,setInstagramReelProgress(){throw Error('Story touched Reel progress')},setInstagramReelFeedback(){throw Error('Story touched Reel feedback')},instagramMediaPlanLoad:async()=>{},
 document:{activeElement:null,getElementById:(id:string)=>nodes[id]??=element(),createElement:()=>({...element(),click(){}})},
 fetch:async(url:string,options:any={})=>{requests.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});const payload=options.body?JSON.parse(options.body):{};
   if(deferred){const callback=deferred;deferred=null;return new Promise(resolve=>callback(resolve))}
   if(url.endsWith('/capability'))return json({automatic:true,accountId:'account-a',source:'operator_declared',runtimeReady:true,message:'Declarado'})
   if(url.endsWith('/uploads'))return json({uploadUrl:'https://storage.invalid/file',objectPath:'a/instagram/stories/file.jpg',uploadHeaders:{}})
   if(url.endsWith('/verify'))return json({verified:true,objectPath:'a/instagram/stories/file.jpg',mimeType:'image/jpeg',sizeBytes:100})
   if(url.endsWith('/publish')){if(publishFails)return json({message:'fake failure'},503);row={...row,status:'READY',revision:row.revision+1};return json(row)}
   if(url.endsWith('/complete-manual')){row={...row,status:'MANUALLY_COMPLETED',revision:row.revision+1,manuallyCompletedAt:new Date().toISOString()};return json(row)}
   if(url.endsWith('/schedule')){row={...row,status:'SCHEDULED',revision:row.revision+1,scheduledAt:payload.scheduledAt};return json(row)}
   if(url.includes('/time-options'))return json({timezone:state.business.timezone,requiresChoice:true,candidates:[{instant:'2026-11-01T05:30:00Z',offset:'UTC-4'},{instant:'2026-11-01T06:30:00Z',offset:'UTC-5'}]})
   if(url.endsWith('/instagram-stories')){if(options.method==='POST'){row={...payload,id:'s',businessId:'a',publicationType:'STORY',status:'DRAFT',revision:0};return json(row)}return json(row?[row]:[])}
   if(options.method==='PATCH'){row={...row,...payload,revision:row.revision+1};return json(row)}
   return json(row)
 }}
const names=[...script.matchAll(/    (?:async )?function ((?:instagramStor)[A-Za-z]+)\(/g)].map(match=>match[1]!)
runInNewContext(['getJson','escapeHtml','instagramMediaHtml','uploadInstagramReelFile','bindInstagramStoriesControls',...names].map(fn).join('\n'),context)
runInNewContext('bindInstagramStoriesControls()',context)
await node('new').listeners.click[0]({currentTarget:node('new')})
assert.equal(node('mode').value,'MANUAL','new stories default to manual, independent of the schema legacy default')
node('file').files=[{name:'photo.jpg',type:'image/jpeg',size:100}];node('file').listeners.change[0]()
await node('form').listeners.submit[0]({preventDefault(){}})
assert.equal(xhrCount,1);assert.equal(requests.filter(r=>r.url.endsWith('/instagram-stories')&&r.method==='POST').length,1)
assert.equal(row.deliveryMode,'MANUAL');assert.equal(row.mediaKind,'IMAGE');assert.equal(node('image').hidden,false)
node('destination').value='now';publishFails=true
await node('form').listeners.submit[0]({preventDefault(){}})
assert.match(node('feedback').textContent,/borrador sigue guardado/)
publishFails=false;await node('form').listeners.submit[0]({preventDefault(){}})
assert.equal(xhrCount,1);assert.equal(requests.filter(r=>r.url.endsWith('/instagram-stories')&&r.method==='POST').length,1)
const before=requests.filter(r=>r.url.endsWith('/publish')).length
await node('form').listeners.submit[0]({preventDefault(){}})
assert.equal(requests.filter(r=>r.url.endsWith('/publish')).length,before,'a READY reload must not resend a Story')
node('manual-confirm').checked=false;await node('manual-complete').listeners.click[0]()
assert.equal(requests.filter(r=>r.url.endsWith('/complete-manual')).length,0)
node('manual-confirm').checked=true;await node('manual-complete').listeners.click[0]()
assert.equal(row.status,'MANUALLY_COMPLETED');assert.ok(!row.publishedAt)
await node('new').listeners.click[0]({currentTarget:node('new')});node('date').value='2026-11-01';node('time').value='01:30';await node('resolve').listeners.click[0]()
assert.ok(node('time-options').innerHTML.includes('UTC-4'));assert.ok(node('time-options').innerHTML.includes('UTC-5'));assert.equal(node('time-options').value,'')
row={...row,status:'SCHEDULED',revision:7,deliveryMode:'MANUAL'}
await runInNewContext("instagramStoryOpen({id:'s'})",context)
node('date').value='2026-11-01';node('time').value='01:30';await node('resolve').listeners.click[0]();node('time-options').value='2026-11-01T06:30:00Z';node('destination').value='schedule'
const beforeSchedule=requests.filter(r=>r.url.endsWith('/schedule')).length,beforePatch=requests.filter(r=>r.method==='PATCH').length
await node('form').listeners.submit[0]({preventDefault(){}})
assert.equal(requests.filter(r=>r.url.endsWith('/schedule')).length,beforeSchedule+1,'a scheduled Story must allow safe reprogramming without editing its source')
assert.equal(requests.filter(r=>r.method==='PATCH').length,beforePatch)
await node('new').listeners.click[0]({currentTarget:node('new')});node('destination').value='draft'
let release!:(response:Response)=>void;deferred=(resolve:typeof release)=>{release=resolve}
node('file').files=[{name:'late.jpg',type:'image/jpeg',size:100}]
const pending=node('form').listeners.submit[0]({preventDefault(){}}),editor=state.instagramStories.editor
node('close').listeners.click[0]();assert.equal(editor.controller.signal.aborted,true)
release(json({uploadUrl:'https://storage.invalid/file',objectPath:'a/file',uploadHeaders:{}}));await pending
assert.equal(xhrCount,1);assert.equal(state.instagramStories.editor,null)
console.log('OK: shipped Story events, manual default, real XHR helper, retained source/draft retry, READY no-resend, explicit completion/DST choice and late-close abort')
