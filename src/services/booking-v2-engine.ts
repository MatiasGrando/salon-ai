import { BookingV2DomainService } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption, BookingV2DomainCatalog } from './booking-v2-domain.js'
import { BookingV2Extractor, type BookingV2Extraction } from './booking-v2-extractor.js'
import { buildBookingV2MessagePlan, type BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { renderBookingV2Response } from './booking-v2-response-renderer.js'
import { applyBookingV2Extraction, type BookingV2Interpretation } from './booking-v2-interpreter.js'
import {
  ANY_PROFESSIONAL_ID,
  acceptField,
  clearFieldAndDependents,
  confirmProposal,
  nextMissingField,
  rejectProposal,
  type BookingV2State
} from './booking-v2-state.js'
import {
  conversationPatchFromState,
  stateFromConversation,
  type BookingV2ConversationPatch,
  type BookingV2ConversationSnapshot
} from './booking-v2-conversation-state.js'

type BookingV2DomainPort = Pick<
  BookingV2DomainService,
  'loadCatalog' | 'toExtractionCatalog' | 'toInterpreterCatalog' | 'findAvailabilityOptions'
>

type BookingV2ExtractorPort = Pick<BookingV2Extractor, 'extract'>

export type BookingV2ProcessInput = {
  businessId: string
  conversation: BookingV2ConversationSnapshot | null
  message: string
  currentDate?: Date
}

export type BookingV2ProcessResult = {
  state: BookingV2State
  conversationPatch: BookingV2ConversationPatch
  plan: BookingV2MessagePlan
  reply: string
  availabilityOptions: BookingV2AvailabilityOption[]
  extraction: BookingV2Extraction | null
  outcome: BookingV2Interpretation['outcome'] | 'proposal_confirmed' | 'proposal_rejected'
}

export class BookingV2Engine {
  constructor(
    private readonly domain: BookingV2DomainPort = new BookingV2DomainService(),
    private readonly extractor: BookingV2ExtractorPort = new BookingV2Extractor()
  ) {}

  async process(input: BookingV2ProcessInput): Promise<BookingV2ProcessResult> {
    const initialState = stateFromConversation(input.conversation)
    const catalog = await this.domain.loadCatalog(input.businessId)

    if (initialState.draft.time && isTimeChangeRequest(input.message)) {
      const stateWithoutTime = {
        ...initialState,
        draft: clearFieldAndDependents(initialState.draft, 'time'),
        pendingProposal: null
      }
      const requestedTime = await this.resolveExpectedTime(
        input.message,
        stateWithoutTime,
        catalog
      )
      const state = requestedTime
        ? acceptField(stateWithoutTime, 'time', requestedTime.time)
        : stateWithoutTime

      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: requestedTime ? 'accepted' : 'no_change',
        affectedField: 'time'
      }, null, catalog)
    }

    if (initialState.pendingProposal) {
      const confirmation = readConfirmation(input.message)
      if (confirmation === 'yes') {
        return this.fromState(confirmProposal(initialState), 'proposal_confirmed', null, catalog)
      }
      if (confirmation === 'no') {
        return this.fromState(rejectProposal(initialState), 'proposal_rejected', null, catalog)
      }
      return this.fromInterpretation({
        state: initialState,
        nextField: nextMissingField(initialState.draft),
        outcome: 'confirmation_required',
        affectedField: initialState.pendingProposal.field
      }, null, catalog)
    }

    const deterministicService = resolveExpectedService(input.message, initialState, catalog)
    if (deterministicService?.kind === 'selected') {
      const state = acceptField(initialState, 'service', deterministicService.serviceId)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'service'
      }, null, catalog)
    }
    if (deterministicService?.kind === 'ambiguous') {
      return this.fromInterpretation({
        state: initialState,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, catalog, 'no_change', {
        serviceSuggestions: catalog.services.filter((service) =>
          deterministicService.serviceIds.includes(service.id)
        )
      })
    }

    const deterministicProfessional = resolveExpectedProfessional(
      input.message,
      initialState,
      catalog
    )
    if (deterministicProfessional) {
      const state = acceptField(initialState, 'professional', deterministicProfessional)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'professional'
      }, null, catalog)
    }

    const deterministicDate = resolveExpectedDate(
      input.message,
      initialState,
      input.currentDate ?? new Date()
    )
    if (deterministicDate) {
      const state = acceptField(initialState, 'date', deterministicDate)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'date'
      }, null, catalog)
    }

    const deterministicTime = await this.resolveExpectedTime(
      input.message,
      initialState,
      catalog
    )
    if (deterministicTime) {
      const stateWithProfessional = initialState.draft.professional === ANY_PROFESSIONAL_ID
        ? acceptField(initialState, 'professional', deterministicTime.professionalId)
        : initialState
      const state = acceptField(stateWithProfessional, 'time', deterministicTime.time)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'time'
      }, null, catalog)
    }

    const extractionCatalog = this.domain.toExtractionCatalog(catalog)
    const extraction = await this.extractor.extract({
      message: input.message,
      draft: initialState.draft,
      services: extractionCatalog.services,
      professionals: extractionCatalog.professionals,
      ...(input.currentDate ? { currentDate: input.currentDate } : {})
    })

    if (!extraction) {
      return this.fromInterpretation({
        state: initialState,
        nextField: nextMissingField(initialState.draft),
        outcome: 'no_change',
        affectedField: null
      }, null, catalog)
    }

    return this.fromInterpretation(
      applyBookingV2Extraction(
        initialState,
        extraction,
        this.domain.toInterpreterCatalog(catalog)
      ),
      extraction,
      catalog
    )
  }

  async resume(input: Omit<BookingV2ProcessInput, 'message'>): Promise<BookingV2ProcessResult> {
    const state = stateFromConversation(input.conversation)
    const catalog = await this.domain.loadCatalog(input.businessId)

    return this.fromInterpretation({
      state,
      nextField: nextMissingField(state.draft),
      outcome: 'no_change',
      affectedField: null
    }, null, catalog)
  }

  private async fromState(
    state: BookingV2State,
    outcome: BookingV2ProcessResult['outcome'],
    extraction: BookingV2Extraction | null,
    catalog: BookingV2DomainCatalog | null
  ): Promise<BookingV2ProcessResult> {
    return this.fromInterpretation({
      state,
      nextField: nextMissingField(state.draft),
      outcome: outcome === 'proposal_confirmed' ? 'accepted' : 'no_change',
      affectedField: null
    }, extraction, catalog, outcome)
  }

  private async fromInterpretation(
    interpretation: BookingV2Interpretation,
    extraction: BookingV2Extraction | null,
    catalog: BookingV2DomainCatalog | null,
    outcome: BookingV2ProcessResult['outcome'] = interpretation.outcome,
    renderContext?: {
      serviceSuggestions?: BookingV2DomainCatalog['services']
    }
  ): Promise<BookingV2ProcessResult> {
    let effectiveInterpretation = interpretation
    let plan = buildBookingV2MessagePlan(effectiveInterpretation)
    let availabilityOptions: BookingV2AvailabilityOption[] = []
    let unavailableDate: string | null = null

    if (
      catalog &&
      effectiveInterpretation.state.draft.service &&
      effectiveInterpretation.state.draft.date &&
      shouldValidateAvailability(plan)
    ) {
      const availability = await this.domain.findAvailabilityOptions({
        catalog,
        serviceId: effectiveInterpretation.state.draft.service,
        professionalId: effectiveInterpretation.state.draft.professional,
        date: effectiveInterpretation.state.draft.date
      })

      availabilityOptions = availability.ok ? availability.options : []

      if (availabilityOptions.length === 0) {
        unavailableDate = effectiveInterpretation.state.draft.date
        const state = {
          ...effectiveInterpretation.state,
          draft: clearFieldAndDependents(effectiveInterpretation.state.draft, 'date'),
          pendingProposal: null
        }
        effectiveInterpretation = {
          state,
          nextField: 'date',
          outcome: 'no_change',
          affectedField: 'date'
        }
        plan = buildBookingV2MessagePlan(effectiveInterpretation)
      } else {
        const proposedTime = timeToValidate(plan, effectiveInterpretation.state)
        if (proposedTime && !availabilityOptions.some((option) => option.time === proposedTime)) {
          const state = {
            ...effectiveInterpretation.state,
            draft: clearFieldAndDependents(effectiveInterpretation.state.draft, 'time'),
            pendingProposal: null
          }
          effectiveInterpretation = {
            state,
            nextField: 'time',
            outcome: 'no_change',
            affectedField: 'time'
          }
          plan = buildBookingV2MessagePlan(effectiveInterpretation)
        } else if (
          proposedTime &&
          plan.type === 'confirm_booking' &&
          effectiveInterpretation.state.draft.professional === ANY_PROFESSIONAL_ID
        ) {
          const selectedOption = availabilityOptions.find((option) => option.time === proposedTime)
          if (selectedOption) {
            let state = acceptField(
              effectiveInterpretation.state,
              'professional',
              selectedOption.professionalId
            )
            state = acceptField(state, 'time', proposedTime)
            effectiveInterpretation = {
              state,
              nextField: 'confirmation',
              outcome: 'accepted',
              affectedField: 'time'
            }
            plan = buildBookingV2MessagePlan(effectiveInterpretation)
          }
        }
      }
    }

    return {
      state: effectiveInterpretation.state,
      conversationPatch: conversationPatchFromState(effectiveInterpretation.state),
      plan,
      reply: renderBookingV2Response({
        plan,
        draft: effectiveInterpretation.state.draft,
        catalog,
        availabilityOptions,
        unavailableDate,
        ...(renderContext?.serviceSuggestions
          ? { serviceSuggestions: renderContext.serviceSuggestions }
          : {})
      }),
      availabilityOptions,
      extraction,
      outcome
    }
  }

  private async resolveExpectedTime(
    message: string,
    state: BookingV2State,
    catalog: BookingV2DomainCatalog
  ) {
    if (nextMissingField(state.draft) !== 'time') return null
    if (!state.draft.service || !state.draft.date) return null

    const requestedTime = parseTime(message)
    if (!requestedTime) return null

    const availability = await this.domain.findAvailabilityOptions({
      catalog,
      serviceId: state.draft.service,
      professionalId: state.draft.professional,
      date: state.draft.date
    })

    if (!availability.ok) return null
    const candidateTimes = [requestedTime]
    const requestedHour = Number(requestedTime.slice(0, 2))
    if (requestedHour >= 1 && requestedHour <= 11) {
      candidateTimes.push(`${String(requestedHour + 12).padStart(2, '0')}${requestedTime.slice(2)}`)
    }

    return candidateTimes
      .map((time) => availability.options.find((option) => option.time === time))
      .find((option) => option !== undefined) ?? null
  }
}

