export type InformationAction = 'SERVICES' | 'PRICES' | 'HOURS' | 'ADDRESS' | 'BUSINESS_INFO'
export type ActionId = InformationAction | 'AVAILABILITY' | 'CREATE_BOOKING' | 'CANCEL' | 'RESCHEDULE' | 'HUMAN_HANDOFF'
type ActionDefinition = { kind: 'read' | 'write'; requirements: readonly string[]; status: 'implemented' | 'proposal_only' | 'pending' }
export const ACTION_REGISTRY: Readonly<Record<ActionId, ActionDefinition>> = {
  SERVICES: { kind: 'read', requirements: ['trusted_business'], status: 'implemented' },
  PRICES: { kind: 'read', requirements: ['trusted_business', 'unambiguous_service'], status: 'implemented' },
  HOURS: { kind: 'read', requirements: ['trusted_business', 'timezone', 'database_clock'], status: 'implemented' },
  ADDRESS: { kind: 'read', requirements: ['trusted_business'], status: 'implemented' },
  BUSINESS_INFO: { kind: 'read', requirements: ['trusted_business'], status: 'implemented' },
  AVAILABILITY: { kind: 'read', requirements: ['trusted_business', 'service', 'date'], status: 'implemented' },
  CREATE_BOOKING: { kind: 'write', requirements: ['service', 'validated_slot', 'customer_name', 'explicit_confirmation'], status: 'proposal_only' },
  CANCEL: { kind: 'write', requirements: ['owned_future_booking', 'explicit_confirmation'], status: 'pending' },
  RESCHEDULE: { kind: 'write', requirements: ['owned_future_booking', 'validated_slot', 'explicit_confirmation'], status: 'pending' },
  HUMAN_HANDOFF: { kind: 'write', requirements: ['trusted_conversation', 'explicit_intent'], status: 'pending' }
}
export const normalizeMessage = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9:/?@.-]+/g, ' ').trim()
function informationActions(message: string): InformationAction[] {
  const text = normalizeMessage(message)
  const information: InformationAction[] = []
  const add = (action: InformationAction, match: boolean) => { if (match && ACTION_REGISTRY[action].status === 'implemented') information.push(action) }
  add('SERVICES', /\b(?:que|cuales|mostrame|mostrar|lista|ver)\b.*\bservicios\b/.test(text))
  add('PRICES', /\b(precio|precios|cuesta|cuestan|sale|salen|costo|cobran)\b/.test(text))
  const availability = /\b(turno|turnos|lugar|espacio|hueco)\b/.test(text)
  add('HOURS', /\b(abren|abre|cierran|cierra|apertura|horario de atencion)\b/.test(text) || !availability && /\bhorarios?\b/.test(text))
  add('ADDRESS', /\b(direccion|ubicacion|domicilio|donde quedan|donde estan|donde queda|como llego|mapa)\b/.test(text))
  add('BUSINESS_INFO', /\b(pagina|web|sitio|telefono|whatsapp|contacto|email|correo|instagram|facebook|tiktok|informacion|info|link|enlace)\b/.test(text))
  return information
}
export function routeActions(message: string): { information: InformationAction[]; informationMessage: string; pendingAction: ActionId | null; bookingMessage: string | null } {
  const text = normalizeMessage(message)
  const pendingAction = /\b(cancelar|canselar|anular)\b/.test(text) ? 'CANCEL'
    : /\b(reprogramar|reagendar|modificar|mover|cambiar|camviar)\b.*\bturno\b/.test(text) ? 'RESCHEDULE'
    : /\b(persona|humano|personal|equipo)\b.*\b(hablar|atender)\b|\b(hablar|atienda|atender)\b.*\b(persona|humano|personal|equipo)\b|\bhablar con\b/.test(text) ? 'HUMAN_HANDOFF' : null
  // Only split meaningful clause boundaries, keeping catalog conjunctions such as "Corte y Color".
  const clauses = message.split(/(?:\s+y\s+|[,;?!]\s+)(?=(?:quiero|quisiera|necesito|reservar|agendar|cu[aá]nto|precio|direcci[oó]n|d[oó]nde|a qu[eé]|qu[eé]|cu[aá]les|abren|abre|cierran|cierra|horario|tel[eé]fono|contacto|mostrame|mostrar|ver)\b)/iu)
  const reads: string[] = []
  const bookings: string[] = []
  const information = new Set<InformationAction>()
  for (const clause of clauses) {
    const detected = informationActions(clause)
    if (detected.length) {
      reads.push(clause)
      for (const action of detected) information.add(action)
    } else if (/\b(?:quiero|quisiera|necesito|reservar|agendar)\b/i.test(clause)) bookings.push(clause)
  }
  // Ambiguous, unsplit informational clauses never feed booking field extraction.
  return {
    information: [...information], informationMessage: reads.join(' y '), pendingAction,
    bookingMessage: information.size ? bookings.length ? bookings.join(' ') : null : message
  }
}
