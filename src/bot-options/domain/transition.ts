/**
 * F3.4/F3.6 — Función de transición pura del motor determinístico por opciones.
 *
 * Contrato (diseno-tecnico.md §7): estado + acción normalizada + contexto
 * pre-cargado tenant-scoped → nuevo estado + efectos declarativos + vista.
 *
 * Este módulo NO importa Prisma, Fastify, Meta ni relojes: el tiempo entra por
 * contexto y las consultas (catálogo, disponibilidad, tenancy) llegan ya
 * resueltas en el contexto. Una guarda que falla produce una recuperación
 * explícita SIN mutar el estado funcional (salvo el contador de inválidos).
 */

import {
  BOT_OPTIONS_ACTION_REQUIREMENTS,
  isCrmAction,
  isSystemEventAction,
  type BotOptionsActionPayload,
  type BotOptionsActionType,
  type BotOptionsEntityRef,
  type SlotBand,
  type SystemEventActionType
} from './actions.js'
import {
  registerInvalidInput,
  resetInvalidStreak,
  validateBotOptionsState,
  type BotOptionsFlowStep,
  type BotOptionsPresentationMode,
  type BotOptionsState
} from './state.js'
import type { BotOptionsEffect } from './effects.js'
import {
  BACK_CHOICE,
  HUMAN_CHOICE,
  HOME_CHOICE,
  NAVIGATION_MENU_CLOSE_CHOICE,
  NAVIGATION_MENU_CHOICE,
  composeGlobalNavigation,
  menuView,
  recoveryView,
  textView,
  type BotOptionsViewModel,
  type GlobalNavigationPlan,
  type ViewChoice
} from './views.js'

export type NormalizedAction = {
  actionType: BotOptionsActionType
  entityRef: BotOptionsEntityRef | null
  payload: BotOptionsActionPayload | null
}

export type TransitionContext = {
  dbNowIso: string
  /** Nombre válido ya persistido para este teléfono/negocio. */
  customerNameOnFile: string | null
  draftExists: boolean
  draftHasProgress: boolean
  categoryActive: boolean
  categoryHasServices: boolean
  serviceActive: boolean
  serviceBookable: boolean
  /** Revalidado contra DB en el contexto: true cuando la política del servicio exige consulta humana. */
  requiresConsultation: boolean
  serviceCompatibleWithCart: boolean
  serviceInCart: boolean
  hasRecommendations: boolean
  recommendedServiceAvailable: boolean
  recommendedCompatibleWithCart: boolean
  professionalCommonExists: boolean
  professionalSelectable: boolean
  /** F5.7: true si el profesional consultado está activo (revalidado contra DB). */
  professionalActive: boolean
  /** F5.7: true si el profesional acepta reservas por este medio. */
  professionalBookable: boolean
  dateAvailable: boolean
  slotAvailable: boolean
  bandHasAvailability: boolean
  catalogCanNext: boolean
  catalogCanPrevious: boolean
  /** F5.7: true si hay más profesionales después de la página actual. */
  professionalCatalogCanNext: boolean
  /** F5.7: true si hay profesionales antes de la página actual. */
  professionalCatalogCanPrevious: boolean
  dateCanNext: boolean
  dateCanPrevious: boolean
  slotCanNext: boolean
  appointmentsExist: boolean
  appointmentsCanNext: boolean
  appointmentOwnedAndFuture: boolean
  cancellationAllowed: boolean
  rescheduleAllowed: boolean
  rescheduleDateAvailable: boolean
  rescheduleSlotAvailable: boolean
  approvedDepositTransferable: boolean
  slotStillAvailableAtConfirm: boolean
  depositRequired: boolean
  paymentConfigComplete: boolean
  labels: {
    categoryName?: string | undefined
    serviceName?: string | undefined
    professionalName?: string | undefined
    appointmentSummary?: string | undefined
    /** F5.6: Texto informativo del horario semanal del negocio (lunes–domingo + excepciones). */
    businessWeeklyHoursText?: string | undefined
    /** F5.7: Texto informativo del horario semanal del profesional (lunes–domingo + excepciones). */
    professionalWeeklyHoursText?: string | undefined
    /** F5.7: Lista de profesionales activos formateada como texto para el listado. */
    professionalListText?: string | undefined
    /** F5.7: Lista de profesionales activos para generar opciones interactivas. */
    professionalCatalog?: ReadonlyArray<{ professionalId: string; label: string }> | undefined
  }
  confirmVisitSnapshot: {
    services: Array<{
      serviceId: string
      name: string
      durationMinutes: number
      priceMinor: number | null
      priceMode: 'FIXED' | 'STARTING_AT' | null
    }>
    professional: { professionalId: string; name: string; assignedByBalancer: boolean }
    totalDurationMinutes: number
    totalPriceMinor: number | null
  } | null
  depositRequest: { amountMinor: number; holdExpiresAtIso: string } | null
}

const FALSE_DEFAULTS: readonly (
  keyof TransitionContext)[] = [
  'draftExists',
  'draftHasProgress',
  'categoryActive',
  'categoryHasServices',
  'serviceActive',
  'serviceBookable',
  'requiresConsultation',
  'serviceCompatibleWithCart',
  'serviceInCart',
  'hasRecommendations',
  'recommendedServiceAvailable',
  'recommendedCompatibleWithCart',
  'professionalCommonExists',
  'professionalSelectable',
  'professionalActive',
  'professionalBookable',
  'dateAvailable',
  'slotAvailable',
  'bandHasAvailability',
  'catalogCanNext',
  'catalogCanPrevious',
  'professionalCatalogCanNext',
  'professionalCatalogCanPrevious',
  'dateCanNext',
  'dateCanPrevious',
  'slotCanNext',
  'appointmentsExist',
  'appointmentsCanNext',
  'appointmentOwnedAndFuture',
  'cancellationAllowed',
  'rescheduleAllowed',
  'rescheduleDateAvailable',
  'rescheduleSlotAvailable',
  'approvedDepositTransferable',
  'slotStillAvailableAtConfirm',
  'depositRequired',
  'paymentConfigComplete'
]

export function normalizeContext(input: Partial<TransitionContext> & Pick<TransitionContext, 'dbNowIso'>): TransitionContext {
  const merged = { ...input } as Record<string, unknown>
  for (const key of FALSE_DEFAULTS) {
    if (typeof merged[key] !== 'boolean') merged[key] = false
  }
  if (typeof merged['customerNameOnFile'] !== 'string') merged['customerNameOnFile'] = null
  const labels = merged['labels']
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) merged['labels'] = {}
  return merged as unknown as TransitionContext
}

export type TransitionOutcome = 'APPLIED' | 'RECOVERED' | 'HANDOFF'

export type RecoveryReason =
  | 'invalid_option_for_state'
  | 'unsupported_content'
  | 'entity_inactive'
  | 'guard_failed'
  | 'navigation_not_available'
  | 'internal_invariant'
  | 'handoff_taken_silent'
  | 'nothing_to_discard'
  | 'stale_ref'

export type TransitionApplied = {
  outcome: 'APPLIED' | 'HANDOFF'
  state: BotOptionsState
  effects: BotOptionsEffect[]
  view: BotOptionsViewModel
}

export type TransitionRecovered = {
  outcome: 'RECOVERED'
  reason: RecoveryReason
  /** false sólo cuando el bot debe callar (atención tomada). */
  respond: boolean
  state: BotOptionsState
  view: BotOptionsViewModel
}

export type TransitionResult = TransitionApplied | TransitionRecovered

// ─── Acciones admitidas por paso funcional ────────────────────────────────────

