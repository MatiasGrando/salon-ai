import { prisma } from '../config/prisma.js'
import { InstagramPublicationService, PrismaInstagramPublicationRepository, InstagramPublicationConflictError, InstagramPublicationNotFoundError, InstagramPublicationValidationError } from './instagram-publication-service.js'
import { hasStoryDeclaration, storyCredentialFingerprint } from './instagram-stories-domain.js'
type Client = Record<string, any>
export class InstagramStoriesService {
  private readonly publications: InstagramPublicationService
  constructor(private readonly client: Client = prisma, private readonly clock: () => Date = () => new Date()) {
    this.publications = new InstagramPublicationService(new PrismaInstagramPublicationRepository(client, clock, 'STORY'), clock)
  }
  async capability(businessId: string) {
    const config = await this.client.businessInstagramConfig.findUnique({ where: { businessId } })
    return { accountId: config?.instagramAccountId ?? null, automatic: hasStoryDeclaration(config), source: hasStoryDeclaration(config) ? 'operator_declared' : 'unknown', declaredAt: hasStoryDeclaration(config) ? config.storiesDeclaredAt : null, message: 'Habilitado por el administrador; Instagram comprobará el permiso al publicar' }
  }
  async declare(businessId: string, actorId: string, enabled: boolean) {
    const config = await this.client.businessInstagramConfig.findUnique({ where: { businessId } })
    if (!config?.accessToken || !config.enabled || !config.instagramAccountId) throw new InstagramPublicationConflictError('Conectá Instagram antes de habilitar la publicación automática.')
    const changed = await this.client.businessInstagramConfig.updateMany({ where: { businessId, accessToken: config.accessToken, instagramAccountId: config.instagramAccountId, apiAccountId: config.apiAccountId }, data: { storiesDeclarationFingerprint: enabled ? storyCredentialFingerprint(config) : null, storiesDeclaredAt: enabled ? this.clock() : null, storiesDeclaredBy: enabled ? actorId : null } })
    if (changed.count !== 1) throw new InstagramPublicationConflictError('La cuenta cambió durante la habilitación.')
    return this.capability(businessId)
  }
  list(businessId: string) { return this.publications.list(businessId) }
  get(businessId: string, id: string) { return this.publications.get(businessId, id) }
  create(businessId: string, input: any) {
    const mode = input.deliveryMode ?? 'MANUAL', kind = input.mediaKind
    return this.publications.createDraft({ businessId, publicationType: 'STORY', mediaKind: kind, deliveryMode: mode, videoObjectPath: input.objectPath ?? '', videoMimeType: input.mimeType ?? '', videoSizeBytes: input.sizeBytes, caption: typeof input.note === 'string' ? input.note.slice(0,2200) : '', shareToFeed: false })
  }
  async update(businessId: string, id: string, input: any) {
    const current = await this.get(businessId,id)
    if (input.objectPath && input.mimeType !== current.videoMimeType) throw new InstagramPublicationValidationError(['Para cambiar de foto a video, creá otra historia.'])
    return this.publications.updateDraft(businessId,id,{ expectedRevision: input.expectedRevision, ...(typeof input.note === 'string' ? {caption:input.note.slice(0,2200)} : {}), ...(input.deliveryMode ? {deliveryMode:input.deliveryMode} : {}), ...(input.objectPath ? {videoObjectPath:input.objectPath,videoMimeType:input.mimeType,videoSizeBytes:input.sizeBytes} : {}) })
  }
  publish(businessId: string,id: string,revision: unknown) { return this.publications.publish(businessId,id,revision) }
  schedule(businessId: string,id: string,input: any) { return this.publications.schedule(businessId,id,input) }
  cancel(businessId: string,id: string,revision: unknown) { return this.publications.cancel(businessId,id,revision) }
  async prepareManual(businessId:string,id:string,revision:unknown) {
    if(!Number.isSafeInteger(revision))throw new InstagramPublicationValidationError(['La revisión es obligatoria.'])
    const changed=await this.client.instagramPublication.updateMany({where:{businessId,id,publicationType:'STORY',deliveryMode:'AUTO',status:'FAILED',revision,claimToken:null,claimedUntil:null,metaMediaId:null,videoDeletedAt:null,videoDeleteRequestedAt:null},data:{deliveryMode:'MANUAL',status:'DRAFT',metaContainerId:null,revision:{increment:1}}})
    if(changed.count!==1)throw new InstagramPublicationConflictError('Sólo un rechazo claro puede pasar a preparación manual; un resultado incierto requiere revisión.')
    return this.get(businessId,id)
  }
  async completeManual(businessId: string,id: string,revision: unknown) {
    if (!Number.isSafeInteger(revision) || (revision as number)<0) throw new InstagramPublicationValidationError(['La revisión es obligatoria.'])
    const changed = await this.client.instagramPublication.updateMany({ where: {businessId,id,publicationType:'STORY',deliveryMode:'MANUAL',revision,status:{in:['DRAFT','READY','SCHEDULED','CANCELLED']},claimToken:null,claimedUntil:null,metaContainerId:null,metaMediaId:null,videoDeletedAt:null,videoDeleteRequestedAt:null},data:{status:'MANUALLY_COMPLETED',manuallyCompletedAt:this.clock(),revision:{increment:1}} })
    if(changed.count!==1)throw new InstagramPublicationConflictError('La historia cambió o su resultado requiere revisión.')
    return this.get(businessId,id)
  }
}
