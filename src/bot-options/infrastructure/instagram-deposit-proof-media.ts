import {DEPOSIT_PROOF_MAX_BYTES} from '../../services/deposit-proof-image-validation.js'
import {MetaDepositMediaError,META_DEPOSIT_MEDIA_TIMEOUT_MS} from './meta-deposit-proof-media.js'
export type InstagramMediaScope={businessId:string;instagramLeadId:string;instagramAccountId:string;externalUserId:string;providerMessageId:string}
export type InstagramMediaDescriptor=InstagramMediaScope&{url:string;type:'image'|'file'}
export type InstagramMediaHttp=(url:string,init:{headers:Record<string,string>;signal:AbortSignal;redirect:'error'})=>Promise<{ok:boolean;redirected?:boolean;headers:{get(name:string):string|null};body:AsyncIterable<Uint8Array>|null}>
export function safeInstagramProofUrl(raw:string):string|null {
  try {const url=new URL(raw)
    if(url.protocol!=='https:'||url.hostname!=='lookaside.fbsbx.com'||url.pathname!=='/ig_messaging_cdn/'||url.port||url.username||url.password||url.hash)return null
    return url.toString()
  }catch{return null}
}
/** Downloads only the descriptor admitted with the signed exact user event.
 * No Graph credentials, redirects or broad provider-domain wildcard are allowed. */
export async function downloadInstagramDepositProof(input:{descriptor:InstagramMediaDescriptor;scope:InstagramMediaScope;fetch:InstagramMediaHttp;timeoutMs?:number}) {
  for(const key of ['businessId','instagramLeadId','instagramAccountId','externalUserId','providerMessageId'] as const){
    if(typeof input.scope[key]!=='string'||!input.scope[key]||input.scope[key].length>256||input.descriptor[key]!==input.scope[key])throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
  }
  if(!['image','file'].includes(input.descriptor.type))throw new MetaDepositMediaError('UNSUPPORTED_MEDIA_TYPE')
  const url=safeInstagramProofUrl(input.descriptor.url);if(!url)throw new MetaDepositMediaError('UNSAFE_DOWNLOAD_URL')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),input.timeoutMs??META_DEPOSIT_MEDIA_TIMEOUT_MS)
  try {
    const response=await input.fetch(url,{headers:{},signal:controller.signal,redirect:'error'})
    if(response.redirected)throw new MetaDepositMediaError('UNSAFE_DOWNLOAD_URL')
    if(!response.ok||!response.body)throw new MetaDepositMediaError('DOWNLOAD_FAILED')
    const mimeType=response.headers.get('content-type')?.split(';')[0]!.trim().toLowerCase()
    if(!mimeType||!(input.descriptor.type==='image'?['image/jpeg','image/png']:['application/pdf']).includes(mimeType))throw new MetaDepositMediaError('UNSUPPORTED_MEDIA_TYPE')
    const length=response.headers.get('content-length');const declared=length!==null&&/^\d+$/.test(length)?Number(length):null
    if(length!==null&&(declared===null||!Number.isSafeInteger(declared)))throw new MetaDepositMediaError('DECLARED_SIZE_MISMATCH')
    if(declared!==null&&declared>DEPOSIT_PROOF_MAX_BYTES)throw new MetaDepositMediaError('TOO_LARGE')
    const chunks:Buffer[]=[];let size=0
    for await(const part of response.body){size+=part.byteLength;if(size>DEPOSIT_PROOF_MAX_BYTES)throw new MetaDepositMediaError('TOO_LARGE');chunks.push(Buffer.from(part))}
    if(!size||declared!==null&&size!==declared)throw new MetaDepositMediaError('DECLARED_SIZE_MISMATCH')
    return {data:Buffer.concat(chunks,size),mimeType:mimeType as 'image/jpeg'|'image/png'|'application/pdf'}
  }catch(error){if(error instanceof MetaDepositMediaError)throw error;throw new MetaDepositMediaError(controller.signal.aborted?'DOWNLOAD_TIMEOUT':'DOWNLOAD_FAILED')}
  finally {clearTimeout(timer)}
}
