type BookingConfirmationEmailInput = {
  recipientEmail: string
  recipientName: string
  appointmentId: string
  businessName: string
  businessAddress?: string | null
  serviceName: string
  professionalName: string
  startAt: Date
  durationMinutes: number
}

type EmailDeliveryResult =
  | { ok: true; providerId: string | null }
  | { ok: false; skipped?: boolean; message: string }

const resendApiUrl = 'https://api.resend.com/emails'

export async function sendBookingConfirmationEmail(input: BookingConfirmationEmailInput): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.BOOKING_EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    return { ok: false, skipped: true, message: 'El correo de confirmacion no esta configurado.' }
  }

  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * 60_000)
  const dateLabel = formatDate(input.startAt)
  const timeLabel = formatTime(input.startAt)
  const subject = `Turno confirmado en ${input.businessName} - ${dateLabel} ${timeLabel}`
  const calendar = buildCalendarFile(input, endAt)
  const text = [
    `Hola ${input.recipientName},`, '',
    `Tu turno en ${input.businessName} esta confirmado.`,
    `Servicio: ${input.serviceName}`,
    `Profesional: ${input.professionalName}`,
    `Fecha: ${dateLabel}`,
    `Hora: ${timeLabel}`,
    input.businessAddress ? `Lugar: ${input.businessAddress}` : null,
    `Codigo de reserva: ${input.appointmentId}`, '',
    'Adjuntamos el evento para que puedas agregarlo a tu calendario.', '',
    'Weex - Reservas online'
  ].filter((line): line is string => line !== null).join('\n')

  const response = await fetch(resendApiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [input.recipientEmail],
      subject,
      text,
      html: renderEmailHtml(input, dateLabel, timeLabel),
      attachments: [{
        filename: 'turno-weex.ics',
        content: Buffer.from(calendar, 'utf8').toString('base64'),
        content_type: 'text/calendar; charset=utf-8; method=PUBLISH'
      }]
    })
  })

  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null
  if (!response.ok) throw new Error(payload?.message || `El proveedor de correo respondio ${response.status}.`)
  return { ok: true, providerId: payload?.id || null }
}

function renderEmailHtml(input: BookingConfirmationEmailInput, dateLabel: string, timeLabel: string) {
  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * 60_000)
  const reservationMarkup = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'EventReservation',
    reservationNumber: input.appointmentId,
    reservationStatus: 'https://schema.org/ReservationConfirmed',
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
        ...(input.businessAddress ? { address: input.businessAddress } : {})
      }
    }
  }).replace(/</g, '\\u003c')
  const location = input.businessAddress
    ? `<tr><td style="padding:6px 0;color:#766a59">Lugar</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(input.businessAddress)}</strong></td></tr>`
    : ''
  return `<!doctype html><html lang="es"><head><script type="application/ld+json">${reservationMarkup}</script></head><body style="margin:0;background:#f3ecdc;font-family:Arial,sans-serif;color:#2a2117">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px">
      <div style="background:#141009;color:#e3c877;padding:22px 28px;font-size:24px;font-weight:700">Weex</div>
      <div style="background:#fffdf8;padding:32px 28px;border:1px solid #e4d9bf">
        <p style="margin:0 0 8px;color:#6d1f1f;font-size:13px;font-weight:700;text-transform:uppercase">Turno confirmado</p>
        <h1 style="margin:0 0 20px;font-size:28px">${escapeHtml(input.businessName)}</h1>
        <p>Hola ${escapeHtml(input.recipientName)}, tu reserva fue confirmada.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0">
          <tr><td style="padding:6px 0;color:#766a59">Servicio</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(input.serviceName)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#766a59">Profesional</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(input.professionalName)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#766a59">Fecha</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(dateLabel)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#766a59">Hora</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(timeLabel)}</strong></td></tr>${location}
        </table>
        <p style="color:#766a59">Adjuntamos un archivo de calendario para que puedas guardar el turno.</p>
        <p style="margin-top:28px;font-size:12px;color:#8a7f6d">Código de reserva: ${escapeHtml(input.appointmentId)}</p>
      </div>
    </div>
  </body></html>`
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
