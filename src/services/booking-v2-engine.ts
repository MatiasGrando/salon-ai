import { BookingV2DomainService } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption, BookingV2DomainCatalog } from './booking-v2-domain.js'
import { BookingV2Extractor, type BookingV2Extraction } from './booking-v2-extractor.js'
import { buildBookingV2MessagePlan, type BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { renderBookingV2Response } from './booking-v2-response-renderer.js'
import { applyBookingV2Extraction, type BookingV2Interpretation } from './booking-v2-interpreter.js'
import {
  BookingV2ServiceValidationClassifier,
  type ServiceValidationClassification
} from './booking-v2-service-validation.js'
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
type BookingV2ServiceValidationPort = {
  classify(input: {
    message: string
    serviceName: string
    validationMessage: string
    validationQuestion: string
  }): Promise<ServiceValidationClassification>
}

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
    private readonly extractor: BookingV2ExtractorPort = new BookingV2Extractor(),
    private readonly serviceValidationClassifier: BookingV2ServiceValidationPort =
      new BookingV2ServiceValidationClassifier()
  ) {}

  async process(input: BookingV2ProcessInput): Promise<BookingV2ProcessResult> {
    const storedState = stateFromConversation(input.conversation)
    const catalog = await this.domain.loadCatalog(input.businessId)
    const initialState = sanitizeCatalogNameCollision(storedState, catalog)

    if (initialState.serviceValidation?.stage === 'awaiting_confirmation') {
      const service = catalog.services.find((option) =>
        option.id === initialState.serviceValidation?.serviceId &&
        option.validationEnabled
      )
      if (service) {
        const alternative = resolveCatalogServiceSelection(input.message, catalog)
        if (
          alternative?.kind === 'selected' &&
          alternative.serviceId !== service.id
        ) {
          const state = acceptField(initialState, 'service', alternative.serviceId)
          return this.fromInterpretation({
            state,
            nextField: nextMissingField(state.draft),
            outcome: 'accepted',
            affectedField: 'service'
          }, null, catalog)
        }

        const classification = await this.serviceValidationClassifier.classify({
          message: input.message,
          serviceName: service.name,
          validationMessage: service.validationMessage?.trim() ?? '',
          validationQuestion: service.validationQuestion?.trim() ?? ''
        })
        if (classification.confidence >= 0.7 && classification.decision === 'confirm') {
          const state: BookingV2State = {
            ...initialState,
            serviceValidation: {
              serviceId: service.id,
              stage: 'completed'
            },
            misunderstandingCount: 0
          }
          return this.fromInterpretation({
            state,
            nextField: nextMissingField(state.draft),
            outcome: 'accepted',
            affectedField: 'service'
          }, null, catalog)
        }
        if (classification.confidence >= 0.7 && classification.decision === 'reject') {
          const state: BookingV2State = {
            ...initialState,
            draft: clearFieldAndDependents(initialState.draft, 'service'),
            pendingProposal: null,
            serviceValidation: null,
            guidedEstimate: null,
            advisorQuote: null,
            pendingDeposit: null,
            misunderstandingCount: 0
          }
          return this.fromInterpretation({
            state,
            nextField: 'service',
            outcome: 'no_change',
            affectedField: 'service'
          }, null, catalog)
        }
        if (classification.confidence >= 0.7 && classification.decision === 'uncertain') {
          return this.guidedEstimateResult(initialState, {
            type: 'handoff',
            reason: 'service_validation_uncertain'
          }, catalog, 'accepted')
        }
        return this.guidedEstimateResult(initialState, {
          type: 'ask_service_validation',
          reason: 'not_understood'
        }, catalog, 'no_change')
      }
    }

    if (initialState.guidedEstimate) {
      const service = catalog.services.find((option) =>
        option.id === initialState.guidedEstimate?.serviceId &&
        option.attentionMode === 'GUIDED_ESTIMATE'
      )
      if (service && initialState.guidedEstimate.stage === 'awaiting_option') {
        const option = resolveEstimateOption(input.message, service.estimateOptions ?? [])
        if (!option) {
          return this.guidedEstimateResult(initialState, {
            type: 'ask_estimate_option',
            reason: 'not_understood'
          }, catalog, 'no_change')
        }
        const state: BookingV2State = {
          ...initialState,
          guidedEstimate: {
            serviceId: service.id,
            stage: 'awaiting_decision',
            optionId: option.id,
            optionLabel: option.label,
            priceMin: option.priceMin,
            priceMax: option.priceMax
          },
          misunderstandingCount: 0
        }
        return this.guidedEstimateResult(state, {
          type: 'show_estimate',
          optionLabel: option.label,
          priceMin: option.priceMin,
          priceMax: option.priceMax,
          note: option.note,
          allowsBooking: service.estimateAllowsBooking !== false
        }, catalog, 'accepted')
      }
      if (service && initialState.guidedEstimate.stage === 'awaiting_decision') {
        if (isExactQuoteRequest(input.message, service.estimateAllowsBooking !== false)) {
          return this.guidedEstimateResult(initialState, {
            type: 'handoff',
            reason: service.requiresPhoto ? 'photo_required' : 'estimate_quote_requested'
          }, catalog, 'accepted')
        }
        if (service.estimateAllowsBooking !== false && isContinueBookingRequest(input.message)) {
          const state: BookingV2State = {
            ...initialState,
            guidedEstimate: {
              ...initialState.guidedEstimate,
              stage: 'completed'
            },
            misunderstandingCount: 0
          }
          return this.fromInterpretation({
            state,
            nextField: nextMissingField(state.draft),
            outcome: 'accepted',
            affectedField: null
          }, null, catalog)
        }
        return this.guidedEstimateResult(initialState, {
          type: 'ask_estimate_decision',
          allowsBooking: service.estimateAllowsBooking !== false
        }, catalog, 'no_change')
      }
    }

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

    const deterministicName = resolveExpectedName(input.message, initialState, catalog)
    if (deterministicName) {
      const state = acceptField(initialState, 'name', deterministicName)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'name'
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
    const rawExtraction = await this.extractor.extract({
      message: input.message,
      draft: initialState.draft,
      expectedField: nextMissingField(initialState.draft),
      services: extractionCatalog.services,
      professionals: extractionCatalog.professionals,
      ...(input.currentDate ? { currentDate: input.currentDate } : {})
    })

    if (!rawExtraction) {
      return this.fromInterpretation({
        state: initialState,
        nextField: nextMissingField(initialState.draft),
        outcome: 'no_change',
        affectedField: null
      }, null, catalog)
    }
    const extraction = discardUngroundedCatalogSelections(
      rawExtraction,
      input.message,
      catalog
    )

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
    const catalog = await this.domain.loadCatalog(input.businessId)
    const state = sanitizeCatalogNameCollision(
      stateFromConversation(input.conversation),
      catalog
    )
    const validationService = state.serviceValidation
      ? catalog.services.find((service) =>
          service.id === state.serviceValidation?.serviceId &&
          service.validationEnabled
        )
      : null
    if (validationService && state.serviceValidation?.stage === 'awaiting_confirmation') {
      return this.guidedEstimateResult(state, {
        type: 'ask_service_validation',
        reason: 'missing'
      }, catalog, 'no_change')
    }
    const guidedService = state.guidedEstimate
      ? catalog.services.find((service) =>
          service.id === state.guidedEstimate?.serviceId &&
          service.attentionMode === 'GUIDED_ESTIMATE'
        )
      : null
    if (guidedService && state.guidedEstimate?.stage === 'awaiting_option') {
      return this.guidedEstimateResult(state, {
        type: 'ask_estimate_option',
        reason: 'missing'
      }, catalog, 'no_change')
    }
    if (guidedService && state.guidedEstimate?.stage === 'awaiting_decision') {
      return this.guidedEstimateResult(state, {
        type: 'ask_estimate_decision',
        allowsBooking: guidedService.estimateAllowsBooking !== false
      }, catalog, 'no_change')
    }

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

    const selectedService = catalog?.services.find(
      (service) => service.id === effectiveInterpretation.state.draft.service
    )
    const hasAcceptedAdvisorQuote = Boolean(
      selectedService &&
      effectiveInterpretation.state.advisorQuote?.serviceId === selectedService.id &&
      effectiveInterpretation.state.advisorQuote.status === 'accepted'
    )
    if (
      selectedService?.validationEnabled &&
      (
        effectiveInterpretation.state.serviceValidation?.serviceId !== selectedService.id ||
        effectiveInterpretation.state.serviceValidation.stage !== 'completed'
      )
    ) {
      effectiveInterpretation = {
        ...effectiveInterpretation,
        state: {
          ...effectiveInterpretation.state,
          serviceValidation: {
            serviceId: selectedService.id,
            stage: 'awaiting_confirmation'
          }
        }
      }
      plan = {
        type: 'ask_service_validation',
        reason: 'missing'
      }
    } else if (selectedService?.attentionMode === 'GUIDED_ESTIMATE') {
      if (
        effectiveInterpretation.state.guidedEstimate?.serviceId !== selectedService.id ||
        effectiveInterpretation.state.guidedEstimate.stage !== 'completed'
      ) {
        effectiveInterpretation = {
          ...effectiveInterpretation,
          state: {
            ...effectiveInterpretation.state,
            guidedEstimate: {
              serviceId: selectedService.id,
              stage: 'awaiting_option',
              optionId: null,
              optionLabel: null,
              priceMin: null,
              priceMax: null
            }
          }
        }
        plan = {
          type: 'ask_estimate_option',
          reason: 'missing'
        }
      }
    } else if (
      selectedService &&
      !hasAcceptedAdvisorQuote &&
      (selectedService.requiresPhoto || (
        selectedService.attentionMode !== undefined &&
        selectedService.attentionMode !== 'DIRECT_BOOKING'
      ))
    ) {
      plan = {
        type: 'handoff',
        reason: selectedService.requiresPhoto
          ? 'photo_required'
          : selectedService.attentionMode === 'QUOTE'
            ? 'quote_required'
            : 'advisor_required'
      }
    }

    if (
      catalog &&
      plan.type === 'ask_field' &&
      plan.field === 'professional' &&
      effectiveInterpretation.state.draft.service &&
      !catalog.professionals.some((professional) =>
        professional.serviceIds.includes(effectiveInterpretation.state.draft.service ?? '')
      )
    ) {
      plan = {
        type: 'handoff',
        reason: 'no_compatible_professional'
      }
    }

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

  private guidedEstimateResult(
    state: BookingV2State,
    plan: BookingV2MessagePlan,
    catalog: BookingV2DomainCatalog,
    outcome: BookingV2ProcessResult['outcome']
  ): BookingV2ProcessResult {
    return {
      state,
      conversationPatch: conversationPatchFromState(state),
      plan,
      reply: renderBookingV2Response({
        plan,
        draft: state.draft,
        catalog,
        availabilityOptions: []
      }),
      availabilityOptions: [],
      extraction: null,
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

function resolveExpectedName(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft) !== 'name') return null

  const candidate = message.trim().replace(/\s+/g, ' ')
  if (
    candidate.length < 2 ||
    candidate.length > 60 ||
    !/^\p{Letter}+(?:[ '-]\p{Letter}+){0,2}$/u.test(candidate)
  ) {
    return null
  }

  const rejectedTokens = new Set([
    'agendar',
    'buen',
    'buenas',
    'cancelar',
    'color',
    'como',
    'corte',
    'cualquiera',
    'cuando',
    'dia',
    'direccion',
    'domingo',
    'es',
    'gracias',
    'hola',
    'horario',
    'horarios',
    'hoy',
    'jueves',
    'llamo',
    'lunes',
    'manana',
    'martes',
    'me',
    'mi',
    'miercoles',
    'necesito',
    'ninguno',
    'nombre',
    'pagina',
    'precio',
    'profesional',
    'profesionales',
    'quiero',
    'reset',
    'reservar',
    'reserva',
    'sabado',
    'servicio',
    'servicios',
    'soy',
    'tarde',
    'tal',
    'total',
    'turno',
    'ubicacion',
    'web',
    'viernes'
  ])
  const tokens = normalize(candidate).split(' ')
  if (tokens.some((token) => rejectedTokens.has(token))) return null
  if (['no', 'si', 'todo bien', 'no se', 'por favor'].includes(normalize(candidate))) {
    return null
  }
  if (nameCollidesWithCatalog(candidate, catalog)) return null

  return candidate
    .split(' ')
    .map((part) => part
      .split(/([-'])/)
      .map((segment) => (
        segment === '-' || segment === "'"
          ? segment
          : segment.charAt(0).toLocaleUpperCase('es-AR') +
            segment.slice(1).toLocaleLowerCase('es-AR')
      ))
      .join(''))
    .join(' ')
}

function resolveExpectedProfessional(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft) !== 'professional') return null

  const selectedService = state.draft.service
  const compatibleProfessionals = catalog.professionals.filter((professional) =>
    !selectedService || professional.serviceIds.includes(selectedService)
  )
  if (compatibleProfessionals.length === 0) return null

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

  const matches = compatibleProfessionals.filter((professional) =>
    normalize(professional.name) === normalizedMessage
  )

  return matches.length === 1 ? matches[0]?.id ?? null : null
}

function resolveExpectedService(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft) !== 'service') return null
  return resolveCatalogServiceSelection(message, catalog)
}

function resolveCatalogServiceSelection(
  message: string,
  catalog: BookingV2DomainCatalog
) {
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

  const normalizedMessage = ` ${normalize(message)} `
  const embeddedMatches = catalog.services.filter((service) =>
    [service.name, ...service.aliases].some((label) => {
      const normalizedLabel = normalize(label)
      return normalizedLabel.length >= 3 &&
        normalizedMessage.includes(` ${normalizedLabel} `)
    })
  )
  if (embeddedMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: embeddedMatches[0]?.id ?? ''
    }
  }
  if (embeddedMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      serviceIds: embeddedMatches.map((service) => service.id)
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

function discardUngroundedCatalogSelections(
  extraction: BookingV2Extraction,
  message: string,
  catalog: BookingV2DomainCatalog
): BookingV2Extraction {
  const groundedName = !extraction.name.value ||
    !nameCollidesWithCatalog(extraction.name.value, catalog)
  const groundedService = !extraction.service.value || catalog.services.some((service) =>
    service.id === extraction.service.value &&
    [service.name, ...service.aliases].some((label) => messageGroundsLabel(message, label))
  )
  const groundedProfessional =
    !extraction.professional.value ||
    catalog.professionals.some((professional) =>
      professional.id === extraction.professional.value &&
      messageGroundsLabel(message, professional.name)
    )
  const groundedCorrection = !extraction.correction.newValue ||
    extraction.correction.field === null ||
    !['service', 'professional'].includes(extraction.correction.field) ||
    (
      extraction.correction.field === 'service'
        ? catalog.services.some((service) =>
            service.id === extraction.correction.newValue &&
            [service.name, ...service.aliases].some((label) =>
              messageGroundsLabel(message, label)
            )
          )
        : catalog.professionals.some((professional) =>
            professional.id === extraction.correction.newValue &&
            messageGroundsLabel(message, professional.name)
          )
    )

  return {
    ...extraction,
    name: groundedName
      ? extraction.name
      : { value: null, confidence: 0, evidence: '' },
    service: groundedService
      ? extraction.service
      : { value: null, confidence: 0, evidence: '' },
    professional: groundedProfessional
      ? extraction.professional
      : { value: null, confidence: 0, evidence: '' },
    correction: groundedCorrection
      ? extraction.correction
      : { ...extraction.correction, newValue: null }
  }
}

function sanitizeCatalogNameCollision(
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
): BookingV2State {
  if (!state.draft.name || !nameCollidesWithCatalog(state.draft.name, catalog)) {
    return state
  }

  return {
    ...state,
    draft: {
      ...state.draft,
      name: null
    },
    pendingProposal: state.pendingProposal?.field === 'name'
      ? null
      : state.pendingProposal
  }
}

function nameCollidesWithCatalog(value: string, catalog: BookingV2DomainCatalog) {
  const normalizedValue = normalize(value)
  if (!normalizedValue) return false

  return catalog.services.some((service) =>
    [
      service.name,
      ...service.aliases,
      service.category,
      service.parentServiceName
    ].some((label) => typeof label === 'string' && normalize(label) === normalizedValue)
  )
}

function messageGroundsLabel(message: string, label: string) {
  const ignoredTokens = new Set(['de', 'del', 'el', 'la', 'los', 'las', 'y'])
  const messageTokens = normalize(message).split(' ').filter(Boolean)
  const labelTokens = normalize(label)
    .split(' ')
    .filter((token) => token.length >= 3 && !ignoredTokens.has(token))

  return labelTokens.some((labelToken) =>
    messageTokens.some((messageToken) =>
      labelToken === messageToken ||
      commonPrefixLength(labelToken, messageToken) >= 4
    )
  )
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let length = 0
  while (length < limit && left[length] === right[length]) length += 1
  return length
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

function resolveEstimateOption(
  message: string,
  options: NonNullable<BookingV2DomainCatalog['services'][number]['estimateOptions']>
) {
  const normalized = normalize(message)
  const numericMatch = /^(?:opcion\s*)?(\d{1,2})$/.exec(normalized)
  if (numericMatch?.[1]) {
    return options[Number(numericMatch[1]) - 1] ?? null
  }
  const exact = options.filter((option) => normalize(option.label) === normalized)
  if (exact.length === 1) return exact[0] ?? null
  const embedded = options.filter((option) =>
    normalized.includes(normalize(option.label)) ||
    normalize(option.label).includes(normalized)
  )
  return embedded.length === 1 ? embedded[0] ?? null : null
}

function isExactQuoteRequest(message: string, allowsBooking: boolean) {
  const normalized = normalize(message)
  if (!allowsBooking && ['si', 'dale', 'ok', 'quiero', 'por favor'].includes(normalized)) return true
  return [
    'presupuesto',
    'presupuesto exacto',
    'cotizacion',
    'cotizar',
    'que lo vea',
    'que me lo vean',
    'hablar con alguien',
    'hablar con una persona',
    'prefiero presupuesto'
  ].some((phrase) => normalized.includes(phrase))
}

function isContinueBookingRequest(message: string) {
  const normalized = normalize(message)
  return [
    'reservar',
    'reserva',
    'quiero reservar',
    'seguir con la reserva',
    'continuar con la reserva',
    'sacar turno',
    'quiero un turno'
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
