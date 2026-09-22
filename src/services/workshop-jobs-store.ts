import { prisma } from '../config/prisma.js'
import type { WorkshopJobsStore } from '../routes/workshop-jobs.js'
import { WorkshopJobError } from './workshop-job-domain.js'
import { isWorkshopDefaultShortcut, workshopDefaultShortcuts } from './workshop-shortcuts.js'
import { calculateWorkshopMaintenance, shouldReplaceWorkshopMaintenance } from './workshop-maintenance.js'
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
  async shortcuts(businessId) {
    await prisma.workshopShortcut.createMany({ data: workshopDefaultShortcuts(businessId), skipDuplicates: true })
    return prisma.workshopShortcut.findMany({where:{businessId},orderBy:[{position:'asc'},{name:'asc'}]})
  },
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
    const serviceIds = Array.from(new Set<string>(job.lines.flatMap((line:any)=>line.serviceId?[line.serviceId]:[])))
    const selectedDefaults = workshopDefaultShortcuts(businessId).filter(service=>serviceIds.includes(service.id))
    if(selectedDefaults.length) await tx.workshopShortcut.createMany({data:selectedDefaults,skipDuplicates:true})
    const services = serviceIds.length ? await tx.workshopShortcut.findMany({where:{businessId,id:{in:serviceIds}}}) : []
    if(services.length!==serviceIds.length)throw new WorkshopJobError('Uno de los servicios no pertenece a este taller')
    const servicesById = new Map(services.map(service=>[service.id,service]))
    const maintenance: Array<NonNullable<ReturnType<typeof calculateWorkshopMaintenance>>> = []
    const enrichedLines=job.lines.map((line:any)=>{
      if(!line.serviceId)return line
      const service=servicesById.get(line.serviceId)!
      const cycle=calculateWorkshopMaintenance({jobDate:job.date,jobMileage:job.mileage,line,service})
      if(cycle)maintenance.push(cycle)
      return {...line,serviceName:service.name,recurrenceEnabled:service.recurrenceEnabled,returnMonths:service.returnMonths,returnKilometers:service.returnKilometers,customerInstructions:service.customerInstructions,...(cycle?{nextDueDate:cycle.nextDueDate,nextDueMileage:cycle.nextDueMileage,manuallyAdjusted:cycle.manuallyAdjusted}:{})}
    })
    const performer = await tx.workshopPerformer.findFirst({where:{businessId,id:job.performerId,active:true}})
    if(!performer) throw new WorkshopJobError('Seleccion&aacute; un trabajador activo')
    const result = await tx.workshopJob.create({data:{businessId,...job,lines:enrichedLines,responsible:performer.name},include:{vehicle:{select:{id:true,plate:true,model:true}}}})
    const existingCycles = maintenance.length ? await tx.workshopMaintenanceCycle.findMany({
      where:{businessId,vehicleId:job.vehicleId,serviceId:{in:maintenance.map(cycle=>cycle.serviceId)}},
      select:{serviceId:true,lastPerformedDate:true}
    }) : []
    const existingCycleDates = new Map(existingCycles.map(cycle=>[cycle.serviceId,cycle.lastPerformedDate]))
    for(const cycle of maintenance){
      if (!shouldReplaceWorkshopMaintenance(existingCycleDates.get(cycle.serviceId), cycle.lastPerformedDate)) continue
      await tx.workshopMaintenanceCycle.upsert({
        where:{businessId_vehicleId_serviceId:{businessId,vehicleId:job.vehicleId,serviceId:cycle.serviceId}},
        create:{businessId,vehicleId:job.vehicleId,lastJobId:result.id,...cycle},
        update:{lastJobId:result.id,...cycle}
      })
    }
    await tx.workshopVehicle.updateMany({where:{businessId,id:job.vehicleId,OR:[{currentMileage:null},{currentMileage:{lt:job.mileage}}]},data:{currentMileage:job.mileage}})
    return result
  })
}
