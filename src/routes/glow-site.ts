import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const glowHost = 'glow.weex.com.ar'
// Only reviewed public media, never arbitrary files from the source directory.
const publicFiles = new Set([
  'alisado-after.png', 'alisado-before.png', 'ba-alisado-after.png', 'ba-alisado-before.png',
  'ba-balayage-before.jpg', 'ba-balayage-split-after.jpg', 'ba-balayage-split-before.jpg',
  'ba-color-split.jpg', 'balayage-9-16-after.jpg', 'balayage-9-16-before.jpg',
  'balayage-after-916.jpg', 'balayage-before-916.jpg', 'banner-corte-hombre.jpg',
  'banner-iluminacion.jpg', 'favicon.svg', 'featured-balayage-mobile-v1.png', 'featured-corte-mobile-v1.png',
  'filosofia-model.jpg', 'hero-glow.jpg', 'hero-glow-mobile-v1.png', 'icons.svg',
  'look-balayage-ref.jpg', 'look-cobrizo.jpg', 'look-corte-masculino.jpg',
  'look-morena-iluminada.jpg', 'look-rubio-premium.jpg', 'modelo-recortada.png',
  'modelo-recortada.webp', 'pro-gaspar.jpg', 'pro-lucas.jpg', 'pro-tamara.jpg'
])
const assetPattern = /^\/assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/

export function isGlowSitePublicResource(method: string, host: string | undefined, path: string) {
  return host?.toLowerCase().split(':')[0] === glowHost
    && ['GET', 'HEAD'].includes(method.toUpperCase())
    && (path === '/' || path === '/reservar' || assetPattern.test(path) || publicFiles.has(path.slice(1)))
}

export async function glowSiteRoutes(app: FastifyInstance, options: { siteDir?: string } = {}) {
  const siteDir = options.siteDir ?? join(process.cwd(), 'sites', 'peluqueria-glow-web', 'dist')
  async function serve(reply: FastifyReply, file: string, html = false, immutable = false) {
    try {
      const content = await readFile(join(siteDir, file))
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('Cache-Control', html ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=86400')
      if (html) {
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
        reply.header('Content-Security-Policy', [
          "default-src 'self'", "img-src 'self' https: data:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com", "script-src 'self'",
          "connect-src 'self' https://weex.com.ar", "frame-src 'self' https://www.google.com",
          "form-action 'self'", "base-uri 'self'", "frame-ancestors 'none'"
        ].join('; '))
      }
      return reply.type(contentType(file)).send(content)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.status(html ? 503 : 404).send({ message: html ? 'Sitio no disponible temporalmente' : 'Asset no encontrado' })
      throw error
    }
  }
  for (const path of ['/', '/reservar']) {
    app.get(path, { constraints: { host: glowHost } }, async (_request, reply) => serve(reply, 'index.html', true))
  }
  app.get('/assets/:asset', { constraints: { host: glowHost } }, async (request, reply) => {
    const { asset } = request.params as { asset: string }
    if (!assetPattern.test(`/assets/${asset}`)) return reply.status(404).send({ message: 'Asset no encontrado' })
    return serve(reply, join('assets', asset), false, true)
  })
  for (const file of publicFiles) {
    app.get(`/${file}`, { constraints: { host: glowHost } }, async (_request, reply) => serve(reply, file))
  }
}

function contentType(file: string) {
  switch (extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}
