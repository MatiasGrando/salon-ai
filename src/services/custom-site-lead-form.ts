import { prisma } from '../config/prisma.js'
import { parsePublishedLeadFormSchema } from './lead-form-domain.js'
import { renderPublicLeadFormHtml, publicLeadFormClientScript } from '../routes/public-lead-forms.js'

const slugPattern = /^[a-z0-9-]{1,120}$/

export async function isConfiguredLeadFormPublished(businessId: string, slug: string) {
  if (!slugPattern.test(slug)) return false
  const flags = await prisma.businessFeatureSettings.findUnique({
    where: { businessId }, select: { pipelineEnabled: true, leadCaptureFormsEnabled: true }
  })
  if (!flags?.pipelineEnabled || !flags?.leadCaptureFormsEnabled) return false
  return Boolean(await prisma.leadCaptureForm.findFirst({
    where: { businessId, publicSlug: slug, status: 'PUBLISHED' }, select: { id: true }
  }))
}

export async function appendConfiguredLeadForm(html: string, businessId: string, slug: string) {
  if (!slugPattern.test(slug) || !html.includes('</body>')) return html
  // A handcrafted page can bind its existing form to the same public endpoint.
  // Never append a second, competing form beside that native design.
  if (html.includes('id="leadContactForm"') && html.includes(`/public/forms/${slug}/submissions`)) return html
  try {
  const flags = await prisma.businessFeatureSettings.findUnique({
    where: { businessId }, select: { pipelineEnabled: true, leadCaptureFormsEnabled: true }
  })
  if (!flags?.pipelineEnabled || !flags?.leadCaptureFormsEnabled) return html
  const form = await prisma.leadCaptureForm.findFirst({
    where: { businessId, publicSlug: slug, status: 'PUBLISHED' }, orderBy: { version: 'desc' }
  })
  if (!form) return html
  const schema = parsePublishedLeadFormSchema({ schemaVersion: form.schemaVersion, fields: form.fields })
  const section = renderPublicLeadFormHtml(slug, form, schema)
  const styles = '<style>.weex-lead-form{width:min(640px,calc(100% - 40px));margin:48px auto;padding:28px;border-radius:18px;background:#162236;color:#fff}.weex-lead-form form{display:grid;gap:14px}.weex-field{display:grid;gap:7px}.weex-field input,.weex-field textarea,.weex-field select{min-width:0;padding:12px;border-radius:8px;border:1px solid #94a3b8}.weex-field [aria-invalid="true"]{border-color:#ef4444}.weex-error{color:#fecaca}.weex-honeypot{position:absolute;left:-9999px}.weex-lead-form button{padding:13px;border:0;border-radius:9px;font-weight:700;cursor:pointer}</style>'
  return html.replace('</body>', `${styles}${section}<script>${publicLeadFormClientScript}</script></body>`)
  } catch {
    // Fail closed: migration/client rollout or a malformed form must not break bookings.
    return html
  }
}
