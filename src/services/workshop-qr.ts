import QRCode from 'qrcode'

export class WorkshopQrValidationError extends Error {}

export function normalizeWorkshopPublicSiteUrl(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WorkshopQrValidationError('Ingresá una URL pública válida')
  }
  if (url.protocol !== 'https:') throw new WorkshopQrValidationError('La página pública debe usar HTTPS')
  if (url.username || url.password) throw new WorkshopQrValidationError('La URL pública no puede incluir credenciales')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function workshopVehiclePublicUrl(baseUrl: string, plate: string) {
  const normalizedBaseUrl = normalizeWorkshopPublicSiteUrl(baseUrl)
  if (!normalizedBaseUrl) throw new WorkshopQrValidationError('Configurá la página pública antes de generar el QR')
  const url = new URL(normalizedBaseUrl)
  url.searchParams.set('patente', plate)
  url.hash = 'consulta-patente'
  return url.toString()
}

export function workshopVehicleQrDataUrl(publicUrl: string) {
  return QRCode.toDataURL(publicUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 720,
    color: { dark: '#111827ff', light: '#ffffffff' }
  })
}
