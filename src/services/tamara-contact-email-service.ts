type TamaraContactEmailInput = {
  name: string
  contact: string
  interest: 'AURA' | 'CONSULTA'
}

type TamaraContactEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; skipped: true; message: string }

const resendApiUrl = 'https://api.resend.com/emails'

export async function sendTamaraContactEmail(input: TamaraContactEmailInput): Promise<TamaraContactEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.TAMARA_CONTACT_EMAIL_FROM?.trim() || process.env.BOOKING_EMAIL_FROM?.trim()
  const recipient = process.env.TAMARA_CONTACT_EMAIL?.trim() || 'concienciadirecta@gmail.com'
  if (!apiKey || !from) {
    return { ok: false, skipped: true, message: 'El envío de consultas todavía no está configurado.' }
  }

  const interestLabel = input.interest === 'AURA' ? 'Sumarse a Aura' : 'Agendar una consulta'
  const subject = `Nueva consulta web: ${interestLabel}`
  const text = [
    'Nueva consulta desde tamaragrando.weex.com.ar', '',
    `Nombre: ${input.name}`,
    `Email o teléfono: ${input.contact}`,
    `Interés: ${interestLabel}`, '',
    `Recibida: ${new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date())}`
  ].join('\n')

  const response = await fetch(resendApiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: looksLikeEmail(input.contact) ? input.contact : undefined,
      subject,
      text,
      html: renderContactEmailHtml(input, interestLabel)
    })
  })

  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null
  if (!response.ok) throw new Error(payload?.message || `El proveedor de correo respondió ${response.status}.`)
  return { ok: true, providerId: payload?.id || null }
}

function renderContactEmailHtml(input: TamaraContactEmailInput, interestLabel: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#0a0a0b;font-family:Arial,sans-serif;color:#f5f4f1">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px">
      <div style="background:#131316;padding:24px 28px;border-bottom:3px solid #e4222b">
        <strong style="font-size:24px;letter-spacing:.04em">TAMARA GRANDO</strong>
      </div>
      <div style="background:#18181c;padding:32px 28px;border:1px solid #2b2b2f">
        <p style="margin:0 0 8px;color:#c9ff3e;font-size:12px;font-weight:700;text-transform:uppercase">Nueva consulta web</p>
        <h1 style="margin:0 0 24px;font-size:27px">${escapeHtml(input.name)}</h1>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:10px 0;color:#a6a5a1">Email o teléfono</td><td style="padding:10px 0;text-align:right"><strong>${escapeHtml(input.contact)}</strong></td></tr>
          <tr><td style="padding:10px 0;color:#a6a5a1;border-top:1px solid #2b2b2f">Interés</td><td style="padding:10px 0;text-align:right;border-top:1px solid #2b2b2f"><strong>${escapeHtml(interestLabel)}</strong></td></tr>
        </table>
        <p style="margin:28px 0 0;color:#777673;font-size:12px">Enviado desde tamaragrando.weex.com.ar</p>
      </div>
    </div>
  </body></html>`
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] || character)
}
