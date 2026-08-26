/**
 * F4.1 — Catálogo tipado de acciones y envelope del motor determinístico por opciones.
 *
 * Fuente canónica: docs/nuevo-bot/maquina-de-estados.md (secciones 3 y 4) y
 * diseno-tecnico.md sección 5. Este módulo es puro: no importa Prisma, Fastify,
 * Meta ni relojes. La identidad de una acción NUNCA depende del título visible,
 * de la posición en la lista ni del último texto enviado.
 */

export const BOT_OPTIONS_ENGINE_KEY = 'deterministic-options'
export const BOT_OPTIONS_ACTIONS_SCHEMA_VERSION = 1

/** Acciones que el cliente puede elegir como opción interactiva. */
export const CLIENT_CHOICE_ACTION_TYPES = [
  'menu.start_booking',
  'menu.browse_services',
  'menu.business_hours',
  'menu.manage_appointment',
  'draft.continue',
  'draft.restart',
  'name.confirm',
  'name.edit',
  'category.select',
  'service.view',
  'service.select',
  'service.book',
  'service.consult',
  'service.more_same_category',
  'service.change_category',
  'catalog.next_page',
  'catalog.previous_page',
  'hours.professional',
  'hours.search_availability',
  'hours.professional_select',
  'hours.choose_other_professional',
  'hours.consult_human',
  'recommendation.add',
  'recommendation.skip',
  'recommendation.consult',
  'cart.add_service',
  'cart.remove_service',
  'cart.continue',
  'professional.any',
  'professional.select',
  'date.next_page',
  'date.previous_page',
  'date.select',
  'slot.band',
  'slot.show_all',
  'slot.next_page',
  'slot.select',
  'booking.confirm',
  'deposit.continue_payment',
  'deposit.cancel_confirm',
  'navigation.open',
  'navigation.close',
  'navigation.back',
  'navigation.home',
  'handoff.request',
  'handoff.wait',
  'handoff.cancel',
  'appointment.select',
  'appointment.next_page',
  'appointment.cancel',
  'appointment.cancel_confirm',
  'appointment.reschedule',
  'appointment.date_select',
  'appointment.slot_select',
  'appointment.reschedule_confirm'
] as const

/** Eventos que disparan transiciones pero no son elecciones del cliente. */
export const SYSTEM_EVENT_ACTION_TYPES = [
  'name.submit',
  'deposit.proof_received',
  'deposit.late_proof',
  'deposit.expired',
  'booking.slot_conflict',
  'appointment.slot_conflict',
  'input.unsupported',
  'input.stale_cutover'
] as const

/** Acciones autorizadas ejecutadas desde el CRM por un agente humano. */
export const CRM_ACTION_TYPES = [
  'deposit.approve',
  'deposit.reject_resubmission',
  'deposit.reject_final',
  'handoff.take',
  'handoff.resolve_home',
  'handoff.resolve_resume'
] as const

export const BOT_OPTIONS_ACTION_TYPES = [
  ...CLIENT_CHOICE_ACTION_TYPES,
  ...SYSTEM_EVENT_ACTION_TYPES,
  ...CRM_ACTION_TYPES
] as const

export type ClientChoiceActionType = (typeof CLIENT_CHOICE_ACTION_TYPES)[number]
export type SystemEventActionType = (typeof SYSTEM_EVENT_ACTION_TYPES)[number]
export type CrmActionType = (typeof CRM_ACTION_TYPES)[number]
export type BotOptionsActionType = (typeof BOT_OPTIONS_ACTION_TYPES)[number]

const CLIENT_CHOICE_SET: ReadonlySet<string> = new Set(CLIENT_CHOICE_ACTION_TYPES)
const SYSTEM_EVENT_SET: ReadonlySet<string> = new Set(SYSTEM_EVENT_ACTION_TYPES)
const CRM_SET: ReadonlySet<string> = new Set(CRM_ACTION_TYPES)

export function isBotOptionsActionType(value: string): value is BotOptionsActionType {
  return CLIENT_CHOICE_SET.has(value) || SYSTEM_EVENT_SET.has(value) || CRM_SET.has(value)
}

export function isClientChoiceAction(value: BotOptionsActionType): value is ClientChoiceActionType {
  return CLIENT_CHOICE_SET.has(value)
}

