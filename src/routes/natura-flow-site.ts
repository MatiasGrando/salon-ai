import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BusinessService } from '../services/business-service.js'
import { findCustomSiteProfileBinding } from '../services/custom-site-profile-binding.js'
import { isBusinessAccountUnavailable } from '../services/business-account-access.js'

const naturaFlowHost = 'naturalflow.weex.com.ar'
const naturaFlowSiteDir = join(process.cwd(), 'src', 'assets', 'natura-flow-site')
const businessService = new BusinessService()
const naturaFlowBinding = findCustomSiteProfileBinding(naturaFlowHost)

const assets = [
  { url: '/styles/custom.css', file: join('styles', 'custom.css'), contentType: 'text/css; charset=utf-8' },
  { url: '/scripts/app.js', file: join('scripts', 'app.js'), contentType: 'application/javascript; charset=utf-8' }
] as const

export async function naturaFlowSiteRoutes(app: FastifyInstance) {
  app.get('/', { constraints: { host: naturaFlowHost } }, async (_request, reply) => {
    if (await customSiteIsUnavailable()) {
      return reply.status(503).type('text/html; charset=utf-8').send(renderUnavailableSite())
    }
    const html = await readFile(join(naturaFlowSiteDir, 'index.html'))
    applySiteHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  for (const asset of assets) {
    app.get(asset.url, { constraints: { host: naturaFlowHost } }, async (_request, reply) => {
      const content = await readFile(join(naturaFlowSiteDir, asset.file))
      reply.header('Cache-Control', 'public, max-age=86400')
      reply.header('X-Content-Type-Options', 'nosniff')
      return reply.type(asset.contentType).send(content)
    })
  }
}

async function customSiteIsUnavailable() {
  if (!naturaFlowBinding) return false
  const business = await businessService.findPublicByCustomerCode(naturaFlowBinding.businessCustomerCode)
  return Boolean(business && isBusinessAccountUnavailable(business.accountStatus))
}

function renderUnavailableSite() {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comercio no disponible | Weex</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1b1e18;color:#faf8f4;font-family:Arial,sans-serif}.card{width:min(520px,calc(100% - 48px));padding:36px;border:1px solid #3d4534;border-radius:18px;background:#272d21;box-shadow:0 18px 50px rgba(0,0,0,.3)}span{color:#d4c4ac;font-weight:800}h1{font-size:28px;margin:14px 0 10px}p{color:#d6d3d1;line-height:1.6;margin:0}</style></head><body><main class="card"><span>Weex</span><h1>Este comercio no est&aacute; disponible temporalmente.</h1><p>Consult&aacute; directamente con el comercio para recibir asistencia.</p></main></body></html>'
}

function applySiteHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "media-src 'self' https://dvnllpvdpvdvdheafyau.supabase.co https://assets.mixkit.co",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '))
}
