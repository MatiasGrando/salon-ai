import assert from 'node:assert/strict'
process.env.DOTENV_CONFIG_PATH = '__instagram_stories_no_dotenv__'
process.env.DATABASE_URL = 'postgresql://fake:fake@127.0.0.1:1/stories_offline'
const { InstagramPublicationService } = await import('../src/services/instagram-publication-service.js')
let saved: any
const repository: any = { async createDraft(input: any) { saved = input; return { ...input,id:'story',status:'DRAFT',revision:0 } } }
const service = new InstagramPublicationService(repository)
const story: any = { businessId:'a',publicationType:'STORY',mediaKind:'IMAGE',deliveryMode:'MANUAL',videoObjectPath:'a/instagram/stories/12345678-1234-4234-8234-123456789abc.jpg',videoMimeType:'image/jpeg',videoSizeBytes:100,caption:'Nota interna',shareToFeed:false }
await service.createDraft(story)
assert.equal(saved.publicationType, 'STORY')
assert.equal(saved.automation.enabled, false)
assert.equal(saved.mediaKind, 'IMAGE')
console.log('OK: a manual JPEG Story draft is accepted independently of Reel automation')

const { InstagramApi, InstagramApiRequestError } = await import('../src/integrations/instagram-api.js')
const { hasStoryDeclaration, storyCredentialFingerprint } = await import('../src/services/instagram-stories-domain.js')
const { InstagramStoriesService } = await import('../src/services/instagram-stories-service.js')
const { InstagramPublicationWorker } = await import('../src/services/instagram-publication-worker.js')
const { default: sharp } = await import('sharp')
const config: any = {businessId:'a',enabled:true,instagramAccountId:'professional',apiAccountId:'app',accessToken:'fake-token',storiesDeclaredAt:new Date(),storiesDeclaredBy:'admin'}
config.storiesDeclarationFingerprint=storyCredentialFingerprint(config)
assert.equal(hasStoryDeclaration(config),true)
for(const patch of [{accessToken:'changed'},{instagramAccountId:'other'},{apiAccountId:'other'},{enabled:false},{storiesDeclaredBy:null}])assert.equal(hasStoryDeclaration({...config,...patch}),false)
const requests: any[]=[]
const api=new InstagramApi(async(url,options)=>{requests.push({url:String(url),body:options?.body?JSON.parse(String(options.body)):null});return Response.json({id:'container'})})
for(const mediaKind of ['IMAGE','VIDEO'] as const)await api.createStoryContainer({accountId:'app',accessToken:'fake-token',mediaUrl:'https://example.invalid/source',mediaKind})
assert.deepEqual(requests.map(r=>r.body),[{media_type:'STORIES',image_url:'https://example.invalid/source'},{media_type:'STORIES',video_url:'https://example.invalid/source'}])
assert.ok(requests.every(r=>!('caption'in r.body)&&!('share_to_feed'in r.body)))
console.log('OK: Story declarations bind account/credential and provider container omits Reel options')
const previousFetch=globalThis.fetch
process.env.SUPABASE_URL='https://storage.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='offline-service-key'
const storage=await import('../src/services/instagram-video-storage-service.js')
const jpeg=await sharp({create:{width:16,height:24,channels:3,background:'#446688'}}).jpeg().toBuffer()
let sourceBytes: Buffer=jpeg;let deletes=0
globalThis.fetch=async(url,options)=>{
 const value=String(url)
 if(options?.method==='DELETE'){deletes++;return Response.json({})}
 if(value.includes('/object/info/'))return Response.json({size:sourceBytes.length,content_type:'image/jpeg'})
 if(options?.method==='POST'&&value.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/instagram-reels/a/instagram/stories/fake.jpg?token=fake'})
 if(options?.method==='HEAD')return new Response(null,{headers:{'content-type':'image/jpeg','content-length':String(sourceBytes.length)}})
 return new Response(new Uint8Array(sourceBytes))
}
try {
 const objectPath='a/instagram/stories/12345678-1234-4234-8234-123456789abc.jpg'
 const verified=await storage.verifyAndSignInstagramReelVideo({businessId:'a',objectPath,expectedMimeType:'image/jpeg',expectedSizeBytes:jpeg.length,readOnly:true})
 assert.equal(verified.mimeType,'image/jpeg')
 sourceBytes=Buffer.from('pretending to be JPEG')
 await assert.rejects(storage.verifyAndSignInstagramReelVideo({businessId:'a',objectPath,expectedMimeType:'image/jpeg',expectedSizeBytes:sourceBytes.length,readOnly:true}),/JPEG válido/)
 assert.equal(deletes,0)
 await assert.rejects(storage.verifyAndSignInstagramReelVideo({businessId:'b',objectPath,expectedMimeType:'image/jpeg',expectedSizeBytes:jpeg.length,readOnly:true}),/no pertenece/)
}finally{globalThis.fetch=previousFetch}
console.log('OK: actual sharp verifies JPEG bytes and rejects a spoof without deleting an original')
const now=new Date('2026-10-26T12:00:00Z')
const row:any={...story,id:'s',status:'READY',revision:1,claimToken:null,claimedUntil:null,metaContainerId:null,metaMediaId:null,videoDeletedAt:null,videoDeleteRequestedAt:null,publishedAt:null,automation:{enabled:false,privateReplyText:'',keywords:[]}}
function matches(actual:any,where:any):boolean{return Object.entries(where).every(([key,value]:[string,any])=>value&&typeof value==='object'&&'in'in value?value.in.includes(actual[key]):actual[key]===value)}
const client:any={businessInstagramConfig:{findUnique:async()=>config,updateMany:async({where,data}:any)=>{if(!matches(config,where))return{count:0};Object.assign(config,data);return{count:1}}},instagramPublication:{
 findFirst:async({where}:any)=>matches(row,where)?row:null,
 findMany:async()=>[row],
 updateMany:async({where,data}:any)=>{if(!matches(row,where))return{count:0};for(const[key,value]of Object.entries(data))row[key]=value&&typeof value==='object'&&'increment'in value?row[key]+value.increment:value;return{count:1}}
}}
const stories=new InstagramStoriesService(client,()=>now)
const capability=await stories.capability('a')
assert.equal(capability.source,'operator_declared');assert.ok(!JSON.stringify(capability).includes(config.accessToken));assert.ok(!JSON.stringify(capability).includes(config.storiesDeclarationFingerprint))
await assert.rejects(stories.completeManual('b','s',1),/cambió/)
await assert.rejects(stories.completeManual('a','s',0),/cambió/)
const complete=await stories.completeManual('a','s',1)
assert.equal(complete.status,'MANUALLY_COMPLETED');assert.equal(+complete.manuallyCompletedAt!,+now);assert.equal(complete.publishedAt,null);assert.equal(complete.metaMediaId,null)
await assert.rejects(stories.completeManual('a','s',2),/cambió/)
for(const status of ['UNKNOWN','PUBLISHING']){row.status=status;await assert.rejects(stories.completeManual('a','s',2),/cambió/)}
let posts=0
const worker=new InstagramPublicationWorker({repository:{recoverExpiredAmbiguousPhases:async()=>0,claimNext:async()=>({...row,status:'READY'}),prepareDispatch:async()=>{throw Error('manual dispatch')},transition:async()=>false},api:{createReelContainer:async()=>{posts++;return{containerId:'x'}},getContainerStatus:async()=>({statusCode:'FINISHED'}),publishContainer:async()=>{posts++;return{mediaId:'x'}}},videoUrls:{createTemporaryHttpsUrl:async()=>{throw Error('manual source send')}},clock:{now:()=>now}})
assert.deepEqual(await worker.runOnce(),{outcome:'idle'});assert.equal(posts,0)
const { resolveInstagramAutomationTarget } = await import('../src/services/instagram-comment-automation-service.js')
await assert.rejects(resolveInstagramAutomationTarget({$queryRaw:async()=>[],businessInstagramConfig:{findUnique:async()=>({instagramAccountId:'professional'})},instagramPublication:{findFirst:async()=>({...row,publicationType:'STORY',status:'PUBLISHED'})}},'a',{publicationId:'s'}),/Reel publicado/)
console.log('OK: manual completion has its own date/status, rejects stale/foreign/uncertain rows and never dispatches; Story comments are rejected server-side')
const {resolveInstagramReelsRuntimeConfig}=await import('../src/services/instagram-reels-runtime.js')
assert.equal(resolveInstagramReelsRuntimeConfig({INSTAGRAM_REELS_ENABLED:'true'}).storiesEnabled,false,'Stories rollout must remain OFF even when Reels are already enabled')
for (const scenario of ['ambiguous', 'rotation']) {
  let posts = 0, token = 'credential-1'
  const row: any = { id:'story',businessId:'a',publicationType:'STORY',mediaKind:'IMAGE',deliveryMode:'AUTO',status:'READY',videoObjectPath:'a/instagram/stories/source.jpg',videoMimeType:'image/jpeg',videoSizeBytes:100,caption:'Internal note only',shareToFeed:false,metaContainerId:null,metaMediaId:null,attempts:0,maxAttempts:5,availableAt:now,claimToken:null,claimedUntil:null,lastError:null,instagramAccountId:'app',accessToken:token,destinationInstagramAccountId:'professional',destinationApiAccountId:'app' }
  const repository: any = {
    async recoverExpiredAmbiguousPhases(){ return 0 },
    async claimNext(input: any){ if(!['READY','PROCESSING'].includes(row.status))return null;row.claimToken=input.claimToken;row.claimedUntil=input.leaseUntil;return structuredClone(row) },
    async prepareDispatch(){ return {instagramAccountId:'app',accessToken:token} },
    async transition(input: any){if(row.status!==input.from||row.claimToken!==input.claimToken)return false;Object.assign(row,input.patch,{status:input.to});if(!input.keepLease){row.claimToken=null;row.claimedUntil=null}return true}
  }
  const worker = new InstagramPublicationWorker({ storiesEnabled: true, repository,clock:{now:()=>now},onStatusChanged(){},videoUrls:{async createTemporaryHttpsUrl(){return'https://storage.invalid/source'}},api:{
    async getStoryAccountType(){if(scenario==='rotation')token='credential-2';return{accountType:'BUSINESS'}},
    async createStoryContainer(input: any){posts++;assert.equal(input.mediaKind,'IMAGE');assert.ok(!('caption'in input));throw new InstagramApiRequestError({message:'Uncertain POST response',httpStatus:null,ambiguous:true,transient:true})},
    async createReelContainer(){throw Error('Story reached Reel transport')},async getContainerStatus(){return{statusCode:'FINISHED'}},async publishContainer(){throw Error('Unexpected publish')}
  } })
  const result = await worker.runOnce()
  assert.equal(result.outcome,'processed');if(result.outcome!=='processed')throw Error('Expected processed Story')
  assert.equal(result.status,scenario==='ambiguous'?'UNKNOWN':'FAILED')
  assert.equal(posts,scenario==='ambiguous'?1:0)
  if(scenario==='ambiguous'){assert.equal((await worker.runOnce()).outcome,'idle');assert.equal(posts,1)}
}

console.log('OK: permanent Story dispatch regressions cover credential rotation and ambiguous no-resend')
assert.equal(resolveInstagramReelsRuntimeConfig({INSTAGRAM_REELS_ENABLED:'true',INSTAGRAM_STORIES_ENABLED:'true'}).storiesEnabled,true)
