import type { PrismaClient } from '../generated/prisma/client.js'
import { computeExceptionWindow } from '../bot-options/application/hours-queries.js'
import { validatePublicProfessionalFacts, type PublicProfessionalFacts } from './public-professional-facts.js'
export type PublicProfessionalClient = Pick<PrismaClient, 'professional' | 'professionalHours' | 'scheduleBlock'>
export type PublicProfessionalContext = { businessId: string; timezone: string; dbNow: Date }
/** Same public hours repository projections, bulked for a fixed three reads. No appointments or private compensation. */
export async function loadPublicProfessionalFacts(client: PublicProfessionalClient, context: PublicProfessionalContext): Promise<PublicProfessionalFacts> {
  const rows = await client.professional.findMany({
    where: { businessId: context.businessId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 51,
    select: { id: true, businessId: true, name: true, description: true, acceptsBotBookings: true,
      serviceLinks: { where: { service: { businessId: context.businessId, isActive: true } }, take: 101,
        select: { service: { select: { id: true, businessId: true, name: true, description: true } } }, orderBy: { serviceId: 'asc' } } }
  })
  if (rows.length > 50 || rows.some(row => row.businessId !== context.businessId || row.serviceLinks.some(link => link.service.businessId !== context.businessId))) throw new Error('invalid public professional scope')
  const ids = rows.map(row => row.id)
  const { from, to } = computeExceptionWindow(context.dbNow, context.timezone)
  const weekly = await client.professionalHours.findMany({ where: { professionalId: { in: ids }, professional: { businessId: context.businessId, isActive: true } },
    select: { professionalId: true, dayOfWeek: true, startTime: true, endTime: true }, orderBy: [{ professionalId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }], take: 5001 })
  const exceptions = await client.scheduleBlock.findMany({ where: { businessId: context.businessId, startAt: { lt: to }, endAt: { gt: from },
    OR: [{ professionalId: null }, { professionalId: { in: ids }, professional: { businessId: context.businessId, isActive: true } }] },
    select: { businessId: true, professionalId: true, startAt: true, endAt: true }, orderBy: { startAt: 'asc' }, take: 5101 })
  if (weekly.length > 5000 || exceptions.length > 5100) throw new Error('public professional data exceeds supported bound')
  if (weekly.some(row => !ids.includes(row.professionalId)) || exceptions.some(row => row.businessId !== context.businessId || row.professionalId !== null && !ids.includes(row.professionalId))) throw new Error('invalid public professional hours scope')
  const publicExceptions = (values: typeof exceptions) => values.map(value => ({ startAt: value.startAt.toISOString(), endAt: value.endAt.toISOString() }))
  const professionals = rows.map(row => ({ id: row.id, name: row.name, description: row.description ?? null, acceptsBotBookings: row.acceptsBotBookings,
    services: row.serviceLinks.map(link => ({ id: link.service.id, name: link.service.name, description: link.service.description ?? null })),
    weeklyHours: weekly.filter(hour => hour.professionalId === row.id).map(hour => ({ dayOfWeek: hour.dayOfWeek, startTime: hour.startTime, endTime: hour.endTime })),
    exceptions: publicExceptions(exceptions.filter(exception => exception.professionalId === row.id)) }))
  const facts: PublicProfessionalFacts = { businessId: context.businessId, timezone: context.timezone,
    exceptionWindow: { from: from.toISOString(), to: to.toISOString() }, businessExceptions: publicExceptions(exceptions.filter(row => row.professionalId === null)), professionals }
  validatePublicProfessionalFacts(facts)
  return facts
}
