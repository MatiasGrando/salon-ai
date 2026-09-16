import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { BusinessService } from '../services/business-service.js'
import { findCustomSiteProfileBinding } from '../services/custom-site-profile-binding.js'
import { isBusinessAccountUnavailable } from '../services/business-account-access.js'
import { parsePublishedLeadFormSchema } from '../services/lead-form-domain.js'
import { LeadFormSubmissionError, LeadFormSubmissionService } from '../services/lead-form-submission-service.js'
import { createRewardAccessToken, createSupabaseRewardStorageFromEnv, LeadRewardError, LeadRewardService } from '../services/lead-reward-service.js'

const businessService = new BusinessService()
const slugPattern = /^[a-z0-9-]{1,120}$/

function publicHeaders(reply: any) {
  reply.header('Cache-Control', 'no-store')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'no-referrer')
}

async function resolvePublishedForm(request: FastifyRequest, slug: string) {
  if (!slugPattern.test(slug)) return null
  // Never use X-Forwarded-Host or a businessId supplied by the browser.
  const binding = findCustomSiteProfileBinding(request.headers.host)
  if (!binding) return null
  const business = await businessService.findPublicByCustomerCode(binding.businessCustomerCode)
  if (!business || !business.landingEnabled || isBusinessAccountUnavailable(business.accountStatus)) return null
  const settings = await prisma.businessFeatureSettings.findUnique({
    where: { businessId: business.id },
    select: { leadCaptureFormsEnabled: true, pipelineEnabled: true }
  })
  if (!settings?.leadCaptureFormsEnabled || !settings.pipelineEnabled) return null
  const form = await prisma.leadCaptureForm.findFirst({
    where: { businessId: business.id, publicSlug: slug, status: 'PUBLISHED' },
    orderBy: { version: 'desc' }
  })
  if (!form) return null
  if (form.rewardMode !== 'NONE' && form.rewardMode !== 'BENEFIT') return null
  try {
    return { business, form, schema: parsePublishedLeadFormSchema({ schemaVersion: form.schemaVersion, fields: form.fields }) }
  } catch { return null }
}

export function renderPublicLeadFormHtml(slug: string, form: { name: string; successTitle: string | null; successMessage: string | null; rewardMode?: unknown }, schema: { fields: readonly { key: string; label: string; type: string; required: boolean; options?: readonly { value: string; label: string }[] }[] }) {
  const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const fields = schema.fields.map(field => {
    const id = `weex-${field.key}`
    const attrs = `id="${esc(id)}" name="${esc(field.key)}" ${field.required ? 'required' : ''}`
    const choices = field.options?.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('') ?? ''
    const control = field.type === 'TEXTAREA' ? `<textarea ${attrs}></textarea>`
      : field.type === 'SELECT' || field.type === 'RADIO' ? `<select ${attrs}><option value="">Seleccioná una opción</option>${choices}</select>`
      : `<input ${attrs} type="${field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : field.type === 'NUMBER' ? 'number' : field.type === 'CHECKBOX' ? 'checkbox' : 'text'}">`
    return `<div class="weex-field"><label for="${esc(id)}">${esc(field.label)}</label>${control}<span class="weex-error" id="${esc(id)}-error" aria-live="polite"></span></div>`
  }).join('')
  const submitLabel = form.rewardMode === 'BENEFIT' ? 'Enviar y acceder al beneficio' : 'Enviar'
  return `<section class="weex-lead-form" data-weex-form="${esc(slug)}"><h2>${esc(form.name)}</h2><form novalidate>${fields}<div class="weex-honeypot" aria-hidden="true"><label>No completar<input name="website" tabindex="-1" autocomplete="off"></label></div><button type="submit">${submitLabel}</button><p class="weex-status" role="status" aria-live="polite"></p><div class="weex-benefit" aria-live="polite"></div></form></section>`
}

