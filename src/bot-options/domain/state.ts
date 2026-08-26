/**
 * F3.2 — Regiones de estado e invariantes del motor determinístico por opciones.
 *
 * Fuente canónica: docs/nuevo-bot/maquina-de-estados.md (secciones 2, 7 y 9).
 * El estado persistido es JSONB en BotSession.state con stateSchemaVersion.
 * Las regiones NUNCA se comprimen en un único `status`: reserva, seña y handoff
 * evolucionan por caminos distintos y así debe poder leerse el estado.
 *
 * Este módulo es puro: no importa Prisma, Fastify, Meta ni relojes. Los
 * timestamps de borrador (draftTouchedAt/draftExpiresAt) viven como columnas de
 * BotSession, no acá: este JSON sólo describe, no cronometra.
 */

export const BOT_OPTIONS_STATE_SCHEMA_VERSION = 1
export const BOT_OPTIONS_ENGINE_VERSION = 'v1'

/** Estados funcionales del flujo conversacional (maquina-de-estados.md §2.1). */
export const BOT_OPTIONS_FLOW_STEPS = [
  'MAIN_MENU',
  'DRAFT_RESUME',
  'NAME_INPUT',
  'NAME_CONFIRM',
  'CATEGORY_SELECT',
  'SERVICE_SELECT',
  'SERVICE_DETAIL',
  'BUSINESS_HOURS',
  'PROFESSIONAL_HOURS_SELECT',
  'PROFESSIONAL_HOURS_DETAIL',
  'APPOINTMENT_LIST',
  'APPOINTMENT_DETAIL',
  'APPOINTMENT_CANCEL_CONFIRM',
  'APPOINTMENT_RESCHEDULE_DATE',
  'APPOINTMENT_RESCHEDULE_SLOT',
  'APPOINTMENT_RESCHEDULE_SUMMARY',
  'RECOMMENDATION_SELECT',
  'CART_REVIEW',
  'INCOMPATIBLE_SERVICE_DECISION',
  'PROFESSIONAL_SELECT',
  'DATE_SELECT',
  'SLOT_SELECT',
  'BOOKING_SUMMARY',
  'DISCARD_CONFIRM',
  'DEPOSIT_INSTRUCTIONS',
  'DEPOSIT_CANCEL_CONFIRM',
  'DEPOSIT_REVIEW',
  'BOOKING_CONFIRMED',
  'HANDOFF_QUEUED',
  'HANDOFF_TAKEN'
] as const

export type BotOptionsFlowStep = (typeof BOT_OPTIONS_FLOW_STEPS)[number]

const FLOW_STEP_SET: ReadonlySet<string> = new Set(BOT_OPTIONS_FLOW_STEPS)

/** Región de reserva. `NONE` = sin visita asociada a esta sesión. */
export type BookingRegionStatus =
  | 'NONE'
  | 'DRAFT'
  | 'HELD'
  | 'PENDING_PAYMENT_REVIEW'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'

/**
 * Región de seña. El motor nuevo jamás produce el valor legacy ambiguo
 * `REJECTED`; esos estados pertenecen sólo al sistema anterior.
 */
export type DepositRegionStatus =
  | 'NONE'
  | 'PENDING_PROOF'
  | 'PROOF_RECEIVED'
  | 'REJECTED_RESUBMISSION_ALLOWED'
  | 'APPROVED'
  | 'REJECTED_FINAL'
  | 'EXPIRED'

/** Región de atención humana. */
export type HandoffRegionStatus = 'NONE' | 'QUEUED' | 'TAKEN'

export const BOT_OPTIONS_BOOKING_STATUSES: readonly BookingRegionStatus[] = [
  'NONE', 'DRAFT', 'HELD', 'PENDING_PAYMENT_REVIEW', 'CONFIRMED', 'CANCELLED', 'EXPIRED'
]
export const BOT_OPTIONS_DEPOSIT_STATUSES: readonly DepositRegionStatus[] = [
  'NONE', 'PENDING_PROOF', 'PROOF_RECEIVED', 'REJECTED_RESUBMISSION_ALLOWED', 'APPROVED', 'REJECTED_FINAL', 'EXPIRED'
]
export const BOT_OPTIONS_HANDOFF_STATUSES: readonly HandoffRegionStatus[] = ['NONE', 'QUEUED', 'TAKEN']