function readConfirmation(message: string): 'yes' | 'no' | null {
  const normalized = normalize(message)
  if ([
    'si',
    'sí',
    'dale',
    'ok',
    'okay',
    'correcto',
    'confirmo',
    'esta bien',
    'está bien',
    'exacto'
  ].includes(normalized)) {
    return 'yes'
  }

  if ([
    'no',
    'nop',
    'no gracias',
    'negativo',
    'cancelalo',
    'cancela',
    'cancelar',
    'mejor no'
  ].includes(normalized)) {
    return 'no'
  }

  return null
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
}

function resolveExpectedProfessional(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft) !== 'professional') return null

  const selectedService = state.draft.service
  const normalizedMessage = normalize(message)
    .replace(/^(?:con|quiero con|prefiero|elijo a|con la|con el)\s+/, '')
  if ([
    'cualquier profesional',
    'cualquiera',
    'sin preferencia',
    'me da igual',
    'el que este disponible',
    'la que este disponible'
  ].includes(normalizedMessage)) {
    return ANY_PROFESSIONAL_ID
  }

  const matches = catalog.professionals.filter((professional) =>
    normalize(professional.name) === normalizedMessage &&
    (!selectedService || professional.serviceIds.includes(selectedService))
  )

  return matches.length === 1 ? matches[0]?.id ?? null : null
}

