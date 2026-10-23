import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeHostname } from '../services/custom-site-profile-binding.js'

const siteDir = join(process.cwd(), 'sites', 'la-cochera')
const publicImages = new Map([
  ['weex.com.ar', new Map([
    ['/lacochera/assets/social/portada-whatsapp-v11.png', { file: 'portada-whatsapp-v11.png', type: 'image/png' }],
    ['/lacochera/assets/social/portada-whatsapp-v14.jpg', { file: 'portada-whatsapp-v14.jpg', type: 'image/jpeg' }]
  ])],
  ['lacochera.weex.com.ar', new Map([
    ['/assets/social/portada-whatsapp-v11.png', { file: 'portada-whatsapp-v11.png', type: 'image/png' }],
    ['/assets/social/portada-whatsapp-v14.jpg', { file: 'portada-whatsapp-v14.jpg', type: 'image/jpeg' }]
  ])]
])

export function isLaCocheraLandingRequest(host: string | undefined, path: string, slug: string | null | undefined) {
  const hostname = normalizeHostname(host)
  return slug === 'lacochera' && (
    hostname === 'weex.com.ar' && path === '/lacochera'
    || hostname === 'lacochera.weex.com.ar' && path === '/'
  )
}

export function isLaCocheraPublicResource(method: string, host: string | undefined, path: string) {
  return ['GET', 'HEAD'].includes(method.toUpperCase()) && publicImages.get(normalizeHostname(host))?.has(path) === true
}

// Called only after the existing public-business account and landingEnabled gates.
export async function sendLaCocheraLanding(reply: FastifyReply) {
  try {
    const html = await readFile(join(siteDir, 'published-v13.html'))
    reply.header('Cache-Control', 'no-cache')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Content-Security-Policy', [
      "default-src 'none'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'",
      "font-src 'self'", "script-src 'self' 'unsafe-inline'", "connect-src 'none'",
      'frame-src https://www.google.com', "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"
    ].join('; '))
    return reply.type('text/html; charset=utf-8').send(html)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.status(503).send({ message: 'Sitio no disponible temporalmente' })
    throw error
  }
}

export async function laCocheraSiteRoutes(app: FastifyInstance) {
  for (const [host, images] of publicImages) {
    for (const [path, image] of images) {
      app.get(path, { constraints: { host } }, async (_request, reply) => {
        const payload = await readFile(join(siteDir, 'assets', 'social', image.file))
        reply.header('X-Content-Type-Options', 'nosniff')
        reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        return reply.type(image.type).send(payload)
      })
    }
  }
}
