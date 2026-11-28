import type { FastifyReply } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { siFacebook, siInstagram, siTiktok, type SimpleIcon } from 'simple-icons'
import { normalizeBusinessSlug, type BusinessService } from '../services/business-service.js'
import { normalizeCustomerPhone } from '../services/phone-normalization-service.js'
import { renderSocialPreviewMetadata } from '../services/landing-social-preview.js'

type DosBrosBusiness = NonNullable<Awaited<ReturnType<BusinessService['findPublicBySlug']>>>
type Service = DosBrosBusiness['services'][number]

const siteDir = join(process.cwd(), 'sites', 'dos-bros')
const baseDomain = (process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar').toLowerCase()
export const dosBrosPreviewPath = '/landing-assets/dosbros-compartir-v1.jpg'
const businessNames = new Set(['dos-bros', 'dos-bros-barberia', 'dosbros', 'dosbros-barberia', 'dosbrosbarberia'])
const portraitAssets = new Map([['donato', 8], ['santiago', 9], ['sebastian', 10], ['valentino', 11]])
const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2, minimumFractionDigits: 0 })

export function isDosBrosBusiness(business: Pick<DosBrosBusiness, 'name'>) {
  return businessNames.has(normalizeBusinessSlug(business.name))
}

export async function sendDosBrosLanding(reply: FastifyReply, business: DosBrosBusiness, basePath: string) {
  const source = await readFile(join(siteDir, 'index.html'), 'utf8')
  reply.header('Cache-Control', 'no-store')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Content-Security-Policy', [
    "default-src 'none'", "img-src 'self' https: data:", "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'", 'frame-src https://maps.google.com', "base-uri 'none'", "frame-ancestors 'none'"
  ].join('; '))
  return reply.type('text/html; charset=utf-8').send(renderDosBrosLanding(source, business, basePath))
}

export async function sendDosBrosSharePreview(reply: FastifyReply) {
  const image = await readFile(join(siteDir, 'dosbros-compartir-v1.jpg'))
  reply.header('Cache-Control', 'public, max-age=31536000, immutable')
  reply.header('X-Content-Type-Options', 'nosniff')
  return reply.type('image/jpeg').send(image)
}

