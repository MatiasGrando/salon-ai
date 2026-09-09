import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { BusinessService } from '../services/business-service.js'
import { findCustomSiteProfileBinding } from '../services/custom-site-profile-binding.js'
import { isBusinessAccountUnavailable } from '../services/business-account-access.js'

const lubricentroHost = 'lubricentro.weex.com.ar'
const lubricentroSiteDir = join(process.cwd(), 'sites', 'lubricentro-albarellos', 'dist')
const businessService = new BusinessService()
const lubricentroBinding = findCustomSiteProfileBinding(lubricentroHost)

const publicFiles = new Map([
  ['/favicon.svg', 'favicon.svg'],
  ['/icons.svg', 'icons.svg'],
  ['/logo-drop.svg', 'logo-drop.svg'],
  ['/images/hero-desktop.jpg', join('images', 'hero-desktop.jpg')],
  ['/images/hero-mobile.jpg', join('images', 'hero-mobile.jpg')]
])

export async function lubricentroSiteRoutes(app: FastifyInstance) {
  app.get('/', { constraints: { host: lubricentroHost } }, async (_request, reply) => {
    if (await customSiteIsUnavailable()) {
      return reply.status(503).type('text/html; charset=utf-8').send(renderUnavailableSite())
    }

    const html = await readFile(join(lubricentroSiteDir, 'index.html'))
    applySiteHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  app.get('/assets/:asset', { constraints: { host: lubricentroHost } }, async (request, reply) => {
    const { asset } = request.params as { asset: string }
    if (!isSafeAssetName(asset)) return reply.status(404).send({ message: 'Asset no encontrado' })
    return serveAsset(reply, join('assets', asset), true)
  })

  for (const [url, file] of publicFiles) {
    app.get(url, { constraints: { host: lubricentroHost } }, async (_request, reply) => serveAsset(reply, file, false))
  }
}

async function customSiteIsUnavailable() {
  if (!lubricentroBinding) return false
  const business = await businessService.findPublicByCustomerCode(lubricentroBinding.businessCustomerCode)
  return Boolean(business && isBusinessAccountUnavailable(business.accountStatus))
}

async function serveAsset(reply: FastifyReply, relativePath: string, immutable: boolean) {
  try {
    const content = await readFile(join(lubricentroSiteDir, relativePath))
    reply.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=86400')
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.type(contentType(relativePath)).send(content)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return reply.status(404).send({ message: 'Asset no encontrado' })
    throw error
  }
}

function isSafeAssetName(asset: string) {
  return /^[a-zA-Z0-9._-]+$/.test(asset)
}

function contentType(file: string) {
  switch (extname(file).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}

function renderUnavailableSite() {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comercio no disponible | Weex</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d11;color:#fafafa;font-family:Arial,sans-serif}.card{width:min(520px,calc(100% - 48px));padding:36px;border:1px solid #3f3f46;border-radius:18px;background:#18181b;box-shadow:0 18px 50px rgba(0,0,0,.35)}span{color:#ef4444;font-weight:800}h1{font-size:28px;margin:14px 0 10px}p{color:#d4d4d8;line-height:1.6;margin:0}</style></head><body><main class="card"><span>Weex</span><h1>Este comercio no est&aacute; disponible temporalmente.</h1><p>Consult&aacute; directamente con el comercio para recibir asistencia.</p></main></body></html>'
}

function applySiteHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self' https://weex.com.ar",
    "frame-src 'self' https://www.google.com",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '))
}
