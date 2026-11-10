import { isSimulatorAppointmentId } from './simulator-booking-scope.js'
import { publicBookingNavigation } from './public-booking-navigation.js'
import { httpsBookingEmailUrl, resolveBookingEmailMedia, type BookingEmailMedia } from './booking-email-media-service.js'

type BookingConfirmationEmailInput = {
  recipientEmail: string
  recipientName: string
  appointmentId: string
  businessName: string
  businessAddress?: string | null
  businessAddressArea?: string | null
  businessMapsUrl?: string | null
  serviceName: string
  professionalName: string
  startAt: Date
  durationMinutes: number
  quotedPrice?: number | null
  priceMode?: 'FIXED' | 'STARTING_AT' | null
  bookingManagementUrl?: string | null
  emailMedia?: BookingEmailMedia
}

type EmailDeliveryResult =
  | { ok: true; providerId: string | null }
  | { ok: false; skipped?: boolean; message: string }

const resendApiUrl = 'https://api.resend.com/emails'

export const bookingConfirmationDetailIcons = {
  service: '&#9986;&#65038;',
  date: '&#128197;&#65038;',
  time: '&#128337;&#65038;',
  professional: '&#128100;&#65038;',
  location: '&#128205;&#65038;'
} as const

export function bookingConfirmationBusinessDetails(
  business: Parameters<typeof resolveBookingEmailMedia>[0] & {
    name: string
    slug?: string | null
    landingEnabled?: boolean
    publicAddress?: string | null
    publicAddressArea?: string | null
    publicMapsUrl?: string | null
  },
  canManage: boolean
) {
  const domain = process.env.PUBLIC_BASE_DOMAIN?.trim().toLowerCase() || 'weex.com.ar'
  const slug = business.slug
  const bookingManagementUrl = canManage && business.landingEnabled && slug && /^[a-z0-9-]+$/.test(slug) && /^[a-z0-9.-]+$/.test(domain)
    ? httpsBookingEmailUrl(publicBookingNavigation(business).accountUrl)
    : null
  return {
    businessName: business.name,
    businessAddress: [business.publicAddress, business.publicAddressArea].filter(Boolean).join(', ') || null,
    businessAddressArea: business.publicAddressArea ?? null,
    businessMapsUrl: business.publicMapsUrl ?? null,
    bookingManagementUrl,
    emailMedia: resolveBookingEmailMedia(business)
  }
}

export async function sendBookingConfirmationEmail(input: BookingConfirmationEmailInput): Promise<EmailDeliveryResult> {
  if (isSimulatorAppointmentId(input.appointmentId)) return { ok: false, skipped: true, message: 'Turno del simulador: correo externo bloqueado' }
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.BOOKING_EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    return { ok: false, skipped: true, message: 'El correo de confirmacion no esta configurado.' }
  }

  const response = await fetch(resendApiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [input.recipientEmail], ...renderBookingConfirmationEmail(input) })
  })

  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null
  if (!response.ok) throw new Error(payload?.message || `El proveedor de correo respondio ${response.status}.`)
  return { ok: true, providerId: payload?.id || null }
}

