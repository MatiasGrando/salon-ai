import { createHash, randomBytes } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '../config/prisma.js'
import { normalizeArgentineMobilePhone, normalizePhone, phoneSearchVariants } from './phone-normalization-service.js'

const SESSION_COOKIE = 'weex_account_session'
const SESSION_MAX_AGE_DAYS = 90
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GOOGLE_OAUTH_REDIRECT_URI = 'postmessage'

const googleClientId = process.env.WEEX_GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || ''
const googleClientSecret = process.env.WEEX_GOOGLE_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || ''
const googleCalendarSyncEnabled = process.env.ENABLE_GOOGLE_CALENDAR_SYNC === 'true'
const googleClient = new OAuth2Client(googleClientId || undefined)
const googleCalendarClient = new OAuth2Client(googleClientId || undefined, googleClientSecret || undefined, GOOGLE_OAUTH_REDIRECT_URI)

export type WeexAccountAuth = {
  account: PublicWeexAccount
}

export type PublicWeexAccount = {
  id: string
  email: string
  emailVerified: boolean
  name: string
  avatarUrl: string | null
  phone: string | null
  phoneVerifiedAt: Date | null
  googleCalendarConnected: boolean
}

type GoogleProfile = {
  googleSub: string
  email: string
  emailVerified: boolean
  name: string
  avatarUrl: string | null
}

export function weexGoogleClientId() {
  return googleClientId
}

export function weexGoogleCalendarEnabled() {
  return Boolean(googleCalendarSyncEnabled && googleClientId && googleClientSecret)
}

export async function signInWithGoogleCredential(credential: string) {
  const profile = await verifyGoogleCredential(credential)
  const account = await prisma.weexAccount.upsert({
    where: {
      googleSub: profile.googleSub
    },
    update: {
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      avatarUrl: profile.avatarUrl
    },
    create: {
      googleSub: profile.googleSub,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      avatarUrl: profile.avatarUrl
    }
  })
  const session = await createWeexSession(account.id)

  return {
    account: publicWeexAccount(account),
    session
  }
}

export async function signInWithGoogleAuthCode(code: string) {
  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google Calendar no esta configurado')
  }

  const { tokens } = await googleCalendarClient.getToken(code)
  if (!tokens.id_token) {
    throw new Error('Google no devolvio una identidad valida')
  }
  const profile = await verifyGoogleCredential(tokens.id_token)
  const tokenUpdate = {
    ...(tokens.access_token ? { googleCalendarAccessToken: tokens.access_token } : {}),
    ...(tokens.refresh_token ? { googleCalendarRefreshToken: tokens.refresh_token } : {}),
    ...(tokens.expiry_date ? { googleCalendarTokenExpiresAt: new Date(tokens.expiry_date) } : {}),
    ...((tokens.scope || tokens.access_token) ? { googleCalendarScope: tokens.scope || GOOGLE_CALENDAR_SCOPE } : {})
  }
  const account = await prisma.weexAccount.upsert({
    where: {
      googleSub: profile.googleSub
    },
    update: {
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      ...tokenUpdate
    },
    create: {
      googleSub: profile.googleSub,
      email: profile.email,
      emailVerified: profile.emailVerified,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      googleCalendarAccessToken: tokens.access_token || null,
      googleCalendarRefreshToken: tokens.refresh_token || null,
      googleCalendarTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      googleCalendarScope: tokens.scope || (tokens.access_token ? GOOGLE_CALENDAR_SCOPE : null)
    }
  })
  const session = await createWeexSession(account.id)

  return {
    account: publicWeexAccount(account),
    session
  }
}

