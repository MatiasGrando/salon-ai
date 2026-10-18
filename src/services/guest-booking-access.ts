import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'

const accessLifetimeSeconds = 7 * 24 * 60 * 60
const cookieName = (businessId: string) => `guest_booking_${businessId}`
const maxNewBookingAccesses = 20
const maxReadableCookieAccesses = 40
const maxCookieHeaderBytes = 12 * 1024
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

class GuestBookingCookieError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message) }
}

function guestCookieTokens(request: FastifyRequest, businessId: string) {
  const header = request.headers.cookie || ''
  if (Buffer.byteLength(header, 'utf8') > maxCookieHeaderBytes) {
    throw new GuestBookingCookieError('No pudimos consultar las reservas de este navegador: los datos guardados superan el límite permitido.')
  }
  const prefix = cookieName(businessId)
  const tokens = new Set<string>()
  let matchingCookies = 0
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name !== prefix && !name.startsWith(prefix + '_')) continue
    if (++matchingCookies > maxReadableCookieAccesses) {
      throw new GuestBookingCookieError('Hay demasiados accesos de reserva en este navegador. No se modificaron tus turnos.')
    }
    const token = part.slice(separator + 1).trim()
    if (!/^[a-f0-9]{64}$/.test(token)) continue
    if (name !== prefix && name !== prefix + '_' + hashToken(token).slice(0, 16)) continue
    tokens.add(token)
  }
  return [...tokens]
}

export function prepareGuestBookingAccess() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + accessLifetimeSeconds * 1000) }
}

export async function persistGuestBookingAccess(transaction: Prisma.TransactionClient, input: {
  tokenHash: string; expiresAt: Date; businessId: string; appointmentIds: string[]; depositId: string | null
}) {
  if (!input.appointmentIds.length || new Set(input.appointmentIds).size !== input.appointmentIds.length) {
    throw new Error('GUEST_BOOKING_ACCESS_INVALID')
  }
  return transaction.guestBookingAccess.create({ data: input })
}

export function setGuestBookingCookie(request: FastifyRequest, reply: FastifyReply, input: {
  businessId: string; slug: string; token: string; expiresAt: Date
}) {
  const secure = request.protocol === 'https' || process.env.NODE_ENV === 'production'
  const name = cookieName(input.businessId) + '_' + hashToken(input.token).slice(0, 16)
  reply.header('Set-Cookie', `${name}=${input.token}; Path=/public/booking/${encodeURIComponent(input.slug)}; HttpOnly; SameSite=Strict; Max-Age=${accessLifetimeSeconds}; Expires=${input.expiresAt.toUTCString()}${secure ? '; Secure' : ''}`)
  reply.header('Cache-Control', 'no-store')
}

export async function resolveGuestBookingAccesses(request: FastifyRequest, businessId: string, client?: Prisma.TransactionClient) {
  const tokens = guestCookieTokens(request, businessId)
  if (!tokens.length) return []
  const accesses = await (client ?? prisma).guestBookingAccess.findMany({
    where: { tokenHash: { in: tokens.map(hashToken) }, businessId, expiresAt: { gt: new Date() } }
  })
  const validAccesses = accesses.filter(access => access.businessId === businessId && access.expiresAt.getTime() > Date.now() &&
    access.appointmentIds.length > 0 && access.appointmentIds.length <= 5 &&
    new Set(access.appointmentIds).size === access.appointmentIds.length)
  if (!validAccesses.length) return []
  const appointments = await (client ?? prisma).appointment.findMany({
    where: { id: { in: [...new Set(validAccesses.flatMap(access => access.appointmentIds))] }, businessId, origin: 'WEB' },
    include: { service: true, professional: true }, orderBy: { startAt: 'asc' }
  })
  const byId = new Map(appointments.map(appointment => [appointment.id, appointment]))
  return validAccesses.flatMap(access => {
    const selected = access.appointmentIds.map(id => byId.get(id)).filter((appointment): appointment is typeof appointments[number] => Boolean(appointment))
    if (selected.length !== access.appointmentIds.length || selected.some(appointment =>
      appointment.businessId !== businessId || appointment.origin !== 'WEB')) return []
    selected.sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    return [{ access, appointments: selected }]
  }).sort((left, right) => right.access.createdAt.getTime() - left.access.createdAt.getTime() || right.access.id.localeCompare(left.access.id))
}

export async function resolveGuestBookingAccess(request: FastifyRequest, businessId: string, selection?: { depositId: string }) {
  const scopes = await resolveGuestBookingAccesses(request, businessId)
  return (selection ? scopes.find(scope => scope.access.depositId === selection.depositId) : scopes[0]) ?? null
}

export async function ensureGuestBookingCapacity(request: FastifyRequest, businessId: string) {
  const projectedCookie = cookieName(businessId) + '_' + '0'.repeat(16) + '=' + '0'.repeat(64)
  if (Buffer.byteLength((request.headers.cookie || '') + '; ' + projectedCookie, 'utf8') > maxCookieHeaderBytes) {
    throw new GuestBookingCookieError('No hay espacio seguro para otra reserva en este navegador. Tus reservas anteriores se conservan.')
  }
  const scopes = await resolveGuestBookingAccesses(request, businessId)
  // Separate admission/read bounds retain simultaneous tab results; this is not a transactional browser counter.
  if (scopes.length >= maxNewBookingAccesses) {
    throw new GuestBookingCookieError('Este navegador ya conserva 20 reservas con acceso vigente. Podés consultarlas; no se creó otra reserva.', 409)
  }
}
