import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sendTamaraContactEmail } from '../services/tamara-contact-email-service.js'

const tamaraHost = 'tamaragrando.weex.com.ar'
const tamaraSiteDir = join(process.cwd(), 'src', 'assets', 'tamara-site')
const contactAttempts = new Map<string, number[]>()
const contactWindowMs = 10 * 60 * 1000
const contactLimit = 5

const tamaraAssets = [
  { url: '/tamara-grando-profile-dark.png', file: 'tamara-grando-profile-dark.png', contentType: 'image/png' },
  { url: '/branding/modo9-emblem-web.jpg', file: join('branding', 'modo9-emblem-web.jpg'), contentType: 'image/jpeg' },
  { url: '/partners/chacarita-juniors.svg', file: join('partners', 'chacarita-juniors.svg'), contentType: 'image/svg+xml' },
  { url: '/partners/deportivo-espanol.svg', file: join('partners', 'deportivo-espanol.svg'), contentType: 'image/svg+xml' },
  { url: '/partners/deportivo-riestra.svg', file: join('partners', 'deportivo-riestra.svg'), contentType: 'image/svg+xml' },
  { url: '/testimonials/juan-m-avatar.jpg', file: join('testimonials', 'juan-m-avatar.jpg'), contentType: 'image/jpeg' },
  { url: '/testimonials/florencia-l-avatar.jpg', file: join('testimonials', 'florencia-l-avatar.jpg'), contentType: 'image/jpeg' },
  { url: '/testimonials/ramiro-s-avatar.jpg', file: join('testimonials', 'ramiro-s-avatar.jpg'), contentType: 'image/jpeg' },
  { url: '/testimonials/agustin-p-avatar.jpg', file: join('testimonials', 'agustin-p-avatar.jpg'), contentType: 'image/jpeg' },
  { url: '/testimonials/camila-r-avatar.jpg', file: join('testimonials', 'camila-r-avatar.jpg'), contentType: 'image/jpeg' },
  { url: '/testimonials/nicolas-t-avatar.jpg', file: join('testimonials', 'nicolas-t-avatar.jpg'), contentType: 'image/jpeg' }
] as const

export async function tamaraSiteRoutes(app: FastifyInstance) {
  app.get('/', { constraints: { host: tamaraHost } }, async (_request, reply) => {
    const html = await readFile(join(tamaraSiteDir, 'index.html'))
    applySiteHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  app.post('/contacto', { constraints: { host: tamaraHost } }, async (request, reply) => {
    const body = request.body as {
      name?: unknown
      contact?: unknown
      interest?: unknown
      website?: unknown
    } | null
    const name = cleanText(body?.name, 100)
    const contact = cleanText(body?.contact, 160)
    const interest = body?.interest === 'CONSULTA' ? 'CONSULTA' : body?.interest === 'AURA' ? 'AURA' : null
    const website = cleanText(body?.website, 200)

    if (website) {
      return reply.send({ message: '¡Gracias! Recibimos tu consulta.' })
    }
    if (name.length < 2) {
      return reply.status(400).send({ message: 'Ingresá tu nombre y apellido.' })
    }
    if (!isValidContact(contact)) {
      return reply.status(400).send({ message: 'Ingresá un email o teléfono válido.' })
    }
    if (!interest) {
      return reply.status(400).send({ message: 'Elegí si te interesa Aura o una consulta.' })
    }
    if (!canSendContact(clientKey(request.headers['x-forwarded-for'], request.ip))) {
      return reply.status(429).send({ message: 'Recibimos varios intentos. Esperá unos minutos antes de volver a enviar.' })
    }

    try {
      const result = await sendTamaraContactEmail({ name, contact, interest })
      if (!result.ok) return reply.status(503).send({ message: result.message })
      return reply.status(201).send({ message: '¡Gracias! Recibimos tu consulta y te responderemos dentro de las próximas 48 horas.' })
    } catch (error) {
      request.log.error({ err: error }, 'No se pudo enviar la consulta del micrositio de Tamara')
      return reply.status(502).send({ message: 'No pudimos enviar tu consulta en este momento. Intentá nuevamente en unos minutos.' })
    }
  })

  for (const asset of tamaraAssets) {
    app.get(asset.url, { constraints: { host: tamaraHost } }, async (_request, reply) => {
      const buffer = await readFile(join(tamaraSiteDir, asset.file))
      applyAssetHeaders(reply)
      return reply.type(asset.contentType).send(buffer)
    })
  }
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
}

function isValidContact(value: string) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true
  return value.replace(/\D/g, '').length >= 8
}

function clientKey(forwardedFor: string | string[] | undefined, fallback: string) {
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  return raw?.split(',')[0]?.trim() || fallback
}

function canSendContact(key: string) {
  const now = Date.now()
  const recentAttempts = (contactAttempts.get(key) || []).filter(timestamp => now - timestamp < contactWindowMs)
  if (recentAttempts.length >= contactLimit) {
    contactAttempts.set(key, recentAttempts)
    return false
  }
  recentAttempts.push(now)
  contactAttempts.set(key, recentAttempts)
  return true
}

function applySiteHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  )
}

function applyAssetHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'public, max-age=86400')
  reply.header('X-Content-Type-Options', 'nosniff')
}
