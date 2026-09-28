import { formatCatalogPrice } from '../bot-options/application/catalog-queries.js'
import { normalizeMessage, type InformationAction } from './actions.js'
import type { DialogueService, DialogueState } from './engine.js'
export type BusinessFacts = {
  businessId: string; name: string; address: string | null; area: string | null; mapsUrl: string | null
  website: string | null; bookingUrl: string | null; whatsapp: string | null; email: string | null
  instagram: string | null; facebook: string | null; tiktok: string | null; description: string | null; hours: string | null
}
export function validateFacts(facts: BusinessFacts, businessId: string): void {
  if (!facts || facts.businessId !== businessId) throw new Error('invalid information scope')
  for (const value of Object.values(facts)) if (value !== null && (typeof value !== 'string' || value.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw new Error('invalid public facts')
}
export function renderServices(services: readonly DialogueService[]): string {
  return services.map(service => {
    const price = formatCatalogPrice(service.price, service.priceMode ?? 'FIXED') ?? 'precio a consultar'
    return `${service.name}: ${price}${service.durationMinutes ? ` (${service.durationMinutes} min)` : ''}`
  }).join('\n') || 'No tengo servicios publicados.'
}
export function renderInformation(actions: readonly InformationAction[], message: string, facts: BusinessFacts | null, services: readonly DialogueService[]): string {
  const text = normalizeMessage(message)
  const replies: string[] = []
  for (const action of actions) {
    if (action === 'SERVICES') replies.push(renderServices(services))
    if (action === 'PRICES') {
      const tokens = text.replace(/[?.,]/g, ' ').split(/\s+/)
      let found = services.filter(service => normalizeMessage(service.name).split(' ').every(word => tokens.includes(word)))
      const full = found
      const partial = services.filter(service => normalizeMessage(service.name).split(' ').some(word => tokens.includes(word)))
      if (!found.length) found = partial
      else if (found.length === 1 && partial.some(other => other.id !== found[0]!.id && normalizeMessage(found[0]!.name).split(' ').every(word => normalizeMessage(other.name).split(' ').includes(word)))) found = partial
      // Partial labels must be disambiguated rather than giving a falsely exact price.
      if (found.length === 1 && full.length === 1) replies.push(renderServices(found))
      else if (found.length) replies.push(`¿Cuál de estos servicios querés consultar? ${found.map(s => s.name).join(', ')}.`)
      else replies.push('¿De qué servicio querés consultar el precio?')
    }
    if (action === 'HOURS') replies.push(facts?.hours || 'No tengo horarios publicados.')
    if (action === 'ADDRESS') replies.push([facts?.address, facts?.area, facts?.mapsUrl].filter(Boolean).join(', ') || 'No tengo una dirección publicada.')
    if (action === 'BUSINESS_INFO') {
      const selected: string[] = []
      const add = (label: string, value: string | null | undefined) => selected.push(value ? `${label}: ${value}` : `No tengo ${label.toLowerCase()} publicado.`)
      if (/\b(pagina|web|sitio)\b/.test(text)) add('Sitio web', facts?.website)
      if (/\b(link|enlace)\b/.test(text)) add('Enlace de reservas', facts?.bookingUrl)
      if (/\b(telefono|whatsapp|contacto)\b/.test(text)) add('WhatsApp', facts?.whatsapp)
      if (/\b(email|correo|contacto)\b/.test(text)) add('Correo', facts?.email)
      for (const social of ['instagram', 'facebook', 'tiktok'] as const) if (text.includes(social)) add(social, facts?.[social])
      if (!selected.length) selected.push([facts?.name, facts?.description].filter(Boolean).join(': ') || 'No tengo información publicada.')
      replies.push(selected.join('\n'))
    }
  }
  return replies.join('\n')
}
export function pendingQuestion(state: DialogueState): string {
  const questions = { service: '¿Qué servicio necesitás?', date: '¿Para qué día querés el turno?', professional: '¿Con qué profesional querés atenderte?', time: '¿Qué horario de los disponibles elegís?', name: '¿A nombre de quién sería el turno?', proposal: 'La propuesta sigue pendiente; todavía no está reservado.' }
  return questions[state.pending]
}