export async function createGoogleCalendarEventForAppointment(input: { accountId: string; appointmentId: string }) {
  const account = await prisma.weexAccount.findUnique({
    where: {
      id: input.accountId
    }
  })
  if (!account?.googleCalendarAccessToken && !account?.googleCalendarRefreshToken) {
    return {
      ok: false as const,
      message: 'Tu cuenta no tiene permiso de Google Calendar todavia.'
    }
  }
  if (!account.googleCalendarScope?.includes(GOOGLE_CALENDAR_SCOPE)) {
    return {
      ok: false as const,
      message: 'Falta autorizar el permiso de Google Calendar.'
    }
  }

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: input.appointmentId
    },
    include: {
      customer: true,
      service: true,
      professional: {
        include: {
          business: true
        }
      }
    }
  })
  if (!appointment) {
    return {
      ok: false as const,
      message: 'No encontre el turno para cargarlo en Calendar.'
    }
  }
  if (appointment.googleCalendarEventId && appointment.googleCalendarAccountId === account.id) {
    return {
      ok: true as const,
      eventId: appointment.googleCalendarEventId
    }
  }

  const client = new OAuth2Client(googleClientId || undefined, googleClientSecret || undefined, GOOGLE_OAUTH_REDIRECT_URI)
  client.setCredentials({
    ...(account.googleCalendarAccessToken ? { access_token: account.googleCalendarAccessToken } : {}),
    ...(account.googleCalendarRefreshToken ? { refresh_token: account.googleCalendarRefreshToken } : {}),
    ...(account.googleCalendarTokenExpiresAt ? { expiry_date: account.googleCalendarTokenExpiresAt.getTime() } : {})
  })
  client.on('tokens', (tokens) => {
    const tokenRefreshUpdate = {
      ...(tokens.access_token ? { googleCalendarAccessToken: tokens.access_token } : {}),
      ...(tokens.refresh_token ? { googleCalendarRefreshToken: tokens.refresh_token } : {}),
      ...(tokens.expiry_date ? { googleCalendarTokenExpiresAt: new Date(tokens.expiry_date) } : {})
    }
    if (Object.keys(tokenRefreshUpdate).length === 0) return
    void prisma.weexAccount.update({
      where: {
        id: account.id
      },
      data: tokenRefreshUpdate
    }).catch(() => null)
  })

  const startAt = appointment.startAt
  const endAt = new Date(startAt.getTime() + appointment.service.duration * 60_000)
  const businessName = appointment.professional.business.name
  const response = await client.request<{ id?: string }>({
    url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    method: 'POST',
    data: {
      summary: `${appointment.service.name} en ${businessName}`,
      description: [
        `Turno reservado en ${businessName}.`,
        `Profesional: ${appointment.professional.name}`,
        `Cliente: ${appointment.customer.name}`,
        appointment.customer.phone ? `Telefono: ${appointment.customer.phone}` : null
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: startAt.toISOString(),
        timeZone: 'America/Argentina/Buenos_Aires'
      },
      end: {
        dateTime: endAt.toISOString(),
        timeZone: 'America/Argentina/Buenos_Aires'
      }
    }
  })

  const eventId = response.data.id
  if (!eventId) {
    return {
      ok: false as const,
      message: 'Google Calendar no devolvio el evento creado.'
    }
  }

  await prisma.appointment.update({
    where: {
      id: appointment.id
    },
    data: {
      googleCalendarEventId: eventId,
      googleCalendarAccountId: account.id
    }
  })

  return {
    ok: true as const,
    eventId
  }
}

export async function getWeexAuthFromRequest(request: FastifyRequest): Promise<WeexAccountAuth | null> {
  const token = readCookie(request.headers.cookie || '', SESSION_COOKIE)
  if (!token) return null

  const session = await prisma.weexAccountSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      account: true
    }
  })
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) await prisma.weexAccountSession.delete({ where: { id: session.id } }).catch(() => null)
    return null
  }

  return {
    account: publicWeexAccount(session.account)
  }
}

export async function destroyWeexSessionFromRequest(request: FastifyRequest) {
  const token = readCookie(request.headers.cookie || '', SESSION_COOKIE)
  if (!token) return
  await prisma.weexAccountSession.deleteMany({
    where: {
      tokenHash: hashSessionToken(token)
    }
  })
}

export async function updateWeexPhone(accountId: string, phoneInput: string, defaultAreaCode?: string | null) {
  const normalized = normalizeArgentineMobilePhone(phoneInput, { defaultAreaCode })
  if (!normalized.ok) {
    return {
      ok: false as const,
      message: normalized.message
    }
  }
  const phone = normalized.phone

  const account = await prisma.weexAccount.update({
    where: {
      id: accountId
    },
    data: {
      phone,
      phoneVerifiedAt: null
    }
  })
  const linkedCount = await linkExistingCustomersByPhone(account.id, phone, defaultAreaCode)

  return {
    ok: true as const,
    account: publicWeexAccount(account),
    linkedCount
  }
}

