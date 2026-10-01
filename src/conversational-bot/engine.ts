import { ACTION_REGISTRY, routeActions, type InformationAction } from './actions.js'
import { pendingQuestion, renderInformation, renderServices, validateFacts, type BusinessFacts } from './information.js'
import { localDateKey, localDateTimeToInstants, parseMinutes, type AvailabilityProfessional, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'
import { resolveDialogueDate } from './dialogue-date.js'
import { parseTurnPlan, type TurnPlan } from './turn-plan.js'

export type DialogueService = { id: string; name: string; durationMinutes: number | null; requiresConsultation: boolean; price: number | null; priceMode?: 'FIXED' | 'STARTING_AT' }
export type DialogueContext = { businessId: string; timezone: string; dbNow: Date }
export type DialoguePort = {
  information?(actions?: readonly InformationAction[]): Promise<BusinessFacts>
  catalog(): Promise<DialogueService[]>
  availability(service: DialogueService, date: string, professionalId?: string): Promise<{ professionals: AvailabilityProfessional[]; slots: AvailabilitySlot[] }>
}
export type PresentedOffer = { businessId: string; serviceId: string; date: string; professionalId: string | null }
export type InformationTarget = { kind: 'business'; actions: readonly InformationAction[] } | { kind: 'presented_offer'; actions: readonly [] }
export type DialogueState = {
  schemaVersion: 1; engine: 'conversational-booking-v1'; businessId: string
  pending: 'service' | 'date' | 'professional' | 'time' | 'name' | 'proposal'
  serviceId: string | null; date: string | null
  professional: null | { kind: 'any' } | { kind: 'specific'; id: string }
  /** Unverified name until uniquely matched against the selected service's compatible professionals. */
  professionalNameHint: string | null
  requestedTime: string | null; slot: AvailabilitySlot | null; customerName: string | null
  /** Evidence of the offer actually presented, not a cache of live availability or chat history. */
  dialogueContext?: { lastQuestion: string | null; presentedOffer: PresentedOffer | null }
}
export type BookingProposal = { kind: 'BOOKING_PROPOSAL'; businessId: string; serviceId: string; professionalId: string; startAt: string; customerName: string }
export type DialogueResponse = { state: DialogueState; reply: string; proposal: BookingProposal | null }
/** Validated QA decision: IDs are rechecked against the current catalog; text still supplies dates and preferences. */
export type DialogueDecision = { serviceId: string | null; candidateIds: readonly string[]; correction: boolean; intent?: 'booking' | 'information' | 'other'; professionalMention?: string | null; informationTarget?: InformationTarget | null; turnPlan?: TurnPlan }
export function hasActiveBooking(state: DialogueState): boolean {
  return Boolean(state.serviceId || state.date || state.professional || state.professionalNameHint || state.requestedTime || state.slot || state.customerName || state.dialogueContext?.lastQuestion || state.pending !== 'service')
}
/** Resume context without presenting an old availability result as freshly checked. */
export function socialQuestion(state: DialogueState): string {
  return state.pending === 'time' ? '¿Querés que consultemos los horarios para tu turno?' : pendingQuestion(state)
}
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
  if (s.professionalNameHint !== undefined && s.professionalNameHint !== null && (!bounded(s.professionalNameHint, 100) || !/^[a-z0-9:/-]+(?: [a-z0-9:/-]+)*$/.test(s.professionalNameHint))) throw new Error('invalid professional hint')
  if (s.slot !== null && (!s.serviceId || !s.date || !s.professional || s.slot.date !== s.date || !bounded(s.slot.professionalId, 128) || !bounded(s.slot.professionalName, 200) || !Number.isFinite(Date.parse(s.slot.startAt)) || parseMinutes(s.slot.time) === null || (s.professional.kind === 'specific' && s.professional.id !== s.slot.professionalId))) throw new Error('invalid slot')
  if ((!s.serviceId && (s.date && s.slot || s.professional?.kind === 'specific' || s.slot)) || (!s.date && s.slot) || (s.pending === 'proposal' && (!s.slot || !s.customerName))) throw new Error('invalid dialogue invariants')
  if (s.dialogueContext !== undefined) {
    const dc = s.dialogueContext
    if (!dc || typeof dc !== 'object' || Array.isArray(dc) || Object.keys(dc).sort().join(',') !== 'lastQuestion,presentedOffer' ||
      dc.lastQuestion !== null && (!bounded(dc.lastQuestion, 240) || !dc.lastQuestion.startsWith('¿') || !dc.lastQuestion.endsWith('?'))) throw new Error('invalid dialogue context')
    const offer = dc.presentedOffer
    if (offer !== null && (!offer || typeof offer !== 'object' || Array.isArray(offer) ||
      Object.keys(offer).sort().join(',') !== 'businessId,date,professionalId,serviceId' ||
      offer.businessId !== businessId || offer.serviceId !== s.serviceId || !validCalendarDate(offer.date) || offer.date !== s.date ||
      !s.professional || (s.professional.kind === 'specific' ? offer.professionalId !== s.professional.id : offer.professionalId !== null))) throw new Error('invalid presented offer')
  }
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
  const result = resolveDialogueDate(text, localDateKey(context.dbNow, context.timezone))
  return result.kind === 'resolved' && localDateTimeToInstants(result.date, 720, context.timezone).length ? result.date : null
}
function containsInvalidDateExpression(text: string, context: DialogueContext): boolean {
  if (!/\b(?:hoy|manana|pasado\s+manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?)\b/.test(text)) return false
  const result = resolveDialogueDate(text, localDateKey(context.dbNow, context.timezone))
  return result.kind === 'invalid' || result.kind === 'ambiguous'
}
function extractTime(text: string): string | null {
  const match = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (match) return `${match[1]!.padStart(2, '0')}:${match[2]}`
  const compact = /^(?:el de las |a las )?([01]?\d|2[0-3])([0-5]\d)$/.exec(text)
  if (compact) return `${compact[1]!.padStart(2, '0')}:${compact[2]}`
  return null
}
function clearSlot(state: DialogueState) { state.slot = null; state.requestedTime = null; delete state.dialogueContext }
function dateLabel(date: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const instant = new Date(Date.UTC(year, month - 1, day, 12))
  const weekday = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'long' }).format(instant)
  return weekday + ' ' + String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0')
}
const serviceList = renderServices
async function respondBooking(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision, preparedCatalog?: DialogueService[]): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  // A prepared turn has already applied every semantic operation: never reparse its information text.
  const text = preparedCatalog ? '' : normalize(message)
  const finish = (reply: string, proposal: BookingProposal | null = null) => {
    const lastLine = reply.trim().split('\n').at(-1) ?? ''
    const expected = pendingQuestion(state)
    const question = expected.startsWith('¿') && reply.includes(expected) ? expected :
      lastLine.startsWith('¿') && lastLine.endsWith('?') && lastLine.length <= 240 ? lastLine : null
    if (state.serviceId || state.dialogueContext || decision?.intent === 'booking') state.dialogueContext = { lastQuestion: question, presentedOffer: state.dialogueContext?.presentedOffer ?? null }
    return { state, reply, proposal }
  }
  if (/^(reset|volver a empezar|empezar de nuevo|no quiero nada|nada gracias)$/.test(text)) return { state: initialDialogueState(context.businessId), reply: 'De acuerdo. Cuando quieras, podemos buscar otro turno.', proposal: null }
  if (/^(gracias|muchas gracias|chau|hasta luego)$/.test(text)) return finish('Gracias a vos. Estoy disponible si necesitás algo más.')
  const services = preparedCatalog ?? await port.catalog()
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  let service = services.find(s => s.id === state.serviceId)
  if (state.serviceId && !service) { state.serviceId = null; state.professional = null; clearSlot(state); state.pending = 'service' }
  let anyProfessional = false
  let rejectsProfessional = false
  let name: RegExpExecArray | null = null
  let prefix = ''
  if (!preparedCatalog) {
    if (/\bcambiar (?:la )?(?:hora|horario)\b/.test(text)) clearSlot(state)
    if (/\bcambiar (?:el )?servicio\b/.test(text)) { state.serviceId = null; service = undefined; state.professional = null; clearSlot(state) }
    const decisionProfessional = decision?.professionalMention ? normalize(decision.professionalMention) : null
    anyProfessional = /\b(cualquiera|cualquier profesional|sin preferencia|me da igual)\b/.test(text)
    rejectsProfessional = /\bnunca te dije\b/.test(text)
    if (rejectsProfessional) { state.professional = null; state.professionalNameHint = null; clearSlot(state); state.pending = 'professional' }
    if (anyProfessional) state.professionalNameHint = null
    else if (!rejectsProfessional) {
      const earlyName = decisionProfessional ?? extractProfessionalHint(text)
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
      if (earlyDate && earlyDate !== state.date) { state.date = earlyDate; clearSlot(state) }
      state.pending = 'service'
      return finish(`¿Cuál de estos servicios querés?\n${serviceList(found)}`)
    }
    if (found.length === 1 && found[0]!.id !== state.serviceId) { service = found[0]!; state.serviceId = service.id; state.professional = null; clearSlot(state) }
    const date = extractDate(text, context)
    if (containsInvalidDateExpression(text, context) && !date) {
      state.date = null; clearSlot(state); state.pending = 'date'
      return finish('Esa fecha no es válida. ¿Qué día querés consultar?')
    }
    if (date && date !== state.date) { state.date = date; clearSlot(state) }
    if (/^(otro dia|probamos otro dia)$/.test(text)) { state.date = null; clearSlot(state) }
    const time = extractTime(text)
    if (time) { state.requestedTime = time; state.slot = null }
    name = /\b(?:soy|me llamo|mi nombre es)\s+([\p{L}][\p{L} '\-]{1,98}?)(?=\s+(?:quiero|turno|hoy|mañana|manana|con)\b|$)/iu.exec(message)
    if (name && !/\b(?:quiero|turno|hoy|mañana|manana|con)\b/i.test(name[1]!)) state.customerName = name[1]!.trim()
    else if ((previous as DialogueState).pending === 'name' && /^[\p{L}][\p{L} '\-]{1,98}$/u.test(message.trim()) &&
      !/\b(hola|buenas|quiero|servicios|servicio|horarios|horario|gracias|no|si|ok|okey|dale|perfecto|confirmar|confirmo|cancelar|cambiar|reset|volver|turno|cualquiera|cualquier|profesional|preferencia|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|precio|direccion|soy|nombre|llamo)\b/.test(text) &&
      !matches(text, services).length) state.customerName = message.trim()
    prefix = catalogQuestion ? `${serviceList(services)}\n` : /^(hola|buenas|como estas|sos linda|salimos)/.test(text) ? 'Hola. Te ayudo con tu turno.\n' : ''
  }
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
  if (anyProfessional) { if (state.professional?.kind !== 'any') delete state.dialogueContext; state.professional = { kind: 'any' }; state.professionalNameHint = null; state.slot = null }
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
        delete state.dialogueContext; state.slot = null; state.professional = { kind: 'specific', id: named[0]!.id }
        const selected = await port.availability(service, state.date, named[0]!.id)
        slots = selected.slots.filter(s => s.date === state.date && s.professionalId === named[0]!.id && Date.parse(s.startAt) > context.dbNow.getTime())
      }
    }
  }
  if (state.professional?.kind === 'specific') {
    if (!professionals.some(p => p.id === (state.professional as { id: string }).id)) { state.professional = null; clearSlot(state) }
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
  if (!state.slot) {
    state.pending = 'time'
    state.dialogueContext = { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: context.businessId, serviceId: service.id, date: state.date,
      professionalId: state.professional.kind === 'specific' ? state.professional.id : null } }
    return finish(`${prefix}Horarios disponibles para ${dateLabel(state.date, context.timezone)}:\n${slots.map(s => `${s.time} con ${s.professionalName}`).join('\n')}\n¿Cuál elegís?`) }
  if (!state.customerName) { state.pending = 'name'; return finish(`${prefix}¿A nombre de quién sería el turno?`) }
  state.pending = 'proposal'
  const proposal: BookingProposal = { kind: 'BOOKING_PROPOSAL', businessId: context.businessId, serviceId: service.id, professionalId: state.slot.professionalId, startAt: state.slot.startAt, customerName: state.customerName }
  return finish(`${prefix}Propuesta: ${service.name}, ${state.date.split('-').reverse().join('/')} a las ${state.slot.time} con ${state.slot.professionalName}, a nombre de ${state.customerName}. Todavía no está reservado.`, proposal)
}