export function renderBookingConfirmationEmail(input: BookingConfirmationEmailInput) {
  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * 60_000)
  const dateLabel = formatDate(input.startAt)
  const timeLabel = formatTime(input.startAt)
  const subject = `Turno confirmado en ${input.businessName} - ${dateLabel} ${timeLabel}`
  const timeRange = input.durationMinutes > 0 ? `${timeLabel} – ${formatTime(endAt)}` : timeLabel
  const timeRangeLabel = /^\d{1,2}:\d{2}(?: – \d{1,2}:\d{2})?$/.test(timeRange) ? `${timeRange} hs` : timeRange
  const priceLabel = bookingPriceLabel(input.quotedPrice, input.priceMode)
  const calendar = buildCalendarFile(input, endAt)
  const managementUrl = httpsBookingEmailUrl(input.bookingManagementUrl)
  const mapsUrl = input.businessAddress
    ? httpsBookingEmailUrl(input.businessMapsUrl) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input.businessAddress)}`
    : null
  const text = [
    `Hola ${input.recipientName},`, '',
    `Tu turno en ${input.businessName} está confirmado.`,
    `Servicio: ${input.serviceName}`,
    `Profesional: ${input.professionalName}`,
    `Fecha: ${dateLabel}`,
    `Hora: ${timeRangeLabel}`,
    `Precio: ${priceLabel}`,
    input.businessAddress ? `Lugar: ${input.businessAddress}` : null,
    mapsUrl ? `Cómo llegar: ${mapsUrl}` : null,
    managementUrl ? `Ver mi turno: ${managementUrl}` : null,
    `Código de reserva: ${input.appointmentId}`, '',
    'Adjuntamos el evento para que puedas agregarlo a tu calendario.', '',
    'Weex - Reservas online'
  ].filter((line): line is string => line !== null).join('\n')

  return {
    subject,
    text,
    html: renderEmailHtml(input, endAt, dateLabel, timeRangeLabel, priceLabel, mapsUrl, managementUrl),
    attachments: [{
      filename: 'turno-weex.ics',
      content: Buffer.from(calendar, 'utf8').toString('base64'),
      content_type: 'text/calendar; charset=utf-8; method=PUBLISH'
    }]
  }
}

function renderEmailHtml(
  input: BookingConfirmationEmailInput,
  endAt: Date,
  dateLabel: string,
  timeRange: string,
  priceLabel: string,
  mapsUrl: string | null,
  managementUrl: string | null
) {
  const reservationMarkup = JSON.stringify({
    '@context': 'http://schema.org',
    '@type': 'EventReservation',
    reservationNumber: input.appointmentId,
    ticketNumber: input.appointmentId,
    numSeats: 1,
    reservationStatus: 'http://schema.org/Confirmed',
    underName: {
      '@type': 'Person',
      name: input.recipientName,
      email: input.recipientEmail
    },
    reservationFor: {
      '@type': 'Event',
      name: `${input.serviceName} en ${input.businessName}`,
      startDate: input.startAt.toISOString(),
      endDate: endAt.toISOString(),
      location: {
        '@type': 'Place',
        name: input.businessName,
        address: {
          '@type': 'PostalAddress',
          streetAddress: input.businessAddress || input.businessName,
          addressLocality: input.businessAddressArea || 'Buenos Aires',
          addressRegion: 'Buenos Aires',
          addressCountry: 'AR'
        }
      }
    }
  }).replace(/</g, '\\u003c')
  const businessName = escapeHtml(input.businessName)
  const banner = httpsBookingEmailUrl(input.emailMedia?.bannerUrl)
  const logo = httpsBookingEmailUrl(input.emailMedia?.logoUrl)
  const photos = (input.emailMedia?.galleryUrls || []).slice(0, 3)
    .map(httpsBookingEmailUrl).filter((url): url is string => url !== null)
  const addressText = escapeHtml(input.businessAddress || '')
  const address = mapsUrl
    ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#6d1f1f;text-decoration:underline">${addressText}</a>`
    : addressText
  const action = managementUrl
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px">
         <tr><td bgcolor="#e3c877" align="center" style="border-radius:8px">
           <a href="${escapeHtml(managementUrl)}" style="display:block;padding:13px 12px;color:#141009;font-size:16px;font-weight:bold;text-decoration:none">Ver mi turno</a>
         </td></tr>
       </table>`
    : ''
  const gallery = photos.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;table-layout:fixed">
         <tr>${photos.map((url, index) => `<td valign="top" width="33%" style="padding-right:4px">${emailImage(url, `Trabajo de ${input.businessName}, foto ${index + 1}`, 176, 'width:100%;max-width:176px;border-radius:8px')}</td>`).join('')}
         ${photos.length < 3 ? `<td width="${(3 - photos.length) * 33}%"></td>` : ''}</tr>
       </table>`
    : ''

  return `<!doctype html>
  <html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="application/ld+json">${reservationMarkup}</script></head>
  <body style="margin:0;background:#f3ecdc;font-family:Arial,sans-serif;color:#2a2117">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f3ecdc">
      <tr><td align="center" style="padding:16px 8px">
        <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#fffdf8" style="max-width:600px;border:1px solid #e4d9bf">
          <tr><td bgcolor="#141009" style="padding:14px 22px;color:#e3c877;font-size:24px;font-weight:bold">Weex</td></tr>
          ${banner ? `<tr><td style="padding:14px 20px 0">${emailImage(banner, `Portada de ${input.businessName}`, 558, 'width:100%;max-width:558px;border-radius:12px')}</td></tr>` : ''}
          <tr><td align="center" style="padding:18px 16px 0">
            ${logo ? emailImage(logo, `Logo de ${input.businessName}`, 64, 'margin:0 auto 8px;max-width:64px;border-radius:10px') : ''}
            <h1 style="margin:0 0 8px;font-size:28px;color:#2a2117">${businessName}</h1>
            <span style="display:inline-block;padding:5px 10px;border-radius:20px;background:#6d1f1f;color:#fffdf8;font-size:13px;font-weight:bold">Turno confirmado</span>
          </td></tr>
          <tr><td style="padding:18px 20px 0">
            <p style="margin:0 0 14px;color:#766a59">Hola ${escapeHtml(input.recipientName)}, tu reserva fue confirmada.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e4d9bf;border-bottom:1px solid #e4d9bf">
              ${emailDetailRow('service', `<h2 style="margin:0;font-size:21px;color:#2a2117">${escapeHtml(input.serviceName)}</h2>`)}
              ${emailDetailRow('date', escapeHtml(dateLabel))}
              ${emailDetailRow('time', `<strong>${escapeHtml(timeRange)}</strong>`)}
              ${emailDetailRow('professional', `Con ${escapeHtml(input.professionalName)}`)}
              ${address ? emailDetailRow('location', address) : ''}
              <tr><td colspan="2" style="padding:8px 0 10px;color:#2a2117;font-size:16px;line-height:1.45"><strong>Precio: ${escapeHtml(priceLabel)}</strong></td></tr>
            </table>
            ${action}${gallery}
          </td></tr>
          <tr><td style="padding:16px 20px;color:#766a59;font-size:13px;line-height:1.45;overflow-wrap:anywhere">
            <p style="margin:0 0 5px">Adjuntamos el evento para que puedas agregarlo a tu calendario.</p>
            <p style="margin:0">C&oacute;digo de reserva: ${escapeHtml(input.appointmentId)}</p>
          </td></tr>
          <tr><td align="center" style="padding:12px 16px;border-top:1px solid #e4d9bf;color:#766a59;font-size:12px">Enviado por Weex</td></tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td></tr>
    </table>
  </body></html>`
}