export async function linkExistingCustomersByPhone(accountId: string, phone: string, defaultAreaCode?: string | null) {
  const normalizedPhone = normalizePhone(phone, { defaultAreaCode })
  const phoneVariants = phoneSearchVariants(phone, { defaultAreaCode })
  const appointments = await prisma.appointment.findMany({
    where: {
      customer: {
        phone: {
          in: phoneVariants
        }
      }
    },
    select: {
      customerId: true,
      professional: {
        select: {
          businessId: true
        }
      }
    }
  })

  const uniqueLinks = new Map<string, { customerId: string; businessId: string }>()
  for (const appointment of appointments) {
    const businessId = appointment.professional.businessId
    uniqueLinks.set(`${appointment.customerId}:${businessId}`, {
      customerId: appointment.customerId,
      businessId
    })
  }

  for (const link of uniqueLinks.values()) {
    await prisma.weexCustomerLink.upsert({
      where: {
        weexAccountId_customerId_businessId: {
          weexAccountId: accountId,
          customerId: link.customerId,
          businessId: link.businessId
        }
      },
      update: {
        phone: normalizedPhone
      },
      create: {
        weexAccountId: accountId,
        customerId: link.customerId,
        businessId: link.businessId,
        phone: normalizedPhone
      }
    })
  }

  return uniqueLinks.size
}

export async function getWeexAppointmentsForBusiness(accountId: string, businessSlug?: string, limit = 5) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20)
  const business = businessSlug
    ? await prisma.business.findUnique({
        where: {
          slug: businessSlug
        },
        select: {
          id: true,
          name: true,
          slug: true
        }
      })
    : null

  if (businessSlug && !business) {
    return {
      business: null,
      appointments: []
    }
  }

  const links = await prisma.weexCustomerLink.findMany({
    where: {
      weexAccountId: accountId,
      ...(business ? { businessId: business.id } : {})
    },
    select: {
      customerId: true,
      businessId: true
    }
  })

  const customerIds = [...new Set(links.map((link) => link.customerId))]
  if (!customerIds.length) {
    return {
      business,
      appointments: []
    }
  }

  const allowedBusinessIds = new Set(links.map((link) => link.businessId))
  const appointments = await prisma.appointment.findMany({
    where: {
      customerId: {
        in: customerIds
      },
      professional: {
        businessId: {
          in: [...allowedBusinessIds]
        }
      }
    },
    include: {
      customer: true,
      service: true,
      professional: {
        include: {
          business: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      }
    },
    orderBy: {
      startAt: 'desc'
    },
    take: safeLimit
  })

  return {
    business,
    appointments: appointments.map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt,
      status: appointment.status,
      service: {
        id: appointment.service.id,
        name: appointment.service.name,
        duration: appointment.service.duration,
        price: appointment.service.price
      },
      professional: {
        id: appointment.professional.id,
        name: appointment.professional.name
      },
      business: appointment.professional.business,
      customer: {
        id: appointment.customer.id,
        name: appointment.customer.name,
        phone: appointment.customer.phone
      }
    }))
  }
}

export function buildWeexSessionCookie(token: string, expiresAt: Date) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : null
  ].filter(Boolean).join('; ')
}

export function buildExpiredWeexSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    process.env.NODE_ENV === 'production' ? 'Secure' : null
  ].filter(Boolean).join('; ')
}

async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  if (!googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID no esta configurado')
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId
  })
  const payload = ticket.getPayload()
  if (!payload?.sub || !payload.email) {
    throw new Error('Google no devolvio los datos necesarios de la cuenta')
  }

  return {
    googleSub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name || payload.email,
    avatarUrl: payload.picture || null
  }
}

async function createWeexSession(accountId: string) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashSessionToken(token)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_MAX_AGE_DAYS)

  await prisma.weexAccountSession.create({
    data: {
      tokenHash,
      accountId,
      expiresAt
    }
  })

  return {
    token,
    expiresAt
  }
}

function publicWeexAccount(account: {
  id: string
  email: string
  emailVerified: boolean
  name: string
  avatarUrl: string | null
  phone: string | null
  phoneVerifiedAt: Date | null
  googleCalendarRefreshToken?: string | null
  googleCalendarAccessToken?: string | null
  googleCalendarScope?: string | null
}) {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerified,
    name: account.name,
    avatarUrl: account.avatarUrl,
    phone: account.phone,
    phoneVerifiedAt: account.phoneVerifiedAt,
    googleCalendarConnected: Boolean(
      (account.googleCalendarRefreshToken || account.googleCalendarAccessToken)
      && account.googleCalendarScope?.includes(GOOGLE_CALENDAR_SCOPE)
    )
  }
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
