import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const tamaraHost = 'tamaragrando.weex.com.ar'
const tamaraSiteDir = join(process.cwd(), 'src', 'assets', 'tamara-site')

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

  for (const asset of tamaraAssets) {
    app.get(asset.url, { constraints: { host: tamaraHost } }, async (_request, reply) => {
      const buffer = await readFile(join(tamaraSiteDir, asset.file))
      applyAssetHeaders(reply)
      return reply.type(asset.contentType).send(buffer)
    })
  }
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
