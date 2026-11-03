import assert from 'node:assert/strict'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
process.env.DOTENV_CONFIG_PATH='__instagram_media_no_env__'
process.env.DATABASE_URL='postgresql://offline:offline@127.0.0.1:1/offline'
const {parseInstagramWebhookPayload}=await import('../src/services/instagram-webhook-parser.js')
const payload={object:'instagram',entry:[{id:'account',messaging:[{sender:{id:'user'},recipient:{id:'account'},timestamp:123456,message:{mid:'mid',attachments:[{type:'image',payload:{url:'https://lookaside.fbsbx.com/ig_messaging_cdn/?signed=offline'}}]}}]}]}
const parsed=parseInstagramWebhookPayload(payload)
assert.equal(parsed.messaging.length,1,'a captionless Instagram image must enter the same durable message pipeline')
assert.equal(parsed.messaging[0]!.text,'')
assert.equal(parsed.messaging[0]!.attachments?.length,1)
const several=structuredClone(payload);several.entry[0]!.messaging[0]!.message.attachments.push({type:'file',payload:{url:'https://lookaside.fbsbx.com/ig_messaging_cdn/?signed=pdf'}})
Object.assign(several.entry[0]!.messaging[0]!.message,{text:'comprobante'})
assert.equal(parseInstagramWebhookPayload(several).messaging.length,1,'text plus multiple attachments remains ONE inbound')
for(const flag of ['is_echo','is_self','is_deleted']){const other=structuredClone(payload);Object.assign(other.entry[0]!.messaging[0]!.message,{[flag]:true});assert.equal(parseInstagramWebhookPayload(other).messaging.length,0)}
const {downloadInstagramDepositProof}=await import('../src/bot-options/infrastructure/instagram-deposit-proof-media.js')
const {validateDepositProof}=await import('../src/services/deposit-proof-validation.js')
const {DEPOSIT_PROOF_MAX_BYTES}=await import('../src/services/deposit-proof-image-validation.js')
const scope={businessId:'biz',instagramLeadId:'lead',instagramAccountId:'account',externalUserId:'user',providerMessageId:'mid'}
const descriptor={...scope,url:'https://lookaside.fbsbx.com/ig_messaging_cdn/?signed=offline',type:'image' as const}
const png=await sharp({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer()
const pdf=await PDFDocument.create();pdf.addPage([100,100]);const pdfBytes=await pdf.save({useObjectStreams:false})
let requests=0
const source=(bytes:Uint8Array,mimeType:string,declared=String(bytes.byteLength),redirected=false)=>(async(_url:string,init:{headers:Record<string,string>;redirect:string})=>{
  requests++;assert.deepEqual(init.headers,{},'never send a Graph bearer token or added credential to a signed CDN URL');assert.equal(init.redirect,'error')
  return {ok:true,redirected,headers:new Headers({'content-type':mimeType,'content-length':declared}),body:(async function*(){yield bytes})()}
})
const image=await downloadInstagramDepositProof({descriptor,scope,fetch:source(png,'image/png') as never})
assert.equal((await validateDepositProof({data:image.data,declaredMimeType:image.mimeType})).sourceMimeType,'image/png')
const document=await downloadInstagramDepositProof({descriptor:{...descriptor,type:'file'},scope,fetch:source(pdfBytes,'application/pdf') as never})
assert.equal((await validateDepositProof({data:document.data,declaredMimeType:document.mimeType})).sourceMimeType,'application/pdf')
for(const url of ['http://lookaside.fbsbx.com/ig_messaging_cdn/','https://127.0.0.1/ig_messaging_cdn/','https://169.254.169.254/','https://lookaside.fbsbx.com.evil.test/ig_messaging_cdn/','https://user:password@lookaside.fbsbx.com/ig_messaging_cdn/','https://lookaside.fbsbx.com:8443/ig_messaging_cdn/','https://lookaside.fbsbx.com/other/','https://cdninstagram.com/anything']){
  const before=requests;await assert.rejects(downloadInstagramDepositProof({descriptor:{...descriptor,url},scope,fetch:source(png,'image/png') as never}),/UNSAFE_DOWNLOAD_URL/);assert.equal(requests,before)
}
await assert.rejects(downloadInstagramDepositProof({descriptor,scope:{...scope,businessId:'foreign'},fetch:source(png,'image/png') as never}),/METADATA_UNAVAILABLE/)
await assert.rejects(downloadInstagramDepositProof({descriptor,scope,fetch:source(png,'image/png',String(png.length),true) as never}),/UNSAFE_DOWNLOAD_URL/)
await assert.rejects(downloadInstagramDepositProof({descriptor,scope,fetch:source(png,'text/html') as never}),/UNSUPPORTED_MEDIA_TYPE/)
await assert.rejects(downloadInstagramDepositProof({descriptor,scope,fetch:source(png,'image/png',String(DEPOSIT_PROOF_MAX_BYTES+1)) as never}),/TOO_LARGE/)
const spoof=await downloadInstagramDepositProof({descriptor,scope,fetch:source(pdfBytes,'image/png') as never})
await assert.rejects(validateDepositProof({data:spoof.data,declaredMimeType:spoof.mimeType}),/MAGIC_MISMATCH/)
const overflow=async()=>({ok:true,headers:new Headers({'content-type':'image/png'}),body:(async function*(){yield new Uint8Array(DEPOSIT_PROOF_MAX_BYTES);yield new Uint8Array(1)})()})
await assert.rejects(downloadInstagramDepositProof({descriptor,scope,fetch:overflow as never}),/TOO_LARGE/)
await assert.rejects(downloadInstagramDepositProof({descriptor,scope,fetch:(async()=>({ok:false,headers:new Headers(),body:null})) as never}),/DOWNLOAD_FAILED/)
console.log('IG captionless/multiple durable inbound and safe signed CDN image/PDF adapter: PASS (fake transport; existing financial validator; no actual provider)')