const BOOKING_STATUS_SET: ReadonlySet<string> = new Set(BOT_OPTIONS_BOOKING_STATUSES)
const DEPOSIT_STATUS_SET: ReadonlySet<string> = new Set(BOT_OPTIONS_DEPOSIT_STATUSES)
const HANDOFF_STATUS_SET: ReadonlySet<string> = new Set(BOT_OPTIONS_HANDOFF_STATUSES)

/**
 * Modos de presentación. Paginación, franjas horarias y menú de navegación son
 * VISTA del estado funcional vigente: nunca cambian el paso funcional ni el
 * destino de navigation.back.
 */
export type BotOptionsPresentationMode =
  | { kind: 'plain' }
  /** parentServiceId identifica una subcategoría explícita; null/ausente = raíz. */
  | { kind: 'catalog_page'; cursor: number; parentServiceId?: string | null }
  | { kind: 'slot_band'; band: SlotBandView }
  | { kind: 'slot_all_pages'; cursor: number }
  | { kind: 'navigation_menu' }
  | { kind: 'appointment_list_page'; cursor: number }
  | { kind: 'professional_list_page'; cursor: number }

export type SlotBandView = 'MORNING' | 'AFTERNOON' | 'EVENING'

export type BotOptionsCartItem = {
  serviceId: string
}

export type BotOptionsSelections = {
  /** Categoría de navegación vigente (puede convivir con carrito). */
  categoryId: string | null
  /** Profesional elegido específicamente; `null` cuando se eligió "cualquiera". */
  professionalId: string | null
  anyProfessional: boolean
  /** Fecha seleccionada YYYY-MM-DD (zona del negocio). */
  date: string | null
  /** Inicio de bloque ISO 8601 con offset, sobre la grilla de 30 minutos. */
  slotStartAt: string | null
  /** Turno estable seleccionado durante cancelación o reprogramación. */
  appointmentId: string | null
}

export type BotOptionsState = {
  schemaVersion: typeof BOT_OPTIONS_STATE_SCHEMA_VERSION
  flow: BotOptionsFlowStep
  booking: BookingRegionStatus
  deposit: DepositRegionStatus
  handoff: HandoffRegionStatus
  cart: BotOptionsCartItem[]
  selections: BotOptionsSelections
  /** Entradas inválidas consecutivas dentro del MISMO estado funcional: 0..3. */
  invalidStreak: number
  presentation: BotOptionsPresentationMode
  /**
   * Pantalla funcional que abrió DISCARD_CONFIRM. Sólo tiene valor mientras el
   * flujo está en ese paso; Volver desde la confirmación regresa acá sin tocar
   * nada más.
   */
  discardReturnFlow: BotOptionsFlowStep | null
  /** Flujo pausado al solicitar atención humana; lo consume resolve_resume. */
  handoffReturnFlow: BotOptionsFlowStep | null
  /** 'BOOKING' selecciona para reservar; 'BROWSING' sólo informa (servicios y precios). */
  catalogMode: 'BOOKING' | 'BROWSING'
  /** Candidato de nombre esperando confirmación; nunca es dato persistido del cliente. */
  nameCandidate: string | null
  /** Entidad pendiente: servicio propuesto (incompatible o previa al nombre) o profesional seleccionado en horas. */
  pendingEntityRef: { type: 'SERVICE'; id: string } | { type: 'PROFESSIONAL'; id: string } | null
  /** Recomendaciones rechazadas en este borrador: no se vuelven a ofrecer. */
  rejectedRecommendationIds: string[]
}

export function createInitialBotOptionsState(): BotOptionsState {
  return {
    schemaVersion: BOT_OPTIONS_STATE_SCHEMA_VERSION,
    flow: 'MAIN_MENU',
    booking: 'NONE',
    deposit: 'NONE',
    handoff: 'NONE',
    cart: [],
    selections: {
      categoryId: null,
      professionalId: null,
      anyProfessional: false,
      date: null,
      slotStartAt: null,
      appointmentId: null
    },
    invalidStreak: 0,
    presentation: { kind: 'plain' },
    discardReturnFlow: null,
    handoffReturnFlow: null,
    catalogMode: 'BOOKING',
    nameCandidate: null,
    pendingEntityRef: null,
    rejectedRecommendationIds: []
  }
}

