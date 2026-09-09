import { prisma } from '../config/prisma.js'
import type { WorkshopJobsStore } from '../routes/workshop-jobs.js'
import { WorkshopJobError } from './workshop-job-domain.js'
import { isWorkshopDefaultShortcut } from './workshop-shortcuts.js'
export const workshopJobsStore: WorkshopJobsStore = {
  list: (businessId, vehicleId, date, performerId, limit, offset) => prisma.workshopJob.findMany({where:{businessId,...(vehicleId ? {vehicleId} : {}),...(date ? {date} : {}),...(performerId !== undefined ? {performerId} : {})},include:{vehicle:{select:{id:true,plate:true,model:true}}},orderBy:[{date:'desc'},{createdAt:'desc'},{id:'desc'}],...(limit?{take:limit,skip:offset||0}:{})}),
  performers: (businessId,includeInactive=false) => prisma.workshopPerformer.findMany({where:{businessId,...(includeInactive?{}:{active:true})},orderBy:{name:'asc'}}),
  async savePerformer(businessId,id,performer) {
    const duplicate=await prisma.workshopPerformer.findFirst({where:{businessId,normalizedName:performer.normalizedName,...(id?{NOT:{id}}:{})}})
    if(duplicate)throw new WorkshopJobError('Ya existe un trabajador con ese nombre')
    if(!id)return prisma.workshopPerformer.create({data:{businessId,...performer,active:performer.active??true}})
    const result=await prisma.workshopPerformer.updateMany({where:{businessId,id},data:performer})
    if(!result.count)throw new WorkshopJobError('Trabajador no encontrado')
    return prisma.workshopPerformer.findFirst({where:{businessId,id}})
  },
  shortcuts: businessId => prisma.workshopShortcut.findMany({where:{businessId},orderBy:[{position:'asc'},{name:'asc'}]}),
  async saveShortcut(businessId,id,data) {
    if (id && isWorkshopDefaultShortcut(businessId,id)) return prisma.workshopShortcut.upsert({where:{id},create:{id,businessId,...data},update:data})
    if (!id) return prisma.workshopShortcut.create({data:{businessId,...data}})
    const result = await prisma.workshopShortcut.updateMany({where:{id,businessId},data})
    if (!result.count) throw new WorkshopJobError('Boton no encontrado')
    return prisma.workshopShortcut.findFirst({where:{id,businessId}})
  },
  create: (businessId,job) => prisma.$transaction(async tx => {
    const vehicle = await tx.workshopVehicle.findFirst({where:{businessId,id:job.vehicleId}})
    if(!vehicle) throw new WorkshopJobError('Auto no encontrado en este taller')
    const performer = await tx.workshopPerformer.findFirst({where:{businessId,id:job.performerId,active:true}})
    if(!performer) throw new WorkshopJobError('Seleccion&aacute; un trabajador activo')
    const result = await tx.workshopJob.create({data:{businessId,...job,responsible:performer.name},include:{vehicle:{select:{id:true,plate:true,model:true}}}})
    await tx.workshopVehicle.updateMany({where:{businessId,id:job.vehicleId,OR:[{currentMileage:null},{currentMileage:{lt:job.mileage}}]},data:{currentMileage:job.mileage}})
    return result
  })
}
