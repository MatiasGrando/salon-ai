import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../config/prisma.js'
import { requireSuperAdmin } from '../plugins/auth-guard.js'

const campaignSlug = 'promocion-weex-agosto-2026'
const campaignPath = `/${campaignSlug}`
const campaignDir = join(process.cwd(), 'src', 'assets', 'weex-campaign')
const leadAttempts = new Map<string, number[]>()
const leadWindowMs = 15 * 60 * 1000
const leadLimit = 10

export async function weexLeadCampaignRoutes(app: FastifyInstance) {
  app.get(campaignPath, serveCampaignFile('landing.html'))
  app.get(`${campaignPath}/`, serveCampaignFile('landing.html'))
  app.get(`${campaignPath}/gracias`, serveCampaignFile('gracias.html'))

  app.post('/public/weex/leads', async (request, reply) => {
    const body = request.body as LeadBody | null
    const honeypot = cleanText(body?.company, 200)
    if (honeypot) return reply.status(201).send({ ok: true })

    const name = cleanText(body?.name, 120)
    const email = cleanText(body?.email, 160).toLowerCase()
    const phone = cleanText(body?.phone, 40)
    const phoneNormalized = phone.replace(/\D/g, '')

    if (name.length < 2 || (email && !isValidEmail(email)) || phoneNormalized.length < 7 || phoneNormalized.length > 15) {
      return reply.status(400).send({ message: 'Revisá los datos ingresados.' })
    }
    if (!canCreateLead(clientKey(request))) {
      return reply.status(429).send({ message: 'Recibimos varios intentos. Esperá unos minutos antes de volver a enviar.' })
    }

    const lead = await prisma.weexLead.create({
      data: {
        name,
        email,
        phone,
        phoneNormalized,
        message: optionalText(body?.message, 1000),
        campaign: cleanText(body?.campaign, 100) || campaignSlug,
        source: cleanText(body?.source, 100) || 'directo',
        medium: optionalText(body?.medium, 100),
        campaignName: optionalText(body?.campaignName, 150),
        content: optionalText(body?.content, 150),
        term: optionalText(body?.term, 150),
        pageUrl: optionalText(body?.pageUrl, 500),
        referrer: optionalText(body?.referrer, 500)
      }
    })

    return reply.status(201).send({ ok: true, id: lead.id })
  })
}

export async function weexLeadAdminRoutes(app: FastifyInstance) {
  app.get('/admin/weex-leads', async (request, reply) => {
    if (!requireSuperAdmin(request, reply)) return
    const leads = await prisma.weexLead.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
    applyAdminHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(renderAdminPage(leads))
  })
}

function serveCampaignFile(fileName: string) {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = await readFile(join(campaignDir, fileName))
    applyCampaignHeaders(reply)
    return reply.type('text/html; charset=utf-8').send(html)
  }
}

type LeadBody = {
  name?: unknown
  email?: unknown
  phone?: unknown
  company?: unknown
  message?: unknown
  campaign?: unknown
  source?: unknown
  medium?: unknown
  campaignName?: unknown
  content?: unknown
  term?: unknown
  pageUrl?: unknown
  referrer?: unknown
}

type AdminLead = {
  createdAt: Date
  name: string
  email: string
  phone: string
  phoneNormalized: string
  message: string | null
  source: string
  campaign: string
  campaignName: string | null
  status: string
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
}

function optionalText(value: unknown, maxLength: number) {
  return cleanText(value, maxLength) || null
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function clientKey(request: FastifyRequest) {
  const forwarded = request.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return raw?.split(',')[0]?.trim() || request.ip
}

function canCreateLead(key: string) {
  const now = Date.now()
  const recentAttempts = (leadAttempts.get(key) || []).filter(timestamp => now - timestamp < leadWindowMs)
  if (recentAttempts.length >= leadLimit) {
    leadAttempts.set(key, recentAttempts)
    return false
  }
  recentAttempts.push(now)
  leadAttempts.set(key, recentAttempts)
  return true
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderAdminPage(leads: AdminLead[]) {
  const rows = leads.map(lead => `<tr>
    <td>${escapeHtml(new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(lead.createdAt))}</td>
    <td><strong>${escapeHtml(lead.name)}</strong></td>
    <td>${lead.email ? `<a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>` : '—'}</td>
    <td><a href="https://wa.me/${escapeHtml(lead.phoneNormalized)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lead.phone)}</a></td>
    <td>${escapeHtml(lead.message || '—')}</td>
    <td>${escapeHtml(lead.source)}</td>
    <td>${escapeHtml(lead.campaignName || lead.campaign)}</td>
    <td><span class="badge">${escapeHtml(lead.status)}</span></td>
  </tr>`).join('')
  const content = rows
    ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Consulta</th><th>Origen</th><th>Campaña</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty"><h2>Todavía no hay leads</h2><p>Los formularios nuevos aparecerán aquí automáticamente.</p></div>'

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leads de Weex</title><style>
  :root{color-scheme:dark;--bg:#0c0f14;--surface:#141922;--line:#28303d;--text:#f4f6f8;--muted:#9aa5b5;--amber:#ffcb3d;--violet:#8c7cff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,rgba(255,203,61,.09),transparent 35%),var(--bg);color:var(--text);font:15px Inter,system-ui,sans-serif}main{width:min(1180px,calc(100% - 32px));margin:42px auto}.top{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:24px}.brand{font-weight:800;letter-spacing:.08em;color:var(--amber)}h1{margin:5px 0;font-size:clamp(1.8rem,4vw,2.5rem)}p{color:var(--muted)}.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:900px}th,td{text-align:left;padding:13px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}td a{color:var(--amber)}.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:rgba(140,124,255,.15);color:#c9c2ff;font-size:.75rem}.empty{text-align:center;padding:50px 20px}.count{font-size:2rem;font-weight:800;color:var(--amber)}@media(max-width:700px){main{margin-top:24px}.top{align-items:start;flex-direction:column}}
  </style></head><body><main><div class="top"><div><div class="brand">WEEX</div><h1>Leads de la campaña</h1><p>Formularios recibidos desde las landings de Weex.</p></div><div><div class="count">${leads.length}</div><p>leads mostrados</p></div></div><div class="card">${content}</div></main></body></html>`
}

function applyCampaignHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '))
}

function applyAdminHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
}
