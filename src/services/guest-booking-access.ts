import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'

const accessLifetimeSeconds = 7 * 24 * 60 * 60
const cookieName = (businessId: string) => `guest_booking_${businessId}`

export function prepareGuestBookingAccess() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + accessLifetimeSeconds * 1000) }
}

export async function persistGuestBookingAccess(transaction: Prisma.TransactionClient, input: {
  tokenHash: string; expiresAt: Date; businessId: string; appointmentIds: string[]; depositId: string | null
}) {
  if (!input.appointmentIds.length || new Set(input.appointmentIds).size !== input.appointmentIds.length) {
    throw new Error('GUEST_BOOKING_ACCESS_INVALID')
  }
  await transaction.guestBookingAccess.create({ data: input })
}

export function setGuestBookingCookie(request: FastifyRequest, reply: FastifyReply, input: {
  businessId: string; slug: string; token: string; expiresAt: Date
}) {
  const secure = request.protocol === 'https' || process.env.NODE_ENV === 'production'
  reply.header('Set-Cookie', `${cookieName(input.businessId)}=${input.token}; Path=/public/booking/${encodeURIComponent(input.slug)}; HttpOnly; SameSite=Strict; Max-Age=${accessLifetimeSeconds}; Expires=${input.expiresAt.toUTCString()}${secure ? '; Secure' : ''}`)
  reply.header('Cache-Control', 'no-store')
}

export async function resolveGuestBookingAccess(request: FastifyRequest, businessId: string) {
  const prefix = cookieName(businessId) + '='
  const token = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const access = await prisma.guestBookingAccess.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') }
  })
  if (!access || access.businessId !== businessId || access.expiresAt.getTime() <= Date.now() ||
    !access.appointmentIds.length || new Set(access.appointmentIds).size !== access.appointmentIds.length) return null
  const appointments = await prisma.appointment.findMany({
    where: { id: { in: access.appointmentIds }, businessId, origin: 'WEB' },
    include: { service: true, professional: true }, orderBy: { startAt: 'asc' }
  })
  if (appointments.length !== access.appointmentIds.length || appointments.some(appointment =>
    appointment.businessId !== businessId || appointment.origin !== 'WEB' || !access.appointmentIds.includes(appointment.id))) return null
  return { access, appointments }
}