export function renderDosBrosLanding(source: string, business: DosBrosBusiness, basePath: string) {
  const bookingPath = basePath + '/reservar'
  const publicPhone = business.publicWhatsapp?.trim() || business.whatsappConfig?.displayPhoneNumber?.trim() || ''
  const phone = normalizeCustomerPhone(publicPhone)
  const whatsappUrl = phone.ok ? 'https://wa.me/' + phone.phone : ''
  const servicePanels = new Map<string, Service[]>()
  for (const service of business.services) {
    const colorService = /\b(color|coloracion|decoloracion)\b/.test(normalizeBusinessSlug(service.category || ''))
    const panel = colorService ? 'Color' : 'Barbería'
    const services = servicePanels.get(panel) || []
    services.push(service)
    servicePanels.set(panel, services)
  }

  const services = ['Barbería', 'Color'].flatMap((panel) => {
    const entries = servicePanels.get(panel)
    if (!entries?.length) return []
    return [
      '<div class="' + (panel === 'Color' ? 'color-menu' : 'barber-menu') + '"><h3 class="service-title">' +
      panel + '</h3><div class="service-list">' + entries.map((service) => renderService(service, bookingPath)).join('') + '</div></div>'
    ]
  }).join('')

  const team = business.professionals.map((professional) => {
    const avatar = publicImageUrl(professional.avatarUrl)
    const portrait = portraitAssets.get(normalizeBusinessSlug(professional.name))
    const name = escapeHtml(professional.name)
    const initials = escapeHtml(professional.name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join('').toUpperCase())
    const photo = avatar
      ? '<img src="' + escapeHtml(avatar) + '" alt="" loading="lazy">'
      : portrait !== undefined
        ? '<img data-img="' + portrait + '" alt="" loading="lazy">'
        : '<span class="person-initials" aria-hidden="true">' + initials + '</span>'
    return '<a class="person" href="' + escapeHtml(bookingPath + '?profesional=' + encodeURIComponent(professional.id)) +
      '" aria-label="Reservar con ' + name + '">' + photo +
      '<span class="person-label"><span class="person-name">' + name +
      '</span><span class="person-availability">Ver disponibilidad <span aria-hidden="true">&#8250;</span></span></span></a>'
  }).join('')

  const hours = business.businessHours
    .filter((hour) => weekdays[hour.dayOfWeek] && hour.startTime && hour.endTime)
    .slice()
    .sort((a, b) => (a.dayOfWeek + 6) % 7 - (b.dayOfWeek + 6) % 7 || a.startTime.localeCompare(b.startTime))
  const hoursRows = hours.map((hour) =>
    '<div class="hours-row"><div>' + weekdays[hour.dayOfWeek] + '<strong>' +
    escapeHtml(hour.startTime) + ' &ndash; ' + escapeHtml(hour.endTime) + '</strong></div></div>'
  ).join('')
  const footerHours = hours.map((hour) =>
    weekdays[hour.dayOfWeek] + ' ' + escapeHtml(hour.startTime) + ' &ndash; ' + escapeHtml(hour.endTime)
  ).join('<br>')

  const address = business.publicAddress?.trim()
  const addressArea = business.publicAddressArea?.trim()
  const mapQuery = encodeURIComponent([address, addressArea].filter(Boolean).join(', '))
  const mapsUrl = publicWebUrl(business.publicMapsUrl) ||
    (address ? 'https://www.google.com/maps/search/?api=1&query=' + mapQuery : '')
  const contacts = [
    phone.ok ? '<a href="tel:+' + phone.phone + '">' + escapeHtml(phone.display) + '</a>' : '',
    renderSocialLink(business.instagramUrl, siInstagram),
    renderSocialLink(business.facebookUrl, siFacebook),
    renderSocialLink(business.tiktokUrl, siTiktok),
    business.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.contactEmail)
      ? '<a href="mailto:' + escapeHtml(encodeURIComponent(business.contactEmail).replace('%40', '@')) + '">' +
        escapeHtml(business.contactEmail) + '</a>' : ''
  ].join('')

  const slots: Record<string, string> = {
    SOCIAL_PREVIEW: renderSocialPreviewMetadata({
      title: 'Dos Bros Barbería',
      description: 'Consultá servicios y precios, conocé al equipo y reservá tu turno online.',
      canonicalUrl: 'https://' + (normalizeBusinessSlug(business.slug || '') || 'dosbros') + '.' + baseDomain + '/',
      imageUrl: 'https://' + baseDomain + dosBrosPreviewPath,
      imageAlt: 'Dos Bros Barbería'
    }) + [
      '<meta property="og:image:type" content="image/jpeg">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">'
    ].join('\n'),
    BOOKING_URL: escapeHtml(bookingPath),
    SERVICES: services || '<p class="site-data-empty">Pr&oacute;ximamente vas a poder consultar los servicios y precios.</p>',
    TEAM: team || '<p class="site-data-empty">Pr&oacute;ximamente vas a poder conocer al equipo.</p>',
    CONTACTS: contacts,
    CONTACTS_HIDDEN: contacts ? '' : ' hidden',
    WHATSAPP_URL: escapeHtml(whatsappUrl),
    WHATSAPP_HIDDEN: whatsappUrl ? '' : ' hidden',
    HOURS: hoursRows || '<p class="site-data-empty">Consult&aacute; disponibilidad en la agenda.</p>',
    FOOTER_HOURS: footerHours,
    FOOTER_HOURS_HIDDEN: footerHours ? '' : ' hidden',
    LOCATION_HIDDEN: address || mapsUrl ? '' : ' hidden',
    ADDRESS: address ? '<p><strong>' + escapeHtml(address) + '</strong>' +
      (addressArea ? '<br>' + escapeHtml(addressArea) : '') + '</p>' : '',
    MAPS_URL: escapeHtml(mapsUrl),
    MAP_PANEL: address ? '<div class="map-panel"><iframe title="Mapa de Dos Bros Barber&iacute;a" src="https://maps.google.com/maps?q=' +
      mapQuery + '&amp;z=16&amp;output=embed" loading="lazy" referrerpolicy="no-referrer"></iframe></div>' : ''
  }
  return source.replace(/<!-- CRM:([A-Z_]+) -->/g, (_, key: string) => slots[key] ?? '')
}

function renderService(service: Service, bookingPath: string) {
  const price = service.price === null
    ? 'Consultar'
    : (service.priceMode === 'STARTING_AT' || service.attentionMode === 'GUIDED_ESTIMATE' ? 'Desde ' : '') +
      currency.format(service.price)
  const name = escapeHtml(service.name)
  const info = '<span class="service-name">' + name + '</span><strong>' + escapeHtml(price) + '</strong>'
  const webBookable = service.attentionMode === 'DIRECT_BOOKING' ||
    (service.attentionMode === 'GUIDED_ESTIMATE' && service.estimateAllowsBooking)
  if (!webBookable) return '<div class="service-row">' + info + '</div>'
  const href = bookingPath + '?servicio=' + encodeURIComponent(service.id)
  return '<a class="service-row" href="' + escapeHtml(href) + '">' + info + '<span aria-hidden="true">&#8599;</span></a>'
}

function renderSocialLink(value: string | null, icon: SimpleIcon) {
  const url = publicWebUrl(value)
  if (!url) return ''
  const handle = icon === siInstagram ? new URL(url).pathname.split('/').filter(Boolean)[0] : ''
  const label = handle ? '@' + handle : icon.title
  return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + icon.path +
    '"/></svg><span>' + escapeHtml(label) + '</span></a>'
}

function publicWebUrl(value: string | null) {
  try {
    const url = new URL(value || '')
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

function publicImageUrl(value: string | null) {
  if (value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
  if (value && /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value
  return publicWebUrl(value)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]!)
}
