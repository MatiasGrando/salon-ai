import assert from 'node:assert/strict'
import { sendBookingConfirmationEmail } from '../src/services/booking-confirmation-email-service.js'

const originalFetch = globalThis.fetch
const originalApiKey = process.env.RESEND_API_KEY
const originalFrom = process.env.BOOKING_EMAIL_FROM
process.env.RESEND_API_KEY = 'local-test-key'
process.env.BOOKING_EMAIL_FROM = 'Weex <test@example.com>'

const input = {
  recipientEmail: 'cliente@example.com',
  recipientName: 'María & Tomás',
  appointmentId: 'appointment-local',
  businessName: 'La Cochera <local>',
  businessAddress: 'Franklin Delano Roosevelt 5520, Villa Urquiza',
  businessMapsUrl: 'https://maps.example.test/la-cochera?entry=email&place=5520',
  serviceName: 'Corte',
  professionalName: 'Joaquín',
  startAt: new Date('2026-09-26T18:00:00.000Z'),
  durationMinutes: 30,
  bookingManagementUrl: 'https://weex.com.ar/la-cochera/cuenta',
  emailMedia: {
    bannerUrl: 'https://example.com/media/header.jpg',
    logoUrl: null,
    galleryUrls: ['https://example.com/media/corte-2.jpg', 'https://example.com/media/corte-1.jpg']
  }
}

type ProviderPayload = {
  html: string
  text: string
  attachments: Array<{ filename: string; content: string }>
}

const deliveries: ProviderPayload[] = []
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://api.resend.com/emails')
  assert.equal(options?.method, 'POST')
  deliveries.push(JSON.parse(String(options?.body)) as ProviderPayload)
  return Response.json({ id: 'local-delivery' })
}

try {
  assert.deepEqual(await sendBookingConfirmationEmail(input), { ok: true, providerId: 'local-delivery' })
  const first = deliveries[0]!
  assert.match(first.html, /src="https:\/\/example\.com\/media\/header\.jpg"/)
  assert.match(first.html, /alt="Portada de La Cochera &lt;local&gt;"/)
  assert.match(first.html, /corte-2\.jpg[\s\S]+corte-1\.jpg/)
  assert.match(first.html, /María &amp; Tomás/)
  assert.match(first.html, /Corte[\s\S]+Joaquín/)
  assert.match(first.html, /15:00\s*–\s*15:30 hs/, 'el correo de 24 horas muestra hs en la ficha')
  assert.equal((first.html.match(/class="booking-email-detail-icon"/g) || []).length, 5)
  assert.match(first.html, /href="https:\/\/maps\.example\.test\/la-cochera\?entry=email&amp;place=5520"[^>]*>Franklin Delano Roosevelt 5520, Villa Urquiza<\/a>/)
  assert.equal((first.html.match(/<img[^>]+border:1px solid #e4d9bf;[^>]+border-radius:/g) || []).length, 3)
  assert.match(first.html, /Franklin Delano Roosevelt 5520/)
  assert.match(first.html, /href="https:\/\/weex\.com\.ar\/la-cochera\/cuenta"[\s\S]*Ver mi turno/)
  assert.match(first.text, /Corte[\s\S]+Joaquín[\s\S]+15:00\s*–\s*15:30 hs/)
  assert.equal(first.attachments[0]?.filename, 'turno-weex.ics')
  const event = Buffer.from(first.attachments[0]!.content, 'base64').toString('utf8')
  assert.match(event, /DTSTART:20260926T180000Z\r\nDTEND:20260926T183000Z/)

  const { emailMedia, bookingManagementUrl, ...textOnlyInput } = input
  await sendBookingConfirmationEmail({ ...textOnlyInput, durationMinutes: 0, businessMapsUrl: 'javascript:alert(1)' })
  const textOnly = deliveries[1]!
  assert.doesNotMatch(textOnly.html, /<img\b|Ver mi turno/)
  assert.match(textOnly.html, /Corte[\s\S]+Joaquín/)
  assert.match(textOnly.html, />15:00 hs<\/strong>/)
  assert.match(textOnly.html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=[^"]+"[^>]*>Franklin Delano Roosevelt 5520, Villa Urquiza<\/a>/)
  assert.doesNotMatch(textOnly.html, /javascript:/)
  assert.equal(textOnly.attachments[0]?.filename, 'turno-weex.ics')

  await sendBookingConfirmationEmail({
    ...input,
    bookingManagementUrl: 'javascript:alert(1)',
    emailMedia: {
      bannerUrl: 'http://example.com/crop.jpg',
      logoUrl: 'https://admin@example.com/logo.jpg',
      galleryUrls: ['data:image/jpeg;base64,ZmFrZQ==', '//example.com/externa.jpg']
    }
  })
  assert.doesNotMatch(deliveries[2]!.html, /<img\b|Ver mi turno|javascript:/)
} finally {
  globalThis.fetch = originalFetch
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalApiKey
  if (originalFrom === undefined) delete process.env.BOOKING_EMAIL_FROM
  else process.env.BOOKING_EMAIL_FROM = originalFrom
}

console.log('OK: el correo mantiene la ficha, el calendario y las fotos ordenadas con medios y enlaces seguros.')