function bookingPriceLabel(quotedPrice: number | null | undefined, priceMode: BookingConfirmationEmailInput['priceMode']) {
  if (!Number.isFinite(quotedPrice) || (quotedPrice ?? 0) < 0) return 'A consultar'
  const formatted = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0
  }).format(quotedPrice)
  return priceMode === 'STARTING_AT' ? `Desde ${formatted}` : formatted
}

function emailDetailRow(icon: keyof typeof bookingConfirmationDetailIcons, content: string) {
  return `<tr>
    <td class="booking-email-detail-icon" width="25" valign="top" aria-hidden="true" style="padding:6px 5px 6px 0;color:#6d1f1f;font-size:16px;line-height:1.45">${bookingConfirmationDetailIcons[icon]}</td>
    <td valign="top" style="padding:6px 0;color:#2a2117;font-size:16px;line-height:1.45;overflow-wrap:anywhere">${content}</td>
  </tr>`
}

function emailImage(url: string, alt: string, width: number, style: string) {
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="${width}" style="display:block;height:auto;box-sizing:border-box;border:1px solid #e4d9bf;${style}">`
}

function buildCalendarFile(input: BookingConfirmationEmailInput, endAt: Date) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Weex//Reservas online//ES',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${escapeIcs(input.appointmentId)}@weex.com.ar`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(input.startAt)}`,
    `DTEND:${formatIcsDate(endAt)}`,
    `SUMMARY:${escapeIcs(`${input.serviceName} en ${input.businessName}`)}`,
    `DESCRIPTION:${escapeIcs(`Turno reservado en ${input.businessName}. Profesional: ${input.professionalName}. Codigo: ${input.appointmentId}.`)}`,
    ...(input.businessAddress ? [`LOCATION:${escapeIcs(input.businessAddress)}`] : []),
    'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n')
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] || character)
}
