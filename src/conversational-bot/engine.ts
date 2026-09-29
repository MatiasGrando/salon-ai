import { ACTION_REGISTRY, routeActions, type InformationAction } from './actions.js'
import { pendingQuestion, renderInformation, renderServices, validateFacts, type BusinessFacts } from './information.js'
import { localDateKey, localDateTimeToInstants, parseMinutes, type AvailabilityProfessional, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'

export type DialogueService = { id: string; name: string; durationMinutes: number | null; requiresConsultation: boolean; price: number | null; priceMode?: 'FIXED' | 'STARTING_AT' }
export type DialogueContext = { businessId: string; timezone: string; dbNow: Date }
export type DialoguePort = {
  information?(actions?: readonly InformationAction[]): Promise<BusinessFacts>
  catalog(): Promise<DialogueService[]>
  availability(service: DialogueService, date: string, professionalId?: string): Promise<{ professionals: AvailabilityProfessional[]; slots: AvailabilitySlot[] }>
}
export type DialogueState = {
  schemaVersion: 1; engine: 'conversational-booking-v1'; businessId: string
  pending: 'service' | 'date' | 'professional' | 'time' | 'name' | 'proposal'
  serviceId: string | null; date: string | null
  professional: null | { kind: 'any' } | { kind: 'specific'; id: string }
  /** Unverified name until uniquely matched against the selected service's compatible professionals. */
  professionalNameHint: string | null
  requestedTime: string | null; slot: AvailabilitySlot | null; customerName: string | null
}
export type BookingProposal = { kind: 'BOOKING_PROPOSAL'; businessId: string; serviceId: string; professionalId: string; startAt: string; customerName: string }
export type DialogueResponse = { state: DialogueState; reply: string; proposal: BookingProposal | null }
/** Validated QA decision: IDs are rechecked against the current catalog; text still supplies dates and preferences. */
export type DialogueDecision = { serviceId: string | null; candidateIds: readonly string[]; correction: boolean }
export function initialDialogueState(businessId: string): DialogueState {
  return { schemaVersion: 1, engine: 'conversational-booking-v1', businessId, pending: 'service', serviceId: null, date: null, professional: null, professionalNameHint: null, requestedTime: null, slot: null, customerName: null }
}
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value)
function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const instant = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day
}
export function parseDialogueState(value: unknown, businessId: string, timezone?: string): DialogueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid dialogue state')
  const s = value as DialogueState
  if (JSON.stringify(value).length > 4096 || s.schemaVersion !== 1 || s.engine !== 'conversational-booking-v1' || s.businessId !== businessId || !bounded(businessId, 128)) throw new Error('invalid dialogue scope')
  if (!['service', 'date', 'professional', 'time', 'name', 'proposal'].includes(s.pending)) throw new Error('invalid dialogue step')
  for (const v of [s.serviceId, s.customerName]) if (v !== null && !bounded(v, v === s.customerName ? 100 : 128)) throw new Error('invalid dialogue field')
  if (s.date !== null && !validCalendarDate(s.date)) throw new Error('invalid date')
  if (s.requestedTime !== null && parseMinutes(s.requestedTime) === null) throw new Error('invalid requested time')
  if (s.professional !== null && (s.professional.kind !== 'any' && (s.professional.kind !== 'specific' || !bounded(s.professional.id, 128)))) throw new Error('invalid professional')
  // Older schemaVersion 1 snapshots have no hint; keep them readable without a SQL migration.
  if (s.professionalNameHint !== undefined && s.professionalNameHint !== null && (!bounded(s.professionalNameHint, 100) || !/^[a-z]+(?: [a-z]+){0,2}$/.test(s.professionalNameHint))) throw new Error('invalid professional hint')
  if (s.slot !== null && (!s.serviceId || !s.date || !s.professional || s.slot.date !== s.date || !bounded(s.slot.professionalId, 128) || !bounded(s.slot.professionalName, 200) || !Number.isFinite(Date.parse(s.slot.startAt)) || parseMinutes(s.slot.time) === null || (s.professional.kind === 'specific' && s.professional.id !== s.slot.professionalId))) throw new Error('invalid slot')
  if ((!s.serviceId && (s.date && s.slot || s.professional || s.slot)) || (!s.date && s.slot) || (s.pending === 'proposal' && (!s.slot || !s.customerName))) throw new Error('invalid dialogue invariants')
  if (s.slot && timezone) {
    const instant = new Date(s.slot.startAt)
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
    if (localDateKey(instant, timezone) !== s.slot.date || time !== s.slot.time) throw new Error('invalid slot wall time')
  }
  return structuredClone({ ...s, professionalNameHint: s.professionalNameHint ?? null })
}
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9:/-]+/g, ' ').trim()
const words = (text: string) => normalize(text).split(' ').filter(w => w && w !== 'y').sort()
function matches<T extends { name: string }>(text: string, items: T[]): T[] {
  const input = words(text)
  const exact = items.filter(item => JSON.stringify(words(item.name)) === JSON.stringify(input))
  if (exact.length) return exact
  const contained = items.filter(item => words(item.name).every(word => input.includes(word)))
  if (contained.length) return contained
  const partial = input.filter(word => !['quiero', 'un', 'una', 'turno', 'para', 'hoy', 'manana', 'con', 'el', 'la', 'servicio', 'cambiar'].includes(word))
  return partial.length ? items.filter(item => partial.every(word => words(item.name).includes(word))) : []
}
function extractProfessionalHint(text: string): string | null {
  const match = /\bcon\s+([a-z]+(?:\s+(?!(?:manana|hoy|pasado|para|el|la|a|las|y|pero|no|quiero|un|una|turno|servicio)\b)[a-z]+){0,2})\b/.exec(text)
  return match?.[1] ?? null
}
function extractDate(text: string, context: DialogueContext): string | null {
  if (/\bmanana\b/.test(text)) return localDateKey(context.dbNow, context.timezone, 1)
  if (/\bhoy\b/.test(text)) return localDateKey(context.dbNow, context.timezone)
  const explicit = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/.exec(text)
  if (!explicit) return null
  const year = explicit[3]!.length === 2 ? `20${explicit[3]}` : explicit[3]!
  const date = `${year}-${explicit[2]!.padStart(2, '0')}-${explicit[1]!.padStart(2, '0')}`
  return validCalendarDate(date) && localDateTimeToInstants(date, 720, context.timezone).length ? date : null
}
function extractTime(text: string): string | null {
  const match = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (match) return `${match[1]!.padStart(2, '0')}:${match[2]}`
  const compact = /^(?:el de las |a las )?([01]?\d|2[0-3])([0-5]\d)$/.exec(text)
  if (compact) return `${compact[1]!.padStart(2, '0')}:${compact[2]}`
  return null
}
function clearSlot(state: DialogueState) { state.slot = null; state.requestedTime = null }
const serviceList = renderServices
async function respondBooking(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const text = normalize(message)
  const finish = (reply: string, proposal: BookingProposal | null = null) => ({ state, reply, proposal })
  if (/^(reset|volver a empezar|empezar de nuevo|no quiero nada|nada gracias)$/.test(text)) return { state: initialDialogueState(context.businessId), reply: 'De acuerdo. Cuando quieras, podemos buscar otro turno.', proposal: null }
  if (/^(gracias|muchas gracias|chau|hasta luego)$/.test(text)) return finish('Gracias a vos. Estoy disponible si necesitás algo más.')
  const services = await port.catalog()
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  let service = services.find(s => s.id === state.serviceId)
  if (state.serviceId && !service) { state.serviceId = null; state.professional = null; clearSlot(state); state.pending = 'service' }
  if (/\bcambiar (?:la )?(?:hora|horario)\b/.test(text)) clearSlot(state)
  if (/\bcambiar (?:el )?servicio\b/.test(text)) { state.serviceId = null; service = undefined; state.professional = null; clearSlot(state) }
  const anyProfessional = /\b(cualquiera|cualquier profesional|sin preferencia|me da igual)\b/.test(text)
  const rejectsProfessional = /\bnunca te dije\b/.test(text)
  if (rejectsProfessional) { state.professional = null; state.professionalNameHint = null; clearSlot(state); state.pending = 'professional' }
  if (anyProfessional) state.professionalNameHint = null
  else if (!rejectsProfessional) {
    const earlyName = extractProfessionalHint(text)
    if (earlyName && !matches(earlyName, services).length) {
      state.professionalNameHint = earlyName
      state.professional = null
      clearSlot(state)
    }
  }
  const catalogQuestion = /(?:que|cuales|mostrame|mostrar).*servicios/.test(text)
  if (decision?.correction) { state.serviceId = null; service = undefined; state.professional = null; clearSlot(state) }
  const found = decision ? services.filter(item => decision.candidateIds.includes(item.id) || item.id === decision.serviceId)
    : catalogQuestion ? [] : matches(text, services)
  if (decision && found.length !== new Set([...decision.candidateIds, ...(decision.serviceId ? [decision.serviceId] : [])]).size) throw new Error('invalid decision catalog')
  if (found.length > 1) {
    const earlyDate = extractDate(text, context)
    if (earlyDate) state.date = earlyDate
    state.pending = 'service'
    return finish(`¿Cuál de estos servicios querés?\n${serviceList(found)}`)
  }
  if (found.length === 1 && found[0]!.id !== state.serviceId) { service = found[0]!; state.serviceId = service.id; state.professional = null; clearSlot(state) }
  const date = extractDate(text, context)
  if (/\b\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})\b/.test(text) && !date) {
    state.date = null; clearSlot(state); state.pending = 'date'
    return finish('Esa fecha no es válida. ¿Qué día querés consultar?')
  }
  if (date && date !== state.date) { state.date = date; clearSlot(state) }
  if (/^(otro dia|probamos otro dia)$/.test(text)) { state.date = null; clearSlot(state) }
  const time = extractTime(text)
  if (time) { state.requestedTime = time; state.slot = null }
  const name = /\b(?:soy|me llamo|mi nombre es)\s+([\p{L}][\p{L} '\-]{1,98}?)(?=\s+(?:quiero|turno|hoy|mañana|manana|con)\b|$)/iu.exec(message)
  if (name && !/\b(?:quiero|turno|hoy|mañana|manana|con)\b/i.test(name[1]!)) state.customerName = name[1]!.trim()
  else if ((previous as DialogueState).pending === 'name' && /^[\p{L}][\p{L} '\-]{1,98}$/u.test(message.trim()) &&
    !/\b(hola|buenas|quiero|servicios|servicio|horarios|horario|gracias|no|si|ok|okey|dale|perfecto|confirmar|confirmo|cancelar|cambiar|reset|volver|turno|cualquiera|cualquier|profesional|preferencia|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|precio|direccion|soy|nombre|llamo)\b/.test(text) &&
    !matches(text, services).length) state.customerName = message.trim()
  let prefix = catalogQuestion ? `${serviceList(services)}\n` : /^(hola|buenas|como estas|sos linda|salimos)/.test(text) ? 'Hola. Te ayudo con tu turno.\n' : ''
  if (!service) { state.pending = 'service'; return finish(`${prefix}¿Qué servicio necesitás?\n${serviceList(services) || 'No tengo servicios disponibles para consultar.'}`) }
  if (service.requiresConsultation || !service.durationMinutes || service.durationMinutes <= 0) return finish('Este servicio requiere una consulta con el equipo antes de reservar.')
  if (!state.date) { state.pending = 'date'; return finish(`${prefix}¿Para qué día querés ${service.name}?`) }
  if (state.date < localDateKey(context.dbNow, context.timezone)) { state.date = null; clearSlot(state); state.pending = 'date'; return finish('Esa fecha ya pasó. ¿Qué otro día querés consultar?') }
  const available = await port.availability(service, state.date, state.professional?.kind === 'specific' ? state.professional.id : undefined)
  const professionals = available.professionals
  const professionalText = name ? normalize(message.replace(name[0], '')) : text
  const negativePreference = !extractProfessionalHint(text) && /\b(?:no|nunca)\b/.test(professionalText) && matches(professionalText.replace(/\b(?:no|nunca|te|dije|quiero)\b/g, ''), professionals).length > 0
  if (negativePreference) { state.professional = null; state.professionalNameHint = null; clearSlot(state); state.pending = 'professional' }
  if ((previous as DialogueState).pending === 'name' && !name && matches(text, professionals).length) state.customerName = (previous as DialogueState).customerName
  let slots = available.slots.filter(s => s.date === state.date && Date.parse(s.startAt) > context.dbNow.getTime() && professionals.some(p => p.id === s.professionalId))
  if (anyProfessional) { state.professional = { kind: 'any' }; state.professionalNameHint = null; state.slot = null }
  else if (!negativePreference && !rejectsProfessional) {
    const namedNow = (previous as DialogueState).pending === 'professional' && professionals.length === 1 && /^(si|dale|perfecto)$/.test(professionalText)
      ? professionals : matches(professionalText, professionals)
    const hint = state.professionalNameHint
    const named = namedNow.length ? namedNow : hint ? matches(hint, professionals) : []
    if (named.length > 1) { state.professionalNameHint = null; state.pending = 'professional'; return finish(`¿Con quién querés atenderte? ${named.map(p => p.name).join(', ')}.`) }
    if (!named.length && hint) {
      state.professionalNameHint = null; state.pending = 'professional'
      return finish(`No encuentro a ${hint} para ${service.name}. ¿Con qué profesional querés atenderte? ${professionals.map(p => p.name).join(', ')}. También podés elegir cualquier profesional.`)
    }
    if (named.length === 1) {
      state.professionalNameHint = null
      if (state.professional?.kind !== 'specific' || state.professional.id !== named[0]!.id) {
        state.professional = { kind: 'specific', id: named[0]!.id }; state.slot = null
        const selected = await port.availability(service, state.date, named[0]!.id)
        slots = selected.slots.filter(s => s.date === state.date && s.professionalId === named[0]!.id && Date.parse(s.startAt) > context.dbNow.getTime())
      }
    }
  }
  if (state.professional?.kind === 'specific') {
    if (!professionals.some(p => p.id === (state.professional as { id: string }).id)) { state.professional = null; state.slot = null }
    else slots = slots.filter(s => s.professionalId === (state.professional as { id: string }).id)
  }
  if (!slots.length) { state.date = null; clearSlot(state); state.pending = 'date'; return finish('No hay horarios disponibles para esa fecha y preferencia. ¿Qué otro día querés consultar?') }
  if (!state.professional) { state.pending = 'professional'; return finish(`${prefix}¿Con qué profesional? ${professionals.map(p => p.name).join(', ')}. También podés elegir cualquier profesional.`) }
  if (state.slot && !slots.some(s => s.startAt === state.slot!.startAt && s.professionalId === state.slot!.professionalId)) state.slot = null
  if (state.requestedTime && !state.slot) {
    const selected = slots.filter(s => s.time === state.requestedTime)
    if (selected.length === 1 || selected.length > 1 && state.professional.kind === 'any') state.slot = selected[0]!
    else if (selected.length > 1) return finish(`Ese horario tiene varias opciones: ${selected.map(s => `${s.time} con ${s.professionalName}`).join(', ')}. Indicá el profesional.`)
  }
  if (!state.slot) { state.pending = 'time'; return finish(`${prefix}Estos son todos los horarios disponibles:\n${slots.map(s => `${s.time} con ${s.professionalName}`).join('\n')}\n¿Cuál elegís?`) }
  if (!state.customerName) { state.pending = 'name'; return finish(`${prefix}¿A nombre de quién sería el turno?`) }
  state.pending = 'proposal'
  const proposal: BookingProposal = { kind: 'BOOKING_PROPOSAL', businessId: context.businessId, serviceId: service.id, professionalId: state.slot.professionalId, startAt: state.slot.startAt, customerName: state.customerName }
  return finish(`${prefix}Propuesta: ${service.name}, ${state.date.split('-').reverse().join('/')} a las ${state.slot.time} con ${state.slot.professionalName}, a nombre de ${state.customerName}. Todavía no está reservado.`, proposal)
}

/** Route current-message reads before booking extraction; reads never publish a proposal. */
export async function respond(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const route = routeActions(message)
  if (route.pendingAction && ACTION_REGISTRY[route.pendingAction].status === 'pending') return { state, proposal: null, reply: 'Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.' }
  if (!route.information.length) return respondBooking(context, state, message, port, decision)
  let facts: BusinessFacts | null = null
  const needsFacts = route.information.some(action => !['SERVICES', 'PRICES'].includes(action))
  if (needsFacts && port.information) {
    try { facts = await port.information(route.information) }
    catch { return { state, proposal: null, reply: 'No pude consultar esa información ahora. ' + pendingQuestion(state) } }
    validateFacts(facts, context.businessId)
  }
  const services = route.information.some(action => action === 'SERVICES' || action === 'PRICES') ? await port.catalog() : []
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200) || s.price !== null && (!Number.isFinite(s.price) || s.price < 0))) throw new Error('invalid information catalog')
  const answer = renderInformation(route.information, route.informationMessage, facts, services)
  if (route.bookingMessage) {
    const next = await respondBooking(context, state, route.bookingMessage, services.length ? { ...port, catalog: async () => services } : port, decision)
    return { ...next, proposal: JSON.stringify(next.state) === JSON.stringify(state) ? null : next.proposal, reply: answer + '\n' + next.reply }
  }
  return { state, reply: answer + '\n' + pendingQuestion(state), proposal: null }
}