function resolveExpectedService(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft) !== 'service') return null
  const signature = selectionSignature(message)
  if (!signature) return null

  const exactMatches = catalog.services.filter((service) =>
    [service.name, ...service.aliases].some((label) => selectionSignature(label) === signature)
  )
  if (exactMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: exactMatches[0]?.id ?? ''
    }
  }

  const requestedTokens = new Set(signature.split(' '))
  const partialMatches = catalog.services.filter((service) =>
    [service.name, ...service.aliases].some((label) => {
      const labelTokens = new Set(selectionSignature(label).split(' '))
      return Array.from(requestedTokens).every((token) => labelTokens.has(token))
    })
  )

  if (partialMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: partialMatches[0]?.id ?? ''
    }
  }
  if (partialMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      serviceIds: partialMatches.map((service) => service.id)
    }
  }
  return null
}

function resolveExpectedDate(message: string, state: BookingV2State, currentDate: Date) {
  if (nextMissingField(state.draft) !== 'date') return null
  const normalized = normalize(message)
  if (normalized !== 'hoy' && normalized !== 'manana') return null

  const date = dateInTimeZone(currentDate, 'America/Buenos_Aires')
  if (normalized === 'manana') date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function selectionSignature(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token && !['y', 'de', 'del', 'el', 'la'].includes(token))
    .sort()
    .join(' ')
}

function dateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return new Date(Date.UTC(read('year'), read('month') - 1, read('day')))
}

function parseTime(message: string) {
  const normalized = normalize(message)
  const compactMatch = /(?:^|\s)(\d{3,4})(?:\s*(?:h|hs|hrs|horas))?(?:\s|$)/.exec(normalized)
  if (compactMatch?.[1]) {
    const compact = compactMatch[1].padStart(4, '0')
    const hour = Number(compact.slice(0, 2))
    const minute = Number(compact.slice(2))
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${compact.slice(0, 2)}:${compact.slice(2)}`
    }
  }

  const match = /(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(?:h|hs|hrs|horas)?(?:\s|$)/.exec(normalized)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function isTimeChangeRequest(message: string) {
  const normalized = normalize(message)
  return [
    'cambiar la hora',
    'cambiar el horario',
    'cambio la hora',
    'cambio el horario',
    'modificar la hora',
    'modificar el horario',
    'otra hora',
    'otro horario'
  ].some((phrase) => normalized.includes(phrase))
}

function shouldValidateAvailability(plan: BookingV2MessagePlan) {
  return plan.type === 'confirm_booking' ||
    (plan.type === 'ask_field' && plan.field === 'time') ||
    (plan.type === 'confirm_field' && plan.field === 'time')
}

function timeToValidate(plan: BookingV2MessagePlan, state: BookingV2State) {
  if (plan.type === 'confirm_booking') return state.draft.time
  if (plan.type === 'confirm_field' && plan.field === 'time') return plan.value
  return null
}
