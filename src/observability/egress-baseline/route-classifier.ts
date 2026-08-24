import type { MetricSource } from './types.js'

const SAFE_TEMPLATE = /^[A-Za-z0-9_./:*-]+$/

export function safeRouteTemplate(value: string | undefined): string {
  if (!value) return '__unmatched__'
  if (value.length > 160 || !SAFE_TEMPLATE.test(value)) return '__unknown_registered__'
  return value
}

export function classifyMetricSource(template: string): MetricSource {
  if (template === '/crm/events') return 'crm'
  if (template.startsWith('/webhooks/')) return 'webhook'
  if (template === '/crm' || template.startsWith('/crm/') || template.startsWith('/admin/')) return 'crm'
  if (/^\/(appointments|availability|businesses|business-hours|campaigns|campaign-jobs|campaign-customer-options|campaign-deliveries|customers|professional-hours|professionals|post-sale|reminder-automations|reports|schedule-blocks|service-categories|services|staff-users|whatsapp)(\/|$)/.test(template)) return 'crm'
  if (template === '/chat') return 'crm'
  if (template === '/health' || template === '/' || template === '/contacto' || template === '/privacidad' || template === '/politicas' || template === '/terminos' || template === '/registro' || template === '/reservar' || template === '/cuenta') return 'public'
  if (template.startsWith('/auth/') || template.startsWith('/public/') || template === '/:slug' || template.startsWith('/:slug/') || template.startsWith('/landing-assets/') || template === '/weex/bot-v1' || template.startsWith('/tamara-') || template.startsWith('/experience-') || template.startsWith('/branding/') || template.startsWith('/partners/') || template.startsWith('/testimonials/') || template === '/promocion-weex-agosto-2026' || template.startsWith('/promocion-weex-agosto-2026/')) return 'public'
  return 'unknown'
}
