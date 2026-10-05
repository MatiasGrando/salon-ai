import { standardDelivery, type StandardField, type StandardDeliveryOptions } from './standard-delivery.js'
import { publicMapsLink } from './maps-link.js'
import { dialogueQuestion } from './dialogue-context.js'
import { formatCatalogPrice, formatCatalogDuration } from '../bot-options/application/catalog-queries.js'
import { normalizeMessage, type InformationAction } from './actions.js'
import { basketIsResolved } from './service-basket.js'
import type { DialogueService, DialogueState } from './engine.js'
export type BusinessFacts = {
  businessId: string; name: string; address: string | null; area: string | null; mapsUrl: string | null
  website: string | null; bookingUrl: string | null; whatsapp: string | null; email: string | null
  instagram: string | null; facebook: string | null; tiktok: string | null; description: string | null; hours: string | null
  paymentMethods?: string | null; discounts?: string | null; parking?: string | null; accessibility?: string | null; wifi?: string | null; policies?: string | null
}
export function validateFacts(facts: BusinessFacts, businessId: string): void {
  if (!facts || facts.businessId !== businessId) throw new Error('invalid information scope')
  for (const value of Object.values(facts)) if (value !== null && (typeof value !== 'string' || value.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw new Error('invalid public facts')
}
function addressLabel(facts: BusinessFacts | null): string | null {
  const address = facts?.address?.trim()
  const area = facts?.area?.trim()
  if (!address && !area) return null
  if (address && area && address.toLowerCase().includes(area.toLowerCase())) return address
  return [address, area].filter(Boolean).join(', ')
}
export function renderServices(services: readonly DialogueService[], purpose?: 'booking' | 'price' | 'details', options?: StandardDeliveryOptions): string {
  return standardDelivery({ kind: 'services', ...(purpose ? { purpose } : {}), services: services.map(service => ({ name: service.name,
    price: formatCatalogPrice(service.price, service.priceMode ?? 'FIXED'),
    duration: formatCatalogDuration(service.durationMinutes, service.durationMinMinutes ?? null, service.durationMaxMinutes ?? null) })) }, options)
}
export function renderInformation(actions: readonly InformationAction[], message: string, facts: BusinessFacts | null, services: readonly DialogueService[], options?: StandardDeliveryOptions): string {
  const text = normalizeMessage(message)
  const replies: string[] = []
  for (const action of actions) {
    if (action === 'SERVICES') replies.push(renderServices(services, undefined, options))
    if (action === 'PRICES') {
      const tokens = text.replace(/[?.,]/g, ' ').split(/\s+/)
      let found = services.filter(service => normalizeMessage(service.name).split(' ').every(word => tokens.includes(word)))
      const full = found
      const partial = services.filter(service => normalizeMessage(service.name).split(' ').some(word => tokens.includes(word)))
      if (!found.length) found = partial
      else if (found.length === 1 && partial.some(other => other.id !== found[0]!.id && normalizeMessage(found[0]!.name).split(' ').every(word => normalizeMessage(other.name).split(' ').includes(word)))) found = partial
      // Partial labels must be disambiguated rather than giving a falsely exact price.
      if (found.length === 1 && full.length === 1) replies.push(renderServices(found, undefined, options))
      else if (found.length) replies.push(renderServices(found, 'price', options))
      // SERVICES already includes each public price; a generic price read adds no separate question.
      else if (!actions.includes('SERVICES')) replies.push('¿De qué servicio querés consultar el precio?')
    }
    if (action === 'HOURS') replies.push(standardDelivery({ kind: 'hours', hours: facts?.hours ?? null, businessName: facts?.name ?? null }, options))
    if (action === 'ADDRESS') {
      const label = addressLabel(facts)
      const maps = publicMapsLink({ businessName: facts?.name ?? null, address: facts?.address?.trim() ? label : null, addressArea: null, mapsUrl: facts?.mapsUrl ?? null })?.url
      replies.push(standardDelivery({ kind: 'address', address: label, areaOnly: !facts?.address?.trim(), mapsUrl: maps ?? null, businessName: facts?.name ?? null }, options))
    }
    if (action === 'BUSINESS_INFO') {
      const selected: StandardField[] = []
      const add = (label: string, value: string | null | undefined, link = false) => { if (value) selected.push({ label, value, link }) }
      if (/\b(pagina|web|sitio)\b/.test(text)) add('Sitio web', facts?.website, true)
      if (/\b(link|enlace)\b/.test(text)) add('Enlace de reservas', facts?.bookingUrl, true)
      if (/\b(telefono|whatsapp|contacto)\b/.test(text)) add('WhatsApp', facts?.whatsapp)
      if (/\b(email|correo|contacto)\b/.test(text)) add('Correo', facts?.email)
      for (const [social, label] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok']] as const) if (text.includes(social)) add(label, facts?.[social], true)
      if (!selected.length && facts?.description && !/\b(instagram|facebook|tiktok|pagina|web|sitio|correo|telefono|whatsapp|link|enlace)\b/.test(text)) add(facts.name, facts.description)
      replies.push(selected.length ? standardDelivery({ kind: 'fields', fields: selected }, options) : standardDelivery({ kind: 'missing', businessName: facts?.name ?? null }, options))
    }
  }
  return replies.join('\n')
}
export function pendingQuestion(state: DialogueState): string {
  if (state.editRequest) return dialogueQuestion(state.editRequest.fields[0]!)
  if (state.pending === 'proposal' && state.sandboxReservation && !state.sandboxReservation.receipt) return '¿Confirmás este turno de prueba?'
  if (state.pending === 'service' && state.basket?.members.some(member => member.mode !== 'single')) return '¿Cuál de las opciones del servicio pendiente querés?'
  if (state.pending === 'service' && basketIsResolved(state)) return '¿Querés cambiar o quitar algún servicio del pedido, o consultarlo con el equipo?'
  if (state.pending === 'time' && !state.dialogueContext?.presentedOffer) return '¿Querés que consultemos los horarios para tu turno?'
  return dialogueQuestion(state.pending)
}
