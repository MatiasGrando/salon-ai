import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { bookingProgramsMarkup, bookingProgramsScript } from '../src/routes/crm-ui/booking-programs.js'

const chrome=process.env.CRM_QA_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
assert.ok(chrome,'Se necesita Chrome o Edge para verificar la interfaz real.')
const output=resolve('tmp/membership-ui-qa');await mkdir(output,{recursive:true})
const profile=join(output,'profile-'+Date.now());await mkdir(profile)
const crmHtml = renderCrmHtml({pollingMarker:{effective:false,headerName:'',headerValue:''} as any})
const style = crmHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1]
const servicesHeader = crmHtml.match(/<header class="services-header">[\s\S]*?<\/header>/)?.[0]
const customersShortcut = crmHtml.match(/<button[^>]*id="customers-memberships"[^>]*>[\s\S]*?<\/button>/)?.[0]
assert.ok(style && servicesHeader && customersShortcut)
assert.match(servicesHeader, /id="services-memberships"/)
const fixture=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><body>${servicesHeader}${customersShortcut}${bookingProgramsMarkup}<div class="dialog-backdrop" id="confirmation-dialog" hidden><section class="dialog confirmation-dialog"><h3 id="confirm-title"></h3><p id="confirm-message"></p><div class="dialog-actions"><button id="confirm-accept">Confirmar</button><button id="confirm-cancel">Cancelar</button></div></section></div><script>
const state={businessId:'b',business:{name:'Barbería demo',timezone:'America/Argentina/Buenos_Aires'},currentUser:{role:'BUSINESS_ADMIN'},professionals:[],customerOverview:[{id:'c',name:'Cliente de prueba'}],services:[{id:'cut',name:'Corte',price:40000,priceMode:'FIXED'},{id:'color',name:'Coloración',price:60000,priceMode:'FIXED'},{id:'combo',name:'Corte + barba',price:50000,priceMode:'FIXED'}]};
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const requests=[];const errors=[];window.addEventListener('error',e=>errors.push(e.message));
for(const name of ['alert','confirm','prompt'])window[name]=()=>{throw new Error('Dialogo nativo prohibido: '+name)};
const requestCrmConfirmation=(message,options)=>new Promise(resolve=>{const d=document.getElementById('confirmation-dialog');document.getElementById('confirm-title').textContent=options.title;document.getElementById('confirm-message').textContent=message;document.getElementById('confirm-accept').textContent=options.confirmLabel;d.hidden=false;document.getElementById('confirm-accept').onclick=()=>{d.hidden=true;resolve(true)};document.getElementById('confirm-cancel').onclick=()=>{d.hidden=true;resolve(false)}});
const plans=[{id:'silver',name:'Plata',kind:'MEMBERSHIP',price:50000,validityDays:30,isActive:true,cancellationHours:24,serviceRules:[{serviceId:'cut',name:'Corte',uses:2,unitPrice:25000}]},{id:'gold',name:'Oro',kind:'MEMBERSHIP',price:80000,validityDays:30,isActive:true,cancellationHours:24,serviceRules:[{serviceId:'cut',name:'Corte',uses:4,unitPrice:20000}]}];
let failCatalog = false;
async function getJson(url, options) {
  if (failCatalog && !options && url.startsWith('/benefit-plans?')) throw new Error('Error temporal de prueba');
  return fixtureJson(url, options);
}
async function fixtureJson(url,options){const path=url.split('?')[0];if(options){const body=JSON.parse(options.body);requests.push({path,body});if(path==='/benefit-plans'){const plan={id:'new',...body,isActive:true,serviceRules:body.serviceRules.map(r=>({...r,name:state.services.find(s=>s.id===r.serviceId).name,unitPrice:r.pricingMode==='FIXED'?r.fixedPrice:Math.round(state.services.find(s=>s.id===r.serviceId).price*(100-r.discountPercent)/100)}))};plans.push(plan);return plan}return {id:'purchase'}}if(path==='/benefit-plans')return plans;if(path.includes('/benefits'))return [{id:'grant',planId:'silver',name:'Plata',startsOn:'2027-01-01',endsOn:'2027-01-30',used:1,reserved:0,available:1,serviceBalances:[{name:'Corte',used:1,reserved:0,available:1}]}];if(path==='/cash-register/payment-context')return {session:{id:'session'}};if(path==='/cash-register/payment-methods')return [{id:'cash',name:'Efectivo'}];return []}
${bookingProgramsScript}
window.ready=true;
</script></body></html>`
const fixturePath=join(output,'memberships.html');await writeFile(fixturePath,fixture,'utf8')
let browserError=''
const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']})
child.stderr?.on('data',chunk=>{browserError+=String(chunk).slice(0,3000)})
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
let socket:WebSocket|undefined
try {
  let port=''
  for(let i=0;i<100&&!port;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]!}catch{await delay(100)}}
  assert.ok(port,'El navegador debe iniciar para poder verificar las dimensiones. '+browserError)
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json() as any[]
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise<void>((ok,no)=>{socket!.addEventListener('open',()=>ok());socket!.addEventListener('error',no)})
  let id=0;const pending=new Map<number,{ok:(v:any)=>void;no:(e:any)=>void}>()
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.no(message.error):p.ok(message.result)})
  const send=(method:string,params:object={})=>new Promise<any>((ok,no)=>{const key=++id;pending.set(key,{ok,no});socket!.send(JSON.stringify({id:key,method,params}));setTimeout(()=>{if(pending.delete(key))no(new Error('CDP timeout: '+method))},15000).unref()})
  const evaluate=async<T=any>(expression:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const viewport=async(width:number,height:number)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(80)}
  await send('Page.enable');await viewport(1500,1100)
  await send('Page.navigate',{url:pathToFileURL(fixturePath).href})
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.ready)'))break;await delay(50)}
  const openCatalog = (id: 'services-memberships' | 'customers-memberships') => evaluate<boolean>(`(async () => {
    document.getElementById(${JSON.stringify(id)}).focus()
    document.activeElement.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    return !bpRoot.hidden && Boolean(bpBody.querySelector('#bp-plan-form')) && !bpBody.querySelector('#bp-purchase-form')
  })()`)
  await evaluate('failCatalog = true')
  assert.equal(await openCatalog('services-memberships'), false)
  assert.match(await evaluate('bpBody.textContent'), /No se pudo cargar/)
  assert.doesNotMatch(await evaluate('bpBody.textContent'), /Cargando/)
  assert.match(await evaluate("document.getElementById('bp-feedback').textContent"), /Error temporal de prueba/)
  await evaluate("(async () => { failCatalog = false; bpBody.querySelector('[data-bp-retry]').click(); await new Promise(resolve => requestAnimationFrame(resolve)) })()")
  assert.ok(await evaluate("bpBody.querySelector('#bp-plan-form') !== null"), 'Reintentar vuelve a abrir el catalogo')
  await evaluate('bpClose()')
  assert.ok(await openCatalog('services-memberships'), 'Servicios abre el catálogo para crear planes')
  await evaluate("document.getElementById('bp-plan-editor').open=true")
  const metrics=()=>evaluate<{width:number;height:number;font:number;input:number;title:number;padding:number;button:number;rowPadding:number;gap:number}>(`(()=>{const d=document.querySelector('.bp-dialog'),i=document.querySelector('#bp-plan-form input'),h=document.querySelector('#bp-title');return {width:d.getBoundingClientRect().width,height:d.getBoundingClientRect().height,font:parseFloat(getComputedStyle(i).fontSize),input:i.getBoundingClientRect().height,title:parseFloat(getComputedStyle(h).fontSize),padding:parseFloat(getComputedStyle(document.getElementById('bp-body')).paddingTop),button:document.querySelector('[data-bp-close]').getBoundingClientRect().height,rowPadding:parseFloat(getComputedStyle(document.querySelector('[data-bp-service] td')).paddingTop),gap:parseFloat(getComputedStyle(document.querySelector('#bp-plan-form .bp-grid')).gap)}})()`)
  const initial=await metrics()
  assert.equal(Math.round(initial.width),900);assert.equal(Math.round(initial.height),600)
  for(const [name,width,height] of [['horizontal',1200,600],['vertical',900,850],['combined',1200,850]] as const){
    await evaluate(`bpDialog.style.width='${width}px';bpDialog.style.height='${height}px'`);await delay(100)
    const current=await metrics()
    for(const field of ['font','input','title','padding','button','rowPadding','gap'] as const)assert.ok(current[field]>initial[field]*1.2,name+': tambien aumenta '+field)
  }
  await evaluate('bpClose()')
  assert.equal(await evaluate('document.activeElement.id'), 'services-memberships')
  assert.ok(await openCatalog('customers-memberships'), 'Clientes conserva el acceso al mismo catálogo')
  await delay(80)
  assert.equal(Math.round((await metrics()).width),1200,'reapertura conserva ancho')
  assert.equal(Math.round((await metrics()).height),850,'reapertura conserva alto')
  await evaluate("document.getElementById('bp-plan-editor').open=true;const f=document.getElementById('bp-plan-form');f.elements.name.value='Plata';f.elements.price.value='50000';const row=document.querySelector('[data-bp-service=\"cut\"]');row.querySelector('[data-bp-uses]').value='2';row.querySelector('[data-bp-value]').value='25000';row.querySelector('[data-bp-value]').dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()")
  await delay(100)
  const posted=await evaluate('requests.find(r=>r.path==="/benefit-plans").body')
  assert.equal(posted.price,50000);assert.equal(posted.serviceRules[0].uses,2);assert.equal(posted.serviceRules[0].fixedPrice,25000)
  await evaluate("document.getElementById('bp-plan-editor').open=true;document.getElementById('bp-plan-form').scrollIntoView()");await delay(80)
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(output,'desktop.png'),Buffer.from(r.data,'base64')))
  for(const [width,height] of [[320,568],[390,844],[768,640],[1500,1100]] as const){
    await viewport(width,height)
    const fit=await evaluate(`(()=>{const r=bpDialog.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,scale:parseFloat(getComputedStyle(bpDialog).getPropertyValue('--bp-scale'))}})()`)
    assert.ok(fit.left>=0&&fit.right<=width+1&&fit.top>=0&&fit.bottom<=height+1,'dialogo dentro de '+width+'x'+height)
    assert.equal(fit.overflow,false,'sin desborde global en '+width)
    if(width<680)assert.equal(fit.scale,1,'movil conserva controles legibles')
    if(width===390)await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(output,'mobile.png'),Buffer.from(r.data,'base64')))
  }
  await evaluate('bpClose()')
  await viewport(390,844)
  assert.ok(await openCatalog('services-memberships'), 'Servicios permite abrir el catálogo en móvil')
  await viewport(1500,1100)
  await evaluate('bpClose()')
  assert.ok(await openCatalog('services-memberships'))
  await delay(80)
  assert.equal(Math.round((await metrics()).width),1200,'reducir el viewport y volver no pierde el ancho elegido')
  assert.equal(Math.round((await metrics()).height),850,'reducir el viewport y volver no pierde el alto elegido')
  await evaluate("openBookingPrograms('benefits',state.customerOverview[0])")
  assert.ok((await evaluate('document.getElementById("bp-body").textContent')).includes('1 disponibles'),'saldo por servicio visible')
  await evaluate("(()=>{const f=document.getElementById('bp-purchase-form');f.elements.planId.value='gold';f.elements.planId.dispatchEvent(new Event('change',{bubbles:true}));f.requestSubmit()})()")
  await delay(100)
  const confirmation=await evaluate("(()=>{const d=document.getElementById('confirmation-dialog'),r=d.getBoundingClientRect();return {above:Number(getComputedStyle(d).zIndex)>Number(getComputedStyle(bpRoot).zIndex),label:document.getElementById('confirm-accept').textContent}})()")
  assert.equal(confirmation.above,true,'la confirmacion de compra debe estar encima del formulario')
  assert.equal(confirmation.label,'Confirmar cobro')
  await evaluate("document.getElementById('confirm-accept').click()");await delay(100)
  assert.equal((await evaluate('requests.find(r=>r.path==="/customer-benefits").body')).planId,'gold')
  assert.deepEqual(await evaluate('errors'),[])
  console.log('OK interfaz real: crear plan, compra, saldos, escala horizontal/vertical/combinada, reapertura y movil. Capturas: '+output)
} finally {socket?.close();child.kill()}