export function isSystemEventAction(value: BotOptionsActionType): value is SystemEventActionType {
  return SYSTEM_EVENT_SET.has(value)
}

export function isCrmAction(value: BotOptionsActionType): value is CrmActionType {
  return CRM_SET.has(value)
}

/** Entidades con ID estable que una acción puede transportar. */
export type BotOptionsEntityType =
  | 'CATEGORY'
  | 'SERVICE'
  | 'PROFESSIONAL'
  | 'APPOINTMENT'

export type BotOptionsEntityRef = {
  type: BotOptionsEntityType
  id: string
}

export type BotOptionsActionRequirements = {
  /** Entidad obligatoria para que la acción sea válida. */
  readonly entity?: BotOptionsEntityType
  /** Exige payload.date con formato YYYY-MM-DD (fecha del negocio). */
  readonly requiresDate?: true
  /** Exige payload.startAt ISO 8601 con offset (inicio de bloque en la grilla). */
  readonly requiresSlotStart?: true
  /** Exige payload.band dentro de las franjas canónicas. */
  readonly requiresSlotBand?: true
  /** Exige payload.conflictChoiceToken cuando la desambiguación confirma una opción. */
  readonly requiresConflictChoice?: true
  /** Exige payload.name con texto ya normalizado (validación Unicode fina es F6.2). */
  readonly requiresName?: true
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SLOT_START_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/

/**
 * Requisitos por acción. Lo que no figura acá no acepta entidad ni payload:
 * el motor rechaza payloads sorpresa en lugar de ignorarlos.
 */
export const BOT_OPTIONS_ACTION_REQUIREMENTS: Readonly<
  Record<BotOptionsActionType, BotOptionsActionRequirements>
> = {
  'menu.start_booking': {},
  'menu.browse_services': {},
  'menu.business_hours': {},
  'menu.manage_appointment': {},
  'draft.continue': {},
  'draft.restart': {},
  'name.submit': { requiresName: true },
  'name.confirm': {},
  'name.edit': {},
  'category.select': { entity: 'CATEGORY' },
  'service.view': { entity: 'SERVICE' },
  'service.select': { entity: 'SERVICE' },
  'service.book': { entity: 'SERVICE' },
  'service.consult': { entity: 'SERVICE' },
  'service.more_same_category': {},
  'service.change_category': {},
  'catalog.next_page': {},
  'catalog.previous_page': {},
  'hours.professional': {},
  'hours.search_availability': {},
  'hours.professional_select': { entity: 'PROFESSIONAL' },
  'hours.choose_other_professional': {},
  'hours.consult_human': {},
  'recommendation.add': { entity: 'SERVICE' },
  'recommendation.skip': {},
  'recommendation.consult': { entity: 'SERVICE' },
  'cart.add_service': {},
  'cart.remove_service': { entity: 'SERVICE' },
  'cart.continue': {},
  'professional.any': {},
  'professional.select': { entity: 'PROFESSIONAL' },
  'date.next_page': {},
  'date.previous_page': {},
  'date.select': { requiresDate: true },
  'slot.band': { requiresSlotBand: true },
  'slot.show_all': {},
  'slot.next_page': {},
  'slot.select': { requiresSlotStart: true },
  'booking.confirm': {},
  'booking.slot_conflict': { requiresSlotStart: true },
  'deposit.proof_received': {},
  'deposit.late_proof': {},
  'deposit.expired': {},
  'deposit.continue_payment': {},
  'deposit.cancel_confirm': {},
  'deposit.approve': {},
  'deposit.reject_resubmission': {},
  'deposit.reject_final': {},
  'navigation.open': {},
  'navigation.close': {},
  'navigation.back': {},
  'navigation.home': {},
  'handoff.request': {},
  'handoff.wait': {},
  'handoff.cancel': {},
  'handoff.take': {},
  'handoff.resolve_home': {},
  'handoff.resolve_resume': {},
  'appointment.select': { entity: 'APPOINTMENT' },
  'appointment.next_page': {},
  'appointment.cancel': { entity: 'APPOINTMENT' },
  'appointment.cancel_confirm': { entity: 'APPOINTMENT' },
  'appointment.reschedule': { entity: 'APPOINTMENT' },
  'appointment.date_select': { entity: 'APPOINTMENT', requiresDate: true },
  'appointment.slot_select': { entity: 'APPOINTMENT', requiresSlotStart: true },
  'appointment.reschedule_confirm': { entity: 'APPOINTMENT' },
  'appointment.slot_conflict': { entity: 'APPOINTMENT', requiresSlotStart: true },
  'input.unsupported': {},
  'input.stale_cutover': {}
}

export type SlotBand = 'MORNING' | 'AFTERNOON' | 'EVENING'

export const BOT_OPTIONS_SLOT_BANDS: readonly SlotBand[] = ['MORNING', 'AFTERNOON', 'EVENING']

export type BotOptionsActionPayload = {
  date?: string
  startAt?: string
  band?: SlotBand
  conflictChoiceToken?: string
  name?: string
}

/**
 * Envelope persistido por la admisión (BotActionInbox). El transporte hacia Meta
 * usa tokens opacos (`b1.<promptToken>.<choiceToken>`); este envelope ya fue
 * resuelto contra BotPrompt/BotPromptChoice y porta la identidad semántica.
 */
export type BotOptionsActionEnvelope = {
  schemaVersion: typeof BOT_OPTIONS_ACTIONS_SCHEMA_VERSION
  engineKey: typeof BOT_OPTIONS_ENGINE_KEY
  engineVersion: string
  deploymentId: string
  businessId: string
  sessionId: string
  promptId: string
  choiceToken: string | null
  actionType: BotOptionsActionType
  entityRef: BotOptionsEntityRef | null
  payload: BotOptionsActionPayload | null
  expectedStateRevision: bigint
  providerEventId: string
  providerMessageId: string | null
  receivedAtIso: string
}

export type EnvelopeValidationFailure =
  | { field: 'schemaVersion'; reason: 'unsupported_version' }
  | { field: 'engineKey'; reason: 'unknown_engine' }
  | { field: 'actionType'; reason: 'unknown_action_type' }
  | { field: 'actionType'; reason: 'client_choice_required_for_interactive_prompt'; }
  | { field: 'engineVersion' | 'deploymentId' | 'businessId' | 'sessionId' | 'promptId' | 'providerEventId'; reason: 'required' }
  | { field: 'choiceToken'; reason: 'required_for_client_choice' }
  | { field: 'choiceToken'; reason: 'forbidden_for_non_choice' }
  | { field: 'entityRef'; reason: 'required' }
  | { field: 'entityRef'; reason: 'unexpected_entity' }
  | { field: 'payload.date'; reason: 'required' }
  | { field: 'payload.date'; reason: 'invalid_format' }
  | { field: 'payload.date'; reason: 'unexpected_field' }
  | { field: 'payload.startAt'; reason: 'required' }
  | { field: 'payload.startAt'; reason: 'invalid_format' }
  | { field: 'payload.startAt'; reason: 'unexpected_field' }
  | { field: 'payload.band'; reason: 'required' }
  | { field: 'payload.band'; reason: 'unknown_band' }
  | { field: 'payload.band'; reason: 'unexpected_field' }
  | { field: 'payload.conflictChoiceToken'; reason: 'required' }
  | { field: 'payload.conflictChoiceToken'; reason: 'unexpected_field' }
  | { field: 'payload.name'; reason: 'required' }
  | { field: 'payload.name'; reason: 'invalid_format' }
  | { field: 'payload.name'; reason: 'unexpected_field' }
  | { field: 'expectedStateRevision'; reason: 'invalid_revision' }
  | { field: 'receivedAtIso'; reason: 'invalid_timestamp' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value
}

/**
 * Valida forma y requisitos estáticos del envelope. NO valida contra estado,
 * catálogo ni tenancy: eso ocurre bajo lock en la transición. Fallar acá es un
 * bug de admisión o un evento corrupto, nunca una recuperación funcional.
 */
export function validateBotOptionsActionEnvelope(
  candidate: unknown
): { ok: true; envelope: BotOptionsActionEnvelope } | { ok: false; failures: EnvelopeValidationFailure[] } {
  const failures: EnvelopeValidationFailure[] = []
  if (!isPlainObject(candidate)) {
    return { ok: false, failures: [{ field: 'engineKey', reason: 'unknown_engine' }] }
  }

  if (candidate.schemaVersion !== BOT_OPTIONS_ACTIONS_SCHEMA_VERSION) {
    failures.push({ field: 'schemaVersion', reason: 'unsupported_version' })
  }
  if (candidate.engineKey !== BOT_OPTIONS_ENGINE_KEY) {
    failures.push({ field: 'engineKey', reason: 'unknown_engine' })
  }
  if (!isNonEmptyTrimmedString(candidate.engineVersion)) {
    failures.push({ field: 'engineVersion', reason: 'required' })
  }
  for (const field of ['deploymentId', 'businessId', 'sessionId', 'promptId', 'providerEventId'] as const) {
    if (!isNonEmptyTrimmedString(candidate[field])) {
      failures.push({ field, reason: 'required' })
    }
  }

  const rawActionType = candidate.actionType
  if (typeof rawActionType !== 'string' || !isBotOptionsActionType(rawActionType)) {
    failures.push({ field: 'actionType', reason: 'unknown_action_type' })
    return { ok: false, failures }
  }
  const actionType = rawActionType
  const requirements = BOT_OPTIONS_ACTION_REQUIREMENTS[actionType]

  const isChoice = isClientChoiceAction(actionType)
  const rawChoiceToken = candidate.choiceToken
  if (isChoice) {
    if (!isNonEmptyTrimmedString(rawChoiceToken)) {
      failures.push({ field: 'choiceToken', reason: 'required_for_client_choice' })
    }
  } else if (rawChoiceToken !== null && rawChoiceToken !== undefined) {
    failures.push({ field: 'choiceToken', reason: 'forbidden_for_non_choice' })
  }

  const rawEntityRef = candidate.entityRef
  let entityRef: BotOptionsEntityRef | null = null
  if (requirements.entity) {
    const expectedType = requirements.entity
    if (
      !isPlainObject(rawEntityRef) ||
      typeof rawEntityRef['type'] !== 'string' ||
      rawEntityRef['type'] !== expectedType ||
      !isNonEmptyTrimmedString(rawEntityRef['id'])
    ) {
      failures.push({ field: 'entityRef', reason: 'required' })
    } else {
      entityRef = { type: expectedType, id: rawEntityRef['id'] }
    }
  } else if (rawEntityRef !== null && rawEntityRef !== undefined) {
    failures.push({ field: 'entityRef', reason: 'unexpected_entity' })
  }

  const rawPayload = candidate.payload
  let payload: BotOptionsActionPayload | null = null
  const expectsAnyPayload = Boolean(
    requirements.requiresDate ||
      requirements.requiresSlotStart ||
      requirements.requiresSlotBand ||
      requirements.requiresConflictChoice ||
      requirements.requiresName
  )
  if (expectsAnyPayload) {
    if (!isPlainObject(rawPayload)) {
      if (requirements.requiresDate) failures.push({ field: 'payload.date', reason: 'required' })
      if (requirements.requiresSlotStart) failures.push({ field: 'payload.startAt', reason: 'required' })
      if (requirements.requiresSlotBand) failures.push({ field: 'payload.band', reason: 'required' })
      if (requirements.requiresConflictChoice) failures.push({ field: 'payload.conflictChoiceToken', reason: 'required' })
      if (requirements.requiresName) failures.push({ field: 'payload.name', reason: 'required' })
    } else {
      const extraKeys = new Set(Object.keys(rawPayload))
      payload = {}

      if (requirements.requiresDate) {
        const dateValue = rawPayload['date']
        if (typeof dateValue !== 'string' || !DATE_PATTERN.test(dateValue)) {
          failures.push({
            field: 'payload.date',
            reason: typeof dateValue === 'string' ? 'invalid_format' : 'required'
          })
        } else {
          payload.date = dateValue
        }
        extraKeys.delete('date')
      } else if ('date' in rawPayload) {
        failures.push({ field: 'payload.date', reason: 'unexpected_field' })
        extraKeys.delete('date')
      }

      if (requirements.requiresSlotStart) {
        const startAtValue = rawPayload['startAt']
        if (typeof startAtValue !== 'string' || !SLOT_START_PATTERN.test(startAtValue)) {
          failures.push({
            field: 'payload.startAt',
            reason: typeof startAtValue === 'string' ? 'invalid_format' : 'required'
          })
        } else {
          payload.startAt = startAtValue
        }
        extraKeys.delete('startAt')
      } else if ('startAt' in rawPayload) {
        failures.push({ field: 'payload.startAt', reason: 'unexpected_field' })
        extraKeys.delete('startAt')
      }

      if (requirements.requiresSlotBand) {
        const bandValue = rawPayload['band']
        if (
          typeof bandValue !== 'string' ||
          !BOT_OPTIONS_SLOT_BANDS.includes(bandValue as SlotBand)
        ) {
          failures.push({
            field: 'payload.band',
            reason: typeof bandValue === 'string' ? 'unknown_band' : 'required'
          })
        } else {
          payload.band = bandValue as SlotBand
        }
        extraKeys.delete('band')
      } else if ('band' in rawPayload) {
        failures.push({ field: 'payload.band', reason: 'unexpected_field' })
        extraKeys.delete('band')
      }

      if (requirements.requiresConflictChoice) {
        const tokenValue = rawPayload['conflictChoiceToken']
        if (!isNonEmptyTrimmedString(tokenValue)) {
          failures.push({ field: 'payload.conflictChoiceToken', reason: 'required' })
        } else {
          payload.conflictChoiceToken = tokenValue
        }
        extraKeys.delete('conflictChoiceToken')
      } else if ('conflictChoiceToken' in rawPayload) {
        failures.push({ field: 'payload.conflictChoiceToken', reason: 'unexpected_field' })
        extraKeys.delete('conflictChoiceToken')
      }

      if (requirements.requiresName) {
        const nameValue = rawPayload['name']
        if (typeof nameValue !== 'string') {
          failures.push({ field: 'payload.name', reason: 'required' })
        } else {
          const trimmed = nameValue.trim().replace(/\s+/g, ' ')
          if (trimmed.length < 2 || trimmed.length > 80 || /[\r\n]/.test(nameValue)) {
            failures.push({ field: 'payload.name', reason: 'invalid_format' })
          } else {
            payload.name = trimmed
          }
        }
        extraKeys.delete('name')
      } else if ('name' in rawPayload) {
        failures.push({ field: 'payload.name', reason: 'unexpected_field' })
        extraKeys.delete('name')
      }

      if (extraKeys.size > 0) {
        // Payloads sorpresa se rechazan; el primer campo extra alcanza para el diagnóstico.
        failures.push({ field: 'payload.date', reason: 'unexpected_field' })
      }
    }
  } else if (rawPayload !== null && rawPayload !== undefined) {
    failures.push({ field: 'payload.date', reason: 'unexpected_field' })
  }

  const rawRevision = candidate.expectedStateRevision
  let revision = 0n
  if (typeof rawRevision === 'bigint') {
    revision = rawRevision
    if (revision < 0n) {
      failures.push({ field: 'expectedStateRevision', reason: 'invalid_revision' })
    }
  } else {
    failures.push({ field: 'expectedStateRevision', reason: 'invalid_revision' })
  }

  const rawReceivedAt = candidate.receivedAtIso
  if (
    typeof rawReceivedAt !== 'string' ||
    Number.isNaN(Date.parse(rawReceivedAt))
  ) {
    failures.push({ field: 'receivedAtIso', reason: 'invalid_timestamp' })
  }

  if (failures.length > 0) {
    return { ok: false, failures }
  }

  return {
    ok: true,
    envelope: {
      schemaVersion: BOT_OPTIONS_ACTIONS_SCHEMA_VERSION,
      engineKey: BOT_OPTIONS_ENGINE_KEY,
      engineVersion: candidate.engineVersion as string,
      deploymentId: candidate.deploymentId as string,
      businessId: candidate.businessId as string,
      sessionId: candidate.sessionId as string,
      promptId: candidate.promptId as string,
      choiceToken: isChoice ? (candidate.choiceToken as string) : null,
      actionType,
      entityRef,
      payload,
      expectedStateRevision: revision,
      providerEventId: candidate.providerEventId as string,
      providerMessageId:
        candidate.providerMessageId === undefined || candidate.providerMessageId === null
          ? null
          : (candidate.providerMessageId as string),
      receivedAtIso: rawReceivedAt as string
    }
  }
}