/** Apply independent semantic updates in dependency order, then reuse the existing booking progression. */
async function respondTurnPlan(context: DialogueContext, state: DialogueState, message: string, port: DialoguePort, rawPlan: unknown): Promise<DialogueResponse> {
  const plan = parseTurnPlan(rawPlan, message)
  // Referential reads describe what was actually shown before this turn, not its replacement.
  const originalOffer = state.dialogueContext?.presentedOffer ? structuredClone(state.dialogueContext.presentedOffer) : null
  const updates = plan.operations.filter(op => !['information', 'unsupported_action'].includes(op.kind))
  const needsCatalog = updates.length > 0 || plan.operations.some(op => op.kind === 'information' && op.target.kind === 'business' && op.target.actions.some(action => action === 'SERVICES' || action === 'PRICES'))
  const services = needsCatalog ? await port.catalog() : []
  if (services.length > 200 || services.some(s => !bounded(s.id, 128) || !bounded(s.name, 200) || s.price !== null && (!Number.isFinite(s.price) || s.price < 0)) || new Set(services.map(s => s.id)).size !== services.length) throw new Error('invalid dialogue catalog')
  parseTurnPlan(plan, message, services.map(service => service.id))
  const invalidate = (clearTime: boolean) => { state.slot = null; if (clearTime) state.requestedTime = null; delete state.dialogueContext }
  const serviceOp = plan.operations.find(op => op.kind === 'service')
  if (serviceOp?.kind === 'service' && serviceOp.mode !== 'multiple' && (serviceOp.mode !== 'unresolved' || serviceOp.correction)) {
    const selected = serviceOp.mode === 'single' ? serviceOp.serviceIds[0]! : null
    if (selected !== state.serviceId || serviceOp.correction || serviceOp.mode === 'alternatives') {
      const replacing = Boolean(state.serviceId) || serviceOp.correction || selected === null
      invalidate(replacing)
      state.serviceId = selected
      if (replacing || state.professional?.kind !== 'any') state.professional = null
    }
  }
  const dateOp = plan.operations.find(op => op.kind === 'date')
  let uncertainDate = false
  if (dateOp?.kind === 'date') {
    const today = localDateKey(context.dbNow, context.timezone)
    const resolution = resolveDialogueDate(dateOp.expression, today)
    const resolved = resolution.kind === 'resolved' && (!dateOp.value || dateOp.value === resolution.date) ? resolution.date
      : resolution.kind === 'unsupported' ? dateOp.value ?? null : null
    const date = resolved && resolved >= today && localDateTimeToInstants(resolved, 720, context.timezone).length ? resolved : null
    uncertainDate = !date
    if (date !== state.date || !date) { invalidate(Boolean(state.date) || !date); state.date = date }
  }
  const professionalOp = plan.operations.find(op => op.kind === 'professional')
  if (professionalOp?.kind === 'professional') {
    const mention = professionalOp.mode === 'specific' ? normalize(professionalOp.mention) || null : null
    // The current slot binds its name to the verified professional ID; aliases remain untrusted hints.
    const sameSpecific = professionalOp.mode === 'specific' && mention && state.professional?.kind === 'specific' &&
      state.slot?.professionalId === state.professional.id && normalize(state.slot.professionalName) === mention
    const sameAny = professionalOp.mode === 'any' && state.professional?.kind === 'any'
    if (!sameSpecific && !sameAny) invalidate(Boolean(state.professional))
    if (!sameSpecific) state.professional = professionalOp.mode === 'any' ? { kind: 'any' } : null
    state.professionalNameHint = mention
  }
  const timeOp = plan.operations.find(op => op.kind === 'time')
  if (timeOp?.kind === 'time') { state.requestedTime = timeOp.value; state.slot = null }
  const nameOp = plan.operations.find(op => op.kind === 'name')
  if (nameOp?.kind === 'name') state.customerName = nameOp.value.trim()

  if (updates.length) state.pending = !state.serviceId ? 'service' : !state.date ? 'date' : !state.professional ? 'professional' : !state.slot ? 'time' : !state.customerName ? 'name' : 'proposal'

  // Facts are read after applying fields, so an unavailable information read cannot roll back valid preferences.
  const answers: string[] = []
  for (const op of plan.operations) {
    if (op.kind === 'unsupported_action') answers.push('Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.')
    if (op.kind !== 'information') continue
    if (op.target.kind === 'presented_offer') {
      const offer = originalOffer
      answers.push(offer ? 'Los horarios que te mostré corresponden a ' + dateLabel(offer.date, context.timezone) + '.'
        : 'No tengo una oferta de horarios mostrada para identificar.')
      continue
    }
    let facts: BusinessFacts | null = null
    const needsFacts = op.target.actions.some(action => action !== 'SERVICES' && action !== 'PRICES')
    if (needsFacts && port.information) {
      try { facts = await port.information(op.target.actions); validateFacts(facts, context.businessId) }
      catch { answers.push('No pude consultar esa información ahora.'); continue }
    }
    answers.push(renderInformation(op.target.actions, op.evidence, facts, services))
  }
  const finishWithoutAgenda = (reply: string): DialogueResponse => ({ state, reply: [...answers, reply].filter(Boolean).join('\n'), proposal: null })
  if (!updates.length) return finishWithoutAgenda(hasActiveBooking(state) ? pendingQuestion(state) : answers.length ? '' : '¿En qué te puedo ayudar con el local?')
  // A basket is intentionally not implemented here; never silently pick one service or publish a partial proposal.
  if (serviceOp?.kind === 'service' && serviceOp.mode === 'multiple') {
    state.pending = !state.serviceId ? 'service' : !state.date ? 'date' : !state.professional ? 'professional' : !state.slot ? 'time' : !state.customerName ? 'name' : 'proposal'
    return finishWithoutAgenda('La reserva de varios servicios todavía no está disponible en este motor. Necesitás solicitarla al equipo.\n' + pendingQuestion(state))
  }
  if (serviceOp?.kind === 'service' && serviceOp.mode === 'unresolved') {
    state.pending = 'service'
    return finishWithoutAgenda('No pude identificar ese servicio. ¿Qué servicio necesitás?\n' + serviceList(services))
  }
  if (serviceOp?.kind === 'service' && serviceOp.mode === 'alternatives') {
    state.pending = 'service'
    return finishWithoutAgenda('¿Cuál de estos servicios querés?\n' + serviceList(services.filter(service => serviceOp.serviceIds.includes(service.id))))
  }
  if (uncertainDate) {
    state.pending = state.serviceId ? 'date' : 'service'
    return finishWithoutAgenda('No pude determinar una fecha válida y única. ¿Qué día querés consultar?' + (!state.serviceId ? '\n' + pendingQuestion(state) : ''))
  }
  const next = await respondBooking(context, state, message, port, undefined, services)
  return { ...next, reply: [...answers, next.reply].filter(Boolean).join('\n') }
}

