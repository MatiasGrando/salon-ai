import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseWorkshopJob, parseWorkshopPerformerName, parseWorkshopShortcut, WorkshopJobError } from '../services/workshop-job-domain.js'
import { mergeWorkshopShortcuts } from '../services/workshop-shortcuts.js'

export interface WorkshopJobsStore {
  list(businessId: string, vehicleId?: string, date?: string, performerId?: string | null, limit?: number, offset?: number): Promise<any[]>
  create(businessId: string, job: ReturnType<typeof parseWorkshopJob>): Promise<any>
  performers(businessId: string, includeInactive?: boolean): Promise<any[]>
  savePerformer(businessId: string, id: string | undefined, performer: {name:string;normalizedName:string;active?:boolean}): Promise<any>
  shortcuts(businessId: string): Promise<any[]>
  saveShortcut(businessId: string, id: string | undefined, data: any): Promise<any>
}
export async function registerWorkshopJobs(app: FastifyInstance, store: WorkshopJobsStore, authorize: (req: FastifyRequest, reply: FastifyReply, id?: string) => Promise<any>) {
  for (const resource of ['jobs','performers','shortcuts']) {
    app.get('/workshop/' + resource, async (req, reply) => {
      const q = req.query as any
      if (!await authorize(req, reply, q.businessId)) return
      if (resource === 'jobs') {
        const performerId=q.performerId === 'none' ? null : q.performerId || undefined
        if(q.vehicleId&&q.limit!==undefined){
          const limit=Math.min(10,Math.max(1,Number(q.limit)||10)),offset=Math.max(0,Number(q.offset)||0)
          const rows=await store.list(q.businessId,q.vehicleId,q.date,performerId,limit+1,offset)
          const hasMore=rows.length>limit
          return {items:rows.slice(0,limit),hasMore,nextOffset:hasMore?offset+limit:null}
        }
        return store.list(q.businessId, q.vehicleId, q.date, performerId)
      }
      return resource === 'performers' ? store.performers(q.businessId, q.includeInactive === '1') : mergeWorkshopShortcuts(q.businessId, await store.shortcuts(q.businessId))
    })
  }
  app.post('/workshop/jobs', async (req, reply) => {
    const body = req.body as any
    if (!await authorize(req, reply, body?.businessId)) return
    try { return reply.code(201).send(await store.create(body.businessId, parseWorkshopJob(body))) }
    catch (e) { if (e instanceof WorkshopJobError) return reply.code(400).send({message:e.message}); throw e }
  })
  const performer = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any
    if (!await authorize(req, reply, body?.businessId)) return
    try {
      if (body.active !== undefined && typeof body.active !== 'boolean') throw new WorkshopJobError('Estado de trabajador invalido')
      return reply.code((req.params as any)?.id ? 200 : 201).send(await store.savePerformer(body.businessId,(req.params as any)?.id,{...parseWorkshopPerformerName(body.name),...(body.active === undefined ? {} : {active:body.active})}))
    }
    catch(e) {
      if(e instanceof WorkshopJobError)return reply.code(e.message.startsWith('Ya existe')?409:400).send({message:e.message})
      if(e && typeof e==='object' && 'code' in e && e.code==='P2002')return reply.code(409).send({message:'Ya existe un trabajador con ese nombre'})
      throw e
    }
  }
  app.post('/workshop/performers',performer)
  app.patch('/workshop/performers/:id',performer)
  const shortcut = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any
    if (!await authorize(req, reply, body?.businessId)) return
    try {
      const data = parseWorkshopShortcut(body)
      const position = Number(body.position ?? 0)
      if (!Number.isInteger(position) || position < 0 || position > 10000) throw new WorkshopJobError('Orden invalido')
      return await store.saveShortcut(body.businessId, (req.params as any)?.id, {...data, position, active: body.active !== false})
    } catch(e) { if(e instanceof WorkshopJobError) return reply.code(400).send({message:e.message}); throw e }
  }
  app.post('/workshop/shortcuts', shortcut)
  app.patch('/workshop/shortcuts/:id', shortcut)
}
