import type { Prisma } from '../generated/prisma/client.js'
import { containsDatedInterval, localParts, weekStart, type DatedHour } from './booking-program-domain.js'

export async function publishedProfessionalHours(tx: Prisma.TransactionClient, professionalId: string, startAt: Date, timezone?: string) {
  const professional = await tx.professional.findUnique({ where: { id: professionalId }, select: { availabilityMode: true, business: { select: { timezone: true } } } })
  const zone = timezone || professional?.business.timezone || 'America/Argentina/Buenos_Aires'
  const date = localParts(startAt, zone).date
  if (professional?.availabilityMode !== 'MANUAL') return null
  const week = await tx.availabilityWeek.findUnique({ where: { professionalId_weekStart: { professionalId, weekStart: weekStart(date) } } })
  return { date, timezone: zone, published: Boolean(week?.publishedAt), hours: (week?.publishedHours || []) as DatedHour[] }
}

export async function insidePublishedProfessionalHours(tx: Prisma.TransactionClient, input: { professionalId: string; startAt: Date; endAt: Date; timezone?: string }) {
  const manual = await publishedProfessionalHours(tx, input.professionalId, input.startAt, input.timezone)
  return manual ? manual.published && containsDatedInterval(manual.hours, input.startAt, input.endAt, manual.timezone) : null
}