export const publicLeadFormClientScript = `(function(){const root=document.querySelector('.weex-lead-form');if(!root)return;const form=root.querySelector('form');const status=root.querySelector('.weex-status');const benefit=root.querySelector('.weex-benefit');const startedAt=new Date().toISOString();let key=crypto.randomUUID();form.addEventListener('submit',async event=>{event.preventDefault();status.textContent='';benefit.replaceChildren();const answers={};let bad=false;for(const field of form.querySelectorAll('.weex-field input,.weex-field textarea,.weex-field select')){const error=form.querySelector('#'+field.id+'-error');field.setAttribute('aria-invalid',String(!field.checkValidity()));if(!field.checkValidity()){bad=true;error.textContent='Revisá este campo';}else{error.textContent='';answers[field.name]=field.type==='checkbox'?field.checked:field.type==='number'?Number(field.value):field.value;}}if(bad){status.textContent='Revisá los campos marcados.';return;}const button=form.querySelector('button');button.disabled=true;try{const slug=root.dataset.weexForm;const params=new URLSearchParams(location.search);const result=await fetch('/public/forms/'+encodeURIComponent(slug)+'/submissions',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({answers,ref:params.get('ref')||undefined,antiSpam:{honeypot:form.elements.website.value,startedAt},attribution:{utmSource:params.get('utm_source')||'',utmMedium:params.get('utm_medium')||'',utmCampaign:params.get('utm_campaign')||''}})});const body=await result.json();if(!result.ok){status.textContent=body.message||'No pudimos recibir el formulario. Probá nuevamente.';for(const issue of body.issues||[]){const field=form.elements[issue.field];if(field){field.setAttribute('aria-invalid','true');const target=form.querySelector('#'+field.id+'-error');if(target)target.textContent='Revisá este campo';}}return;}status.textContent='¡Formulario recibido!';form.reset();key=crypto.randomUUID();if(body.benefitAvailable&&body.rewardClaim){const claim=await fetch('/public/reward-claims/'+encodeURIComponent(body.rewardClaim.id)+'/access',{method:'POST',headers:{Authorization:'Bearer '+body.rewardClaim.accessToken},cache:'no-store',referrerPolicy:'no-referrer'});if(!claim.ok){status.textContent+=' Tu beneficio no está disponible por ahora.';return;}const reward=await claim.json();if(reward.type==='FILE'||reward.type==='LINK'){const link=document.createElement('a');link.href=reward.url||reward.value;link.textContent=reward.type==='FILE'?'Descargar regalo':'Abrir regalo';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';benefit.append(link);}else{const text=document.createElement('p');text.textContent=reward.value;benefit.append(text);}}}catch{status.textContent='Error de conexión. Probá nuevamente.';}finally{button.disabled=false;}});})();`

type SubmissionResult = {
  submission: { id: string; formId: string }
  claim: { id: string; accessVersion: number; expiresAt: Date | null; revokedAt?: Date | null } | null
  benefitAvailable: boolean
  replayed: boolean
}

export function createPublicSubmissionResponse(result: SubmissionResult, options: { businessId: string; rewardTokenSecret: string; now?: number }) {
  if (!result.benefitAvailable) {
    if (result.claim) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
    return { status: 'ACCEPTED' as const, submissionId: result.submission.id, benefitAvailable: false, rewardClaim: null, replayed: result.replayed }
  }
  const now = options.now ?? Date.now()
  const claim = result.claim
  const claimActive = Boolean(claim && !claim.revokedAt && (!claim.expiresAt || claim.expiresAt.getTime() > now))
  if (!claim || !claimActive) throw new LeadRewardError('REWARD_UNAVAILABLE', 503)
  const claimExpiresAt = claim.expiresAt && claim.expiresAt.getTime() < now + 24 * 60 * 60_000
    ? claim.expiresAt
    : new Date(now + 24 * 60 * 60_000)
  const accessToken = createRewardAccessToken(options.rewardTokenSecret, {
    claimId: claim.id,
    businessId: options.businessId,
    formId: result.submission.formId,
    accessVersion: claim.accessVersion,
    expiresAt: claimExpiresAt
  })
  return { status: 'ACCEPTED' as const, submissionId: result.submission.id, benefitAvailable: true, rewardClaim: { id: claim.id, accessToken }, replayed: result.replayed }
}