export type StateInvariantId =
  | 'schema_version_known'
  | 'region_status_known'
  | 'invalid_streak_range'
  | 'cart_unique_services'
  | 'booking_requires_complete_selection'
  | 'deposit_requires_active_booking'
  | 'approved_deposit_implies_confirmed_booking'
  | 'proof_review_implies_proof_received'
  | 'awaiting_proof_implies_hold_states'
  | 'rejected_final_or_expired_not_confirmed'
  | 'deposit_instructions_flow_matches_deposit_region'
  | 'deposit_review_flow_matches_deposit_region'
  | 'confirmed_flow_matches_booking_region'
  | 'handoff_taken_blocks_functional_flows'
  | 'handoff_flow_consistency'
  | 'professional_exclusive_selection'
  | 'presentation_kind_allowed'

const BOOKING_ACTIVE_FOR_DEPOSIT: ReadonlySet<BookingRegionStatus> = new Set([
  'HELD',
  'PENDING_PAYMENT_REVIEW'
] as const)

/** Señas que exigen una reserva activa retenida mientras existen. */
const DEPOSIT_REQUIRES_ACTIVE_BOOKING: ReadonlySet<DepositRegionStatus> = new Set([
  'PENDING_PROOF',
  'PROOF_RECEIVED',
  'REJECTED_RESUBMISSION_ALLOWED'
] as const)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasShape<T extends object>(value: unknown, guard: (item: Record<string, unknown>) => boolean): value is T {
  return isPlainObject(value) && guard(value)
}

/** Reconstruye el estado desde JSONB persistido; versión desconocida NUNCA se interpreta parcialmente. */
export function parseBotOptionsState(
  raw: unknown
): { ok: true; state: BotOptionsState } | { ok: false; invariant: StateInvariantId } {
  if (
    !hasShape<Record<string, unknown>>(raw, (item) => item.schemaVersion === BOT_OPTIONS_STATE_SCHEMA_VERSION)
  ) {
    return { ok: false, invariant: 'schema_version_known' }
  }
  const candidate = raw as unknown
  const result = validateBotOptionsState(candidate)
  if (!result.ok) return result
  return { ok: true, state: candidate as BotOptionsState }
}

/**
 * Verifica TODAS las invariantes locales del estado (maquina-de-estados.md §9).
 * Las invariantes contextuales —profesional común al carrito, bloque disponible,
 * vigencia de entidades— se validan bajo lock en la transición, acá no.
 */