/** Route current-message reads before booking extraction; reads never publish a proposal. */
export async function respond(context: DialogueContext, previous: unknown, message: string, port: DialoguePort, decision?: DialogueDecision): Promise<DialogueResponse> {
  if (!bounded(message.trim(), 2000) || !Number.isFinite(context.dbNow.getTime())) throw new Error('invalid dialogue input')
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  if (decision && Object.hasOwn(decision, 'turnPlan')) return respondTurnPlan(context, state, message, port, decision.turnPlan)
  const delivered = (reply: string): DialogueResponse => {
    const question = pendingQuestion(state)
    if (state.dialogueContext) state.dialogueContext.lastQuestion = question.startsWith('¿') && question.endsWith('?') && reply.endsWith(question) ? question : null
    return { state, proposal: null, reply }
  }
  const lexicalRoute = routeActions(message)
  const target = decision?.informationTarget
  if (!target && state.dialogueContext?.presentedOffer && lexicalRoute.information.includes('HOURS')) {
    return { state, proposal: null, reply: '¿Consultás por el horario de atención del local o por los horarios que te mostré para tu turno?' }
  }
  if (target?.kind === 'presented_offer') {
    const offer = state.dialogueContext?.presentedOffer
    return delivered(offer
      ? 'Los horarios que te mostré corresponden a ' + dateLabel(offer.date, context.timezone) + '.\n' + pendingQuestion(state)
      : 'No tengo una oferta de horarios mostrada para identificar. ¿Querés que consultemos los horarios para tu turno?')
  }
  const route = target?.kind === 'business'
    ? { ...lexicalRoute, information: [...target.actions], informationMessage: message, bookingMessage: null }
    : lexicalRoute
  if (route.pendingAction && ACTION_REGISTRY[route.pendingAction].status === 'pending') return { state, proposal: null, reply: 'Esa operación todavía no está disponible en este motor. Necesitás solicitarla al equipo.' }
  if (!route.information.length && decision?.intent === 'other' && !decision.serviceId && !decision.candidateIds.length && !decision.professionalMention &&
      !/^(reset|volver a empezar|empezar de nuevo|no quiero nada|nada gracias)$/.test(normalize(message))) return { state, proposal: null,
    reply: state.pending === 'service' && !state.serviceId ? '¿En qué te puedo ayudar con el local?' : socialQuestion(state) }
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
    const bookingFields = ({ dialogueContext: _context, ...fields }: DialogueState) => fields
    return { ...next, proposal: JSON.stringify(bookingFields(next.state)) === JSON.stringify(bookingFields(state)) ? null : next.proposal, reply: answer + '\n' + next.reply }
  }
  return delivered(answer + (hasActiveBooking(state) ? '\n' + pendingQuestion(state) : ''))
}