const CLIENT_ALLOWED: Partial<Record<BotOptionsFlowStep, readonly BotOptionsActionType[]>> = {
  MAIN_MENU: [
    'menu.start_booking',
    'menu.browse_services',
    'menu.business_hours',
    'menu.manage_appointment',
    'navigation.open'
  ],
  DRAFT_RESUME: ['draft.continue', 'draft.restart', 'navigation.home'],
  NAME_INPUT: ['name.edit', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  NAME_CONFIRM: ['name.confirm', 'name.edit', 'navigation.back', 'navigation.home', 'navigation.open'],
  CATEGORY_SELECT: [
    'category.select',
    'catalog.next_page',
    'catalog.previous_page',
    'cart.add_service',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  SERVICE_SELECT: [
    'service.view',
    'service.select',
    'catalog.next_page',
    'catalog.previous_page',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  SERVICE_DETAIL: [
    'service.book',
    'service.consult',
    'service.more_same_category',
    'service.change_category',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  RECOMMENDATION_SELECT: [
    'recommendation.add',
    'recommendation.skip',
    'recommendation.consult',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  CART_REVIEW: [
    'cart.add_service',
    'cart.remove_service',
    'cart.continue',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  INCOMPATIBLE_SERVICE_DECISION: [
    'recommendation.add',
    'cart.continue',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  PROFESSIONAL_SELECT: ['professional.any', 'professional.select', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  DATE_SELECT: [
    'date.next_page',
    'date.previous_page',
    'date.select',
    'professional.any',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  SLOT_SELECT: [
    'slot.band',
    'slot.show_all',
    'slot.next_page',
    'slot.select',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  BOOKING_SUMMARY: ['booking.confirm', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  DISCARD_CONFIRM: ['draft.restart', 'navigation.back', 'navigation.close', 'handoff.request'],
  DEPOSIT_INSTRUCTIONS: ['deposit.cancel_confirm', 'navigation.home', 'navigation.open', 'handoff.request'],
  DEPOSIT_CANCEL_CONFIRM: ['deposit.continue_payment', 'deposit.cancel_confirm', 'navigation.close', 'handoff.request'],
  DEPOSIT_REVIEW: ['navigation.home', 'handoff.request'],
  BOOKING_CONFIRMED: ['menu.start_booking', 'navigation.home'],
  BUSINESS_HOURS: ['hours.professional', 'hours.search_availability', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  PROFESSIONAL_HOURS_SELECT: ['hours.professional_select', 'hours.next_page', 'hours.previous_page', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  PROFESSIONAL_HOURS_DETAIL: [
    'hours.choose_other_professional',
    'hours.professional_search_availability',
    'hours.professional_consult_human',
    'navigation.back',
    'navigation.home',
    'navigation.open'
  ],
  APPOINTMENT_LIST: ['appointment.select', 'appointment.next_page', 'navigation.back', 'navigation.home', 'navigation.open', 'handoff.request'],
  APPOINTMENT_DETAIL: [
    'appointment.cancel',
    'appointment.reschedule',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  APPOINTMENT_CANCEL_CONFIRM: ['appointment.cancel_confirm', 'navigation.back', 'navigation.close', 'handoff.request'],
  APPOINTMENT_RESCHEDULE_DATE: [
    'appointment.date_select',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  APPOINTMENT_RESCHEDULE_SLOT: [
    'appointment.slot_select',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  APPOINTMENT_RESCHEDULE_SUMMARY: [
    'appointment.reschedule_confirm',
    'navigation.back',
    'navigation.home',
    'navigation.open',
    'handoff.request'
  ],
  HANDOFF_QUEUED: ['handoff.wait', 'handoff.cancel'],
  HANDOFF_TAKEN: []
}

const GLOBAL_CLIENT_ACTIONS: ReadonlySet<BotOptionsActionType> = new Set([
  'navigation.open',
  'navigation.close',
  'handoff.request'
])

/** Destinos explícitos de Volver (maquina-de-estados.md §6) e invalidaciones §7. */
type BackTarget = {
  flow: BotOptionsFlowStep
  apply: (state: BotOptionsState) => BotOptionsState
}

function withoutSelections(state: BotOptionsState, level: 'professional' | 'date' | 'slot'): BotOptionsState {
  const selections = { ...state.selections }
  if (level === 'professional') {
    selections.professionalId = null
    selections.anyProfessional = false
  }
  if (level === 'professional' || level === 'date') selections.date = null
  selections.slotStartAt = null
  return { ...state, selections }
}

const BACK_TARGETS: Partial<Record<BotOptionsFlowStep, BackTarget>> = {
  NAME_INPUT: { flow: 'MAIN_MENU', apply: (state) => ({ ...state, nameCandidate: null }) },
  NAME_CONFIRM: { flow: 'NAME_INPUT', apply: (state) => ({ ...state, nameCandidate: null }) },
  CATEGORY_SELECT: {
    flow: 'CATEGORY_SELECT',
    apply: () => {
      throw new Error('static_target')
    }
  },
  SERVICE_SELECT: {
    flow: 'CATEGORY_SELECT',
    apply: (state) => ({ ...state, selections: { ...state.selections, categoryId: null } })
  },
  SERVICE_DETAIL: { flow: 'SERVICE_SELECT', apply: (state) => state },
  RECOMMENDATION_SELECT: { flow: 'CART_REVIEW', apply: (state) => state },
  CART_REVIEW: { flow: 'SERVICE_SELECT', apply: (state) => state },
  INCOMPATIBLE_SERVICE_DECISION: { flow: 'CART_REVIEW', apply: (state) => ({ ...state, pendingEntityRef: null }) },
  PROFESSIONAL_SELECT: { flow: 'CART_REVIEW', apply: (state) => withoutSelections(state, 'professional') },
  DATE_SELECT: { flow: 'PROFESSIONAL_SELECT', apply: (state) => withoutSelections(state, 'professional') },
  SLOT_SELECT: { flow: 'DATE_SELECT', apply: (state) => withoutSelections(state, 'date') },
  BOOKING_SUMMARY: { flow: 'SLOT_SELECT', apply: (state) => withoutSelections(state, 'slot') },
  APPOINTMENT_LIST: { flow: 'MAIN_MENU', apply: (state) => ({ ...state, presentation: { kind: 'plain' } }) },
  APPOINTMENT_DETAIL: {
    flow: 'APPOINTMENT_LIST',
    apply: (state) => ({
      ...state,
      selections: { ...state.selections, appointmentId: null, date: null, slotStartAt: null },
      presentation: { kind: 'plain' }
    })
  },
  APPOINTMENT_CANCEL_CONFIRM: { flow: 'APPOINTMENT_DETAIL', apply: (state) => ({ ...state, presentation: { kind: 'plain' } }) },
  APPOINTMENT_RESCHEDULE_DATE: {
    flow: 'APPOINTMENT_DETAIL',
    apply: (state) => ({
      ...state,
      selections: { ...state.selections, date: null, slotStartAt: null },
      presentation: { kind: 'plain' }
    })
  },
  APPOINTMENT_RESCHEDULE_SLOT: {
    flow: 'APPOINTMENT_RESCHEDULE_DATE',
    apply: (state) => ({
      ...state,
      selections: { ...state.selections, date: null, slotStartAt: null },
      presentation: { kind: 'plain' }
    })
  },
  APPOINTMENT_RESCHEDULE_SUMMARY: {
    flow: 'APPOINTMENT_RESCHEDULE_SLOT',
    apply: (state) => ({
      ...state,
      selections: { ...state.selections, slotStartAt: null },
      presentation: { kind: 'plain' }
    })
  },
  PROFESSIONAL_HOURS_SELECT: { flow: 'BUSINESS_HOURS', apply: (state) => state },
  PROFESSIONAL_HOURS_DETAIL: {
    flow: 'PROFESSIONAL_HOURS_SELECT',
    apply: (state) => ({ ...state, pendingEntityRef: null })
  },
  BUSINESS_HOURS: { flow: 'MAIN_MENU', apply: (state) => state }
}

/** Estados donde Volver genérico no existe; cada uno tiene su salida específica. */
const BACK_BLOCKED: ReadonlySet<BotOptionsFlowStep> = new Set([
  'DEPOSIT_INSTRUCTIONS',
  'DEPOSIT_CANCEL_CONFIRM',
  'DEPOSIT_REVIEW',
  'HANDOFF_QUEUED',
  'HANDOFF_TAKEN'
] as const)

const WAITING_PROOF_DEPOSITS = (deposit: BotOptionsState['deposit']): boolean =>
  deposit === 'PENDING_PROOF' || deposit === 'REJECTED_RESUBMISSION_ALLOWED'

function hasBookingProgress(state: BotOptionsState): boolean {
  return state.cart.length > 0 || state.selections.date !== null || state.booking !== 'NONE'
}

function baseOf(state: BotOptionsState, patch: Partial<BotOptionsState>): BotOptionsState {
  return { ...state, ...patch } as BotOptionsState
}

function plainPresentation(): BotOptionsPresentationMode {
  return { kind: 'plain' }
}

// ─── Vista estándar por estado (rebuild tras close/back/stale) ────────────────

export function renderCurrentView(state: BotOptionsState, context: TransitionContext): BotOptionsViewModel {
  const globalWithBack = (capacity: number, contextualCount: number) => ({ capacity, contextualCount, back: BACK_CHOICE })
  switch (state.flow) {
    case 'MAIN_MENU':
      return menuView('¿Qué querés hacer?', [
        { actionType: 'menu.start_booking', label: 'Sacar un turno' },
        { actionType: 'menu.browse_services', label: 'Ver servicios y precios' },
        { actionType: 'menu.business_hours', label: 'Consultar horarios' },
        { actionType: 'menu.manage_appointment', label: 'Gestionar un turno' },
        HUMAN_CHOICE
      ])
    case 'DRAFT_RESUME':
      return menuView('Tenemos una reserva sin terminar. ¿Continuamos?', [
        { actionType: 'draft.continue', label: 'Continuar reserva' },
        { actionType: 'draft.restart', label: 'Empezar de nuevo' },
        HUMAN_CHOICE
      ])
    case 'NAME_INPUT':
      return recoveryView('¿Cómo es tu nombre?', [])
    case 'NAME_CONFIRM':
      return menuView(
        `¿Tu nombre es ${state.nameCandidate ?? context.customerNameOnFile ?? ''}?`,
        [
          { actionType: 'name.confirm', label: 'Sí, es correcto' },
          { actionType: 'name.edit', label: 'Corregir nombre' },
          HUMAN_CHOICE
        ]
      )
    case 'CATEGORY_SELECT': {
      const nav = composeGlobalNavigation({ capacity: 10, contextualCount: 2, back: BACK_CHOICE })
      return appendGlobals(
        menuView(context.labels.categoryName ? `Servicios de ${context.labels.categoryName}` : 'Elegí un servicio', []),
        nav
      )
    }
    case 'SERVICE_SELECT': {
      const nav = composeGlobalNavigation({ capacity: 10, contextualCount: 2, back: BACK_CHOICE })
      return appendGlobals(menuView('Elegí una opción', []), nav)
    }
    case 'SERVICE_DETAIL': {
      const detailServiceId = state.pendingEntityRef?.id
      const detailChoices: ViewChoice[] = []
      if (context.serviceActive && detailServiceId) {
        if (context.requiresConsultation) {
          detailChoices.push({ actionType: 'service.consult', label: 'Consultar con el equipo', entityRef: { type: 'SERVICE', id: detailServiceId } })
        } else {
          detailChoices.push({ actionType: 'service.book', label: 'Reservar este servicio', entityRef: { type: 'SERVICE', id: detailServiceId } })
        }
        detailChoices.push({ actionType: 'service.more_same_category', label: 'Ver otros servicios' })
      }
      const navDetail = composeGlobalNavigation({ capacity: 10, contextualCount: detailChoices.length, back: BACK_CHOICE })
      return appendGlobals(
        menuView(`Detalle de ${context.labels.serviceName ?? 'servicio'}`, detailChoices),
        navDetail
      )
    }
    case 'RECOMMENDATION_SELECT':
      return menuView('¿Querés complementarlo?', [
        { actionType: 'recommendation.add', label: 'Agregar' },
        { actionType: 'recommendation.skip', label: 'Continuar sin agregar' }
      ])
    case 'CART_REVIEW':
      return menuView('Tu reserva', [
        { actionType: 'cart.add_service', label: 'Agregar otro servicio' },
        { actionType: 'cart.remove_service', label: 'Quitar un servicio' },
        { actionType: 'cart.continue', label: 'Continuar con la reserva' }
      ])
    case 'INCOMPATIBLE_SERVICE_DECISION':
      return menuView(
        `${context.labels.serviceName ?? 'Este servicio'} requiere coordinar entre varios profesionales. ¿Qué hacemos?`,
        [
          { actionType: 'recommendation.add', label: 'Agregar y coordinar con el equipo' },
          { actionType: 'cart.continue', label: 'Continuar sin este servicio' }
        ]
      )
    case 'PROFESSIONAL_SELECT':
      return menuView('¿Con quién querés atenderte?', [
        { actionType: 'professional.any', label: 'Cualquier profesional disponible' }
      ])
    case 'DATE_SELECT':
      return menuView('Elegí la fecha', [{ actionType: 'date.next_page', label: 'Ver más fechas' }])
    case 'SLOT_SELECT':
      return menuView('Elegí el horario', [
        { actionType: 'slot.band', label: 'Mañana', payload: { band: 'MORNING' } },
        { actionType: 'slot.band', label: 'Tarde', payload: { band: 'AFTERNOON' } },
        { actionType: 'slot.band', label: 'Noche', payload: { band: 'EVENING' } },
        { actionType: 'slot.show_all', label: 'Ver todos los horarios' }
      ])
    case 'BOOKING_SUMMARY':
      return menuView('Confirmá tu reserva', [{ actionType: 'booking.confirm', label: 'Confirmar turno' }])
    case 'DISCARD_CONFIRM':
      return menuView('¿Seguro que querés descartar la reserva en curso?', [
        { actionType: 'draft.restart', label: 'Descartar e ir al menú' },
        BACK_CHOICE
      ])
    case 'DEPOSIT_INSTRUCTIONS':
      return menuView('Te esperamos con el comprobante antes del vencimiento.', [
        HOME_CHOICE,
        HUMAN_CHOICE
      ])
    case 'DEPOSIT_CANCEL_CONFIRM':
      return menuView('¿Querés cancelar esta solicitud? El horario quedará disponible.', [
        { actionType: 'deposit.cancel_confirm', label: 'Sí, cancelar' },
        { actionType: 'deposit.continue_payment', label: 'No, continuar con el pago' }
      ])
    case 'DEPOSIT_REVIEW':
      return textView('Tu horario sigue reservado provisoriamente mientras revisamos el comprobante.')
    case 'BOOKING_CONFIRMED':
      return textView('Listo, tu turno quedó confirmado. Te esperamos.')
    case 'BUSINESS_HOURS': {
      const hoursView = menuView('¿Qué querés ver?', [
        { actionType: 'hours.professional', label: 'Horario de un profesional' },
        { actionType: 'hours.search_availability', label: 'Buscar un turno disponible' }
      ])
      // F5.6: El horario semanal informativo se envía como texto previo al interactivo.
      if (context.labels.businessWeeklyHoursText) {
        return { ...hoursView, informativeTexts: [context.labels.businessWeeklyHoursText] }
      }
      return hoursView
    }
    case 'PROFESSIONAL_HOURS_SELECT': {
      const PAGE_SIZE = 7
      const catalog = context.labels.professionalCatalog ?? []
      const cursor = state.presentation.kind === 'professional_list_page' ? state.presentation.cursor : 0
      const pageStart = cursor * PAGE_SIZE
      const pageEnd = pageStart + PAGE_SIZE
      const page = catalog.slice(pageStart, pageEnd)
      const profChoices: ViewChoice[] = page.map((prof) => ({
        actionType: 'hours.professional_select' as const,
        label: prof.label,
        entityRef: { type: 'PROFESSIONAL' as const, id: prof.professionalId }
      }))
      // Derive navigation directly from cursor + catalog length (never stale)
      const hasPrev = cursor > 0
      const hasNext = pageEnd < catalog.length
      if (hasPrev) {
        profChoices.unshift({ actionType: 'hours.previous_page' as const, label: '← Profesionales anteriores' })
      }
      if (hasNext) {
        profChoices.push({ actionType: 'hours.next_page' as const, label: 'Más profesionales →' })
      }
      const navigation = composeGlobalNavigation({ capacity: 10, contextualCount: profChoices.length, back: BACK_CHOICE })
      const profListView = appendGlobals(menuView('¿De quién querés ver el horario?', profChoices), navigation)
      if (context.labels.professionalListText) {
        return { ...profListView, informativeTexts: [context.labels.professionalListText] }
      }
      return profListView
    }
    case 'PROFESSIONAL_HOURS_DETAIL': {
      const profDetailChoices: ViewChoice[] = []
      const profRef = state.pendingEntityRef?.type === 'PROFESSIONAL' ? { type: 'PROFESSIONAL' as const, id: state.pendingEntityRef.id } : undefined
      if (profRef && context.professionalActive) {
        if (context.professionalBookable) {
          profDetailChoices.push({ actionType: 'hours.professional_search_availability', label: 'Buscar un turno disponible', entityRef: profRef })
        } else {
          profDetailChoices.push({ actionType: 'hours.professional_consult_human', label: 'Hablar con el equipo', entityRef: profRef })
        }
      }
      profDetailChoices.push({ actionType: 'hours.choose_other_professional', label: 'Ver otro profesional' })
      const profName = context.labels.professionalName ?? 'el profesional'
      const navigation = composeGlobalNavigation({ capacity: 10, contextualCount: profDetailChoices.length, back: BACK_CHOICE })
      const profDetailView = appendGlobals(menuView(`Jornada de ${profName}.`, profDetailChoices), navigation)
      if (context.labels.professionalWeeklyHoursText) {
        return { ...profDetailView, informativeTexts: [context.labels.professionalWeeklyHoursText] }
      }
      return profDetailView
    }
    case 'APPOINTMENT_LIST':
      return menuView('Estos son tus próximos turnos:', [])
    case 'APPOINTMENT_DETAIL':
      return menuView(context.labels.appointmentSummary ?? 'Detalle del turno', [
        { actionType: 'appointment.cancel', label: 'Cancelar turno' },
        { actionType: 'appointment.reschedule', label: 'Reprogramar turno' }
      ])
    case 'APPOINTMENT_CANCEL_CONFIRM':
      return menuView('¿Confirmás la cancelación? El horario quedará libre.', [
        { actionType: 'appointment.cancel_confirm', label: 'Sí, cancelar turno' },
        BACK_CHOICE
      ])
    case 'APPOINTMENT_RESCHEDULE_DATE':
      return menuView('Elegí la nueva fecha', [])
    case 'APPOINTMENT_RESCHEDULE_SLOT':
      return menuView('Elegí el nuevo horario', [])
    case 'APPOINTMENT_RESCHEDULE_SUMMARY':
      return menuView('Confirmás el cambio de horario?', [
        { actionType: 'appointment.reschedule_confirm', label: 'Confirmar cambio' }
      ])
    case 'HANDOFF_QUEUED':
      return menuView('Ya avisamos al equipo. Seguí tu lugar desde acá.', [
        { actionType: 'handoff.wait', label: 'Seguir esperando' },
        { actionType: 'handoff.cancel', label: 'Cancelar atención y volver' }
      ])
    case 'HANDOFF_TAKEN':
      return textView('')
  }
}

function appendGlobals(view: BotOptionsViewModel, plan: GlobalNavigationPlan): BotOptionsViewModel {
  return { ...view, choices: [...view.choices, ...plan.directChoices] }
}

// ─── Motor ────────────────────────────────────────────────────────────────────

function recovered(
  state: BotOptionsState,
  reason: RecoveryReason,
  body: string,
  choices: ViewChoice[] = [BACK_CHOICE]
): TransitionRecovered {
  return { outcome: 'RECOVERED', reason, respond: true, state, view: recoveryView(body, choices) }
}

function applied(
  state: BotOptionsState,
  view: BotOptionsViewModel,
  effects: BotOptionsEffect[] = []
): TransitionResult {
  // Toda acción válida o cambio válido de estado reinicia el contador de
  // inválidos (reglas-funcionales.md §11): se aplica sobre el estado final.
  const cleaned = resetInvalidStreak(state)
  const validated = validateBotOptionsState(cleaned)
  if (!validated.ok) {
    return {
      outcome: 'RECOVERED',
      reason: 'internal_invariant',
      respond: true,
      state,
      view: recoveryView('Algo salió mal de nuestro lado. No se cambió nada de tu reserva.', [
        HOME_CHOICE,
        HUMAN_CHOICE
      ])
    }
  }
  return { outcome: effectsRequireHandoff(effects) ? 'HANDOFF' : 'APPLIED', state: cleaned, effects, view }
}

function effectsRequireHandoff(effects: readonly BotOptionsEffect[]): boolean {
  return effects.some((effect) => effect.kind === 'REQUEST_HUMAN_HANDOFF')
}

function addToCart(state: BotOptionsState, serviceId: string): BotOptionsState {
  return { ...state, cart: [...state.cart.filter((item) => item.serviceId !== serviceId), { serviceId }] }
}

function enterHandoff(
  state: BotOptionsState,
  reason: string,
  detail: string | null,
  context: { serviceId: string } | { professionalId: string } | null = null
): TransitionResult {
  const nextState = baseOf(resetInvalidStreak(state), {
    flow: 'HANDOFF_QUEUED',
    handoff: 'QUEUED',
    handoffReturnFlow: state.flow === 'HANDOFF_QUEUED' ? state.handoffReturnFlow : state.flow,
    presentation: plainPresentation()
  })
  return applied(nextState, renderCurrentView(nextState, EMPTY_CONTEXT_FOR_VIEWS), [
    { kind: 'REQUEST_HUMAN_HANDOFF', reason, detail, context }
  ])
}

const EMPTY_CONTEXT_FOR_VIEWS: TransitionContext = normalizeContext({ dbNowIso: '1970-01-01T00:00:00Z' })

function escalateInvalid(state: BotOptionsState, message: string): TransitionResult {
  const escalation = registerInvalidInput(state)
  if (escalation.escalation === 'auto_handoff') {
    return enterHandoff(escalatingState(escalation.state), 'entradas_invalidas_repetidas', message)
  }
  const highlight =
    escalation.escalation === 'highlight_human'
      ? [HUMAN_CHOICE]
      : []
  return recovered(
    escalation.state,
    'invalid_option_for_state',
    message,
    [...highlight]
  )
}

function escalatingState(state: BotOptionsState): BotOptionsState {
  return state
}

/**
 * Punto de entrada único del core. La acción llega ya normalizada y validada en
 * forma (admisión); acá se decide si es legal para el estado vigente.
 */
export function transition(
  state: BotOptionsState,
  action: NormalizedAction,
  contextInput: Partial<TransitionContext> & Pick<TransitionContext, 'dbNowIso'>
): TransitionResult {
  const context = normalizeContext(contextInput)
  const { actionType, entityRef, payload } = action

  // Atención tomada: silencio para cliente/sistema, pero el CRM conserva las
  // acciones explícitas de resolución. Si se bloquearan acá, el handoff sería
  // un estado terminal imposible de cerrar.
  if (state.handoff === 'TAKEN' && !isCrmAction(actionType)) {
    return { outcome: 'RECOVERED', reason: 'handoff_taken_silent', respond: false, state, view: textView('') }
  }

  // ── Eventos de sistema ──────────────────────────────────────────────────
  if (isSystemEventAction(actionType)) {
    return handleSystemEvent(state, actionType, payload, context)
  }

  // ── Acciones CRM ────────────────────────────────────────────────────────
  if (isCrmAction(actionType)) {
    return handleCrmAction(state, actionType, payload, context)
  }

  // ── Elecciones del cliente ──────────────────────────────────────────────
  const allowed = CLIENT_ALLOWED[state.flow] ?? []
  if (!allowed.includes(actionType) && !GLOBAL_CLIENT_ACTIONS.has(actionType)) {
    return escalateInvalid(state, 'Ese paso continúa con las opciones de la pantalla. Elegí una de las disponibles.')
  }

  // Universales primero.
  const universal = tryUniversal(state, actionType, entityRef, context)
  if (universal) return universal

  switch (state.flow) {
    case 'MAIN_MENU':
      return fromMainMenu(state, actionType, context)
    case 'DRAFT_RESUME':
      return fromDraftResume(state, actionType)
    case 'NAME_CONFIRM':
      return fromNameConfirm(state, actionType, context)
    case 'CATEGORY_SELECT':
      return fromCategorySelect(state, actionType, entityRef, context)
    case 'SERVICE_SELECT':
      return fromServiceSelect(state, actionType, entityRef, context)
    case 'SERVICE_DETAIL':
      return fromServiceDetail(state, actionType, entityRef, context)
    case 'RECOMMENDATION_SELECT':
      return fromRecommendationSelect(state, actionType, entityRef, context)
    case 'CART_REVIEW':
      return fromCartReview(state, actionType, entityRef, context)
    case 'INCOMPATIBLE_SERVICE_DECISION':
      return fromIncompatibleDecision(state, actionType, entityRef, context)
    case 'PROFESSIONAL_SELECT':
      return fromProfessionalSelect(state, actionType, entityRef, context)
    case 'DATE_SELECT':
      return fromDateSelect(state, actionType, payload, context)
    case 'SLOT_SELECT':
      return fromSlotSelect(state, actionType, payload, context)
    case 'BOOKING_SUMMARY':
      return fromBookingSummary(state, actionType, context)
    case 'DISCARD_CONFIRM':
      if (actionType === 'draft.restart') {
        const cleared = clearDraft(state)
        return applied(cleared, renderCurrentView(cleared, context))
      }
      break
    case 'DEPOSIT_INSTRUCTIONS':
      if (actionType === 'deposit.cancel_confirm') {
        const next = baseOf(state, { flow: 'DEPOSIT_CANCEL_CONFIRM', presentation: plainPresentation() })
        return applied(next, renderCurrentView(next, context))
      }
      break
    case 'DEPOSIT_CANCEL_CONFIRM':
      return fromDepositCancelConfirm(state, actionType, context)
    case 'BUSINESS_HOURS':
      if (actionType === 'hours.professional') {
        if (!context.professionalSelectable) {
          return recovered(state, 'guard_failed', 'No hay profesionales disponibles para consultar ahora.', [])
        }
        return applied(baseOf(state, { flow: 'PROFESSIONAL_HOURS_SELECT' }), renderCurrentView({ ...state, flow: 'PROFESSIONAL_HOURS_SELECT' }, context))
      }
      if (actionType === 'hours.search_availability') return startBookingPath(state, context)
      break
    case 'PROFESSIONAL_HOURS_SELECT':
      if (actionType === 'hours.professional_select' && entityRef?.type === 'PROFESSIONAL') {
        if (!context.professionalActive) {
          return recovered(state, 'entity_inactive', 'Ese profesional ya no está disponible. Elegí otro, por favor.', [])
        }
        const next = baseOf(resetInvalidStreak(state), {
          flow: 'PROFESSIONAL_HOURS_DETAIL',
          pendingEntityRef: { type: 'PROFESSIONAL' as const, id: entityRef.id }
        })
        return applied(next, renderCurrentView({ ...next, flow: 'PROFESSIONAL_HOURS_DETAIL' }, context))
      }
      if (actionType === 'hours.next_page') {
        if (!context.professionalCatalogCanNext) return recovered(state, 'guard_failed', 'No hay más profesionales hacia adelante.', [])
        const cursor = state.presentation.kind === 'professional_list_page' ? state.presentation.cursor + 1 : 1
        const nextState = baseOf(state, { presentation: { kind: 'professional_list_page', cursor } })
        return applied(nextState, renderCurrentView(nextState, context))
      }
      if (actionType === 'hours.previous_page') {
        if (!context.professionalCatalogCanPrevious) return recovered(state, 'guard_failed', 'Estás en la primera página de profesionales.', [])
        const cursor = state.presentation.kind === 'professional_list_page' ? state.presentation.cursor - 1 : 0
        const nextState = baseOf(state, { presentation: { kind: 'professional_list_page', cursor: Math.max(0, cursor) } })
        return applied(nextState, renderCurrentView(nextState, context))
      }
      break
    case 'PROFESSIONAL_HOURS_DETAIL': {
      // Validate that the pending entityRef matches the rendered professional
      const pendingProfId = state.pendingEntityRef?.type === 'PROFESSIONAL' ? state.pendingEntityRef.id : null
      if (actionType === 'hours.choose_other_professional') {
        return applied(
          baseOf(state, { flow: 'PROFESSIONAL_HOURS_SELECT', pendingEntityRef: null }),
          renderCurrentView({ ...state, flow: 'PROFESSIONAL_HOURS_SELECT', pendingEntityRef: null }, context)
        )
      }
      if (actionType === 'hours.professional_consult_human') {
        // Required entity: entityRef must be present and match pendingProfId
        if (!pendingProfId) {
          return recovered(state, 'guard_failed', 'No pudimos identificar el profesional.', [])
        }
        if (!entityRef || entityRef.type !== 'PROFESSIONAL' || entityRef.id !== pendingProfId) {
          return recovered(state, 'stale_ref', 'Los datos del profesional cambiaron. Recargá la vista.', [])
        }
        if (!context.professionalActive) {
          return recovered(state, 'entity_inactive', 'Ese profesional ya no está disponible. Elegí otro, por favor.', [])
        }
        if (context.professionalBookable) {
          return recovered(state, 'guard_failed', 'Ese profesional sí acepta reservas. Usá "Buscar turno" en su lugar.', [])
        }
        return enterHandoff(state, 'profesional_no_reservable_por_bot', context.labels.professionalName ?? null, { professionalId: pendingProfId })
      }
      if (actionType === 'hours.professional_search_availability') {
        // Required entity: entityRef must be present and match pendingProfId
        if (!pendingProfId) {
          return recovered(state, 'guard_failed', 'No pudimos identificar el profesional.', [])
        }
        if (!entityRef || entityRef.type !== 'PROFESSIONAL' || entityRef.id !== pendingProfId) {
          return recovered(state, 'stale_ref', 'Los datos del profesional cambiaron. Recargá la vista.', [])
        }
        if (!context.professionalActive) {
          return recovered(state, 'entity_inactive', 'Ese profesional ya no está disponible. Elegí otro, por favor.', [])
        }
        if (!context.professionalBookable) {
          return recovered(state, 'guard_failed', 'Ese profesional no acepta reservas por este medio.', [HUMAN_CHOICE])
        }
        // Fijar la selección profesional antes de iniciar booking path; limpiar date/slot previos.
        const withSelection = baseOf(state, {
          selections: { ...state.selections, professionalId: pendingProfId, anyProfessional: false, date: null, slotStartAt: null }
        })
        return startBookingPath(withSelection, context)
      }
      // Reject old generic actions in this flow (they'd fail normalization anyway)
      if (actionType === 'hours.search_availability' || actionType === 'hours.consult_human') {
        return recovered(state, 'stale_ref', 'Acción desactualizada. Recargá la pantalla.', [])
      }
      break
    }
    case 'APPOINTMENT_LIST':
      if (actionType === 'appointment.select' && entityRef?.type === 'APPOINTMENT' && context.appointmentOwnedAndFuture) {
        const next = baseOf(state, {
          flow: 'APPOINTMENT_DETAIL',
          selections: { ...state.selections, appointmentId: entityRef.id, date: null, slotStartAt: null },
          presentation: plainPresentation()
        })
        return applied(next, renderCurrentView(next, context))
      }
      if (actionType === 'appointment.next_page' && context.appointmentsCanNext) {
        const cursor = state.presentation.kind === 'appointment_list_page' ? state.presentation.cursor + 1 : 1
        return applied(baseOf(state, { presentation: { kind: 'appointment_list_page', cursor } }), renderCurrentView(state, context))
      }
      break
    case 'APPOINTMENT_DETAIL':
      return fromAppointmentDetail(state, actionType, entityRef, context)
    case 'APPOINTMENT_CANCEL_CONFIRM':
      if (
        actionType === 'appointment.cancel_confirm' &&
        entityRef?.type === 'APPOINTMENT' &&
        entityRef.id === state.selections.appointmentId &&
        context.cancellationAllowed
      ) {
        const next = baseOf(state, {
          flow: 'APPOINTMENT_LIST',
          booking: 'CANCELLED',
          presentation: plainPresentation()
        })
        return applied(next, textView('Listo, cancelamos tu turno.'), [
          { kind: 'CANCEL_BOOKING', reason: 'cliente_cancelo_por_bot' }
        ])
      }
      break
    case 'APPOINTMENT_RESCHEDULE_DATE':
      if (
        actionType === 'appointment.date_select' &&
        entityRef?.type === 'APPOINTMENT' &&
        entityRef.id === state.selections.appointmentId &&
        payload?.date &&
        context.rescheduleDateAvailable
      ) {
        const next = baseOf(state, {
          flow: 'APPOINTMENT_RESCHEDULE_SLOT',
          selections: { ...state.selections, date: payload.date, slotStartAt: null }
        })
        return applied(next, renderCurrentView(next, context))
      }
      break
    case 'APPOINTMENT_RESCHEDULE_SLOT':
      if (
        actionType === 'appointment.slot_select' &&
        entityRef?.type === 'APPOINTMENT' &&
        entityRef.id === state.selections.appointmentId &&
        payload?.startAt &&
        context.rescheduleSlotAvailable
      ) {
        const next = baseOf(state, {
          flow: 'APPOINTMENT_RESCHEDULE_SUMMARY',
          selections: { ...state.selections, slotStartAt: payload.startAt }
        })
        return applied(next, renderCurrentView(next, context))
      }
      break
    case 'APPOINTMENT_RESCHEDULE_SUMMARY':
      if (
        actionType === 'appointment.reschedule_confirm' &&
        entityRef?.type === 'APPOINTMENT' &&
        entityRef.id === state.selections.appointmentId &&
        state.selections.slotStartAt !== null &&
        payload === null
      ) {
        if (!context.rescheduleSlotAvailable) {
          const back = baseOf(withoutSelections(state, 'slot'), { flow: 'APPOINTMENT_RESCHEDULE_SLOT' })
          return applied(back, recoveryView('Ese horario acaba de ocuparse. Elegí otro, por favor.', []))
        }
        const next = baseOf(state, { flow: 'APPOINTMENT_DETAIL', presentation: plainPresentation() })
        return applied(next, textView('Listo, reprogramamos tu turno.'), [
          {
            kind: 'SWAP_APPOINTMENT_SLOT',
            appointmentId: entityRef.id,
            newSlotStartAt: state.selections.slotStartAt,
            keepApprovedDeposit: context.approvedDepositTransferable
          }
        ])
      }
      break
    case 'HANDOFF_QUEUED':
      // wait/cancel ya están cubiertos por universales.
      break
    case 'BOOKING_CONFIRMED':
    case 'DEPOSIT_REVIEW':
    case 'NAME_INPUT':
    case 'DEPOSIT_CANCEL_CONFIRM':
      // Sus acciones ya fueron tratadas arriba o por universales.
      break
  }

  return escalateInvalid(state, 'No pude entender esa opción dentro de este paso. Usá las opciones de la pantalla.')
}

// ── Universales ───────────────────────────────────────────────────────────────

function tryUniversal(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  _entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult | null {
  switch (actionType) {
    case 'navigation.open': {
      const next = baseOf(state, { presentation: { kind: 'navigation_menu' } })
      const target = BACK_TARGETS[state.flow]
      const choices: ViewChoice[] = []
      if (target && !BACK_BLOCKED.has(state.flow)) choices.push(BACK_CHOICE)
      choices.push(HOME_CHOICE, HUMAN_CHOICE, NAVIGATION_MENU_CLOSE_CHOICE)
      return applied(next, menuView('Opciones de navegación', choices))
    }
    case 'navigation.close': {
      if (state.presentation.kind !== 'navigation_menu') {
        return recovered(state, 'navigation_not_available', 'No hay un menú de navegación abierto.', [])
      }
      const restored = baseOf(state, { presentation: restoreFromNavigation(state.presentation) })
      return applied(restored, renderCurrentView(restored, context))
    }
    case 'navigation.back': {
      if (state.flow === 'DISCARD_CONFIRM') {
        const target = state.discardReturnFlow ?? 'MAIN_MENU'
        return applied(baseOf(state, { flow: target, discardReturnFlow: null, presentation: plainPresentation() }), renderCurrentView({ ...state, flow: target }, context))
      }
      const target = BACK_TARGETS[state.flow]
      if (!target || BACK_BLOCKED.has(state.flow)) {
        return recovered(
          state,
          'navigation_not_available',
          'Desde acá no hay Volver directo; usá las opciones de la pantalla.',
          state.flow.startsWith('DEPOSIT') ? [HOME_CHOICE] : [NAVIGATION_MENU_CHOICE]
        )
      }
      if (target.flow === 'CATEGORY_SELECT' && state.flow === 'CATEGORY_SELECT') {
        // CATEGORY_SELECT vuelve al carrito si existe; si no, al menú.
        if (state.cart.length > 0) return applied(baseOf(state, { flow: 'CART_REVIEW', presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'CART_REVIEW' }, context))
        return applied(baseOf(state, { flow: 'MAIN_MENU', presentation: plainPresentation(), catalogMode: 'BOOKING' }), renderCurrentView({ ...state, flow: 'MAIN_MENU' }, context))
      }
      let next = target.apply(state)
      const presentation =
        state.flow === 'PROFESSIONAL_HOURS_DETAIL' && state.presentation.kind === 'professional_list_page'
          ? state.presentation
          : plainPresentation()
      next = baseOf(next, { flow: target.flow, presentation })
      return applied(next, renderCurrentView(next, context))
    }
    case 'navigation.home': {
      if (state.flow === 'DEPOSIT_INSTRUCTIONS' && WAITING_PROOF_DEPOSITS(state.deposit)) {
        return applied(baseOf(state, { flow: 'DEPOSIT_CANCEL_CONFIRM' }), renderCurrentView({ ...state, flow: 'DEPOSIT_CANCEL_CONFIRM' }, context))
      }
      if (state.flow === 'DEPOSIT_REVIEW') {
        const next = baseOf(state, { flow: 'MAIN_MENU', presentation: plainPresentation() })
        return applied(next, textView('Tu horario sigue reservado provisoriamente mientras revisamos el comprobante.'))
      }
      if (state.flow === 'HANDOFF_QUEUED') {
        return recovered(state, 'navigation_not_available', 'Tu consulta ya está en cola. Podés seguir esperando o cancelarla.', [])
      }
      if (hasBookingProgress(state)) {
        return applied(
          baseOf(state, { flow: 'DISCARD_CONFIRM', discardReturnFlow: state.flow }),
          renderCurrentView({ ...state, flow: 'DISCARD_CONFIRM' }, context)
        )
      }
      const cleared = baseOf(clearDraft(state), { flow: 'MAIN_MENU', presentation: plainPresentation() })
      return applied(cleared, renderCurrentView(cleared, context))
    }
    case 'handoff.request': {
      if (state.handoff === 'QUEUED') {
        return recovered(state, 'guard_failed', 'Tu consulta ya está en cola.', [])
      }
      return enterHandoff(state, handoffReasonForFlow(state.flow), null)
    }
    case 'handoff.wait': {
      if (state.flow !== 'HANDOFF_QUEUED') {
        return escalateInvalid(state, 'No hay una espera activa ahora mismo.')
      }
      return applied(state, textView('Seguís en cola. El equipo te va a escribir por acá.'))
    }
    case 'handoff.cancel': {
      if (state.flow !== 'HANDOFF_QUEUED') {
        return escalateInvalid(state, 'No hay una atención en espera para cancelar.')
      }
      const target = state.handoffReturnFlow ?? 'MAIN_MENU'
      const restored = validateResumeTarget(baseOf(state, {
        flow: target,
        handoff: 'NONE',
        handoffReturnFlow: null,
        presentation: plainPresentation()
      }))
      return applied(restored, renderCurrentView(restored, context))
    }
    default:
      return null
  }
}

function restoreFromNavigation(current: BotOptionsPresentationMode): BotOptionsPresentationMode {
  return current.kind === 'navigation_menu' ? { kind: 'plain' } : current
}

/** Revalidación mínima al retomar un flujo pausado: nunca restaura estados financieros huérfanos. */
function validateResumeTarget(state: BotOptionsState): BotOptionsState {
  if (WAITING_PROOF_DEPOSITS(state.deposit) === false && state.flow === 'DEPOSIT_INSTRUCTIONS') {
    return baseOf(state, { flow: state.deposit === 'NONE' ? 'MAIN_MENU' : state.flow })
  }
  return state
}

function handoffReasonForFlow(flow: BotOptionsFlowStep): string {
  if (flow === 'INCOMPATIBLE_SERVICE_DECISION') return 'coordinacion_multiprofesional'
  if (flow === 'PROFESSIONAL_HOURS_DETAIL') return 'consulta_profesional_no_reservable'
  if (flow.startsWith('APPOINTMENT')) return 'gestion_requiere_equipo'
  if (flow.startsWith('DEPOSIT')) return 'senal_requiere_revision'
  return 'cliente_solicito_atencion'
}

// ── Eventos de sistema ────────────────────────────────────────────────────────

function handleSystemEvent(
  state: BotOptionsState,
  actionType: SystemEventActionType,
  payload: BotOptionsActionPayload | null,
  context: TransitionContext
): TransitionResult {
  switch (actionType) {
    case 'name.submit': {
      if (state.flow !== 'NAME_INPUT') {
        return escalateInvalid(state, 'Ahora no estoy pidiendo un nombre. Seguí con las opciones.')
      }
      const name = payload?.name
      if (!name) {
        return escalateInvalid(state, 'Necesito tu nombre para continuar. Escribilo, por favor.')
      }
      return applied(
        baseOf(resetInvalidStreak(state), { flow: 'NAME_CONFIRM', nameCandidate: name }),
        renderCurrentView({ ...state, flow: 'NAME_CONFIRM', nameCandidate: name }, context)
      )
    }
    case 'deposit.proof_received': {
      if (state.flow !== 'DEPOSIT_INSTRUCTIONS' || !WAITING_PROOF_DEPOSITS(state.deposit)) {
        return escalateInvalid(state, 'Ahora no estoy esperando un comprobante.')
      }
      const next = baseOf(resetInvalidStreak(state), {
        flow: 'DEPOSIT_REVIEW',
        deposit: 'PROOF_RECEIVED',
        booking: 'PENDING_PAYMENT_REVIEW'
      })
      return applied(next, textView('Recibimos tu comprobante. Tu horario queda reservado provisoriamente mientras lo revisamos.'))
    }
    case 'deposit.expired': {
      if (!WAITING_PROOF_DEPOSITS(state.deposit)) return escalateInvalid(state, '')
      const next = baseOf(state, { flow: 'MAIN_MENU', deposit: 'EXPIRED', booking: 'EXPIRED', presentation: plainPresentation() })
      return applied(next, textView('Venció el plazo del comprobante y liberamos el horario. Cuando quieras, buscamos uno nuevo.'), [
        { kind: 'RELEASE_HOLD' }
      ])
    }
    case 'deposit.late_proof': {
      if (state.deposit !== 'EXPIRED') return escalateInvalid(state, '')
      return enterHandoff(state, 'comprobante_tardio', null)
    }
    case 'booking.slot_conflict': {
      if (state.flow !== 'BOOKING_SUMMARY' && state.flow !== 'SLOT_SELECT') return escalateInvalid(state, '')
      const next = baseOf(withoutSelections(state, 'slot'), { flow: 'SLOT_SELECT', presentation: plainPresentation() })
      return applied(next, recoveryView('Ese horario acaba de ocuparse. Estos son los disponibles ahora:', []))
    }
    case 'appointment.slot_conflict': {
      if (state.flow !== 'APPOINTMENT_RESCHEDULE_SUMMARY' && state.flow !== 'APPOINTMENT_RESCHEDULE_SLOT') {
        return escalateInvalid(state, '')
      }
      const next = baseOf(state, { flow: 'APPOINTMENT_RESCHEDULE_SLOT', presentation: plainPresentation() })
      return applied(next, recoveryView('El horario nuevo se ocupó. Tu turno original sigue intacto; elegí otro horario.', []))
    }
    case 'input.unsupported': {
      if (state.flow === 'NAME_INPUT') {
        return escalateInvalid(state, 'Para el nombre necesito texto escrito, por favor.')
      }
      return escalateInvalid(state, 'Este paso funciona con las opciones de la pantalla. Elegí una para continuar.')
    }
  }
}

type SystemEventAction = SystemEventActionType

// ── Acciones CRM ──────────────────────────────────────────────────────────────

function handleCrmAction(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  payload: BotOptionsActionPayload | null,
  context: TransitionContext
): TransitionResult {
  const type = actionType as 'deposit.approve' | 'deposit.reject_resubmission' | 'deposit.reject_final' | 'handoff.take' | 'handoff.resolve_home' | 'handoff.resolve_resume'

  switch (type) {
    case 'deposit.approve': {
      if (state.deposit !== 'PROOF_RECEIVED' || state.booking !== 'PENDING_PAYMENT_REVIEW') {
        return escalateInvalid(state, '')
      }
      const next = baseOf(state, { flow: 'BOOKING_CONFIRMED', deposit: 'APPROVED', booking: 'CONFIRMED', presentation: plainPresentation() })
      return applied(next, textView('Pago aprobado: tu turno quedó confirmado. ¡Te esperamos!'), [
        { kind: 'APPROVE_DEPOSIT' }
      ])
    }
    case 'deposit.reject_resubmission': {
      if (state.deposit !== 'PROOF_RECEIVED' || state.booking !== 'PENDING_PAYMENT_REVIEW') {
        return escalateInvalid(state, '')
      }
      const reason = payload?.reason?.trim() ?? ''
      const resubmissionExpiresAtIso = payload?.resubmissionDeadlineIso ?? ''
      const deadline = resubmissionExpiresAtIso ? Date.parse(resubmissionExpiresAtIso) : Number.NaN
      const dbNow = Date.parse(context.dbNowIso)
      if (!reason || !Number.isFinite(deadline) || !Number.isFinite(dbNow) || deadline <= dbNow) {
        return recovered(state, 'guard_failed', 'El rechazo necesita motivo y un nuevo plazo futuro.', [])
      }
      const next = baseOf(state, { flow: 'DEPOSIT_INSTRUCTIONS', deposit: 'REJECTED_RESUBMISSION_ALLOWED', booking: 'HELD' })
      return applied(next, textView('El comprobante no pudimos aceptarlo. Te enviamos el motivo y tenés un plazo nuevo para reenviarlo.'), [
        {
          kind: 'REJECT_DEPOSIT_FOR_RESUBMISSION',
          reason,
          resubmissionExpiresAtIso
        }
      ])
    }
    case 'deposit.reject_final': {
      if (state.deposit !== 'PROOF_RECEIVED' && state.deposit !== 'REJECTED_RESUBMISSION_ALLOWED') {
        return escalateInvalid(state, '')
      }
      if (!payload?.reason?.trim()) {
        return recovered(state, 'guard_failed', 'El rechazo final necesita un motivo.', [])
      }
      const next = baseOf(state, { flow: 'MAIN_MENU', deposit: 'REJECTED_FINAL', booking: 'CANCELLED', presentation: plainPresentation() })
      return applied(next, textView('El comprobante fue rechazado definitivamente y liberamos el horario.'), [
        { kind: 'REJECT_DEPOSIT_FINAL', reason: payload.reason.trim() },
        { kind: 'RELEASE_HOLD' }
      ])
    }
    case 'handoff.take': {
      if (state.handoff !== 'QUEUED') return escalateInvalid(state, '')
      return applied(baseOf(state, { flow: 'HANDOFF_TAKEN', handoff: 'TAKEN' }), textView(''), [
        { kind: 'TAKE_HUMAN_HANDOFF' }
      ])
    }
    case 'handoff.resolve_home': {
      if (state.handoff !== 'TAKEN') return escalateInvalid(state, '')
      const cleared = baseOf(clearDraft(state), {
        flow: 'MAIN_MENU',
        handoff: 'NONE',
        handoffReturnFlow: null,
        presentation: plainPresentation()
      })
      return applied(cleared, renderCurrentView(cleared, context), [
        { kind: 'RESOLVE_HANDOFF', mode: 'HOME' }
      ])
    }
    case 'handoff.resolve_resume': {
      if (state.handoff !== 'TAKEN') return escalateInvalid(state, '')
      const target = state.handoffReturnFlow ?? 'MAIN_MENU'
      const next = baseOf(state, { flow: target, handoff: 'NONE', handoffReturnFlow: null, presentation: plainPresentation() })
      return applied(next, renderCurrentView(next, context), [
        { kind: 'RESOLVE_HANDOFF', mode: 'RESUME' }
      ])
    }
  }
  return escalateInvalid(state, '')
}

// ── Handlers funcionales ──────────────────────────────────────────────────────

function startBookingPath(state: BotOptionsState, context: TransitionContext): TransitionResult {
  if (context.draftExists && context.draftHasProgress) {
    return applied(baseOf(state, { flow: 'DRAFT_RESUME' }), renderCurrentView({ ...state, flow: 'DRAFT_RESUME' }, context))
  }
  if (!context.customerNameOnFile && !state.nameCandidate) {
    return applied(baseOf(state, { flow: 'NAME_INPUT', catalogMode: 'BOOKING' }), renderCurrentView({ ...state, flow: 'NAME_INPUT' }, context))
  }
  const next = baseOf(state, { flow: 'CATEGORY_SELECT', catalogMode: 'BOOKING', presentation: plainPresentation() })
  return applied(next, renderCurrentView(next, context))
}

function fromMainMenu(state: BotOptionsState, actionType: BotOptionsActionType, context: TransitionContext): TransitionResult {
  switch (actionType) {
    case 'menu.start_booking':
      return startBookingPath(state, context)
    case 'menu.browse_services': {
      const next = baseOf(state, { flow: 'CATEGORY_SELECT', catalogMode: 'BROWSING', presentation: plainPresentation() })
      return applied(next, renderCurrentView(next, context))
    }
    case 'menu.business_hours':
      return applied(baseOf(state, { flow: 'BUSINESS_HOURS' }), renderCurrentView({ ...state, flow: 'BUSINESS_HOURS' }, context))
    case 'menu.manage_appointment': {
      if (!context.appointmentsExist) {
        return recovered(
          resetInvalidStreak(state),
          'guard_failed',
          'No encontramos turnos futuros para este número. ¿Querés sacar uno nuevo?',
          [{ actionType: 'menu.start_booking', label: 'Sacar un turno' }]
        )
      }
      return applied(baseOf(state, { flow: 'APPOINTMENT_LIST', presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'APPOINTMENT_LIST' }, context))
    }
  }
  return escalateInvalid(state, '')
}

function fromDraftResume(state: BotOptionsState, actionType: BotOptionsActionType): TransitionResult {
  if (actionType === 'draft.restart') {
    const cleared = baseOf(clearDraft(state), { flow: 'MAIN_MENU', presentation: plainPresentation() })
    return applied(cleared, renderCurrentView(cleared, EMPTY_CONTEXT_FOR_VIEWS))
  }
  if (actionType === 'draft.continue') {
    const target = resumeTargetFlow(state)
    return applied(baseOf(state, { flow: target, presentation: plainPresentation() }), renderCurrentView({ ...state, flow: target }, EMPTY_CONTEXT_FOR_VIEWS))
  }
  return escalateInvalid(state, '')
}

function resumeTargetFlow(state: BotOptionsState): BotOptionsFlowStep {
  if (WAITING_PROOF_DEPOSITS(state.deposit)) return 'DEPOSIT_INSTRUCTIONS'
  if (state.deposit === 'PROOF_RECEIVED') return 'DEPOSIT_REVIEW'
  if (state.selections.slotStartAt) return 'BOOKING_SUMMARY'
  if (state.selections.date) return 'SLOT_SELECT'
  if (state.selections.professionalId || state.selections.anyProfessional) return 'DATE_SELECT'
  if (state.cart.length > 0) return 'PROFESSIONAL_SELECT'
  return 'CATEGORY_SELECT'
}

function fromNameConfirm(state: BotOptionsState, actionType: BotOptionsActionType, context: TransitionContext): TransitionResult {
  if (actionType === 'name.confirm') {
    const candidate = state.nameCandidate
    if (!candidate) return recovered(state, 'entity_inactive', 'Perdimos el nombre cargado. Escribilo de nuevo, por favor.', [])
    const effects: BotOptionsEffect[] = [{ kind: 'PERSIST_CUSTOMER_NAME', name: candidate }]
    const afterName: BotOptionsState = baseOf(resetInvalidStreak(state), { nameCandidate: null })

    // Intención previa: "Reservar este servicio" pedía nombre primero.
    // Solo pendingEntityRef de tipo SERVICE ingresa al carrito; PROFESSIONAL jamás.
    if (afterName.pendingEntityRef?.type === 'SERVICE') {
      const serviceId = afterName.pendingEntityRef.id
      if (!context.serviceCompatibleWithCart) {
        return applied(
          baseOf(afterName, { flow: 'INCOMPATIBLE_SERVICE_DECISION', presentation: plainPresentation() }),
          renderCurrentView({ ...afterName, flow: 'INCOMPATIBLE_SERVICE_DECISION' }, context),
          effects
        )
      }
      const withItem = addToCart(afterName, serviceId)
      return applied(
        baseOf(withItem, { flow: 'RECOMMENDATION_SELECT', pendingEntityRef: null, presentation: plainPresentation() }),
        renderCurrentView({ ...withItem, flow: 'RECOMMENDATION_SELECT' }, context),
        effects
      )
    }
    // Si había un pending de tipo PROFESSIONAL (horarios), limpiarlo y continuar al catálogo de servicios.
    if (afterName.pendingEntityRef?.type === 'PROFESSIONAL') {
      const cleared = baseOf(afterName, { pendingEntityRef: null, flow: 'CATEGORY_SELECT', presentation: plainPresentation() })
      return applied(cleared, renderCurrentView(cleared, context), effects)
    }
    const next = baseOf(afterName, { flow: 'CATEGORY_SELECT', presentation: plainPresentation() })
    return applied(next, renderCurrentView(next, context), effects)
  }
  if (actionType === 'name.edit') {
    return applied(baseOf(state, { flow: 'NAME_INPUT', nameCandidate: null }), renderCurrentView({ ...state, flow: 'NAME_INPUT' }, context))
  }
  return escalateInvalid(state, '')
}

function fromCategorySelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'category.select') {
    if (!entityRef || !context.categoryActive) {
      return recovered(state, 'entity_inactive', 'Esa categoría ya no está disponible. Elegí otra, por favor.', [])
    }
    if (!context.categoryHasServices) {
      return recovered(state, 'guard_failed', 'Esta categoría no tiene servicios activos ahora. Probá con otra.', [])
    }
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'SERVICE_SELECT',
      selections: { ...state.selections, categoryId: entityRef.id },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  if (actionType === 'catalog.next_page' || actionType === 'catalog.previous_page') {
    return pageShift(state, actionType === 'catalog.next_page', context.catalogCanNext, context.catalogCanPrevious, 'catalog_page')
  }
  if (actionType === 'cart.add_service') {
    return applied(baseOf(state, { catalogMode: 'BOOKING' }), renderCurrentView(state, context))
  }
  return escalateInvalid(state, '')
}

function pageShift(
  state: BotOptionsState,
  forward: boolean,
  canNext: boolean,
  canPrevious: boolean,
  kind: 'catalog_page'
): TransitionResult {
  if (forward && !canNext) return recovered(state, 'guard_failed', 'No hay más páginas hacia adelante.', [])
  if (!forward && !canPrevious) return recovered(state, 'guard_failed', 'Estás en la primera página.', [])
  const cursor = state.presentation.kind === kind ? state.presentation.cursor + (forward ? 1 : -1) : forward ? 1 : 0
  return applied(baseOf(state, { presentation: { kind, cursor: Math.max(0, cursor) } }), renderCurrentView(state, EMPTY_CONTEXT_FOR_VIEWS))
}

function addServiceOrIncompatible(
  state: BotOptionsState,
  serviceId: string,
  context: TransitionContext
): TransitionResult {
  if (context.serviceInCart) {
    return recovered(state, 'guard_failed', 'Ese servicio ya está en tu reserva.', [])
  }
  if (!context.serviceCompatibleWithCart) {
    return applied(
      baseOf(resetInvalidStreak(state), {
        flow: 'INCOMPATIBLE_SERVICE_DECISION',
        pendingEntityRef: { type: 'SERVICE', id: serviceId },
        presentation: plainPresentation()
      }),
      renderCurrentView({ ...state, flow: 'INCOMPATIBLE_SERVICE_DECISION' }, context)
    )
  }
  const withItem = addToCart(state, serviceId)
  const invalidated = withoutSelections(withItem, 'professional')
  if (!context.hasRecommendations) {
    const next = baseOf(invalidated, { flow: 'CART_REVIEW', presentation: plainPresentation() })
    return applied(next, renderCurrentView(next, EMPTY_CONTEXT_FOR_VIEWS))
  }
  const next = baseOf(invalidated, { flow: 'RECOMMENDATION_SELECT', presentation: plainPresentation() })
  return applied(next, renderCurrentView(next, EMPTY_CONTEXT_FOR_VIEWS))
}

function fromServiceSelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'service.view') {
    if (!entityRef || !context.serviceActive) {
      return recovered(state, 'entity_inactive', 'Ese servicio ya no está disponible.', [])
    }
    const next = baseOf(state, {
      flow: 'SERVICE_DETAIL',
      pendingEntityRef: { type: 'SERVICE' as const, id: entityRef.id }
    })
    return applied(next, renderCurrentView({ ...state, flow: 'SERVICE_DETAIL', pendingEntityRef: { type: 'SERVICE' as const, id: entityRef.id } }, context))
  }
  if (actionType === 'service.select') {
    if (state.catalogMode === 'BROWSING') {
      return escalateInvalid(state, 'En esta lista estás sólo mirando precios. Entrá al detalle para reservar.')
    }
    if (!entityRef || !context.serviceActive || !context.serviceBookable) {
      return recovered(state, 'entity_inactive', 'Ese servicio no está disponible para reservar ahora.', [])
    }
    return addServiceOrIncompatible(state, entityRef.id, context)
  }
  if (actionType === 'catalog.next_page' || actionType === 'catalog.previous_page') {
    return pageShift(state, actionType === 'catalog.next_page', context.catalogCanNext, context.catalogCanPrevious, 'catalog_page')
  }
  return escalateInvalid(state, '')
}

function fromServiceDetail(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  const pendingServiceId = state.pendingEntityRef?.id
  const actionMatchesRenderedService =
    entityRef?.type === 'SERVICE' &&
    typeof pendingServiceId === 'string' &&
    entityRef.id === pendingServiceId
  const serviceId = actionMatchesRenderedService ? entityRef.id : null
  switch (actionType) {
    case 'service.book': {
      if (!serviceId || !context.serviceActive) {
        return recovered(state, 'entity_inactive', 'Ese servicio ya no está disponible.', [])
      }
      if (!context.serviceBookable || context.requiresConsultation) {
        return enterHandoff(
          state,
          'servicio_requiere_consulta_previa',
          context.labels.serviceName ?? null,
          { serviceId }
        )
      }
      if (!context.customerNameOnFile && !state.nameCandidate) {
        return applied(
          baseOf(state, { flow: 'NAME_INPUT', pendingEntityRef: { type: 'SERVICE', id: serviceId }, catalogMode: 'BOOKING' }),
          renderCurrentView({ ...state, flow: 'NAME_INPUT' }, context)
        )
      }
      return addServiceOrIncompatible(state, serviceId, context)
    }
    case 'service.consult':
      if (!serviceId || !context.serviceActive) {
        return recovered(state, 'entity_inactive', 'Ese servicio ya no está disponible.', [])
      }
      if (!context.serviceBookable || !context.requiresConsultation) {
        return recovered(state, 'guard_failed', 'Ese servicio no requiere consulta previa.', [])
      }
      return enterHandoff(
        state,
        'servicio_requiere_consulta_previa',
        context.labels.serviceName ?? null,
        { serviceId }
      )
    case 'service.more_same_category':
      return applied(baseOf(state, { flow: 'SERVICE_SELECT', presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'SERVICE_SELECT' }, context))
    case 'service.change_category':
      return applied(
        baseOf(state, { flow: 'CATEGORY_SELECT', selections: { ...state.selections, categoryId: null }, presentation: plainPresentation() }),
        renderCurrentView({ ...state, flow: 'CATEGORY_SELECT' }, context)
      )
  }
  return escalateInvalid(state, '')
}

function fromRecommendationSelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'recommendation.add') {
    if (!entityRef) return recovered(state, 'entity_inactive', 'No pudimos identificar ese complemento.', [])
    if (!context.recommendedServiceAvailable) {
      return recovered(state, 'entity_inactive', 'Ese complemento ya no está disponible.', [])
    }
    if (!context.recommendedCompatibleWithCart) {
      return enterHandoff(state, 'complemento_requiere_coordinacion', context.labels.serviceName ?? null)
    }
    const withItem = addToCart(state, entityRef.id)
    return applied(baseOf(withItem, { flow: 'CART_REVIEW', presentation: plainPresentation() }), renderCurrentView({ ...withItem, flow: 'CART_REVIEW' }, context))
  }
  if (actionType === 'recommendation.skip') {
    const rejected = entityRef
      ? [...new Set([...state.rejectedRecommendationIds, entityRef.id])]
      : state.rejectedRecommendationIds
    return applied(baseOf(state, { flow: 'CART_REVIEW', rejectedRecommendationIds: rejected, presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'CART_REVIEW' }, context))
  }
  if (actionType === 'recommendation.consult') {
    return enterHandoff(state, 'complemento_requiere_coordinacion', context.labels.serviceName ?? null)
  }
  return escalateInvalid(state, '')
}

function fromCartReview(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'cart.remove_service') {
    if (!entityRef || !state.cart.some((item) => item.serviceId === entityRef.id)) {
      return recovered(state, 'entity_inactive', 'Ese servicio no está en tu reserva.', [])
    }
    const remaining = state.cart.filter((item) => item.serviceId !== entityRef.id)
    const next = baseOf(withoutSelections({ ...state, cart: remaining }, 'professional'), { presentation: plainPresentation() })
    return applied(next, renderCurrentView(next, context))
  }
  if (actionType === 'cart.add_service') {
    return applied(baseOf(state, { flow: 'CATEGORY_SELECT', catalogMode: 'BOOKING', presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'CATEGORY_SELECT' }, context))
  }
  if (actionType === 'cart.continue') {
    if (state.cart.length === 0 || !context.professionalCommonExists) {
      return recovered(state, 'guard_failed', 'Necesitamos revisar esa combinación de servicios. Te ayudo el equipo.', [HUMAN_CHOICE])
    }
    const clearedProf = withoutSelections(state, 'professional')
    return applied(baseOf(clearedProf, { flow: 'PROFESSIONAL_SELECT', presentation: plainPresentation() }), renderCurrentView({ ...clearedProf, flow: 'PROFESSIONAL_SELECT' }, context))
  }
  return escalateInvalid(state, '')
}

function fromIncompatibleDecision(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'recommendation.add') {
    const serviceId = entityRef?.id ?? state.pendingEntityRef?.id
    if (!serviceId) return recovered(state, 'entity_inactive', 'No pudimos identificar ese servicio.', [])
    return enterHandoff(baseOf(state, { pendingEntityRef: { type: 'SERVICE', id: serviceId } }), 'coordinacion_multiprofesional', context.labels.serviceName ?? null)
  }
  if (actionType === 'cart.continue') {
    return applied(baseOf(state, { flow: 'CART_REVIEW', pendingEntityRef: null, presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'CART_REVIEW' }, context))
  }
  return escalateInvalid(state, '')
}

function fromProfessionalSelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'professional.any') {
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'DATE_SELECT',
      selections: { ...state.selections, professionalId: null, anyProfessional: true, date: null, slotStartAt: null },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  if (actionType === 'professional.select') {
    if (!entityRef || !context.professionalSelectable) {
      return recovered(state, 'entity_inactive', 'Esa persona no puede realizar todos los servicios elegidos.', [])
    }
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'DATE_SELECT',
      selections: { ...state.selections, professionalId: entityRef.id, anyProfessional: false, date: null, slotStartAt: null },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  return escalateInvalid(state, '')
}

function fromDateSelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  payload: BotOptionsActionPayload | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'date.next_page' || actionType === 'date.previous_page') {
    if ((actionType === 'date.next_page') !== context.dateCanNext && actionType === 'date.next_page') {
      return recovered(state, 'guard_failed', 'Llegaste al final del rango de búsqueda.', [])
    }
    const cursor = state.presentation.kind === 'catalog_page' ? state.presentation.cursor + (actionType === 'date.next_page' ? 1 : -1) : actionType === 'date.next_page' ? 1 : 0
    return applied(baseOf(state, { presentation: { kind: 'catalog_page', cursor: Math.max(0, cursor) } }), renderCurrentView(state, context))
  }
  if (actionType === 'date.select') {
    if (!payload?.date || !context.dateAvailable) {
      return recovered(state, 'guard_failed', 'Esa fecha ya no tiene disponibilidad. Elegí otra, por favor.', [])
    }
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'SLOT_SELECT',
      selections: { ...state.selections, date: payload.date, slotStartAt: null },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  if (actionType === 'professional.any') {
    return fromProfessionalSelect(state, 'professional.any', null, context)
  }
  return escalateInvalid(state, '')
}

function fromSlotSelect(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  payload: BotOptionsActionPayload | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'slot.band') {
    const band = payload?.band as SlotBand | undefined
    if (!band || !context.bandHasAvailability) {
      return recovered(state, 'guard_failed', 'No hay horarios en esa franja para esta fecha.', [])
    }
    return applied(baseOf(state, { presentation: { kind: 'slot_band', band } }), renderCurrentView(state, context))
  }
  if (actionType === 'slot.show_all') {
    return applied(baseOf(state, { presentation: { kind: 'slot_all_pages', cursor: 0 } }), renderCurrentView(state, context))
  }
  if (actionType === 'slot.next_page') {
    if (!context.slotCanNext) return recovered(state, 'guard_failed', 'No hay más horarios para este día.', [])
    const cursor = state.presentation.kind === 'slot_all_pages' ? state.presentation.cursor + 1 : 1
    return applied(baseOf(state, { presentation: { kind: 'slot_all_pages', cursor } }), renderCurrentView(state, context))
  }
  if (actionType === 'slot.select') {
    if (!payload?.startAt || !context.slotAvailable) {
      return recovered(state, 'guard_failed', 'Ese horario se ocupó. Elegí otro, por favor.', [])
    }
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'BOOKING_SUMMARY',
      selections: { ...state.selections, slotStartAt: payload.startAt },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  return escalateInvalid(state, '')
}

function fromBookingSummary(state: BotOptionsState, actionType: BotOptionsActionType, context: TransitionContext): TransitionResult {
  if (actionType === 'booking.confirm') {
    if (!state.selections.slotStartAt || !state.selections.date || !context.slotStillAvailableAtConfirm) {
      return handleSystemEvent(baseOf(state, { flow: 'BOOKING_SUMMARY' }), 'booking.slot_conflict', null, context)
    }
    if (context.depositRequired && !context.paymentConfigComplete) {
      return enterHandoff(state, 'configuracion_de_pago_incompleta', null)
    }
    if (!context.confirmVisitSnapshot) {
      return recovered(state, 'internal_invariant', 'Nos faltaron datos para confirmar. Probemos otra vez.', [BACK_CHOICE])
    }
    if (context.depositRequired) {
      const deposit = context.depositRequest
      if (!deposit) return recovered(state, 'internal_invariant', 'Faltó preparar el pago. Probemos otra vez.', [BACK_CHOICE])
      const next = baseOf(resetInvalidStreak(state), {
        flow: 'DEPOSIT_INSTRUCTIONS',
        booking: 'HELD',
        deposit: 'PENDING_PROOF',
        presentation: plainPresentation()
      })
      return applied(next, renderCurrentView(next, context), [
        {
          kind: 'HOLD_VISIT_WITH_DEPOSIT',
          services: context.confirmVisitSnapshot.services,
          professional: context.confirmVisitSnapshot.professional,
          date: state.selections.date!,
          slotStartAt: state.selections.slotStartAt,
          totalDurationMinutes: context.confirmVisitSnapshot.totalDurationMinutes,
          depositAmountMinor: deposit.amountMinor,
          holdExpiresAtIso: deposit.holdExpiresAtIso
        }
      ])
    }
    const next = baseOf(resetInvalidStreak(state), {
      flow: 'BOOKING_CONFIRMED',
      booking: 'CONFIRMED',
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context), [
      {
        kind: 'CONFIRM_VISIT',
        services: context.confirmVisitSnapshot.services,
        professional: context.confirmVisitSnapshot.professional,
        date: state.selections.date!,
        slotStartAt: state.selections.slotStartAt,
        totalDurationMinutes: context.confirmVisitSnapshot.totalDurationMinutes,
        totalPriceMinor: context.confirmVisitSnapshot.totalPriceMinor
      }
    ])
  }
  return escalateInvalid(state, '')
}

function fromDepositCancelConfirm(state: BotOptionsState, actionType: BotOptionsActionType, context: TransitionContext): TransitionResult {
  if (actionType === 'deposit.continue_payment') {
    return applied(baseOf(state, { flow: 'DEPOSIT_INSTRUCTIONS', presentation: plainPresentation() }), renderCurrentView({ ...state, flow: 'DEPOSIT_INSTRUCTIONS' }, context))
  }
  if (actionType === 'deposit.cancel_confirm') {
    const next = baseOf(state, {
      flow: 'MAIN_MENU',
      deposit: 'NONE',
      booking: 'CANCELLED',
      presentation: plainPresentation()
    })
    return applied(next, textView('Listo, cancelamos la solicitud y liberamos el horario.'), [
      { kind: 'RELEASE_HOLD' }
    ])
  }
  return escalateInvalid(state, '')
}

function fromAppointmentDetail(
  state: BotOptionsState,
  actionType: BotOptionsActionType,
  entityRef: BotOptionsEntityRef | null,
  context: TransitionContext
): TransitionResult {
  if (actionType === 'appointment.cancel') {
    if (!entityRef || !context.appointmentOwnedAndFuture) {
      return recovered(state, 'entity_inactive', 'No pudimos encontrar ese turno. Volvé a intentar desde Gestionar turno.', [])
    }
    if (!context.cancellationAllowed) {
      return enterHandoff(state, 'cancelacion_fuera_de_politica_o_con_pago', context.labels.appointmentSummary ?? null)
    }
    const next = baseOf(state, {
      flow: 'APPOINTMENT_CANCEL_CONFIRM',
      selections: { ...state.selections, appointmentId: entityRef.id }
    })
    return applied(next, renderCurrentView(next, context))
  }
  if (actionType === 'appointment.reschedule') {
    if (!entityRef || !context.appointmentOwnedAndFuture) {
      return recovered(state, 'entity_inactive', 'No pudimos encontrar ese turno. Volvé a intentar desde Gestionar turno.', [])
    }
    if (!context.rescheduleAllowed) {
      return enterHandoff(state, 'reprogramacion_fuera_de_politica_o_con_pago', context.labels.appointmentSummary ?? null)
    }
    const next = baseOf(state, {
      flow: 'APPOINTMENT_RESCHEDULE_DATE',
      selections: { ...state.selections, appointmentId: entityRef.id, date: null, slotStartAt: null },
      presentation: plainPresentation()
    })
    return applied(next, renderCurrentView(next, context))
  }
  return escalateInvalid(state, '')
}

function clearDraft(state: BotOptionsState): BotOptionsState {
  const fresh = createInitialLike(state)
  return fresh
}

function createInitialLike(state: BotOptionsState): BotOptionsState {
  return {
    schemaVersion: state.schemaVersion,
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