export function validateBotOptionsState(
  candidate: unknown
): { ok: true } | { ok: false; invariant: StateInvariantId } {
  if (!isPlainObject(candidate)) return { ok: false, invariant: 'schema_version_known' }
  if (candidate['schemaVersion'] !== BOT_OPTIONS_STATE_SCHEMA_VERSION) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const streak = candidate['invalidStreak']
  if (typeof streak !== 'number' || !Number.isInteger(streak) || streak < 0 || streak > 3) {
    return { ok: false, invariant: 'invalid_streak_range' }
  }

  const flow = candidate['flow'] as BotOptionsFlowStep | undefined
  if (typeof flow !== 'string' || !FLOW_STEP_SET.has(flow)) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const discardReturnFlow = candidate['discardReturnFlow']
  if (
    discardReturnFlow !== null &&
    (typeof discardReturnFlow !== 'string' || !FLOW_STEP_SET.has(discardReturnFlow))
  ) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const handoffReturnFlow = candidate['handoffReturnFlow']
  if (
    handoffReturnFlow !== null &&
    (typeof handoffReturnFlow !== 'string' || !FLOW_STEP_SET.has(handoffReturnFlow))
  ) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const catalogMode = candidate['catalogMode']
  if (catalogMode !== 'BOOKING' && catalogMode !== 'BROWSING') {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const nameCandidate = candidate['nameCandidate']
  if (nameCandidate !== null && typeof nameCandidate !== 'string') {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const rejectedRecommendationIds = candidate['rejectedRecommendationIds']
  if (
    (!Array.isArray(rejectedRecommendationIds) ||
      rejectedRecommendationIds.some((id) => typeof id !== 'string'))
  ) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const pendingEntityRef = candidate['pendingEntityRef']
  if (
    pendingEntityRef !== null &&
    (!isPlainObject(pendingEntityRef) ||
      (pendingEntityRef['type'] !== 'SERVICE' && pendingEntityRef['type'] !== 'PROFESSIONAL') ||
      typeof pendingEntityRef['id'] !== 'string' ||
      pendingEntityRef['id'].trim().length === 0)
  ) {
    return { ok: false, invariant: 'schema_version_known' }
  }

  const cart = candidate['cart']
  if (!Array.isArray(cart)) return { ok: false, invariant: 'cart_unique_services' }
  const serviceIds = new Set<string>()
  for (const item of cart) {
    if (
      !isPlainObject(item) ||
      typeof item['serviceId'] !== 'string' ||
      item['serviceId'].length === 0
    ) {
      return { ok: false, invariant: 'cart_unique_services' }
    }
    if (serviceIds.has(item['serviceId'] as string)) {
      return { ok: false, invariant: 'cart_unique_services' }
    }
    serviceIds.add(item['serviceId'] as string)
  }

  const rawBooking = candidate['booking']
  const rawDeposit = candidate['deposit']
  const rawHandoff = candidate['handoff']
  if (
    typeof rawBooking !== 'string' || !BOOKING_STATUS_SET.has(rawBooking) ||
    typeof rawDeposit !== 'string' || !DEPOSIT_STATUS_SET.has(rawDeposit) ||
    typeof rawHandoff !== 'string' || !HANDOFF_STATUS_SET.has(rawHandoff)
  ) {
    return { ok: false, invariant: 'region_status_known' }
  }
  const booking = rawBooking as BookingRegionStatus
  const deposit = rawDeposit as DepositRegionStatus
  const handoff = rawHandoff as HandoffRegionStatus

  const selections = candidate['selections']
  if (!isPlainObject(selections)) {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  const professionalId = selections['professionalId']
  const anyProfessional = selections['anyProfessional']
  const categoryId = selections['categoryId']
  const date = selections['date']
  const slotStartAt = selections['slotStartAt']
  const appointmentId = selections['appointmentId']
  if (categoryId !== null && typeof categoryId !== 'string') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  if (professionalId !== null && typeof professionalId !== 'string') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  if (typeof anyProfessional !== 'boolean') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  if (date !== null && typeof date !== 'string') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  if (slotStartAt !== null && typeof slotStartAt !== 'string') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  if (appointmentId !== null && typeof appointmentId !== 'string') {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }
  const completeSelection =
    cart.length > 0 &&
    (typeof professionalId === 'string' || anyProfessional === true) &&
    typeof date === 'string' &&
    typeof slotStartAt === 'string'

  if ((booking === 'HELD' || booking === 'PENDING_PAYMENT_REVIEW' || booking === 'CONFIRMED') && !completeSelection) {
    return { ok: false, invariant: 'booking_requires_complete_selection' }
  }

  if (
    DEPOSIT_REQUIRES_ACTIVE_BOOKING.has(deposit) &&
    !BOOKING_ACTIVE_FOR_DEPOSIT.has(booking)
  ) {
    return { ok: false, invariant: 'deposit_requires_active_booking' }
  }
  if (deposit === 'APPROVED' && booking !== 'CONFIRMED') {
    return { ok: false, invariant: 'approved_deposit_implies_confirmed_booking' }
  }
  if (deposit === 'PROOF_RECEIVED' && booking !== 'PENDING_PAYMENT_REVIEW') {
    return { ok: false, invariant: 'proof_review_implies_proof_received' }
  }
  if ((deposit === 'REJECTED_FINAL' || deposit === 'EXPIRED') && (booking === 'CONFIRMED' || booking === 'HELD')) {
    return { ok: false, invariant: 'rejected_final_or_expired_not_confirmed' }
  }

  if (flow === 'DEPOSIT_INSTRUCTIONS' && !(DEPOSIT_REQUIRES_ACTIVE_BOOKING.has(deposit) && deposit !== 'PROOF_RECEIVED')) {
    return { ok: false, invariant: 'deposit_instructions_flow_matches_deposit_region' }
  }
  if (flow === 'DEPOSIT_REVIEW' && deposit !== 'PROOF_RECEIVED') {
    return { ok: false, invariant: 'deposit_review_flow_matches_deposit_region' }
  }
  if (flow === 'BOOKING_CONFIRMED' && booking !== 'CONFIRMED') {
    return { ok: false, invariant: 'confirmed_flow_matches_booking_region' }
  }

  if (handoff === 'TAKEN') {
    const functionalBlocked = [
      'CATEGORY_SELECT',
      'SERVICE_SELECT',
      'SERVICE_DETAIL',
      'CART_REVIEW',
      'BOOKING_SUMMARY',
      'DEPOSIT_INSTRUCTIONS',
      'DATE_SELECT',
      'SLOT_SELECT'
    ] as const
    if ((functionalBlocked as readonly string[]).includes(flow)) {
      return { ok: false, invariant: 'handoff_taken_blocks_functional_flows' }
    }
  }

  if (
    (flow === 'HANDOFF_QUEUED' && handoff !== 'QUEUED') ||
    (flow === 'HANDOFF_TAKEN' && handoff !== 'TAKEN') ||
    (handoff === 'QUEUED' && flow !== 'HANDOFF_QUEUED') ||
    (handoff === 'TAKEN' && flow !== 'HANDOFF_TAKEN')
  ) {
    return { ok: false, invariant: 'handoff_flow_consistency' }
  }

  if (typeof professionalId === 'string' && anyProfessional === true) {
    return { ok: false, invariant: 'professional_exclusive_selection' }
  }

  const presentation = candidate['presentation']
  if (!isPlainObject(presentation)) {
    return { ok: false, invariant: 'presentation_kind_allowed' }
  }
  const kind = presentation['kind']
  const allowedKinds = ['plain', 'catalog_page', 'slot_band', 'slot_all_pages', 'navigation_menu', 'appointment_list_page', 'professional_list_page']
  if (typeof kind !== 'string' || !(allowedKinds as readonly string[]).includes(kind)) {
    return { ok: false, invariant: 'presentation_kind_allowed' }
  }
  if ((kind === 'catalog_page' || kind === 'slot_all_pages' || kind === 'appointment_list_page' || kind === 'professional_list_page')) {
    const cursor = presentation['cursor']
    if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
      return { ok: false, invariant: 'presentation_kind_allowed' }
    }
  }
  if (kind === 'catalog_page') {
    const parentServiceId = presentation['parentServiceId']
    if (parentServiceId !== undefined && parentServiceId !== null &&
        (typeof parentServiceId !== 'string' || parentServiceId.trim().length === 0 || parentServiceId.trim() !== parentServiceId)) {
      return { ok: false, invariant: 'presentation_kind_allowed' }
    }
  }
  if (kind === 'slot_band') {
    const band = presentation['band']
    if (band !== 'MORNING' && band !== 'AFTERNOON' && band !== 'EVENING') {
      return { ok: false, invariant: 'presentation_kind_allowed' }
    }
  }

  return { ok: true }
}

export type InvalidInputEscalation = 'none' | 'highlight_human' | 'auto_handoff'

export type InvalidStreakResult = {
  state: BotOptionsState
  escalation: InvalidInputEscalation
}

/**
 * Registra una entrada no admitida consecutiva dentro del mismo estado.
 * 1º: reexplicar; 2º: destacar atención humana; 3º: derivar automático.
 * Una acción válida o cambio válido de estado reinicia el contador a cero.
 */
export function registerInvalidInput(state: BotOptionsState): InvalidStreakResult {
  const nextStreak = Math.min(3, state.invalidStreak + 1)
  const nextState: BotOptionsState = { ...state, invalidStreak: nextStreak }
  if (nextStreak >= 3) return { state: nextState, escalation: 'auto_handoff' }
  if (nextStreak === 2) return { state: nextState, escalation: 'highlight_human' }
  return { state: nextState, escalation: 'none' }
}

export function resetInvalidStreak(state: BotOptionsState): BotOptionsState {
  return state.invalidStreak === 0 ? state : { ...state, invalidStreak: 0 }
}
