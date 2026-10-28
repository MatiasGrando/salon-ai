import type { FastifyInstance } from 'fastify'
import { InstagramDuplicationService } from '../services/instagram-duplication-service.js'
import { InstagramStoriesService } from '../services/instagram-stories-service.js'
import { InstagramPublicationConflictError, InstagramPublicationValidationError, InstagramPublicationNotFoundError } from '../services/instagram-publication-service.js'
import { createInstagramReelUpload, verifyAndSignInstagramReelVideo } from '../services/instagram-video-storage-service.js'
export async function instagramStoriesRoutes(app: FastifyInstance, options: { service?: InstagramStoriesService; runtimeReady?: boolean; allowedBusinessIds?: readonly string[]; storage?: { createUpload: typeof createInstagramReelUpload; verify: typeof verifyAndSignInstagramReelVideo } } = {}) {
  const service = options.service ?? new InstagramStoriesService()
  const storage = options.storage ?? { createUpload: createInstagramReelUpload, verify: verifyAndSignInstagramReelVideo }
  app.addHook('preHandler',async (request,reply)=>{
    if(request.method==='GET')return
    if(!options.runtimeReady)return reply.status(503).send({message:'La preparación de historias no está habilitada o falta su almacenamiento.'})
    if(options.allowedBusinessIds && !options.allowedBusinessIds.includes((request.params as any).businessId))return reply.status(404).send({message:'Historias no disponibles para este comercio.'})
  })
  const base='/businesses/:businessId/instagram-stories'
  app.get(base+'/capability',async(request,reply)=>{try{return {...await service.capability((request.params as any).businessId),runtimeReady:!!options.runtimeReady}}catch(error){return failure(reply,error)}})
  app.post(base+'/capability',async(request,reply)=>{
    const user=request.auth?.user
    if(!user || !['SUPER_ADMIN','ACCOUNT_ADMIN','BUSINESS_ADMIN'].includes(user.role))return reply.status(403).send({message:'Sólo un administrador puede habilitar historias automáticas.'})
    const body=object(request.body)
    if(typeof body.enabled!=='boolean' || (body.enabled && body.acknowledged!==true))return reply.status(400).send({message:'Confirmá expresamente la habilitación declarada.'})
    try{return await service.declare((request.params as any).businessId,user.id,body.enabled)}catch(error){return failure(reply,error)}
  })
  app.get(base,async(request,reply)=>{try{return (await service.list((request.params as any).businessId)).map(dto)}catch(error){return failure(reply,error)}})
  app.get(base+'/:storyId',async(request,reply)=>{const p=request.params as any;try{return dto(await service.get(p.businessId,p.storyId))}catch(error){return failure(reply,error)}})
  app.post(base+'/uploads',async(request,reply)=>{const p=request.params as any,body=object(request.body);try{return await storage.createUpload({businessId:p.businessId,publicationType:'STORY',mimeType:body.mimeType as string,sizeBytes:body.sizeBytes as number})}catch{return reply.status(400).send({message:'Elegí una foto JPEG de hasta 8 MB o un video MP4/MOV dentro del límite del CRM.'})}})
  app.post(base+'/uploads/verify',async(request,reply)=>{const p=request.params as any,body=object(request.body);try{
    assertStoryPath(p.businessId,body.objectPath)
    const verified=await storage.verify({businessId:p.businessId,objectPath:body.objectPath as string,expectedMimeType:body.mimeType as string,expectedSizeBytes:body.sizeBytes as number,readOnly:true})
    return{verified:true,objectPath:body.objectPath,mimeType:verified.mimeType,sizeBytes:verified.sizeBytes}
  }catch{return reply.status(400).send({message:'No se pudo verificar el archivo. Las fotos deben ser JPEG reales de hasta 8 MB y 20 megapíxeles (política del CRM).'})}})
  app.post(base,async(request,reply)=>{const p=request.params as any,body=object(request.body);try{
    assertStoryPath(p.businessId,body.objectPath)
    await storage.verify({businessId:p.businessId,objectPath:body.objectPath as string,expectedMimeType:body.mimeType as string,expectedSizeBytes:body.sizeBytes as number,readOnly:true})
    return reply.status(201).send(dto(await service.create(p.businessId,body)))
  }catch(error){return failure(reply,error)}})
  app.patch(base+'/:storyId',async(request,reply)=>{const p=request.params as any,body=object(request.body);try{
    if(body.objectPath){assertStoryPath(p.businessId,body.objectPath);await storage.verify({businessId:p.businessId,objectPath:body.objectPath as string,expectedMimeType:body.mimeType as string,expectedSizeBytes:body.sizeBytes as number,readOnly:true})}
    return dto(await service.update(p.businessId,p.storyId,body))
  }catch(error){return failure(reply,error)}})
  for(const action of ['publish','schedule','cancel','complete-manual'] as const)app.post(base+'/:storyId/'+action,async(request,reply)=>{const p=request.params as any,body=object(request.body);try{
    if(action==='complete-manual' && body.confirmed!==true)throw new InstagramPublicationValidationError(['Confirmá que completaste la historia manualmente.'])
    if(action==='publish'||action==='schedule'){const current=await service.get(p.businessId,p.storyId);await storage.verify({businessId:p.businessId,objectPath:current.videoObjectPath,expectedMimeType:current.videoMimeType,expectedSizeBytes:current.videoSizeBytes,readOnly:true})}
    const row=action==='schedule'?await service.schedule(p.businessId,p.storyId,body):action==='cancel'?await service.cancel(p.businessId,p.storyId,body.expectedRevision):action==='complete-manual'?await service.completeManual(p.businessId,p.storyId,body.expectedRevision):await service.publish(p.businessId,p.storyId,body.expectedRevision)
    return dto(row)
  }catch(error){return failure(reply,error)}})
  app.post(base+'/:storyId/prepare-manual',async(request,reply)=>{const p=request.params as any,body=object(request.body);try{
    if(body.confirmed!==true)throw new InstagramPublicationValidationError(['Confirmá la preparación manual.'])
    return dto(await service.prepareManual(p.businessId,p.storyId,body.expectedRevision))
  }catch(error){return failure(reply,error)}})
  app.post(base+'/:storyId/duplicate',async(request,reply)=>{const p=request.params as any;try{
    const result=await new InstagramDuplicationService().duplicate(p.businessId,{publicationId:p.storyId,publicationType:'STORY'},object(request.body).expectedRevision)
    return {...result,publication:result.publication?dto(result.publication):null}
  }catch(error){return failure(reply,error)}})
  app.get(base+'/:storyId/download',async(request,reply)=>{const p=request.params as any;try{
    const current=await service.get(p.businessId,p.storyId)
    if(!current.videoAvailable || current.videoDeleteRequestedAt)throw new InstagramPublicationConflictError('El archivo ya no está disponible.')
    const signed=await storage.verify({businessId:p.businessId,objectPath:current.videoObjectPath,expectedMimeType:current.videoMimeType,expectedSizeBytes:current.videoSizeBytes,readOnly:true})
    reply.header('Cache-Control','no-store')
    return {url:signed.signedUrl,expiresAt:signed.expiresAt,mimeType:current.videoMimeType}
  }catch(error){return failure(reply,error)}})
}
function dto(row:any){return {...row,objectPath:row.videoObjectPath,mimeType:row.videoMimeType,sizeBytes:row.videoSizeBytes,note:row.caption}}
function object(raw:unknown):Record<string,unknown>{return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{}}
function assertStoryPath(businessId:string,raw:unknown){if(typeof raw!=='string'||!raw.startsWith(businessId+'/instagram/stories/'))throw new InstagramPublicationValidationError(['El archivo no pertenece a las historias de este comercio.'])}
function failure(reply:any,error:unknown){const status=error instanceof InstagramPublicationValidationError?400:error instanceof InstagramPublicationConflictError?409:error instanceof InstagramPublicationNotFoundError?404:503;return reply.status(status).send({message:status===503?'No se pudo completar la operación de historias.':(error as Error).message})}
