import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'

const scrypt = promisify(scryptCallback)
const SESSION_COOKIE = 'salon_ai_session'
const SESSION_MAX_AGE_DAYS = 30

export type AuthUser = {
  id: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'BUSINESS_ADMIN' | 'STAFF'
  businessId: string | null
}

export type AuthContext = {
  user: AuthUser
}

export function sessionCookieName() {
  return SESSION_COOKIE
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, expectedHex] = passwordHash.split('$')
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false
  const actual = await scrypt(password, salt, 64) as Buffer
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashSessionToken(token)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_MAX_AGE_DAYS)

  await prisma.userSession.create({
    data: {
      tokenHash,
      userId,
      expiresAt
    }
  })

  return { token, expiresAt }
}

export async function getAuthFromRequest(request: FastifyRequest): Promise<AuthContext | null> {
  const token = readCookie(request.headers.cookie || '', SESSION_COOKIE)
  if (!token) return null
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: true
    }
  })
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    if (session) await prisma.userSession.delete({ where: { id: session.id } }).catch(() => null)
    return null
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      businessId: session.user.businessId
    }
  }
}

export async function destroySessionFromRequest(request: FastifyRequest) {
  const token = readCookie(request.headers.cookie || '', SESSION_COOKIE)
  if (!token) return
  await prisma.userSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } })
}

export function buildSessionCookie(token: string, expiresAt: Date) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : null
  ].filter(Boolean).join('; ')
}

export function buildExpiredSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    process.env.NODE_ENV === 'production' ? 'Secure' : null
  ].filter(Boolean).join('; ')
}

export async function ensureBootstrapSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.SUPER_ADMIN_PASSWORD?.trim()
  const name = process.env.SUPER_ADMIN_NAME?.trim() || 'Salon AI Admin'
  if (!email || !password) return

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== 'SUPER_ADMIN' || !existing.isActive) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'SUPER_ADMIN', isActive: true, name }
      })
    }
    return
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: 'SUPER_ADMIN'
    }
  })
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function readCookie(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...valueParts] = part.trim().split('=')
    if (rawKey === name) return decodeURIComponent(valueParts.join('=') || '')
  }
  return null
}
