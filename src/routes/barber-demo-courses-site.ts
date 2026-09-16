import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BusinessService } from '../services/business-service.js'
import { findCustomSiteProfileBinding } from '../services/custom-site-profile-binding.js'
import { isBusinessAccountUnavailable } from '../services/business-account-access.js'
import { appendConfiguredLeadForm } from '../services/custom-site-lead-form.js'

const barberDemoHost = 'demo-barber.weex.com.ar'
const barberDemoSiteDir = join(process.cwd(), 'src', 'assets', 'barber-demo-courses-site')
const businessService = new BusinessService()
const barberDemoBinding = findCustomSiteProfileBinding(barberDemoHost)

const assets = [
  'asesoria-personalizada.jpg',
  'marketing-digital.jpg',
  'og-preview.jpg',
  'redes-sociales.jpg',
  'ventas-online.jpg'
] as const

export async function barberDemoCoursesSiteRoutes(app: FastifyInstance) {
  app.get('/', { constraints: { host: barberDemoHost } }, async (_request, reply) => {
    const business = barberDemoBinding
      ? await businessService.findPublicByCustomerCode(barberDemoBinding.businessCustomerCode)
      : null
    if (!business || !business.landingEnabled || isBusinessAccountUnavailable(business.accountStatus)) {
      return reply.status(503).type('text/html; charset=utf-8').send(renderUnavailableSite())
    }

    const source = await readFile(join(barberDemoSiteDir, 'index.html'), 'utf8')
    const html = await appendConfiguredLeadForm(source, business.id, 'barber-demo-course-lead')
    applySiteHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  for (const asset of assets) {
    app.get(`/assets/${asset}`, { constraints: { host: barberDemoHost } }, async (_request, reply) => {
      const content = await readFile(join(barberDemoSiteDir, 'assets', asset))
      reply.header('Cache-Control', 'public, max-age=86400')
      reply.header('X-Content-Type-Options', 'nosniff')
      return reply.type('image/jpeg').send(content)
    })
  }
}

function renderUnavailableSite() {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comercio no disponible | Weex</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:Arial,sans-serif}.card{width:min(520px,calc(100% - 48px));padding:36px;border:1px solid #334155;border-radius:18px;background:#1e293b;box-shadow:0 18px 50px rgba(0,0,0,.3)}span{color:#f59e0b;font-weight:800}h1{font-size:28px;margin:14px 0 10px}p{color:#cbd5e1;line-height:1.6;margin:0}</style></head><body><main class="card"><span>Weex</span><h1>Este comercio no est&aacute; disponible temporalmente.</h1><p>Consult&aacute; directamente con el comercio para recibir asistencia.</p></main></body></html>'
}

function applySiteHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '))
}