export async function publicLeadFormsRoutes(app: FastifyInstance) {
  app.get('/public/forms/:slug/schema', async (request, reply) => {
    publicHeaders(reply)
    const { slug } = request.params as { slug: string }
    const resolved = await resolvePublishedForm(request, slug)
    if (!resolved) return reply.status(404).send({ code: 'FORM_NOT_AVAILABLE', message: 'Formulario no disponible' })
    return { slug, name: resolved.form.name, schemaVersion: resolved.schema.schemaVersion, fields: resolved.schema.fields }
  })
  app.get('/f/:slug', async (request, reply) => {
    publicHeaders(reply)
    const { slug } = request.params as { slug: string }
    const resolved = await resolvePublishedForm(request, slug)
    if (!resolved) return reply.status(404).send({ code: 'FORM_NOT_AVAILABLE', message: 'Formulario no disponible' })
    const html = renderPublicLeadFormHtml(slug, resolved.form, resolved.schema)
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${resolved.form.name.replace(/[&<>"']/g, '')}</title><style>body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f9fafb}.weex-lead-form{width:min(600px,calc(100% - 48px));padding:24px;background:#1f2937;border-radius:16px}.weex-field{display:grid;gap:8px;margin:18px 0}input,select,textarea{padding:12px;border-radius:8px;border:1px solid #9ca3af}button{padding:13px 20px;border:0;border-radius:8px;cursor:pointer}.weex-error{color:#fca5a5}.weex-honeypot{position:absolute;left:-9999px}</style></head><body>${html}<script>${publicLeadFormClientScript}</script></body></html>`)
  })
  app.post('/public/forms/:slug/submissions', async (request, reply) => {
    publicHeaders(reply)
    const { slug } = request.params as { slug: string }
    const resolved = await resolvePublishedForm(request, slug)
    if (!resolved) return reply.status(404).send({ code: 'FORM_NOT_AVAILABLE', message: 'Formulario no disponible' })
    const body = request.body as Record<string, unknown> | null
    const key = request.headers['idempotency-key']
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof key !== 'string') return reply.status(422).send({ code: 'INVALID_SUBMISSION', message: 'Revisá el formulario' })
    const antiSpam = body.antiSpam as Record<string, unknown> | null
    const secret = process.env.LEAD_FORM_RATE_LIMIT_SECRET ?? ''
    const service = new LeadFormSubmissionService(prisma, {
      rateLimitSecret: secret,
      instagramFormRefSecret: process.env.INSTAGRAM_FORM_REF_SECRET ?? ''
    })
    try {
      const result = await service.submit({ businessId: resolved.business.id, publicSlug: slug, idempotencyKey: key, answers: body.answers, attribution: body.attribution, instagramRef: body.ref, antiSpam: { honeypot: antiSpam?.honeypot, startedAt: antiSpam?.startedAt, ipAddress: request.ip } })
      const response = createPublicSubmissionResponse(result, {
        businessId: resolved.business.id,
        rewardTokenSecret: process.env.LEAD_REWARD_TOKEN_SECRET ?? ''
      })
      return reply.status(result.replayed ? 200 : 201).send(response)
    } catch (error) {
      if (error instanceof LeadFormSubmissionError) return reply.status(error.statusCode).send({ code: error.code, message: error.code === 'INVALID_INSTAGRAM_REF' ? 'El enlace de Instagram venció o no es válido.' : error.statusCode === 429 ? 'Demasiados intentos. Probá más tarde.' : 'Revisá el formulario e intentá nuevamente.', issues: error.issues })
      request.log.error({ errorCode: (error as { code?: string }).code }, 'Fallo al recibir formulario')
      return reply.status(503).send({ code: 'SUBMISSION_SERVICE_UNAVAILABLE', message: 'No pudimos recibir el formulario. Probá más tarde.' })
    }
  })
  app.post('/public/reward-claims/:id/access', async (request, reply) => {
    publicHeaders(reply)
    const { id } = request.params as { id: string }
    const binding = findCustomSiteProfileBinding(request.headers.host)
    if (!binding) return reply.status(404).send({ code: 'REWARD_NOT_AVAILABLE', message: 'Beneficio no disponible' })
    const business = await businessService.findPublicByCustomerCode(binding.businessCustomerCode)
    if (!business || !business.landingEnabled || isBusinessAccountUnavailable(business.accountStatus)) return reply.status(404).send({ code: 'REWARD_NOT_AVAILABLE', message: 'Beneficio no disponible' })
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1]
    if (!bearer || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return reply.status(404).send({ code: 'REWARD_NOT_AVAILABLE', message: 'Beneficio no disponible' })
    const service = new LeadRewardService(prisma, { tokenSecret: process.env.LEAD_REWARD_TOKEN_SECRET ?? '', encryptionKey: process.env.LEAD_REWARD_ENCRYPTION_KEY ?? '', storage: createSupabaseRewardStorageFromEnv() })
    try {
      const result = await service.access(id, bearer, business.id)
      return reply.send(result)
    } catch (error) {
      if (error instanceof LeadRewardError) return reply.status(error.statusCode).send({ code: error.code, message: 'Beneficio no disponible' })
      request.log.error({ errorCode: (error as { code?: string }).code }, 'Fallo al acceder beneficio')
      return reply.status(503).send({ code: 'REWARD_UNAVAILABLE', message: 'Beneficio no disponible' })
    }
  })
}
