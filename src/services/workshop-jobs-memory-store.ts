import { randomUUID } from 'node:crypto'
import type { WorkshopJobsStore } from '../routes/workshop-jobs.js'
import { WorkshopJobError } from './workshop-job-domain.js'
import { isWorkshopDefaultShortcut } from './workshop-shortcuts.js'
export function createWorkshopJobsMemoryStore(
  findVehicle: (businessId:string,id:string)=>any,
  seed: {jobs?:any[];performers?:any[];shortcuts?:any[]} = {}
): WorkshopJobsStore {
  const jobs:any[]=[...(seed.jobs || [])], performers:any[]=[...(seed.performers || [])], shortcuts:any[]=[...(seed.shortcuts || [])]
  return {
    async list(businessId,vehicleId,date,performerId,limit,offset=0) {const rows=jobs.filter(x=>x.businessId===businessId&&(!vehicleId||x.vehicleId===vehicleId)&&(!date||x.date===date)&&(performerId===undefined||x.performerId===performerId)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));return limit?rows.slice(offset,offset+limit):rows},
    async performers(businessId,includeInactive=false){return performers.filter(x=>x.businessId===businessId&&(includeInactive||x.active))},
    async savePerformer(businessId,id,data){const duplicate=performers.find(x=>x.businessId===businessId&&x.normalizedName===data.normalizedName&&x.id!==id);if(duplicate)throw Object.assign(new Error('Duplicado'),{code:'P2002'});if(id){const x=performers.find(x=>x.businessId===businessId&&x.id===id);if(!x)throw new WorkshopJobError('Trabajador no encontrado');Object.assign(x,data);return x}const x={id:randomUUID(),businessId,...data,active:data.active??true};performers.push(x);return x},
    async shortcuts(businessId){return shortcuts.filter(x=>x.businessId===businessId).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name))},
    async saveShortcut(businessId,id,data){if(id){const x=shortcuts.find(x=>x.businessId===businessId&&x.id===id);if(x){Object.assign(x,data);return x}if(!isWorkshopDefaultShortcut(businessId,id))throw new WorkshopJobError('Boton no encontrado')}const x={id:id||randomUUID(),businessId,...data};shortcuts.push(x);return x},
    async create(businessId,job){const vehicle=findVehicle(businessId,job.vehicleId);if(!vehicle)throw new WorkshopJobError('Auto no encontrado en este taller');const performer=performers.find(x=>x.businessId===businessId&&x.id===job.performerId&&x.active);if(!performer)throw new WorkshopJobError('Seleccioná un trabajador activo');const record={id:randomUUID(),businessId,...job,responsible:performer.name,createdAt:new Date().toISOString(),vehicle:{id:vehicle.id,plate:vehicle.plate,model:vehicle.model}};jobs.push(record);vehicle.currentMileage=Math.max(vehicle.currentMileage??0,job.mileage);return record}
  }
}
