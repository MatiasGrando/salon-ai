import {
  BookingV2DomainService,
  catalogCategoryOptions,
  catalogServicesForCategory,
  combinationRuleFor
} from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption, BookingV2DomainCatalog } from './booking-v2-domain.js'
import { BookingV2Extractor, type BookingV2Extraction } from './booking-v2-extractor.js'
import { buildBookingV2MessagePlan, type BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { renderBookingV2Response } from './booking-v2-response-renderer.js'
import {
  queueRemainingServices,
  restartServiceConsultationQueue
} from './service-consultation-queue.js'
import { applyBookingV2Extraction, type BookingV2Interpretation } from './booking-v2-interpreter.js'
import {
  BookingV2ServiceValidationClassifier,
  type ServiceValidationClassification
} from './booking-v2-service-validation.js'
import {
  BookingV2EstimateDecisionExtractor,
  type EstimateDecisionExtraction
} from './booking-v2-estimate-decision-extractor.js'
import {
  BookingV2EstimateOptionExtractor,
  type EstimateOptionExtraction
} from './booking-v2-estimate-option-extractor.js'
import {
  BookingV2ChoiceExtractor,
  type BookingV2ChoiceExtraction
} from './booking-v2-choice-extractor.js'
import {
  ANY_PROFESSIONAL_ID,
  addCombinedServices,
  acceptField,
  clearFieldAndDependents,
  confirmProposal,
  createEmptyBookingV2State,
  combinedServiceIds,
  nextMissingField,
  proposeField,
  queueAdditionalServices,
  recordLowConfidence,
  rejectProposal,
  type BookingField,
  type BookingV2PendingServiceDisambiguation,
  type BookingV2PendingCoordinatedAvailability,
  type BookingV2CoordinatedTimeBand,
  type BookingV2ServiceDisambiguationGroup,
  type BookingV2State
} from './booking-v2-state.js'
import {
  conversationPatchFromState,
  stateFromConversation,
  type BookingV2ConversationPatch,
  type BookingV2ConversationSnapshot
} from './booking-v2-conversation-state.js'
import {
  detectContextualServiceCatalogPresentationIntent,
  isAmbiguousCatalogAffirmation
} from './service-catalog-presentation-intent.js'
import {
  applyBookingAvailabilityTransition,
  bookingAvailabilityResolutionPlan,
  pendingAvailabilityResolution,
  resolveBookingAvailability,
} from './booking-availability-resolution.js'
import { detectDeterministicConfirmation } from './conversation-confirmation-intent.js'
import {
  bookingCoordinationActionableReply,
  detectBookingCoordinationChoice,
  optionFitsTimeWindow,
  timeBelongsToBand
} from './booking-coordination-choice.js'
import type {
  BookingAvailabilitySearchOption,
  BookingAvailabilitySearchResult
} from './booking-availability-search.js'

type BookingV2DomainPort = Pick<
  BookingV2DomainService,
  'loadCatalog' | 'toExtractionCatalog' | 'toInterpreterCatalog' | 'findAvailabilityOptions'
> & Partial<Pick<BookingV2DomainService, 'findNextAvailabilityOptions' | 'searchAvailability'>>

type BookingV2ExtractorPort = Pick<BookingV2Extractor, 'extract'>
type BookingV2ServiceValidationPort = {
  classify(input: {
    message: string
    serviceName: string
    validationMessage: string
    validationQuestion: string
  }): Promise<ServiceValidationClassification>
}
type BookingV2EstimateDecisionPort = {
  extract(input: {
    message: string
    serviceName: string
    allowsBooking: boolean
    requiresPhoto: boolean
  }): Promise<EstimateDecisionExtraction>
}
type BookingV2EstimateOptionPort = {
  extract(input: {
    message: string
    serviceName: string
    options: Array<{ id: string; label: string; note: string | null }>
  }): Promise<EstimateOptionExtraction>
}
type BookingV2ChoicePort = {
  extract(input: {
    message: string
    question: string
    choices: Array<{ id: string; meaning: string }>
  }): Promise<BookingV2ChoiceExtraction>
}

export type BookingV2ProcessInput = {
  businessId: string
  conversation: BookingV2ConversationSnapshot | null
  message: string
  currentDate?: Date
  understandingExtraction?: BookingV2Extraction | null
}

export type BookingV2ProcessResult = {
  state: BookingV2State
  conversationPatch: BookingV2ConversationPatch
  plan: BookingV2MessagePlan
  reply: string
  messages?: string[]
  availabilityOptions: BookingV2AvailabilityOption[]
  extraction: BookingV2Extraction | null
  outcome: BookingV2Interpretation['outcome'] | 'proposal_confirmed' | 'proposal_rejected'
}

export class BookingV2Engine {
  constructor(
    private readonly domain: BookingV2DomainPort = new BookingV2DomainService(),
    private readonly extractor: BookingV2ExtractorPort = new BookingV2Extractor(),
    private readonly serviceValidationClassifier: BookingV2ServiceValidationPort =
      new BookingV2ServiceValidationClassifier(),
    private readonly estimateDecisionExtractor: BookingV2EstimateDecisionPort =
      new BookingV2EstimateDecisionExtractor(),
    private readonly estimateOptionExtractor: BookingV2EstimateOptionPort =
      new BookingV2EstimateOptionExtractor(),
    private readonly choiceExtractor: BookingV2ChoicePort =
      new BookingV2ChoiceExtractor()
  ) {}

  async hasMultipleServiceConsultation(input: { businessId: string; message: string }) {
    const catalog = await this.domain.loadCatalog(input.businessId)
    return resolveExplicitServiceGroups(input.message, catalog).length >= 2
  }

  async process(input: BookingV2ProcessInput): Promise<BookingV2ProcessResult> {
    const storedState = stateFromConversation(input.conversation)
    const catalog = await this.domain.loadCatalog(input.businessId)
    const sanitizedState = sanitizeCatalogNameCollision(storedState, catalog)
    const actionableMessage = bookingCoordinationActionableReply(input.message)
    if (actionableMessage !== input.message) {
      input = { ...input, message: actionableMessage }
    }
    const catalogPresentationIntent = detectContextualServiceCatalogPresentationIntent(input.message)
    const initialState: BookingV2State =
      catalog.displayMode === 'CATEGORIES_FIRST' && !sanitizedState.draft.service
        ? {
            ...sanitizedState,
            ...(catalogPresentationIntent ? { unsupportedServiceRequest: null } : {}),
            catalogNavigation: catalogPresentationIntent === 'show_all'
              ? {
                  view: 'ALL_SERVICES',
                  categoryKey: null,
                  categoryName: null,
                  pendingCategoryKey: null,
                  pendingCategoryName: null
                }
              : catalogPresentationIntent === 'show_categories' ||
                  catalogPresentationIntent === 'use_business_default'
                ? null
                : sanitizedState.catalogNavigation
          }
          : catalogPresentationIntent
            ? { ...sanitizedState, unsupportedServiceRequest: null }
            : sanitizedState

    if (initialState.pendingCoordinatedAvailability) {
      return this.handlePendingCoordinatedAvailability({
        input,
        state: initialState,
        catalog
      })
    }

    if (initialState.pendingServiceSeparation) {
      const pending = initialState.pendingServiceSeparation
      const selectedServiceIds = combinedServiceIds(initialState)

      if (pending.edit?.action === 'menu') {
        const normalizedMessage = normalize(input.message)
        const deterministicMenuChoice = /\b(?:cambiar|reemplazar)\b/.test(normalizedMessage)
          ? 'change'
          : /\b(?:quitar|sacar|eliminar)\b/.test(normalizedMessage)
            ? 'remove'
            : /\b(?:empezar|arrancar|reiniciar|volver)\b.*\b(?:nuevo|cero|principio)\b/.test(normalizedMessage)
              ? 'restart'
              : null
        const menuChoice = deterministicMenuChoice
          ? { choiceId: deterministicMenuChoice, confidence: 1 }
          : await this.choiceExtractor.extract({
              message: input.message,
              question: '¿Quiere cambiar un servicio, quitarlo o empezar nuevamente la reserva?',
              choices: [
                { id: 'change', meaning: 'Cambiar o reemplazar uno de los servicios elegidos.' },
                { id: 'remove', meaning: 'Quitar uno de los servicios elegidos.' },
                { id: 'restart', meaning: 'Borrar la selección y empezar nuevamente la reserva.' }
              ]
            })
        if (menuChoice.confidence >= 0.7 && menuChoice.choiceId === 'restart') {
          let state = createEmptyBookingV2State()
          if (initialState.draft.name) state = acceptField(state, 'name', initialState.draft.name)
          return this.fromInterpretation({
            state,
            nextField: 'service',
            outcome: 'accepted',
            affectedField: 'service'
          }, null, catalog)
        }
        if (
          menuChoice.confidence >= 0.7 &&
          (menuChoice.choiceId === 'change' || menuChoice.choiceId === 'remove')
        ) {
          const action = menuChoice.choiceId
          const state: BookingV2State = {
            ...initialState,
            pendingServiceSeparation: {
              reason: pending.reason,
              edit: { action, serviceIds: null }
            },
            misunderstandingCount: 0
          }
          return this.guidedEstimateResult(state, {
            type: 'ask_service_edit_target',
            action,
            serviceIds: selectedServiceIds
          }, catalog, 'accepted')
        }
        return this.guidedEstimateResult(initialState, {
          type: 'show_service_modification_menu'
        }, catalog, 'no_change')
      }

      if (pending.edit?.serviceIds?.length) {
        const deterministicDecision = explicitConfirmationChoice(input.message)
        const decision = deterministicDecision
          ? { choiceId: deterministicDecision, confidence: 1 }
          : await this.choiceExtractor.extract({
              message: input.message,
              question: pending.edit.action === 'change'
                ? '¿Confirma que quiere cambiar los servicios indicados?'
                : '¿Confirma que quiere quitar los servicios indicados de la reserva?',
              choices: [
                { id: 'confirm_edit', meaning: 'Confirma la modificación solicitada.' },
                { id: 'cancel_edit', meaning: 'No confirma; quiere conservar los servicios actuales.' }
              ]
            })
        if (decision.confidence >= 0.7 && decision.choiceId === 'cancel_edit') {
          const state: BookingV2State = {
            ...initialState,
            pendingServiceSeparation: { reason: pending.reason },
            misunderstandingCount: 0
          }
          return this.guidedEstimateResult(state, {
            type: 'offer_separate_services',
            reason: pending.reason
          }, catalog, 'proposal_rejected')
        }
        if (decision.confidence >= 0.7 && decision.choiceId === 'confirm_edit') {
          const state = applyConfirmedServiceEdit(
            initialState,
            pending.edit.action,
            pending.edit.serviceIds
          )
          if (pending.edit.action === 'change' && state.draft.service) {
            const replacementState: BookingV2State = {
              ...state,
              pendingServiceReplacement: { removedServiceIds: pending.edit.serviceIds }
            }
            return this.guidedEstimateResult(
              replacementState,
              {
                type: 'ask_service_replacement',
                selectedServiceIds: combinedServiceIds(replacementState)
              },
              catalog,
              'proposal_confirmed'
            )
          }
          return this.fromInterpretation({
            state,
            nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
            outcome: 'accepted',
            affectedField: 'service'
          }, null, catalog)
        }
        const state = {
          ...initialState,
          misunderstandingCount: initialState.misunderstandingCount + 1
        }
        return state.misunderstandingCount >= 3
          ? this.guidedEstimateResult(state, {
              type: 'handoff',
              reason: 'repeated_misunderstanding'
            }, catalog, 'no_change')
          : this.guidedEstimateResult(state, {
              type: 'confirm_service_edit',
              action: pending.edit.action,
              serviceIds: pending.edit.serviceIds
            }, catalog, 'no_change')
      }

      const deterministicChoice = pendingServiceChoiceFromMessage({
        message: input.message,
        catalog,
        selectedServiceIds,
        ...(pending.edit?.action === 'change' || pending.edit?.action === 'remove'
          ? { actionHint: pending.edit.action }
          : {})
      }) ?? (!pending.edit?.action
        ? serviceSeparationConfirmationChoice(input.message)
        : null)
      const choices = pending.edit?.action
        ? serviceTargetChoices(pending.edit.action, selectedServiceIds, catalog)
        : [
            { id: 'separate', meaning: 'Buscar y reservar cada servicio por separado.' },
            { id: 'review_together', meaning: 'Mantener el pedido conjunto y pedir que lo revise una persona del equipo.' },
            { id: 'change_services', meaning: 'Cambiar o reemplazar uno o todos los servicios elegidos.' },
            { id: 'remove_services', meaning: 'Quitar uno o todos los servicios elegidos sin reemplazarlos.' },
            ...serviceTargetChoices('change', selectedServiceIds, catalog),
            ...serviceTargetChoices('remove', selectedServiceIds, catalog)
          ]
      const choice = deterministicChoice
        ? { choiceId: deterministicChoice, confidence: 1 }
        : await this.choiceExtractor.extract({
            message: input.message,
            question: pending.edit?.action
              ? `¿Cuál de los servicios elegidos quiere ${pending.edit.action === 'change' ? 'cambiar' : 'quitar'}?`
              : '¿Quiere separar, revisar, cambiar o quitar alguno de los servicios elegidos?',
            choices
          })
      if (choice.confidence >= 0.7 && choice.choiceId === 'separate') {
        if (
          pending.reason === 'no_common_professional' &&
          this.domain.searchAvailability
        ) {
          return this.startCoordinatedAvailability({
            state: initialState,
            catalog,
            currentDate: input.currentDate ?? new Date()
          })
        }
        const queuedServices = queueAdditionalServices(
          { ...initialState, queuedServices: [] },
          initialState.combinedServices
        ).queuedServices
        const state: BookingV2State = {
          ...initialState,
          draft: {
            ...initialState.draft,
            professional: null,
            ...(catalog.bookingFlowOrder === 'PROFESSIONAL_FIRST'
              ? { date: null, time: null }
              : {})
          },
          queuedServices,
          combinedServices: [],
          pendingServiceSeparation: null,
          pendingAvailabilityResolution: null,
          addonSuggestion: null,
          addonOfferCompletedServiceId: initialState.draft.service,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }
      if (choice.confidence >= 0.7 && choice.choiceId === 'review_together') {
        return this.guidedEstimateResult({
          ...initialState,
          pendingServiceSeparation: null
        }, {
          type: 'handoff',
          reason: 'combination_review_required'
        }, catalog, 'accepted')
      }
      if (choice.confidence >= 0.7 && choice.choiceId === 'modify_menu') {
        const state: BookingV2State = {
          ...initialState,
          pendingServiceSeparation: {
            reason: pending.reason,
            edit: { action: 'menu', serviceIds: null }
          },
          misunderstandingCount: 0
        }
        return this.guidedEstimateResult(state, {
          type: 'show_service_modification_menu'
        }, catalog, 'accepted')
      }

      const editChoice = parseServiceEditChoice(choice.choiceId, selectedServiceIds)
      if (choice.confidence >= 0.7 && editChoice) {
        const state: BookingV2State = {
          ...initialState,
          pendingServiceSeparation: {
            reason: pending.reason,
            edit: editChoice
          },
          misunderstandingCount: 0
        }
        return this.guidedEstimateResult(state, editChoice.serviceIds
          ? {
              type: 'confirm_service_edit',
              action: editChoice.action,
              serviceIds: editChoice.serviceIds
            }
          : {
              type: 'ask_service_edit_target',
              action: editChoice.action,
              serviceIds: selectedServiceIds
            }, catalog, 'confirmation_required')
      }

      const state = {
        ...initialState,
        misunderstandingCount: initialState.misunderstandingCount + 1
      }
      if (state.misunderstandingCount >= 3) {
        return this.guidedEstimateResult(state, {
          type: 'handoff',
          reason: 'repeated_misunderstanding'
        }, catalog, 'no_change')
      }
      return this.guidedEstimateResult(state, {
        type: 'offer_separate_services',
        reason: pending.reason
      }, catalog, 'no_change')
    }

    if (initialState.pendingServiceReplacement) {
      const selectedServiceIds = combinedServiceIds(initialState)
      const selection = resolveCatalogServiceSelection(input.message, catalog)
      if (
        selection?.kind === 'selected' &&
        !selectedServiceIds.includes(selection.serviceId)
      ) {
        let state = initialState.draft.service
          ? addCombinedServices(initialState, [{
              serviceId: selection.serviceId,
              evidence: input.message.trim()
            }])
          : acceptField(initialState, 'service', selection.serviceId)
        state = {
          ...state,
          pendingServiceReplacement: null,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }

      const state = {
        ...initialState,
        misunderstandingCount: initialState.misunderstandingCount + 1
      }
      if (state.misunderstandingCount >= 3) {
        return this.guidedEstimateResult(state, {
          type: 'handoff',
          reason: 'repeated_misunderstanding'
        }, catalog, 'no_change')
      }
      return this.guidedEstimateResult(state, {
        type: 'ask_service_replacement',
        selectedServiceIds
      }, catalog, 'no_change')
    }

    if (initialState.pendingCombinedAvailability) {
      const pending = initialState.pendingCombinedAvailability
      const choice = await this.choiceExtractor.extract({
        message: input.message,
        question: '¿Preferís una de las próximas disponibilidades conjuntas o buscar cada servicio por separado?',
        choices: [
          ...pending.options.map((option, index) => ({
            id: `joint:${index}`,
            meaning: `Reservar todos los servicios juntos el ${option.date} a las ${option.time} con ${option.professionalName}.`
          })),
          {
            id: 'separate',
            meaning: 'Buscar los servicios por separado, aunque sean distintos días, horarios o turnos.'
          }
        ]
      })
      if (choice.confidence >= 0.7 && choice.choiceId === 'separate') {
        let state: BookingV2State = {
          ...initialState,
          queuedServices: queueAdditionalServices(
            { ...initialState, queuedServices: [] },
            initialState.combinedServices
          ).queuedServices,
          combinedServices: [],
          pendingCombinedAvailability: null,
          pendingAvailabilityResolution: null,
          addonSuggestion: null,
          addonOfferCompletedServiceId: initialState.draft.service,
          draft: {
            ...initialState.draft,
            professional: catalog.bookingFlowOrder === 'PROFESSIONAL_FIRST'
              ? ANY_PROFESSIONAL_ID
              : null,
            date: pending.requestedDate,
            time: null
          },
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'date'
        }, null, catalog)
      }
      const jointIndex = choice.choiceId?.startsWith('joint:')
        ? Number(choice.choiceId.slice('joint:'.length))
        : -1
      const selectedOption = Number.isInteger(jointIndex) ? pending.options[jointIndex] : null
      if (choice.confidence >= 0.7 && selectedOption) {
        let state: BookingV2State = {
          ...initialState,
          pendingCombinedAvailability: null,
          pendingAvailabilityResolution: null,
          misunderstandingCount: 0
        }
        state = acceptField(state, 'professional', selectedOption.professionalId)
        state = acceptField(state, 'date', selectedOption.date)
        state = acceptField(state, 'time', selectedOption.time)
        return this.fromInterpretation({
          state,
          nextField: 'confirmation',
          outcome: 'accepted',
          affectedField: 'time'
        }, null, catalog)
      }
      return this.guidedEstimateResult(initialState, {
        type: 'offer_combined_availability',
        requestedDate: pending.requestedDate,
        options: pending.options
      }, catalog, 'no_change')
    }

    if (initialState.addonSuggestion) {
      const suggestion = initialState.addonSuggestion
      const mentionedServiceIds = selectedAddonIdsFromMessage(
        input.message,
        suggestion.candidateServiceIds,
        catalog,
        input.understandingExtraction
      )
      if (mentionedServiceIds.length) {
        const state = addCombinedServices(initialState, mentionedServiceIds.map((serviceId) => ({
          serviceId,
          evidence: input.message.trim()
        })))
        const result = await this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
        return withMultipleServicesAcknowledgement(result, catalog)
      }
      const deterministicDecision = deterministicAddonDecision(
        input.message,
        suggestion.candidateServiceIds
      )
      if (deterministicDecision.type === 'decline') {
        const state: BookingV2State = {
          ...initialState,
          addonSuggestion: null,
          addonOfferCompletedServiceId: suggestion.sourceServiceId,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }
      if (deterministicDecision.type === 'accept') {
        const state = addCombinedServices(initialState, [{
          serviceId: deterministicDecision.serviceId,
          evidence: input.message.trim()
        }])
        const result = await this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
        return withMultipleServicesAcknowledgement(result, catalog)
      }
      if (deterministicDecision.type === 'ambiguous_affirmation') {
        return this.guidedEstimateResult(initialState, {
          type: 'ask_service_addons',
          serviceIds: suggestion.candidateServiceIds
        }, catalog, 'no_change')
      }
      const choice = await this.choiceExtractor.extract({
        message: input.message,
        question: '¿Querés sumar alguno de los servicios sugeridos o continuar sin extras?',
        choices: [
          ...suggestion.candidateServiceIds.map((serviceId) => ({
            id: `addon:${serviceId}`,
            meaning: `Agregar ${catalog.services.find((service) => service.id === serviceId)?.name ?? serviceId} a la misma reserva.`
          })),
          { id: 'continue', meaning: 'No agregar extras y continuar con la reserva.' }
        ]
      })
      if (choice.confidence >= 0.7 && choice.choiceId === 'continue') {
        const state: BookingV2State = {
          ...initialState,
          addonSuggestion: null,
          addonOfferCompletedServiceId: suggestion.sourceServiceId,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }
      const selectedServiceId = choice.choiceId?.startsWith('addon:')
        ? choice.choiceId.slice('addon:'.length)
        : null
      if (
        choice.confidence >= 0.7 &&
        selectedServiceId &&
        suggestion.candidateServiceIds.includes(selectedServiceId)
      ) {
        const state = addCombinedServices(initialState, [{
          serviceId: selectedServiceId,
          evidence: input.message.trim()
        }])
        const result = await this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
        return withMultipleServicesAcknowledgement(result, catalog)
      }
      return this.guidedEstimateResult(initialState, {
        type: 'ask_service_addons',
        serviceIds: suggestion.candidateServiceIds
      }, catalog, 'no_change')
    }

    if (initialState.categoryAdvice?.stage === 'awaiting_confirmation') {
      const choice = await this.choiceExtractor.extract({
        message: input.message,
        question: `¿Querés hablar con un profesional para elegir un servicio de ${initialState.categoryAdvice.categoryName} o volver a los tratamientos?`,
        choices: [
          { id: 'request_advice', meaning: 'Quiere hablar con un profesional o pedir asesoramiento.' },
          { id: 'back_to_services', meaning: 'Prefiere volver a ver o elegir tratamientos.' }
        ]
      })
      if (choice.confidence >= 0.65 && choice.choiceId === 'request_advice') {
        const categoryName = initialState.categoryAdvice.categoryName
        const state: BookingV2State = {
          ...initialState,
          categoryAdvice: {
            ...initialState.categoryAdvice,
            stage: 'requested'
          },
          misunderstandingCount: 0
        }
        return this.guidedEstimateResult(state, {
          type: 'handoff',
          reason: 'category_advice_requested',
          categoryName
        }, catalog, 'accepted')
      }
      if (choice.confidence >= 0.65 && choice.choiceId === 'back_to_services') {
        const categoryName = initialState.categoryAdvice.categoryName
        const state: BookingV2State = {
          ...initialState,
          categoryAdvice: null,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: 'service',
          outcome: 'no_change',
          affectedField: 'service'
        }, null, catalog, 'no_change', {
          serviceSuggestions: servicesForCategory(catalog, categoryName)
        })
      }
      return this.guidedEstimateResult(initialState, {
        type: 'ask_category_advice_confirmation',
        categoryName: initialState.categoryAdvice.categoryName,
        reason: 'not_understood'
      }, catalog, 'no_change')
    }

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
            nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
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
          let state: BookingV2State = {
            ...initialState,
            serviceValidation: {
              serviceId: service.id,
              stage: 'completed'
            },
            misunderstandingCount: 0
          }
          state = completeCombinedServiceDecision(state, service.id)
          return this.fromInterpretation({
            state,
            nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
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
        if (!(service.estimateOptions?.length) && service.price !== null && service.price > 0) {
          const state: BookingV2State = {
            ...initialState,
            guidedEstimate: {
              serviceId: service.id,
              stage: 'awaiting_decision',
              optionId: null,
              optionLabel: null,
              priceMin: service.price,
              priceMax: null
            },
            misunderstandingCount: 0
          }
          if (state.quoteOnly) {
            return this.completeQuoteOnlyEstimate(state, catalog)
          }
          return this.guidedEstimateResult(state, {
            type: 'show_base_estimate',
            priceMin: service.price,
            allowsBooking: service.estimateAllowsBooking !== false
          }, catalog, 'accepted')
        }
        let option = deterministicEstimateOption(input.message, service.estimateOptions ?? [])
        if (!option) {
          const optionExtraction = await this.estimateOptionExtractor.extract({
            message: input.message,
            serviceName: service.name,
            options: (service.estimateOptions ?? []).map((candidate) => ({
              id: candidate.id,
              label: candidate.label,
              note: candidate.note
            }))
          })
          option = optionExtraction.confidence >= 0.65
            ? service.estimateOptions?.find((candidate) => candidate.id === optionExtraction.optionId) ?? null
            : null
        }
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
        if (state.quoteOnly) {
          return this.completeQuoteOnlyEstimate(state, catalog)
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
        const decision = await this.estimateDecisionExtractor.extract({
          message: input.message,
          serviceName: service.name,
          allowsBooking: service.estimateAllowsBooking !== false,
          requiresPhoto: service.requiresPhoto === true
        })
        if (decision.confidence >= 0.65 && decision.decision === 'request_exact_quote') {
          return this.guidedEstimateResult(initialState, {
            type: 'handoff',
            reason: service.requiresPhoto ? 'photo_required' : 'estimate_quote_requested'
          }, catalog, 'accepted')
        }
        if (
          decision.confidence >= 0.65 &&
          decision.decision === 'continue_booking' &&
          service.estimateAllowsBooking !== false
        ) {
          if (initialState.quoteOnly) {
            return this.completeQuoteOnlyEstimate(initialState, catalog)
          }
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
            nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
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

    if (initialState.pendingProposal) {
      const choice = await this.choiceExtractor.extract({
        message: input.message,
        question: '¿Confirmás la opción propuesta para continuar con la reserva?',
        choices: [
          { id: 'confirm', meaning: 'Acepta o confirma la propuesta.' },
          { id: 'reject', meaning: 'Rechaza la propuesta o quiere elegir otra opción.' }
        ]
      })
      if (choice.confidence >= 0.65 && choice.choiceId === 'confirm') {
        return this.fromState(confirmProposal(initialState), 'proposal_confirmed', null, catalog)
      }
      if (choice.confidence >= 0.65 && choice.choiceId === 'reject') {
        return this.fromState(rejectProposal(initialState), 'proposal_rejected', null, catalog)
      }
      return this.fromInterpretation({
        state: initialState,
        nextField: nextMissingField(initialState.draft, catalog.bookingFlowOrder),
        outcome: 'confirmation_required',
        affectedField: initialState.pendingProposal.field
      }, null, catalog)
    }

    const serviceChoice =
      nextMissingField(initialState.draft, catalog.bookingFlowOrder) === 'service' &&
      initialState.categoryAdvice?.stage === 'offered'
      ? await this.choiceExtractor.extract({
          message: input.message,
          question: '¿El cliente pide ayuda humana porque no sabe qué servicio elegir o está intentando continuar la selección por su cuenta?',
          choices: [
            { id: 'request_service_advice', meaning: 'No sabe qué servicio necesita o pide asesoramiento de una persona para elegir.' },
            { id: 'continue_service_selection', meaning: 'Elige, consulta o describe un servicio sin pedir ayuda humana para decidir.' }
          ]
        })
      : null
    if (
      serviceChoice &&
      (serviceChoice.confidence ?? 0) >= 0.65 &&
      serviceChoice.choiceId === 'request_service_advice'
    ) {
      const adviceCategory = initialState.categoryAdvice?.categoryName
      if (adviceCategory) {
        const state: BookingV2State = {
          ...initialState,
          categoryAdvice: {
            categoryName: adviceCategory,
            stage: 'awaiting_confirmation'
          },
          misunderstandingCount: 0
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_category_advice_confirmation',
          categoryName: adviceCategory,
          reason: 'missing'
        }, catalog, 'accepted')
      }

    }

    const pendingGroupResolution = resolvePendingServiceDisambiguation(
      input.message,
      initialState.pendingServiceDisambiguation,
      catalog
    )
    if (pendingGroupResolution.selections.length) {
      let state = applyResolvedServiceSelections(
        initialState,
        pendingGroupResolution.selections
      )
      state = {
        ...state,
        pendingServiceDisambiguation: pendingServiceDisambiguationFromGroups(
          pendingGroupResolution.remainingGroups
        )
      }
      if (state.quoteOnly && state.pendingServiceDisambiguation) {
        return this.serviceDisambiguationResult(state, catalog, 'accepted')
      }
      state = prepareQuoteOnlySelectedServices(state)
      const nextField = state.pendingServiceDisambiguation && state.draft.name
        ? 'service'
        : nextMissingField(state.draft, catalog.bookingFlowOrder)
      const result = await this.fromInterpretation({
        state,
        nextField,
        outcome: 'accepted',
        affectedField: 'service'
      }, null, catalog, 'accepted', nextField === 'service'
        ? { serviceSuggestions: pendingServiceDisambiguationOptions(state, catalog) ?? [] }
        : undefined)
      return state.pendingServiceDisambiguation
        ? result
        : withMultipleServicesAcknowledgement(result, catalog)
    }
    if (
      initialState.pendingServiceDisambiguation &&
      (
        Boolean(initialState.draft.name) ||
        Boolean(initialState.quoteOnly) ||
        nextMissingField(initialState.draft, catalog.bookingFlowOrder) === 'service'
      )
    ) {
      if (initialState.quoteOnly) {
        return this.serviceDisambiguationResult(initialState, catalog, 'no_change')
      }
      return this.fromInterpretation({
        state: initialState,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, catalog, 'no_change', {
        serviceSuggestions: pendingServiceDisambiguationOptions(initialState, catalog) ?? []
      })
    }

    const explicitServiceGroups = resolveExplicitServiceGroups(input.message, catalog)
    if (!initialState.draft.service && explicitServiceGroups.length >= 2) {
      const selections = explicitServiceGroups.flatMap((group) =>
        group.kind === 'selected'
          ? [{ serviceId: group.serviceId, evidence: group.evidence }]
          : []
      )
      const ambiguousGroups = explicitServiceGroups.flatMap((group) =>
        group.kind === 'ambiguous'
          ? [{ serviceIds: group.serviceIds, evidence: group.evidence }]
          : []
      )
      const serviceConsultationState = initialState.quoteOnly
        ? {
            ...initialState,
            quoteOnly: restartServiceConsultationQueue(initialState.quoteOnly)
          }
        : initialState
      let state = applyResolvedServiceSelections(serviceConsultationState, selections)
      state = {
        ...state,
        pendingServiceDisambiguation: pendingServiceDisambiguationFromGroups(ambiguousGroups)
      }
      if (state.quoteOnly && state.pendingServiceDisambiguation) {
        return this.serviceDisambiguationResult(state, catalog, selections.length ? 'accepted' : 'no_change')
      }
      state = prepareQuoteOnlySelectedServices(state)
      const nextField = state.pendingServiceDisambiguation && state.draft.name
        ? 'service'
        : nextMissingField(state.draft, catalog.bookingFlowOrder)
      const result = await this.fromInterpretation({
        state,
        nextField,
        outcome: selections.length ? 'accepted' : 'no_change',
        affectedField: 'service'
      }, null, catalog, selections.length ? 'accepted' : 'no_change', nextField === 'service'
        ? { serviceSuggestions: pendingServiceDisambiguationOptions(state, catalog) ?? [] }
        : undefined)
      return state.pendingServiceDisambiguation
        ? result
        : withMultipleServicesAcknowledgement(result, catalog)
    }
    const hasStructuredMultipleServices = Boolean(
      input.understandingExtraction?.additionalServices?.some((service) =>
        service.value && service.confidence >= 0.55
      )
    )

    const catalogNavigationResult = hasStructuredMultipleServices
      ? null
      : await this.handleCatalogNavigation({
          message: input.message,
          state: initialState,
          catalog
        })
    if (catalogNavigationResult) return catalogNavigationResult

    const deterministicName = resolveExpectedName(input.message, initialState, catalog)
    if (deterministicName) {
      const state = acceptField(initialState, 'name', deterministicName)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
        outcome: 'accepted',
        affectedField: 'name'
      }, null, catalog)
    }

    let stateForExtraction = initialState
    const deterministicService = hasStructuredMultipleServices
      ? null
      : resolveExpectedService(input.message, initialState, catalog)
    if (deterministicService?.kind === 'selected') {
      const state = acceptField(initialState, 'service', deterministicService.serviceId)
      const hasAheadAvailabilityPreference = Boolean(
        input.understandingExtraction?.date.value &&
        input.understandingExtraction.date.evidence &&
        input.understandingExtraction.date.confidence >= 0.65
      ) || Boolean(
        input.understandingExtraction?.time.value &&
        input.understandingExtraction.time.evidence &&
        input.understandingExtraction.time.confidence >= 0.65
      )
      if (
        nextMissingField(initialState.draft, catalog.bookingFlowOrder) === 'service' &&
        !hasAheadAvailabilityPreference
      ) {
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }
      stateForExtraction = state
    }
    if (deterministicService?.kind === 'ambiguous') {
      const serviceSuggestions = catalog.services.filter((service) =>
        deterministicService.serviceIds.includes(service.id)
      )
      const adviceCategory = sharedAdviceCategory(serviceSuggestions)
      const state: BookingV2State = {
        ...initialState,
        pendingServiceDisambiguation: {
          serviceIds: deterministicService.serviceIds,
          evidence: input.message.trim()
        },
        categoryAdvice: adviceCategory
          ? {
              categoryName: adviceCategory,
              stage: 'offered'
            }
          : null
      }
      if (nextMissingField(initialState.draft, catalog.bookingFlowOrder) === 'service') {
        return this.fromInterpretation({
          state,
          nextField: 'service',
          outcome: 'no_change',
          affectedField: 'service'
        }, null, catalog, 'no_change', {
          serviceSuggestions
        })
      }
      stateForExtraction = state
    }

    const deterministicProfessional = resolveExpectedProfessional(
      input.message,
      stateForExtraction,
      catalog
    )
    if (deterministicProfessional?.kind === 'ambiguous') {
      return this.guidedEstimateResult(initialState, {
        type: 'clarify_professional',
        professionalIds: deterministicProfessional.professionalIds
      }, catalog, 'no_change')
    }
    if (deterministicProfessional?.kind === 'selected') {
      const state = acceptField(initialState, 'professional', deterministicProfessional.professionalId)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
        outcome: 'accepted',
        affectedField: 'professional'
      }, null, catalog)
    }
    if (deterministicProfessional?.kind === 'probable') {
      const state = proposeField(initialState, {
        field: 'professional',
        value: deterministicProfessional.professionalId,
        confidence: 0.7,
        evidence: input.message.trim()
      })
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
        outcome: 'confirmation_required',
        affectedField: 'professional'
      }, null, catalog)
    }

    const deterministicDate = resolveExpectedDate(
      input.message,
      stateForExtraction,
      input.currentDate ?? new Date(),
      catalog.bookingFlowOrder
    )
    if (deterministicDate) {
      const state = acceptField(initialState, 'date', deterministicDate)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
        outcome: 'accepted',
        affectedField: 'date'
      }, null, catalog)
    }

    const deterministicTime = await this.resolveExpectedTime(
      input.message,
      stateForExtraction,
      catalog
    )
    if (deterministicTime) {
      const stateWithProfessional = initialState.draft.professional === ANY_PROFESSIONAL_ID
        ? acceptField(initialState, 'professional', deterministicTime.professionalId)
        : initialState
      const state = acceptField(stateWithProfessional, 'time', deterministicTime.time)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
        outcome: 'accepted',
        affectedField: 'time'
      }, null, catalog)
    }

    const extractionCatalog = this.domain.toExtractionCatalog(catalog)
    const rawExtraction = input.understandingExtraction === undefined
      ? await this.extractor.extract({
          message: input.message,
          draft: stateForExtraction.draft,
          expectedField: nextMissingField(stateForExtraction.draft, catalog.bookingFlowOrder),
          services: extractionCatalog.services,
          professionals: extractionCatalog.professionals,
          ...(input.currentDate ? { currentDate: input.currentDate } : {})
        })
      : input.understandingExtraction

    if (!rawExtraction) {
      const expectedField = nextMissingField(stateForExtraction.draft, catalog.bookingFlowOrder)
      if (
        shouldCountFailedExpectedFieldAnswer(
          input.message,
          expectedField,
          catalog
        )
      ) {
        const state = recordLowConfidence(stateForExtraction)
        const affectedField = expectedField === 'confirmation' ? null : expectedField
        return this.fromInterpretation({
          state,
          nextField: expectedField,
          outcome: 'not_understood',
          affectedField
        }, null, catalog)
      }
      return this.fromInterpretation({
        state: stateForExtraction,
        nextField: nextMissingField(stateForExtraction.draft, catalog.bookingFlowOrder),
        outcome: 'no_change',
        affectedField: deterministicService?.kind === 'selected' ? 'service' : null
      }, null, catalog)
    }
    const groundedExtraction = discardUngroundedCatalogSelections(
      rawExtraction,
      input.message,
      catalog,
      stateForExtraction
    )
    const extraction = stateForExtraction.pendingServiceDisambiguation
      ? withoutServiceSelection(
          groundedExtraction,
          pendingServiceDisambiguationGroups(stateForExtraction.pendingServiceDisambiguation)
            .flatMap((group) => group.serviceIds)
        )
      : groundedExtraction

    const baseInterpretation = applyBookingV2Extraction(
      stateForExtraction,
      extraction,
      this.domain.toInterpreterCatalog(catalog)
    )
    const stateWithCombinedServices = queueServicesFromExtraction(
      baseInterpretation.state,
      extraction,
      catalog
    )
    const interpretation = {
      ...baseInterpretation,
      state: stateWithCombinedServices
    }
    const expectedField = nextMissingField(stateForExtraction.draft, catalog.bookingFlowOrder)
    const affectedField = expectedField === 'confirmation' ? null : expectedField
    const effectiveInterpretation = interpretation.outcome === 'no_change' &&
      shouldCountFailedExpectedFieldAnswer(input.message, expectedField, catalog)
      ? {
          state: recordLowConfidence(interpretation.state),
          nextField: expectedField,
          outcome: 'not_understood' as const,
          affectedField
        }
      : interpretation

    const result = await this.fromInterpretation(
      effectiveInterpretation,
      extraction,
      catalog
    )
    return stateWithCombinedServices.combinedServices.length > stateForExtraction.combinedServices.length
      ? withMultipleServicesAcknowledgement(result, catalog)
      : result
  }

  private async handleCatalogNavigation(input: {
    message: string
    state: BookingV2State
    catalog: BookingV2DomainCatalog
  }): Promise<BookingV2ProcessResult | null> {
    if (
      input.catalog.displayMode !== 'CATEGORIES_FIRST' ||
      nextMissingField(input.state.draft, input.catalog.bookingFlowOrder) !== 'service'
    ) {
      return null
    }
    const categories = catalogCategoryOptions(input.catalog)
    if (!categories.some((category) => category.name !== 'Otros')) return null

    const presentationIntent = detectContextualServiceCatalogPresentationIntent(input.message)
    const directService = resolveCatalogServiceSelection(input.message, input.catalog)
    if (
      !directService &&
      (presentationIntent === 'use_business_default' || presentationIntent === 'show_categories')
    ) {
      const state: BookingV2State = {
        ...input.state,
        catalogNavigation: null,
        misunderstandingCount: 0
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }

    if (directService?.kind === 'selected') return null

    const pendingCategory = input.state.catalogNavigation?.pendingCategoryKey
      ? categories.find((category) =>
          category.key === input.state.catalogNavigation?.pendingCategoryKey
        )
      : null
    if (pendingCategory) {
      const confirmation = await this.choiceExtractor.extract({
        message: input.message,
        question: `¿Te referís a la categoría ${pendingCategory.name}?`,
        choices: [
          { id: 'confirm_category', meaning: 'Confirma que esa es la categoría que quiere.' },
          { id: 'reject_category', meaning: 'No quiere esa categoría y prefiere volver a elegir.' }
        ]
      })
      if (confirmation.confidence >= 0.65 && confirmation.choiceId === 'confirm_category') {
        return this.openCatalogCategory(input.state, input.catalog, pendingCategory)
      }
      if (confirmation.confidence >= 0.65 && confirmation.choiceId === 'reject_category') {
        const state: BookingV2State = {
          ...input.state,
          catalogNavigation: null,
          misunderstandingCount: 0
        }
        return this.fromInterpretation({
          state,
          nextField: 'service',
          outcome: 'no_change',
          affectedField: 'service'
        }, null, input.catalog)
      }
      return this.fromInterpretation({
        state: input.state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }

    const normalizedMessage = normalize(input.message)
    if (presentationIntent === 'show_all') {
      const state: BookingV2State = {
        ...input.state,
        catalogNavigation: {
          view: 'ALL_SERVICES',
          categoryKey: null,
          categoryName: null,
          pendingCategoryKey: null,
          pendingCategoryName: null
        },
        misunderstandingCount: 0
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }
    if (isBackToCategoriesMessage(normalizedMessage)) {
      const state: BookingV2State = {
        ...input.state,
        catalogNavigation: null,
        misunderstandingCount: 0
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }

    if (isAmbiguousCatalogAffirmation(input.message)) {
      return this.fromInterpretation({
        state: input.state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }

    const ambiguousCategory = directService?.kind === 'ambiguous'
      ? categoryForServiceIds(categories, directService.serviceIds)
      : null
    if (ambiguousCategory) {
      return this.openCatalogCategory(input.state, input.catalog, ambiguousCategory)
    }

    const exactCategory = categories.find((category) =>
      selectionSignature(category.name) === selectionSignature(input.message)
    )
    if (exactCategory) {
      return this.openCatalogCategory(input.state, input.catalog, exactCategory)
    }

    const categoryChoice = await this.choiceExtractor.extract({
      message: input.message,
      question: '¿Qué categoría de servicios quiere elegir el cliente?',
      choices: [
        ...categories.map((category) => ({
          id: `category:${category.key}`,
          meaning: `Quiere ver servicios de la categoría ${category.name}.`
        })),
        { id: 'show_all_services', meaning: 'Quiere ver el catálogo completo o todos los servicios.' },
        { id: 'restart_booking', meaning: 'Quiere volver a empezar la reserva.' },
        { id: 'human_handoff', meaning: 'Quiere hablar con una persona del equipo.' }
      ]
    })
    if (categoryChoice.confidence >= 0.65 && categoryChoice.choiceId === 'show_all_services') {
      const state: BookingV2State = {
        ...input.state,
        catalogNavigation: {
          view: 'ALL_SERVICES',
          categoryKey: null,
          categoryName: null,
          pendingCategoryKey: null,
          pendingCategoryName: null
        },
        misunderstandingCount: 0
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }
    if (categoryChoice.confidence >= 0.65 && categoryChoice.choiceId === 'human_handoff') {
      return this.guidedEstimateResult(input.state, {
        type: 'handoff',
        reason: 'service_selection_uncertain'
      }, input.catalog, 'accepted')
    }
    if (categoryChoice.confidence >= 0.65 && categoryChoice.choiceId === 'restart_booking') {
      const state = createCatalogRestartState(input.state.draft.name)
      return this.fromInterpretation({
        state,
        nextField: nextMissingField(state.draft, input.catalog.bookingFlowOrder),
        outcome: 'no_change',
        affectedField: 'service'
      }, null, input.catalog)
    }

    const selectedCategory = categoryChoice.choiceId?.startsWith('category:')
      ? categories.find((category) => `category:${category.key}` === categoryChoice.choiceId)
      : null
    if (selectedCategory && categoryChoice.confidence >= 0.85) {
      return this.openCatalogCategory(input.state, input.catalog, selectedCategory)
    }
    if (selectedCategory && categoryChoice.confidence >= 0.55) {
      const state: BookingV2State = {
        ...input.state,
        catalogNavigation: {
          view: 'CATEGORY',
          categoryKey: null,
          categoryName: null,
          pendingCategoryKey: selectedCategory.key,
          pendingCategoryName: selectedCategory.name
        }
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'confirmation_required',
        affectedField: 'service'
      }, null, input.catalog)
    }
    return null
  }

  private openCatalogCategory(
    initialState: BookingV2State,
    catalog: BookingV2DomainCatalog,
    category: { key: string; name: string }
  ) {
    const state: BookingV2State = {
      ...initialState,
      catalogNavigation: {
        view: 'CATEGORY',
        categoryKey: category.key,
        categoryName: category.name,
        pendingCategoryKey: null,
        pendingCategoryName: null
      },
      misunderstandingCount: 0
    }
    return this.fromInterpretation({
      state,
      nextField: 'service',
      outcome: 'no_change',
      affectedField: 'service'
    }, null, catalog, 'no_change', {
      serviceSuggestions: catalogServicesForCategory(catalog, category.key)
    })
  }

  private async startCoordinatedAvailability(input: {
    state: BookingV2State
    catalog: BookingV2DomainCatalog
    currentDate: Date
    assignmentMode?: 'SINGLE_PROFESSIONAL' | 'MULTIPLE_PROFESSIONALS'
  }) {
    const serviceIds = combinedServiceIds(input.state)
    const assignmentMode = input.assignmentMode ?? 'MULTIPLE_PROFESSIONALS'
    const today = dateInTimeZone(input.currentDate, 'America/Buenos_Aires').toISOString().slice(0, 10)
    const tomorrow = addIsoDateDays(today, 1)
    const requestedProfessionalId = input.state.draft.professional &&
      input.state.draft.professional !== ANY_PROFESSIONAL_ID
      ? input.state.draft.professional
      : null
    const quickDates: string[] = []
    if (this.domain.searchAvailability) {
      const candidates = [today, tomorrow].filter((date): date is string => Boolean(date))
      const results = await Promise.all(candidates.map(async (date) => ({
        date,
        result: await this.searchCoordinatedAvailability({
          catalog: input.catalog,
          serviceIds,
          mode: { type: 'DATE', date },
          maxResults: 1,
          assignmentMode,
          requiredProfessionalId: requestedProfessionalId
        })
      })))
      quickDates.push(...results
        .filter(({ result }) => result.status === 'AVAILABLE')
        .map(({ date }) => date))
    }
    const pending: BookingV2PendingCoordinatedAvailability = {
      serviceIds,
      assignmentMode,
      requestedProfessionalId,
      requireRequestedProfessional: Boolean(requestedProfessionalId),
      phase: 'AWAITING_DATE',
      date: null,
      quickDates,
      options: [],
      filteredOptionIds: [],
      page: 0,
      timeBand: null,
      requestedTime: null,
      requestedWindow: null,
      selectedOptionId: null
    }
    return this.guidedEstimateResult({
      ...input.state,
      pendingServiceSeparation: null,
      pendingAvailabilityResolution: null,
      pendingCoordinatedAvailability: pending,
      misunderstandingCount: 0
    }, {
      type: 'ask_coordinated_date',
      quickDates,
      assignmentMode,
      professionalName: professionalNameById(input.catalog, requestedProfessionalId)
    }, input.catalog, 'accepted')
  }

  private async handlePendingCoordinatedAvailability(input: {
    input: BookingV2ProcessInput
    state: BookingV2State
    catalog: BookingV2DomainCatalog
  }): Promise<BookingV2ProcessResult> {
    const pending = input.state.pendingCoordinatedAvailability!
    const phase = pending.phase === 'AWAITING_DATE'
      ? 'DATE' as const
      : pending.phase === 'AWAITING_TIME_PREFERENCE' || pending.phase === 'AWAITING_SEARCH_TIME'
        ? 'TIME_PREFERENCE' as const
        : 'OPTION' as const
    let choice = detectBookingCoordinationChoice({
      message: input.input.message,
      phase
    })
    const hasExplicitDate = pending.phase === 'AWAITING_DATE' && Boolean(resolveCoordinatedDate(
      input.input.message,
      input.input.currentDate ?? new Date(),
      input.input.understandingExtraction?.date.value ?? null
    ))
    if (!choice && !hasExplicitDate) {
      choice = await this.semanticCoordinatedChoice({
        message: input.input.message,
        pending
      })
    }
    if (!choice && input.input.understandingExtraction?.time.value) {
      choice = {
        type: 'EXACT_TIME',
        time: input.input.understandingExtraction.time.value
      }
    }

    if (choice?.type === 'REQUEST_HUMAN') {
      return this.guidedEstimateResult({
        ...input.state,
        pendingCoordinatedAvailability: null
      }, { type: 'handoff', reason: 'combination_review_required' }, input.catalog, 'accepted')
    }
    if (choice?.type === 'MODIFY_SERVICES') {
      const state: BookingV2State = {
        ...input.state,
        pendingCoordinatedAvailability: null,
        pendingServiceSeparation: {
          reason: 'no_common_professional',
          edit: { action: 'change', serviceIds: null }
        }
      }
      return this.guidedEstimateResult(state, {
        type: 'ask_service_edit_target',
        action: 'change',
        serviceIds: pending.serviceIds
      }, input.catalog, 'accepted')
    }
    if (choice?.type === 'SEARCH_WITHOUT_PROFESSIONAL' && pending.requireRequestedProfessional) {
      const relaxedPending: BookingV2PendingCoordinatedAvailability = {
        ...pending,
        requireRequestedProfessional: false,
        options: [],
        filteredOptionIds: [],
        page: 0,
        timeBand: null,
        selectedOptionId: null
      }
      const relaxedState: BookingV2State = {
        ...input.state,
        draft: {
          ...input.state.draft,
          professional: ANY_PROFESSIONAL_ID,
          time: null
        },
        pendingCoordinatedAvailability: relaxedPending
      }
      if (pending.date) {
        const result = await this.searchCoordinatedAvailability({
          catalog: input.catalog,
          serviceIds: pending.serviceIds,
          mode: {
            type: 'DATE',
            date: pending.date,
            requestedTime: pending.requestedTime
          },
          maxResults: 25,
          assignmentMode: pending.assignmentMode,
          requiredProfessionalId: null
        })
        return this.coordinatedSearchResult({
          state: relaxedState,
          pending: relaxedPending,
          catalog: input.catalog,
          result,
          date: pending.date,
          requestedTime: pending.requestedTime,
          requestedWindow: pending.requestedWindow
        })
      }
      return this.startCoordinatedAvailability({
        state: relaxedState,
        catalog: input.catalog,
        currentDate: input.input.currentDate ?? new Date(),
        assignmentMode: pending.assignmentMode
      })
    }

    if (pending.phase === 'OPTION_SELECTED') {
      const selected = pending.options.find((option) => option.id === pending.selectedOptionId)
      if (selected) {
        return this.guidedEstimateResult(input.state, {
          type: 'show_coordinated_selection',
          option: selected,
          assignmentMode: pending.assignmentMode
        }, input.catalog, 'no_change')
      }
    }

    if (pending.phase === 'AWAITING_SEARCH_TIME') {
      if (choice?.type !== 'EXACT_TIME') {
        return this.guidedEstimateResult(input.state, {
          type: 'ask_coordinated_search_time',
          date: pending.options.length ? pending.date : null,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'no_change')
      }
      if (pending.date && pending.options.length) {
        const filtered = pending.options.filter((option) => option.startTime === choice.time)
        if (filtered.length) {
          return this.showCoordinatedOptions(input.state, {
            ...pending,
            phase: 'AWAITING_OPTION',
            filteredOptionIds: filtered.map((option) => option.id),
            requestedTime: choice.time,
            requestedWindow: null,
            page: 0
          }, input.catalog)
        }
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: {
            ...pending,
            phase: 'AWAITING_TIME_PREFERENCE',
            requestedTime: choice.time
          }
        }
        return this.guidedEstimateResult(state, {
          type: 'coordinated_date_unavailable',
          date: pending.date,
          reason: 'REQUESTED_TIME_UNAVAILABLE',
          requestedTime: choice.time,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null,
          canSearchWithoutProfessional: pending.requireRequestedProfessional
        }, input.catalog, 'no_change')
      }
      const today = dateInTimeZone(
        input.input.currentDate ?? new Date(),
        'America/Buenos_Aires'
      ).toISOString().slice(0, 10)
      const result = await this.searchCoordinatedAvailability({
        catalog: input.catalog,
        serviceIds: pending.serviceIds,
        mode: {
          type: 'TIME_ACROSS_DAYS',
          afterDate: today,
          time: choice.time,
          horizonDays: 14,
          maxDates: 5
        },
        maxResults: 15,
        assignmentMode: pending.assignmentMode,
        requiredProfessionalId: pending.requireRequestedProfessional
          ? pending.requestedProfessionalId
          : null
      })
      const quickDates = Array.from(new Set(result.options.map((option) => option.date))).slice(0, 5)
      if (quickDates.length) {
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: {
            ...pending,
            phase: 'AWAITING_DATE',
            quickDates,
            requestedTime: choice.time,
            options: [],
            filteredOptionIds: [],
            page: 0
          }
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_date',
          quickDates,
          requestedTime: choice.time,
          assignmentMode: pending.assignmentMode,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'accepted')
      }
      const state: BookingV2State = {
        ...input.state,
        pendingCoordinatedAvailability: {
          ...pending,
          phase: 'AWAITING_DATE',
          requestedTime: choice.time
        }
      }
      return this.guidedEstimateResult(state, {
        type: 'coordinated_date_unavailable',
        date: today,
        reason: result.status === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : 'REQUESTED_TIME_UNAVAILABLE',
        requestedTime: choice.time,
        professionalName: pending.requireRequestedProfessional
          ? professionalNameById(input.catalog, pending.requestedProfessionalId)
          : null,
        canSearchWithoutProfessional: pending.requireRequestedProfessional
      }, input.catalog, 'no_change')
    }

    if (pending.phase === 'AWAITING_DATE') {
      if (choice?.type === 'SEARCH_TIME') {
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: {
            ...pending,
            phase: 'AWAITING_SEARCH_TIME'
          }
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_search_time',
          date: null,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'no_change')
      }
      if (choice?.type === 'SHOW_MORE') {
        return this.guidedEstimateResult(input.state, {
          type: 'show_coordinated_more_options'
        }, input.catalog, 'no_change')
      }
      if (choice?.type === 'CHOOSE_OTHER_DATE') {
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: { ...pending, quickDates: [] }
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_date',
          quickDates: [],
          requestedTime: pending.requestedTime,
          assignmentMode: pending.assignmentMode,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'no_change')
      }
      if (choice?.type === 'SHOW_NEXT_DAYS') {
        const today = dateInTimeZone(
          input.input.currentDate ?? new Date(),
          'America/Buenos_Aires'
        ).toISOString().slice(0, 10)
        const result = await this.searchCoordinatedAvailability({
          catalog: input.catalog,
          serviceIds: pending.serviceIds,
          mode: { type: 'NEXT_DAYS', afterDate: today, horizonDays: 14, maxDates: 5 },
          maxResults: 25,
          assignmentMode: pending.assignmentMode,
          requiredProfessionalId: pending.requireRequestedProfessional
            ? pending.requestedProfessionalId
            : null
        })
        const quickDates = Array.from(new Set(result.options.map((option) => option.date))).slice(0, 5)
        const state = {
          ...input.state,
          pendingCoordinatedAvailability: { ...pending, quickDates }
        }
        if (!quickDates.length) {
          return this.guidedEstimateResult(state, {
            type: 'coordinated_date_unavailable',
            date: today,
            reason: result.status === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : 'NO_AVAILABILITY_ON_DATE',
            requestedTime: pending.requestedTime,
            professionalName: pending.requireRequestedProfessional
              ? professionalNameById(input.catalog, pending.requestedProfessionalId)
              : null,
            canSearchWithoutProfessional: pending.requireRequestedProfessional
          }, input.catalog, 'no_change')
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_date',
          quickDates,
          requestedTime: pending.requestedTime,
          assignmentMode: pending.assignmentMode,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'no_change')
      }

      const date = resolveCoordinatedDate(
        input.input.message,
        input.input.currentDate ?? new Date(),
        input.input.understandingExtraction?.date.value ?? null
      )
      if (!date) {
        return this.guidedEstimateResult(input.state, {
          type: 'ask_coordinated_date',
          quickDates: pending.quickDates,
          requestedTime: pending.requestedTime,
          assignmentMode: pending.assignmentMode,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'no_change')
      }
      const timeChoice = detectBookingCoordinationChoice({
        message: input.input.message,
        phase: 'TIME_PREFERENCE'
      })
      const requestedTime = timeChoice?.type === 'EXACT_TIME'
        ? timeChoice.time
        : pending.requestedTime
      const result = await this.searchCoordinatedAvailability({
        catalog: input.catalog,
        serviceIds: pending.serviceIds,
        mode: { type: 'DATE', date, requestedTime },
        maxResults: 25,
        assignmentMode: pending.assignmentMode,
        requiredProfessionalId: pending.requireRequestedProfessional
          ? pending.requestedProfessionalId
          : null
      })
      return this.coordinatedSearchResult({
        state: input.state,
        pending,
        catalog: input.catalog,
        result,
        date,
        requestedTime,
        requestedWindow: timeChoice?.type === 'TIME_WINDOW' ? timeChoice : null
      })
    }

    if (pending.phase === 'AWAITING_TIME_PREFERENCE') {
      if (choice?.type === 'SEARCH_TIME') {
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: {
            ...pending,
            phase: 'AWAITING_SEARCH_TIME'
          }
        }
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_search_time',
          date: pending.date,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'accepted')
      }
      if (choice?.type === 'SHOW_MORE') {
        return this.showCoordinatedOptions(input.state, {
          ...pending,
          phase: 'AWAITING_OPTION',
          filteredOptionIds: pending.options.map((option) => option.id),
          page: 0
        }, input.catalog)
      }
      const filtered = filterCoordinatedOptions(pending.options, choice)
      if (filtered.length) {
        return this.showCoordinatedOptions(input.state, {
          ...pending,
          phase: 'AWAITING_OPTION',
          filteredOptionIds: filtered.map((option) => option.id),
          page: 0,
          timeBand: choice?.type === 'TIME_BAND' ? choice.band : null,
          requestedTime: choice?.type === 'EXACT_TIME' ? choice.time : null,
          requestedWindow: choice?.type === 'TIME_WINDOW' ? choice : null
        }, input.catalog)
      }
      if (choice?.type === 'EXACT_TIME' || choice?.type === 'TIME_WINDOW') {
        const state: BookingV2State = {
          ...input.state,
          pendingCoordinatedAvailability: {
            ...pending,
            requestedTime: choice.type === 'EXACT_TIME' ? choice.time : null,
            requestedWindow: choice.type === 'TIME_WINDOW' ? choice : null
          }
        }
        return this.guidedEstimateResult(state, {
          type: 'coordinated_date_unavailable',
          date: pending.date!,
          reason: 'REQUESTED_TIME_UNAVAILABLE',
          requestedTime: choice.type === 'EXACT_TIME' ? choice.time : null,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null,
          canSearchWithoutProfessional: pending.requireRequestedProfessional
        }, input.catalog, 'no_change')
      }
      return this.guidedEstimateResult(input.state, {
        type: 'ask_coordinated_time_preference',
        date: pending.date!,
        bands: coordinatedTimeBands(pending.options),
        professionalName: pending.requireRequestedProfessional
          ? professionalNameById(input.catalog, pending.requestedProfessionalId)
          : null
      }, input.catalog, 'no_change')
    }

    const visible = visibleCoordinatedOptions(pending)
    if (choice?.type === 'SHOW_MORE') {
      const currentIds = new Set(filteredCoordinatedOptions(pending).map((option) => option.id))
      const optionsOutsideCurrentFilter = pending.options.filter((option) => !currentIds.has(option.id))
      if (optionsOutsideCurrentFilter.length) {
        return this.showCoordinatedOptions(input.state, {
          ...pending,
          filteredOptionIds: optionsOutsideCurrentFilter.map((option) => option.id),
          page: 0,
          timeBand: null,
          requestedTime: null,
          requestedWindow: null
        }, input.catalog)
      }
      const totalPages = Math.max(1, Math.ceil(filteredCoordinatedOptions(pending).length / 2))
      const nextPage = (pending.page + 1) % totalPages
      return this.showCoordinatedOptions(input.state, { ...pending, page: nextPage }, input.catalog)
    }
    const selected = choice?.type === 'OPTION'
      ? visible[choice.index] ?? null
      : choice?.type === 'EXACT_TIME'
        ? filteredCoordinatedOptions(pending).find((option) => option.startTime === choice.time) ?? null
        : null
    if (selected) {
      const state: BookingV2State = {
        ...input.state,
        pendingCoordinatedAvailability: {
          ...pending,
          phase: 'OPTION_SELECTED',
          selectedOptionId: selected.id
        }
      }
      return this.guidedEstimateResult(state, {
        type: 'show_coordinated_selection',
        option: selected,
        assignmentMode: pending.assignmentMode
      }, input.catalog, 'accepted')
    }
    const refiltered = filterCoordinatedOptions(pending.options, choice)
    if (refiltered.length) {
      return this.showCoordinatedOptions(input.state, {
        ...pending,
        filteredOptionIds: refiltered.map((option) => option.id),
        page: 0
      }, input.catalog)
    }
    return this.showCoordinatedOptions(input.state, pending, input.catalog)
  }

  private async coordinatedSearchResult(input: {
    state: BookingV2State
    pending: BookingV2PendingCoordinatedAvailability
    catalog: BookingV2DomainCatalog
    result: BookingAvailabilitySearchResult
    date: string
    requestedTime: string | null
    requestedWindow: { startTime: string; endTime: string } | null
  }) {
    let options = input.result.options
    if (input.requestedWindow) {
      options = options.filter((option) => optionFitsTimeWindow(option, input.requestedWindow!))
    }
    if (input.result.status === 'AVAILABLE' && options.length) {
      const pending: BookingV2PendingCoordinatedAvailability = {
        ...input.pending,
        date: input.date,
        options,
        filteredOptionIds: options.map((option) => option.id),
        page: 0,
        timeBand: null,
        requestedTime: input.requestedTime,
        requestedWindow: input.requestedWindow,
        selectedOptionId: null,
        phase: options.length > 2 && !input.requestedTime && !input.requestedWindow
          ? 'AWAITING_TIME_PREFERENCE'
          : 'AWAITING_OPTION'
      }
      if (pending.phase === 'AWAITING_TIME_PREFERENCE') {
        return this.guidedEstimateResult({
          ...input.state,
          pendingCoordinatedAvailability: pending
        }, {
          type: 'ask_coordinated_time_preference',
          date: input.date,
          bands: coordinatedTimeBands(options),
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(input.catalog, pending.requestedProfessionalId)
            : null
        }, input.catalog, 'accepted')
      }
      return this.showCoordinatedOptions(input.state, pending, input.catalog)
    }

    const reason = input.result.status === 'PROVIDER_ERROR'
      ? 'PROVIDER_ERROR' as const
      : input.result.status === 'REQUESTED_TIME_UNAVAILABLE' || input.requestedWindow
        ? 'REQUESTED_TIME_UNAVAILABLE' as const
        : input.result.status === 'NO_CONTINUOUS_COMBINATION'
          ? 'NO_CONTINUOUS_COMBINATION' as const
          : 'NO_AVAILABILITY_ON_DATE' as const
    const state: BookingV2State = {
      ...input.state,
      pendingCoordinatedAvailability: {
        ...input.pending,
        phase: 'AWAITING_DATE',
        date: input.date,
        options: input.result.options,
        filteredOptionIds: [],
        requestedTime: input.requestedTime,
        requestedWindow: input.requestedWindow,
        selectedOptionId: null
      }
    }
    return this.guidedEstimateResult(state, {
      type: 'coordinated_date_unavailable',
      date: input.date,
      reason,
      requestedTime: input.requestedTime,
      professionalName: input.pending.requireRequestedProfessional
        ? professionalNameById(input.catalog, input.pending.requestedProfessionalId)
        : null,
      canSearchWithoutProfessional: input.pending.requireRequestedProfessional
    }, input.catalog, 'no_change')
  }

  private showCoordinatedOptions(
    state: BookingV2State,
    pending: BookingV2PendingCoordinatedAvailability,
    catalog: BookingV2DomainCatalog
  ) {
    const normalizedState: BookingV2State = {
      ...state,
      pendingCoordinatedAvailability: pending
    }
    const allOptions = filteredCoordinatedOptions(pending)
    const visible = visibleCoordinatedOptions(pending)
    return this.guidedEstimateResult(normalizedState, {
      type: 'offer_coordinated_options',
      date: pending.date!,
      options: visible,
      hasMore: allOptions.length > 2 || pending.options.some((option) =>
        !allOptions.some((filtered) => filtered.id === option.id)
      ),
      page: pending.page,
      assignmentMode: pending.assignmentMode
    }, catalog, 'accepted')
  }

  private searchCoordinatedAvailability(input: {
    catalog: BookingV2DomainCatalog
    serviceIds: string[]
    mode: Parameters<NonNullable<BookingV2DomainPort['searchAvailability']>>[0]['mode']
    maxResults: number
    assignmentMode?: 'SINGLE_PROFESSIONAL' | 'MULTIPLE_PROFESSIONALS'
    requiredProfessionalId?: string | null
  }) {
    return this.domain.searchAvailability!({
      catalog: input.catalog,
      serviceId: input.serviceIds[0]!,
      serviceIds: input.serviceIds,
      mode: input.mode,
      assignmentMode: input.assignmentMode ?? 'MULTIPLE_PROFESSIONALS',
      professionalId: input.requiredProfessionalId ?? null,
      preferredProfessionalId: input.requiredProfessionalId ?? null,
      maxResults: input.maxResults
    })
  }

  private async semanticCoordinatedChoice(input: {
    message: string
    pending: BookingV2PendingCoordinatedAvailability
  }): Promise<ReturnType<typeof detectBookingCoordinationChoice>> {
    const visible = visibleCoordinatedOptions(input.pending)
    const choices = [
      { id: 'request_human', meaning: 'Quiere que una persona del equipo coordine la reserva.' },
      { id: 'modify_services', meaning: 'Quiere cambiar o quitar alguno de los servicios.' },
      { id: 'show_more', meaning: 'Quiere ver más horarios u opciones disponibles.' },
      { id: 'next_days', meaning: 'Quiere buscar disponibilidad en los próximos días.' },
      { id: 'search_time', meaning: 'Quiere indicar o probar una hora exacta.' },
      { id: 'other_date', meaning: 'Quiere elegir o escribir otra fecha.' },
      ...(input.pending.requireRequestedProfessional
        ? [{
            id: 'without_professional',
            meaning: 'Autoriza buscar opciones sin mantener al profesional solicitado.'
          }]
        : []),
      ...(input.pending.phase === 'AWAITING_TIME_PREFERENCE'
        ? [
            { id: 'morning', meaning: 'Prefiere comenzar durante la mañana.' },
            { id: 'midday', meaning: 'Prefiere comenzar cerca del mediodía.' },
            { id: 'afternoon', meaning: 'Prefiere comenzar durante la tarde.' }
          ]
        : []),
      ...(input.pending.phase === 'AWAITING_OPTION'
        ? visible.map((option, index) => ({
            id: `option:${index}`,
            meaning: `Elige la opción ${index + 1}, que comienza a las ${option.startTime}.`
          }))
        : [])
    ]
    const result = await this.choiceExtractor.extract({
      message: input.message,
      question: input.pending.phase === 'AWAITING_TIME_PREFERENCE'
        ? '¿En qué momento del día prefiere comenzar?'
        : '¿Cuál de las opciones de horario prefiere?',
      choices
    })
    if (result.confidence < 0.7) return null
    if (result.choiceId === 'request_human') return { type: 'REQUEST_HUMAN' }
    if (result.choiceId === 'modify_services') return { type: 'MODIFY_SERVICES' }
    if (result.choiceId === 'show_more') return { type: 'SHOW_MORE' }
    if (result.choiceId === 'next_days') return { type: 'SHOW_NEXT_DAYS' }
    if (result.choiceId === 'search_time') return { type: 'SEARCH_TIME' }
    if (result.choiceId === 'other_date') return { type: 'CHOOSE_OTHER_DATE' }
    if (result.choiceId === 'without_professional') return { type: 'SEARCH_WITHOUT_PROFESSIONAL' }
    if (result.choiceId === 'morning') return { type: 'TIME_BAND', band: 'MORNING' }
    if (result.choiceId === 'midday') return { type: 'TIME_BAND', band: 'MIDDAY' }
    if (result.choiceId === 'afternoon') return { type: 'TIME_BAND', band: 'AFTERNOON' }
    const optionIndex = result.choiceId?.startsWith('option:')
      ? Number(result.choiceId.slice('option:'.length))
      : -1
    return Number.isInteger(optionIndex) && optionIndex >= 0
      ? { type: 'OPTION', index: optionIndex }
      : null
  }

  async resume(input: Omit<BookingV2ProcessInput, 'message'>): Promise<BookingV2ProcessResult> {
    const catalog = await this.domain.loadCatalog(input.businessId)
    const state = sanitizeCatalogNameCollision(
      stateFromConversation(input.conversation),
      catalog
    )
    if (state.pendingCoordinatedAvailability) {
      const pending = state.pendingCoordinatedAvailability
      if (pending.phase === 'AWAITING_DATE') {
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_date',
          quickDates: pending.quickDates,
          requestedTime: pending.requestedTime,
          assignmentMode: pending.assignmentMode,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(catalog, pending.requestedProfessionalId)
            : null
        }, catalog, 'no_change')
      }
      if (pending.phase === 'AWAITING_SEARCH_TIME') {
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_search_time',
          date: pending.options.length ? pending.date : null,
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(catalog, pending.requestedProfessionalId)
            : null
        }, catalog, 'no_change')
      }
      if (pending.phase === 'AWAITING_TIME_PREFERENCE') {
        return this.guidedEstimateResult(state, {
          type: 'ask_coordinated_time_preference',
          date: pending.date!,
          bands: coordinatedTimeBands(pending.options),
          professionalName: pending.requireRequestedProfessional
            ? professionalNameById(catalog, pending.requestedProfessionalId)
            : null
        }, catalog, 'no_change')
      }
      if (pending.phase === 'OPTION_SELECTED') {
        const selected = pending.options.find((option) => option.id === pending.selectedOptionId)
        if (selected) {
          return this.guidedEstimateResult(state, {
            type: 'show_coordinated_selection',
            option: selected,
            assignmentMode: pending.assignmentMode
          }, catalog, 'no_change')
        }
      }
      return this.showCoordinatedOptions(state, pending, catalog)
    }
    if (state.pendingServiceSeparation) {
      const pending = state.pendingServiceSeparation
      const selectedServiceIds = combinedServiceIds(state)
      if (pending.edit?.action === 'menu') {
        return this.guidedEstimateResult(state, {
          type: 'show_service_modification_menu'
        }, catalog, 'no_change')
      }
      if (pending.edit?.serviceIds?.length) {
        return this.guidedEstimateResult(state, {
          type: 'confirm_service_edit',
          action: pending.edit.action,
          serviceIds: pending.edit.serviceIds
        }, catalog, 'no_change')
      }
      if (pending.edit?.action === 'change' || pending.edit?.action === 'remove') {
        return this.guidedEstimateResult(state, {
          type: 'ask_service_edit_target',
          action: pending.edit.action,
          serviceIds: selectedServiceIds
        }, catalog, 'no_change')
      }
      return this.guidedEstimateResult(state, {
        type: 'offer_separate_services',
        reason: pending.reason
      }, catalog, 'no_change')
    }
    if (state.pendingServiceReplacement) {
      return this.guidedEstimateResult(state, {
        type: 'ask_service_replacement',
        selectedServiceIds: combinedServiceIds(state)
      }, catalog, 'no_change')
    }
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
      if (!(guidedService.estimateOptions?.length) && guidedService.price !== null && guidedService.price > 0) {
        const estimateState: BookingV2State = {
          ...state,
          guidedEstimate: {
            serviceId: guidedService.id,
            stage: 'awaiting_decision',
            optionId: null,
            optionLabel: null,
            priceMin: guidedService.price,
            priceMax: null
          }
        }
        return this.guidedEstimateResult(estimateState, {
          type: 'show_base_estimate',
          priceMin: guidedService.price,
          allowsBooking: guidedService.estimateAllowsBooking !== false
        }, catalog, 'no_change')
      }
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
      nextField: nextMissingField(state.draft, catalog.bookingFlowOrder),
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
      nextField: nextMissingField(state.draft, catalog?.bookingFlowOrder),
      outcome: outcome === 'proposal_confirmed' ? 'accepted' : 'no_change',
      affectedField: null
    }, extraction, catalog, outcome)
  }

  private async completeQuoteOnlyEstimate(
    state: BookingV2State,
    catalog: BookingV2DomainCatalog
  ): Promise<BookingV2ProcessResult> {
    const guidedEstimate = state.guidedEstimate
    const completedEstimate = guidedEstimate?.priceMin === null || !guidedEstimate
      ? []
      : [{
          serviceId: guidedEstimate.serviceId,
          priceMin: guidedEstimate.priceMin,
          priceMax: guidedEstimate.priceMax
        }]
    const estimates = [
      ...(state.quoteOnly?.estimates ?? []).filter(
        (estimate) => estimate.serviceId !== guidedEstimate?.serviceId
      ),
      ...completedEstimate
    ]
    let remainingServiceIds = (state.quoteOnly?.remainingServiceIds ?? [])
      .filter((serviceId) => serviceId !== guidedEstimate?.serviceId)
    let nextServiceId = remainingServiceIds[0]

    while (nextServiceId) {
      const nextService = catalog.services.find((candidate) => candidate.id === nextServiceId)
      if (
        nextService?.attentionMode !== 'DIRECT_BOOKING' ||
        nextService.price === null ||
        nextService.price <= 0
      ) {
        break
      }
      estimates.push({
        serviceId: nextService.id,
        priceMin: nextService.price,
        priceMax: nextService.priceMode === 'STARTING_AT' ? null : nextService.price
      })
      remainingServiceIds = remainingServiceIds.slice(1)
      nextServiceId = remainingServiceIds[0]
    }

    const quoteState: BookingV2State = {
      ...state,
      draft: {
        ...state.draft,
        service: nextServiceId ?? null,
        professional: null,
        date: null,
        time: null
      },
      combinedServices: [],
      guidedEstimate: null,
      quoteOnly: { ...state.quoteOnly, remainingServiceIds, estimates },
      misunderstandingCount: 0
    }
    if (nextServiceId) {
      return this.fromInterpretation({
        state: quoteState,
        nextField: nextMissingField(quoteState.draft, catalog.bookingFlowOrder),
        outcome: 'accepted',
        affectedField: null
      }, null, catalog)
    }
    return this.guidedEstimateResult(quoteState, {
      type: 'quote_complete',
      estimates
    }, catalog, 'accepted')
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
    let effectiveInterpretation = catalog
      ? {
          ...interpretation,
          state: prepareCombinedServiceDecision(interpretation.state, catalog)
        }
      : interpretation
    if (
      effectiveInterpretation.state.draft.name &&
      effectiveInterpretation.state.pendingServiceDisambiguation
    ) {
      // La selección de servicios funciona como una frontera del flujo: aunque
      // una validación, estimación o sugerencia interna haya terminado, no se
      // puede pedir profesional, fecha u hora hasta cerrar toda la lista inicial.
      effectiveInterpretation = {
        ...effectiveInterpretation,
        nextField: 'service'
      }
    }
    let plan = buildBookingV2MessagePlan(effectiveInterpretation, catalog?.bookingFlowOrder)
    let availabilityOptions: BookingV2AvailabilityOption[] = []
    let unavailableDate: string | null = null

    const selectedService = catalog?.services.find(
      (service) => service.id === effectiveInterpretation.state.draft.service
    )
    if (
      selectedService &&
      effectiveInterpretation.state.quoteOnly &&
      selectedService.attentionMode === 'DIRECT_BOOKING' &&
      selectedService.price !== null &&
      selectedService.price > 0
    ) {
      const estimates = [
        ...effectiveInterpretation.state.quoteOnly.estimates.filter(
          (estimate) => estimate.serviceId !== selectedService.id
        ),
        {
          serviceId: selectedService.id,
          priceMin: selectedService.price,
          priceMax: selectedService.priceMode === 'STARTING_AT' ? null : selectedService.price
        }
      ]
      const remainingServiceIds = effectiveInterpretation.state.quoteOnly.remainingServiceIds
        .filter((serviceId) => serviceId !== selectedService.id)
      const nextServiceId = remainingServiceIds[0] ?? null
      const quoteState: BookingV2State = {
        ...effectiveInterpretation.state,
        draft: {
          ...effectiveInterpretation.state.draft,
          service: nextServiceId,
          professional: null,
          date: null,
          time: null
        },
        combinedServices: [],
        guidedEstimate: null,
      quoteOnly: { ...effectiveInterpretation.state.quoteOnly, remainingServiceIds, estimates },
        misunderstandingCount: 0
      }
      if (nextServiceId) {
        return this.fromInterpretation({
          state: quoteState,
          nextField: nextMissingField(quoteState.draft, catalog.bookingFlowOrder),
          outcome: 'accepted',
          affectedField: null
        }, null, catalog, 'accepted')
      }
      return this.guidedEstimateResult(quoteState, {
        type: 'quote_complete',
        estimates
      }, catalog, 'accepted')
    }
    const hasAcceptedAdvisorQuote = Boolean(
      selectedService &&
      effectiveInterpretation.state.advisorQuote?.serviceId === selectedService.id &&
      effectiveInterpretation.state.advisorQuote.status === 'accepted'
    )
    const canEvaluateSelectedService = Boolean(
      selectedService && (
        effectiveInterpretation.state.draft.name ||
        effectiveInterpretation.state.quoteOnly
      )
    )
    const assistedSelectedService = Boolean(
      selectedService && (
        selectedService.requiresPhoto || (
          selectedService.attentionMode !== undefined &&
          selectedService.attentionMode !== 'DIRECT_BOOKING'
        )
      )
    )
    if (selectedService && !effectiveInterpretation.state.draft.name && assistedSelectedService && !effectiveInterpretation.state.quoteOnly) {
      plan = {
        type: 'show_service_preview_and_ask_name'
      }
    } else if (
      canEvaluateSelectedService &&
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
    } else if (canEvaluateSelectedService && selectedService?.attentionMode === 'GUIDED_ESTIMATE') {
      if (
        effectiveInterpretation.state.guidedEstimate?.serviceId !== selectedService.id ||
        effectiveInterpretation.state.guidedEstimate.stage !== 'completed'
      ) {
        if (!(selectedService.estimateOptions?.length) && selectedService.price !== null && selectedService.price > 0) {
          effectiveInterpretation = {
            ...effectiveInterpretation,
            state: {
              ...effectiveInterpretation.state,
              guidedEstimate: {
                serviceId: selectedService.id,
                stage: 'awaiting_decision',
                optionId: null,
                optionLabel: null,
                priceMin: selectedService.price,
                priceMax: null
              }
            }
          }
          plan = {
            type: 'show_base_estimate',
            priceMin: selectedService.price,
            allowsBooking: selectedService.estimateAllowsBooking !== false
          }
        } else {
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
      }
    } else if (
      selectedService &&
      canEvaluateSelectedService &&
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

    const selectedServiceIds = combinedServiceIds(effectiveInterpretation.state)
    if (catalog && !effectiveInterpretation.state.quoteOnly && selectedServiceIds.length > 1 && !isServiceDecisionPlan(plan)) {
      const combinationDecision = evaluateServiceCombination(selectedServiceIds, catalog)
      if (combinationDecision === 'REVIEW_REQUIRED') {
        plan = { type: 'handoff', reason: 'combination_review_required' }
      } else if (combinationDecision === 'BLOCKED') {
        effectiveInterpretation = {
          ...effectiveInterpretation,
          state: {
            ...effectiveInterpretation.state,
            pendingServiceSeparation: { reason: 'blocked_combination' }
          }
        }
        plan = { type: 'offer_separate_services', reason: 'blocked_combination' }
      }
    }

    if (
      catalog &&
      selectedServiceIds.length >= 1 &&
      selectedService &&
      effectiveInterpretation.state.addonOfferCompletedServiceId !== serviceSelectionKey(selectedServiceIds) &&
      !effectiveInterpretation.state.addonSuggestion &&
      plan.type === 'ask_field' &&
      ['professional', 'date'].includes(plan.field)
    ) {
      const selectedIds = new Set(selectedServiceIds)
      const addonIds = Array.from(new Set(selectedServiceIds.flatMap((sourceServiceId) => {
        const sourceService = catalog.services.find((service) => service.id === sourceServiceId)
        return (sourceService?.suggestedAddonIds ?? []).filter((addonServiceId) =>
          catalog.serviceIds.has(addonServiceId) &&
          !selectedIds.has(addonServiceId) &&
          !selectedServiceIds.some((selectedServiceId) =>
            combinationRuleFor(catalog, selectedServiceId, addonServiceId)?.policy === 'BLOCKED'
          ) &&
          !conflictsWithExclusiveSelectedFamily(addonServiceId, selectedServiceIds, catalog)
        )
      })))
      if (addonIds.length) {
        effectiveInterpretation = {
          ...effectiveInterpretation,
          state: {
            ...effectiveInterpretation.state,
            addonSuggestion: {
              sourceServiceId: serviceSelectionKey(selectedServiceIds),
              candidateServiceIds: addonIds.slice(0, 4)
            }
          }
        }
        plan = { type: 'ask_service_addons', serviceIds: addonIds.slice(0, 4) }
      }
    }

    if (
      catalog &&
      (
        (plan.type === 'ask_field' && ['professional', 'date', 'time'].includes(plan.field)) ||
        plan.type === 'confirm_booking'
      ) &&
      effectiveInterpretation.state.draft.service
    ) {
      const professionalResolution = resolveBookingAvailability({
        stage: 'professional_compatibility',
        serviceCount: selectedServiceIds.length,
        hasCompatibleProfessional: catalog.professionals.some((professional) =>
          selectedServiceIds.every((serviceId) => professional.serviceIds.includes(serviceId))
        )
      })
      effectiveInterpretation = {
        ...effectiveInterpretation,
        state: {
          ...effectiveInterpretation.state,
          pendingAvailabilityResolution: pendingAvailabilityResolution({
            resolution: professionalResolution,
            serviceIds: selectedServiceIds,
            professionalId: effectiveInterpretation.state.draft.professional,
            requestedDate: effectiveInterpretation.state.draft.date,
            requestedTime: effectiveInterpretation.state.draft.time
          })
        }
      }
      if (professionalResolution.status === 'NO_COMMON_PROFESSIONAL') {
        effectiveInterpretation = {
          ...effectiveInterpretation,
          state: {
            ...effectiveInterpretation.state,
            pendingServiceSeparation: { reason: 'no_common_professional' }
          }
        }
        plan = { type: 'offer_separate_services', reason: 'no_common_professional' }
      } else if (professionalResolution.status === 'NO_COMPATIBLE_PROFESSIONAL') {
        plan = { type: 'handoff', reason: 'no_compatible_professional' }
      }
    }

    if (
      catalog &&
      this.domain.searchAvailability &&
      plan.type === 'ask_field' &&
      plan.field === 'time' &&
      effectiveInterpretation.state.draft.service &&
      effectiveInterpretation.state.draft.date
    ) {
      const requestedProfessionalId = effectiveInterpretation.state.draft.professional &&
        effectiveInterpretation.state.draft.professional !== ANY_PROFESSIONAL_ID
        ? effectiveInterpretation.state.draft.professional
        : null
      const pending: BookingV2PendingCoordinatedAvailability = {
        serviceIds: selectedServiceIds,
        assignmentMode: 'SINGLE_PROFESSIONAL',
        requestedProfessionalId,
        requireRequestedProfessional: Boolean(requestedProfessionalId),
        phase: 'AWAITING_OPTION',
        date: effectiveInterpretation.state.draft.date,
        quickDates: [],
        options: [],
        filteredOptionIds: [],
        page: 0,
        timeBand: null,
        requestedTime: null,
        requestedWindow: null,
        selectedOptionId: null
      }
      const result = await this.searchCoordinatedAvailability({
        catalog,
        serviceIds: selectedServiceIds,
        mode: { type: 'DATE', date: effectiveInterpretation.state.draft.date },
        maxResults: 25,
        assignmentMode: 'SINGLE_PROFESSIONAL',
        requiredProfessionalId: requestedProfessionalId
      })
      return this.coordinatedSearchResult({
        state: effectiveInterpretation.state,
        pending,
        catalog,
        result,
        date: effectiveInterpretation.state.draft.date,
        requestedTime: null,
        requestedWindow: null
      })
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
        serviceIds: selectedServiceIds,
        professionalId: effectiveInterpretation.state.draft.professional,
        date: effectiveInterpretation.state.draft.date
      })

      availabilityOptions = availability.ok ? availability.options : []
      const proposedTime = timeToValidate(plan, effectiveInterpretation.state)
      const shouldSearchUpcoming = availabilityOptions.length === 0 &&
        Boolean(this.domain.findNextAvailabilityOptions)
      const nextOptions = shouldSearchUpcoming && this.domain.findNextAvailabilityOptions
        ? await this.domain.findNextAvailabilityOptions({
              catalog,
              serviceId: effectiveInterpretation.state.draft.service,
              serviceIds: selectedServiceIds,
              professionalId: effectiveInterpretation.state.draft.professional,
              afterDate: effectiveInterpretation.state.draft.date,
              horizonDays: 14,
              maxDates: 3,
              maxSlotsPerDate: 3
            })
        : []
      const availabilityResolution = resolveBookingAvailability({
        stage: 'daily_availability',
        options: availabilityOptions,
        requestedTime: proposedTime,
        upcomingSearch: shouldSearchUpcoming
          ? { performed: true, options: nextOptions }
          : { performed: false }
      })
      const resolutionPlan = bookingAvailabilityResolutionPlan(availabilityResolution, {
        hasSelectedProfessional: Boolean(
          effectiveInterpretation.state.draft.professional &&
          effectiveInterpretation.state.draft.professional !== ANY_PROFESSIONAL_ID
        )
      })
      const stateWithAvailabilityResolution: BookingV2State = {
        ...effectiveInterpretation.state,
        pendingAvailabilityResolution: pendingAvailabilityResolution({
          resolution: availabilityResolution,
          serviceIds: selectedServiceIds,
          professionalId: effectiveInterpretation.state.draft.professional,
          requestedDate: effectiveInterpretation.state.draft.date,
          requestedTime: proposedTime
        })
      }
      effectiveInterpretation = {
        ...effectiveInterpretation,
        state: stateWithAvailabilityResolution
      }

      if (
        availabilityResolution.status === 'NO_SLOTS_ON_DATE' ||
        availabilityResolution.status === 'NO_UPCOMING_AVAILABILITY'
      ) {
        unavailableDate = effectiveInterpretation.state.draft.date
        const state = applyBookingAvailabilityTransition(
          effectiveInterpretation.state,
          resolutionPlan.transition
        )
        effectiveInterpretation = {
          state,
          nextField: 'date',
          outcome: 'no_change',
          affectedField: 'date'
        }
        plan = buildBookingV2MessagePlan(effectiveInterpretation, catalog.bookingFlowOrder)
      } else if (availabilityResolution.status === 'UPCOMING_AVAILABILITY_FOUND') {
        unavailableDate = effectiveInterpretation.state.draft.date
        const state: BookingV2State = {
          ...applyBookingAvailabilityTransition(effectiveInterpretation.state, resolutionPlan.transition),
          pendingCombinedAvailability: selectedServiceIds.length > 1
            ? {
                requestedDate: unavailableDate!,
                options: availabilityResolution.options
              }
            : null
        }
        effectiveInterpretation = {
          state,
          nextField: 'date',
          outcome: 'no_change',
          affectedField: 'date'
        }
        plan = selectedServiceIds.length > 1
          ? {
              type: 'offer_combined_availability',
              requestedDate: unavailableDate!,
              options: availabilityResolution.options
            }
          : buildBookingV2MessagePlan(effectiveInterpretation, catalog.bookingFlowOrder)
      } else if (availabilityResolution.status === 'REQUESTED_TIME_UNAVAILABLE') {
        const state = applyBookingAvailabilityTransition(
          effectiveInterpretation.state,
          resolutionPlan.transition
        )
        effectiveInterpretation = {
          state,
          nextField: 'time',
          outcome: 'no_change',
          affectedField: 'time'
        }
        plan = buildBookingV2MessagePlan(effectiveInterpretation, catalog.bookingFlowOrder)
      } else if (
        availabilityResolution.status === 'AVAILABLE' &&
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
          plan = buildBookingV2MessagePlan(effectiveInterpretation, catalog.bookingFlowOrder)
        }
      }
    }

    const reconciledState = reconcileBookingV2Agenda(
      effectiveInterpretation.state,
      plan,
      availabilityOptions
    )
    effectiveInterpretation = {
      ...effectiveInterpretation,
      state: reconciledState
    }

    const serviceSuggestions = renderContext?.serviceSuggestions ??
      pendingServiceDisambiguationOptions(effectiveInterpretation.state, catalog) ??
      offeredCategoryServices(effectiveInterpretation.state, catalog)
    const serviceSuggestionLabel = effectiveInterpretation.state.pendingServiceDisambiguation
      ? ambiguousServiceReference(effectiveInterpretation.state.pendingServiceDisambiguation.evidence)
      : null

    const reply = renderBookingV2Response({
      plan,
      draft: effectiveInterpretation.state.draft,
      agenda: effectiveInterpretation.state.agenda,
      catalogNavigation: effectiveInterpretation.state.catalogNavigation,
      catalog,
      availabilityOptions,
      unavailableDate,
      combinedServices: effectiveInterpretation.state.combinedServices,
      quoteOnly: effectiveInterpretation.state.quoteOnly,
      ...(serviceSuggestions ? { serviceSuggestions } : {}),
      ...(serviceSuggestionLabel ? { serviceSuggestionLabel } : {})
    })
    return {
      state: effectiveInterpretation.state,
      conversationPatch: conversationPatchFromState(effectiveInterpretation.state),
      plan,
      reply,
      ...(plan.type === 'offer_combined_availability'
        ? { messages: combinedAvailabilityMessages(reply) }
        : {}),
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
    const reconciledState = reconcileBookingV2Agenda(state, plan, [])
    const reply = renderBookingV2Response({
      plan,
      draft: reconciledState.draft,
      agenda: reconciledState.agenda,
      catalogNavigation: reconciledState.catalogNavigation,
      catalog,
      availabilityOptions: [],
      combinedServices: reconciledState.combinedServices,
      quoteOnly: reconciledState.quoteOnly
    })
    return {
      state: reconciledState,
      conversationPatch: conversationPatchFromState(reconciledState),
      plan,
      reply,
      ...(plan.type === 'offer_combined_availability'
        ? { messages: combinedAvailabilityMessages(reply) }
        : {}),
      availabilityOptions: [],
      extraction: null,
      outcome
    }
  }

  private serviceDisambiguationResult(
    state: BookingV2State,
    catalog: BookingV2DomainCatalog,
    outcome: BookingV2ProcessResult['outcome']
  ): BookingV2ProcessResult {
    const plan = buildBookingV2MessagePlan({
      state,
      nextField: 'service',
      outcome,
      affectedField: 'service'
    }, catalog.bookingFlowOrder)
    const reconciledState = reconcileBookingV2Agenda(state, plan, [])
    const serviceSuggestions = pendingServiceDisambiguationOptions(reconciledState, catalog)
    const serviceSuggestionLabel = reconciledState.pendingServiceDisambiguation
      ? ambiguousServiceReference(reconciledState.pendingServiceDisambiguation.evidence)
      : null
    const reply = renderBookingV2Response({
      plan,
      draft: reconciledState.draft,
      agenda: reconciledState.agenda,
      catalogNavigation: reconciledState.catalogNavigation,
      catalog,
      availabilityOptions: [],
      combinedServices: reconciledState.combinedServices,
      quoteOnly: reconciledState.quoteOnly,
      ...(serviceSuggestions ? { serviceSuggestions } : {}),
      ...(serviceSuggestionLabel ? { serviceSuggestionLabel } : {})
    })
    return {
      state: reconciledState,
      conversationPatch: conversationPatchFromState(reconciledState),
      plan,
      reply,
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
    if (nextMissingField(state.draft, catalog.bookingFlowOrder) !== 'time') return null
    if (!state.draft.service || !state.draft.date) return null

    const requestedTime = parseTime(message)
    if (!requestedTime) return null

    const availability = await this.domain.findAvailabilityOptions({
      catalog,
      serviceId: state.draft.service,
      serviceIds: combinedServiceIds(state),
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

function reconcileBookingV2Agenda(
  state: BookingV2State,
  plan: BookingV2MessagePlan,
  availabilityOptions: BookingV2AvailabilityOption[]
): BookingV2State {
  if (!state.agenda.length) return state

  const acceptedQuote = state.advisorQuote?.status === 'accepted'
  const selectedServiceId = state.draft.service
  const waitingForQuote = plan.type === 'handoff' && [
    'photo_required',
    'quote_required',
    'estimate_quote_requested'
  ].includes(plan.reason)

  const agenda = state.agenda.map((originalItem): typeof originalItem => {
    const item = originalItem.serviceId || !selectedServiceId
      ? originalItem
      : { ...originalItem, serviceId: selectedServiceId }

    if (item.intent === 'request_quote') {
      const quoteMatchesService = !item.serviceId || state.advisorQuote?.serviceId === item.serviceId
      if (acceptedQuote && quoteMatchesService) {
        return { ...item, status: 'completed', blockedBy: null }
      }
      if (plan.type === 'show_service_preview_and_ask_name') {
        return { ...item, serviceInformationProvided: true }
      }
      if (waitingForQuote) return { ...item, status: 'pending', blockedBy: null }
      return item
    }

    if (item.intent === 'check_availability') {
      if (
        (plan.type === 'ask_field' && plan.field === 'time' && availabilityOptions.length > 0) ||
        plan.type === 'confirm_booking'
      ) {
        return { ...item, status: 'completed', blockedBy: null }
      }
      if (waitingForQuote || state.advisorQuote?.status === 'awaiting_acceptance') {
        return { ...item, status: 'blocked', blockedBy: 'quote_pending' }
      }
      if (acceptedQuote && item.status === 'blocked') {
        return { ...item, status: 'pending', blockedBy: null }
      }
    }
    return item
  })

  return { ...state, agenda }
}

function sharedAdviceCategory(services: BookingV2DomainCatalog['services']) {
  const categories = Array.from(new Set(
    services
      .filter((service) => service.categoryAdviceEnabled === true)
      .map((service) => service.category?.trim())
      .filter((category): category is string => Boolean(category))
  ))
  return categories.length === 1 ? categories[0] ?? null : null
}

function servicesForCategory(catalog: BookingV2DomainCatalog, categoryName: string) {
  return catalog.services.filter((service) =>
    typeof service.category === 'string' &&
    normalize(service.category) === normalize(categoryName)
  )
}

function offeredCategoryServices(
  state: BookingV2State,
  catalog: BookingV2DomainCatalog | null
) {
  if (!catalog) return undefined
  if (state.catalogNavigation?.view === 'CATEGORY' && state.catalogNavigation.categoryKey) {
    const services = catalogServicesForCategory(catalog, state.catalogNavigation.categoryKey)
    return services.length ? services : undefined
  }
  if (state.categoryAdvice?.stage !== 'offered') return undefined
  const services = servicesForCategory(catalog, state.categoryAdvice.categoryName)
  return services.length ? services : undefined
}

function pendingServiceDisambiguationOptions(
  state: BookingV2State,
  catalog: BookingV2DomainCatalog | null
) {
  if (!catalog || !state.pendingServiceDisambiguation) return undefined
  const services = state.pendingServiceDisambiguation.serviceIds
    .map((serviceId) => catalog.services.find((service) => service.id === serviceId))
    .filter((service): service is BookingV2DomainCatalog['services'][number] => Boolean(service))
  return services.length > 1 ? services : undefined
}

function withoutServiceSelection(
  extraction: BookingV2Extraction,
  ambiguousServiceIds: string[]
): BookingV2Extraction {
  const ambiguousIds = new Set(ambiguousServiceIds)
  return {
    ...extraction,
    service: { value: null, confidence: 0, evidence: '' },
    additionalServices: extraction.additionalServices?.filter((service) =>
      !service.value || !ambiguousIds.has(service.value)
    ) ?? []
  }
}

function categoryForServiceIds(
  categories: ReturnType<typeof catalogCategoryOptions>,
  serviceIds: string[]
) {
  if (!serviceIds.length) return null
  const requested = new Set(serviceIds)
  const matches = categories.filter((category) =>
    serviceIds.every((serviceId) => category.serviceIds.includes(serviceId)) &&
    category.serviceIds.some((serviceId) => requested.has(serviceId))
  )
  return matches.length === 1 ? matches[0] ?? null : null
}

function isBackToCategoriesMessage(normalizedMessage: string) {
  return [
    'volver',
    'volver a categorias',
    'ver categorias',
    'mostrar categorias',
    'categorias'
  ].includes(normalizedMessage)
}

function createCatalogRestartState(customerName: string | null) {
  const state = createEmptyBookingV2State()
  return customerName ? acceptField(state, 'name', customerName) : state
}

function shouldCountFailedCatalogSelection(
  message: string,
  expectedField: BookingField | 'confirmation',
  catalog: BookingV2DomainCatalog
) {
  if (expectedField !== 'service' || catalog.displayMode !== 'CATEGORIES_FIRST') return false
  const normalizedMessage = normalize(message)
  if (!normalizedMessage) return false
  return !['hola', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches'].includes(normalizedMessage)
}

function serviceTargetChoices(
  action: 'change' | 'remove',
  serviceIds: string[],
  catalog: BookingV2DomainCatalog
) {
  const verb = action === 'change' ? 'Cambiar o reemplazar' : 'Quitar o eliminar'
  return [
    ...serviceIds.map((serviceId) => ({
      id: `${action}_service:${serviceId}`,
      meaning: `${verb} solamente ${catalog.services.find((service) => service.id === serviceId)?.name ?? serviceId}.`
    })),
    ...(serviceIds.length > 1
      ? [{
          id: `${action}_all_services`,
          meaning: `${verb} todos los servicios elegidos.`
        }]
      : [])
  ]
}

function pendingServiceChoiceFromMessage(input: {
  message: string
  catalog: BookingV2DomainCatalog
  selectedServiceIds: string[]
  actionHint?: 'change' | 'remove'
}) {
  const normalizedMessage = normalize(input.message)
  if (!input.actionHint && /^(?:modificar|editar)\s+(?:los\s+)?servicios?$/.test(normalizedMessage)) {
    return 'modify_menu'
  }
  if (!input.actionHint && /\b(?:coordinar|combinar)\b.*\bhorarios?\b/.test(normalizedMessage)) {
    return 'separate'
  }
  if (!input.actionHint && /\b(?:por separado|separados|separadas)\b/.test(normalizedMessage)) {
    return 'separate'
  }
  if (!input.actionHint && /\b(?:revise|revisar|revision|equipo|persona del local)\b/.test(normalizedMessage)) {
    return 'review_together'
  }

  const action = input.actionHint ?? (
    /\b(?:cambiar|cambio|modificar|modifico|reemplazar|reemplazo)\b/.test(normalizedMessage)
      ? 'change'
      : /\b(?:quitar|quito|sacar|saco|eliminar|elimino|borrar|borro)\b/.test(normalizedMessage)
        ? 'remove'
        : null
  )
  if (!action) return null

  if (/\b(?:ambos|ambas|los dos|las dos|todos|todas)\b/.test(normalizedMessage)) {
    return `${action}_all_services`
  }

  const matchingServiceIds = input.selectedServiceIds.filter((serviceId) => {
    const service = input.catalog.services.find((candidate) => candidate.id === serviceId)
    if (!service) return false
    return [service.name, ...service.aliases].some((label) => {
      const normalizedLabel = normalize(label)
      return Boolean(normalizedLabel) && normalizedMessage.includes(normalizedLabel)
    })
  })
  if (matchingServiceIds.length === 1) {
    return `${action}_service:${matchingServiceIds[0]}`
  }
  if (matchingServiceIds.length > 1) {
    return `${action}_all_services`
  }
  return `${action}_services`
}

function serviceSeparationConfirmationChoice(message: string) {
  const confirmation = detectDeterministicConfirmation(message)
  if (confirmation?.intent === 'confirm') return 'separate'
  if (confirmation?.intent === 'reject') return 'review_together'
  return null
}

function resolveCoordinatedDate(message: string, currentDate: Date, extractedDate: string | null) {
  if (extractedDate && /^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) return extractedDate
  const normalized = normalize(message)
  const date = dateInTimeZone(currentDate, 'America/Buenos_Aires')
  if (/\bhoy\b/.test(normalized)) return date.toISOString().slice(0, 10)
  if (/\bmanana\b/.test(normalized)) {
    date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().slice(0, 10)
  }
  const isoDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(normalized)?.[1]
  if (isoDate) return isoDate
  const requestedWeekday = weekdayMentionedInMessage(normalized)
  if (requestedWeekday === null) return null
  const daysUntilRequested = (requestedWeekday - date.getUTCDay() + 7) % 7
  date.setUTCDate(date.getUTCDate() + (daysUntilRequested || 7))
  return date.toISOString().slice(0, 10)
}

function coordinatedTimeBands(options: BookingAvailabilitySearchOption[]): BookingV2CoordinatedTimeBand[] {
  return (['MORNING', 'MIDDAY', 'AFTERNOON'] as const).filter((band) =>
    options.some((option) => timeBelongsToBand(option.startTime, band))
  )
}

function filterCoordinatedOptions(
  options: BookingAvailabilitySearchOption[],
  choice: ReturnType<typeof detectBookingCoordinationChoice>
) {
  if (choice?.type === 'TIME_BAND') {
    return options.filter((option) => timeBelongsToBand(option.startTime, choice.band))
  }
  if (choice?.type === 'EXACT_TIME') {
    return options.filter((option) => option.startTime === choice.time)
  }
  if (choice?.type === 'TIME_WINDOW') {
    return options.filter((option) => optionFitsTimeWindow(option, choice))
  }
  return []
}

function filteredCoordinatedOptions(pending: BookingV2PendingCoordinatedAvailability) {
  if (!pending.filteredOptionIds.length) return pending.options
  const selectedIds = new Set(pending.filteredOptionIds)
  return pending.options.filter((option) => selectedIds.has(option.id))
}

function visibleCoordinatedOptions(pending: BookingV2PendingCoordinatedAvailability) {
  const options = filteredCoordinatedOptions(pending)
  return options.slice(pending.page * 2, pending.page * 2 + 2)
}

function addIsoDateDays(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function professionalNameById(
  catalog: BookingV2DomainCatalog,
  professionalId: string | null
) {
  if (!professionalId) return null
  return catalog.professionals.find((professional) => professional.id === professionalId)?.name ?? null
}

function parseServiceEditChoice(choiceId: string | null, selectedServiceIds: string[]) {
  if (choiceId === 'change_services') return { action: 'change' as const, serviceIds: null }
  if (choiceId === 'remove_services') return { action: 'remove' as const, serviceIds: null }
  if (choiceId === 'change_all_services') {
    return { action: 'change' as const, serviceIds: selectedServiceIds }
  }
  if (choiceId === 'remove_all_services') {
    return { action: 'remove' as const, serviceIds: selectedServiceIds }
  }
  const match = choiceId?.match(/^(change|remove)_service:(.+)$/)
  if (!match) return null
  const action = match[1] === 'change' ? 'change' as const : 'remove' as const
  const serviceId = match[2]
  return serviceId && selectedServiceIds.includes(serviceId)
    ? { action, serviceIds: [serviceId] }
    : null
}

function explicitConfirmationChoice(message: string): 'confirm_edit' | 'cancel_edit' | null {
  const normalizedMessage = normalize(message)
  if (/^(?:no|no quiero|mejor no|dejalo|dejemoslo|conservalos|mantener)(?:\b|$)/.test(normalizedMessage)) {
    return 'cancel_edit'
  }
  if (/^(?:si|confirmo|confirmado|dale|ok|okay|correcto|hacelo|sacalo|quitalo|cambialo)(?:\b|$)/.test(normalizedMessage)) {
    return 'confirm_edit'
  }
  return null
}

function applyConfirmedServiceEdit(
  state: BookingV2State,
  action: 'change' | 'remove',
  serviceIds: string[]
): BookingV2State {
  const selectedServices = [
    ...(state.draft.service
      ? [{ serviceId: state.draft.service, evidence: '' }]
      : []),
    ...state.combinedServices
  ]
  const removedIds = new Set(serviceIds)
  const remainingServices = selectedServices.filter((service) => !removedIds.has(service.serviceId))
  const primaryService = remainingServices[0] ?? null
  return {
    ...state,
    draft: {
      ...state.draft,
      service: primaryService?.serviceId ?? null,
      professional: null,
      time: null
    },
    pendingProposal: null,
    categoryAdvice: null,
    catalogNavigation: null,
    serviceValidation: null,
    guidedEstimate: null,
    advisorQuote: null,
    pendingDeposit: null,
    combinedServices: remainingServices.slice(1),
    queuedServices: state.queuedServices.filter((service) => !removedIds.has(service.serviceId)),
    addonSuggestion: null,
    addonOfferCompletedServiceId: action === 'change' ? primaryService?.serviceId ?? null : null,
    pendingCombinedAvailability: null,
    pendingServiceSeparation: null,
    pendingServiceReplacement: null,
    pendingCoordinatedAvailability: null,
    misunderstandingCount: 0
  }
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

function shouldCountFailedProfessionalSelection(message: string, expectedField: BookingField | 'confirmation') {
  if (expectedField !== 'professional') return false
  const normalizedMessage = normalize(message)
  return /^(?:con|con la|con el|prefiero|quiero con|elijo a)\s+\S+/.test(normalizedMessage)
}

function shouldCountFailedExpectedFieldAnswer(
  message: string,
  expectedField: BookingField | 'confirmation',
  catalog: BookingV2DomainCatalog
) {
  if (
    shouldCountFailedProfessionalSelection(message, expectedField) ||
    shouldCountFailedCatalogSelection(message, expectedField, catalog)
  ) {
    return true
  }
  if (!['date', 'time'].includes(expectedField)) return false
  const normalizedMessage = normalize(message)
  if (!normalizedMessage) return false
  return !['hola', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches'].includes(normalizedMessage)
}

function resolveExpectedName(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (nextMissingField(state.draft, catalog.bookingFlowOrder) !== 'name') return null

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
  if (nextMissingField(state.draft, catalog.bookingFlowOrder) !== 'professional') return null

  const selectedService = state.draft.service
  const selectedServiceIds = combinedServiceIds(state)
  const compatibleProfessionals = catalog.professionals.filter((professional) =>
    !selectedService || selectedServiceIds.every((serviceId) =>
      professional.serviceIds.includes(serviceId)
    )
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
    return {
      kind: 'selected' as const,
      professionalId: ANY_PROFESSIONAL_ID
    }
  }

  return resolveProfessionalReference(message, compatibleProfessionals)
}

function resolveProfessionalReference(
  message: string,
  professionals: BookingV2DomainCatalog['professionals']
) {
  if (!professionals.length) return null

  const normalizedMessage = normalize(message)
  const messageTokens = professionalReferenceTokens(normalizedMessage)
  if (!messageTokens.length) return null

  const fullNameMatches = professionals
    .map((professional) => ({
      professional,
      nameTokens: professionalNameTokens(professional.name)
    }))
    .filter(({ nameTokens }) =>
      nameTokens.length >= 2 && nameTokens.every((token) => messageTokens.includes(token))
    )
  const mostSpecificFullNameLength = Math.max(
    0,
    ...fullNameMatches.map(({ nameTokens }) => nameTokens.length)
  )
  const mostSpecificFullNameMatches = fullNameMatches.filter(({ nameTokens }) =>
    nameTokens.length === mostSpecificFullNameLength
  )
  if (mostSpecificFullNameMatches.length === 1) {
    return {
      kind: 'selected' as const,
      professionalId: mostSpecificFullNameMatches[0]?.professional.id ?? ''
    }
  }
  if (mostSpecificFullNameMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      professionalIds: mostSpecificFullNameMatches.map(({ professional }) => professional.id)
    }
  }

  const exactTokenMatches = professionals.filter((professional) =>
    professionalNameTokens(professional.name).some((token) => messageTokens.includes(token))
  )
  if (exactTokenMatches.length === 1) {
    return {
      kind: 'selected' as const,
      professionalId: exactTokenMatches[0]?.id ?? ''
    }
  }
  if (exactTokenMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      professionalIds: exactTokenMatches.map((professional) => professional.id)
    }
  }

  const probableMatches = professionals.filter((professional) =>
    messageTokens.some((token) => isProbableProfessionalNickname(token, professional.name))
  )
  if (probableMatches.length === 1) {
    return {
      kind: 'probable' as const,
      professionalId: probableMatches[0]?.id ?? ''
    }
  }
  if (probableMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      professionalIds: probableMatches.map((professional) => professional.id)
    }
  }

  return null
}

const PROFESSIONAL_REFERENCE_STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'ella', 'la', 'las', 'lo', 'los',
  'me', 'mi', 'para', 'por', 'puede', 'preferiria', 'prefiero', 'que',
  'quiero', 'ser', 'si', 'un', 'una', 'y'
])

function professionalReferenceTokens(value: string) {
  return value
    .split(' ')
    .filter((token) => token.length >= 2 && !PROFESSIONAL_REFERENCE_STOP_WORDS.has(token))
}

function professionalNameTokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !['de', 'del', 'la', 'las', 'los', 'y'].includes(token))
}

function isProbableProfessionalNickname(candidate: string, professionalName: string) {
  if (!candidate || candidate.includes(' ')) return false
  const firstName = normalize(professionalName).split(' ')[0] ?? ''
  if (candidate.length < 4 || firstName.length < 4 || candidate === firstName) return false

  // Errores de tipeo inequívocos: Lcas -> Lucas, Tamra -> Tamara.
  if (editDistanceAtMostOne(candidate, firstName)) return true

  // Truncamientos frecuentes: Nico -> Nicolas, Cami -> Camila.
  if (firstName.startsWith(candidate)) return true

  // Apodos terminados en i/y: Tami -> Tamara, Mili -> Milagros.
  if (
    /^[a-z]+[iy]$/.test(candidate) &&
    candidate.length <= 6 &&
    firstName.startsWith(candidate.slice(0, -1))
  ) {
    return true
  }

  // Diminutivos espanoles: Marquitos -> Marcos, Carlitos -> Carlos.
  const diminutiveStem = candidate
    .replace(/(?:citos|citas|itos|itas|cito|cita|ito|ita)$/, '')
    .replace(/qu$/, 'c')
  return diminutiveStem.length >= 3 && firstName.startsWith(diminutiveStem)
}

function resolveExpectedService(
  message: string,
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
) {
  if (state.draft.service) return null
  return resolveCatalogServiceSelection(message, catalog)
}

function resolveCatalogServiceSelection(
  message: string,
  catalog: BookingV2DomainCatalog
) {
  const signature = selectionSignature(message)
  if (!signature) return null

  const genericFamilyMatches = genericServiceFamilyMatches(signature, catalog)
  if (genericFamilyMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      serviceIds: genericFamilyMatches.map((service) => service.id)
    }
  }

  const exactMatches = catalog.services.filter((service) =>
    [service.name, ...service.aliases].some((label) => selectionSignature(label) === signature)
  )
  if (exactMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: exactMatches[0]?.id ?? ''
    }
  }
  if (exactMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      serviceIds: exactMatches.map((service) => service.id)
    }
  }

  const messageTokens = serviceSelectionTokens(message)
  const catalogTokens = catalog.services.flatMap((service) =>
    [service.name, ...service.aliases].flatMap(serviceSelectionTokens)
  )
  const relevantMessageTokens = messageTokens.filter((messageToken) =>
    catalogTokens.some((catalogToken) => serviceTokensMatch(messageToken, catalogToken))
  )
  const sharedPartialMatches = relevantMessageTokens.length
    ? catalog.services.filter((service) =>
        [service.name, ...service.aliases].some((label) => {
          const labelTokens = serviceSelectionTokens(label)
          return relevantMessageTokens.every((messageToken) =>
            labelTokens.some((labelToken) => serviceTokensMatch(messageToken, labelToken))
          )
        })
      )
    : []
  if (sharedPartialMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: sharedPartialMatches[0]?.id ?? ''
    }
  }
  if (sharedPartialMatches.length > 1) {
    return {
      kind: 'ambiguous' as const,
      serviceIds: sharedPartialMatches.map((service) => service.id)
    }
  }

  const scoredMatches = catalog.services
    .map((service) => ({
      service,
      score: Math.max(...[service.name, ...service.aliases].map((label) =>
        serviceLabelMatchScore(messageTokens, serviceSelectionTokens(label))
      ))
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)

  const bestScore = scoredMatches[0]?.score ?? 0
  const partialMatches = scoredMatches
    .filter((candidate) => bestScore - candidate.score < 0.08)
    .map((candidate) => candidate.service)

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

function deterministicEstimateOption(
  message: string,
  options: NonNullable<BookingV2DomainCatalog['services'][number]['estimateOptions']>
) {
  const normalizedMessage = normalize(message).trim()
  const numericMatch = normalizedMessage.match(/^(?:opcion )?(\d+)$/)
  const ordinalIndex = new Map([
    ['primera', 1], ['primero', 1], ['segunda', 2], ['segundo', 2], ['tercera', 3], ['tercero', 3],
    ['cuarta', 4], ['cuarto', 4], ['quinta', 5], ['quinto', 5]
  ]).get(normalizedMessage)
  const selectedIndex = numericMatch ? Number(numericMatch[1]) : ordinalIndex
  if (!selectedIndex || selectedIndex < 1 || selectedIndex > options.length) return null
  return options[selectedIndex - 1] ?? null
}

function genericServiceFamilyMatches(
  signature: string,
  catalog: BookingV2DomainCatalog
) {
  const reference = signature
    .split(' ')
    .filter((token) => ![
      'averiguar', 'consulta', 'cotizacion', 'informacion', 'precio', 'presupuesto', 'saber',
      'buenas', 'buenos', 'como', 'dia', 'hola', 'noche', 'tarde', 'va'
    ].includes(token))
    .join(' ')
  const familyTerms = /^(?:color|coloracion|colorearme|tenir|tenirme|tintura|tinturarme)(?: pelo| cabello)?$/.test(reference)
    ? ['color', 'coloracion', 'tintura', 'iluminacion', 'balayage', 'babylights', 'contouring', 'mechas']
    : /^(?:corte|cortar|cortarme|cortarme pelo|corte pelo)$/.test(reference)
      ? ['corte']
      : null
  if (!familyTerms) return []

  return catalog.services.filter((service) => {
    const labels = [service.name, service.category ?? '', ...service.aliases]
      .map((label) => serviceSelectionTokens(label))
    return labels.some((tokens) => tokens.some((token) =>
      familyTerms.some((familyTerm) => serviceTokensMatch(token, familyTerm))
    ))
  })
}

function ambiguousServiceReference(evidence: string) {
  const ignored = new Set([
    'a', 'al', 'averiguar', 'buenas', 'buenos', 'como', 'con', 'consulta', 'cotizacion',
    'de', 'del', 'dia', 'el', 'en', 'hacer', 'hacerme', 'hola', 'informacion', 'la', 'las',
    'los', 'me', 'necesito', 'noche', 'para', 'por', 'presupuesto', 'precio', 'queria',
    'quiero', 'quisiera', 'saber', 'tarde', 'un', 'una', 'va', 'y'
  ])
  const words = normalize(evidence)
    .split(' ')
    .filter((word) => word && !ignored.has(word))
    .map((word) => /^(?:cortar|cortarme|cortarse)$/.test(word) ? 'corte' : word)
  const reference = words.join(' ').trim()
  return reference ? `${reference.charAt(0).toUpperCase()}${reference.slice(1)}` : null
}

function resolveExpectedDate(
  message: string,
  state: BookingV2State,
  currentDate: Date,
  bookingFlowOrder: BookingV2DomainCatalog['bookingFlowOrder']
) {
  if (nextMissingField(state.draft, bookingFlowOrder) !== 'date') return null
  const normalized = normalize(message)
  const date = dateInTimeZone(currentDate, 'America/Buenos_Aires')
  const tokens = new Set(normalized.split(' ').filter(Boolean))
  if (tokens.has('hoy')) return date.toISOString().slice(0, 10)
  if (tokens.has('manana')) {
    date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().slice(0, 10)
  }

  const requestedWeekday = weekdayMentionedInMessage(normalized)
  if (requestedWeekday === null) return null

  const daysUntilRequested = (requestedWeekday - date.getUTCDay() + 7) % 7
  date.setUTCDate(date.getUTCDate() + (daysUntilRequested || 7))
  return date.toISOString().slice(0, 10)
}

const WEEKDAYS_BY_NAME = new Map([
  ['domingo', 0],
  ['lunes', 1],
  ['martes', 2],
  ['miercoles', 3],
  ['jueves', 4],
  ['viernes', 5],
  ['sabado', 6]
])

function weekdayMentionedInMessage(normalizedMessage: string) {
  const tokens = new Set(normalizedMessage.split(' ').filter(Boolean))
  for (const [weekday, day] of WEEKDAYS_BY_NAME) {
    if (tokens.has(weekday)) return day
  }
  return null
}

function dateMatchesRequestedWeekday(message: string, dateValue: string) {
  const requestedWeekday = weekdayMentionedInMessage(normalize(message))
  if (requestedWeekday === null) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false

  const parsedDate = new Date(`${dateValue}T12:00:00.000Z`)
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.getUTCDay() === requestedWeekday
}

function selectionSignature(value: string) {
  return serviceSelectionTokens(value)
    .sort()
    .join(' ')
}

function serviceSelectionTokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token && ![
      'a', 'al', 'con', 'de', 'del', 'el', 'en', 'hacer', 'hacerme', 'la', 'las',
      'los', 'me', 'para', 'por', 'querer', 'queria', 'quiero', 'reservar', 'agendar', 'turno', 'un', 'una', 'unas',
      'unos', 'y'
    ].includes(token))
}

function serviceLabelMatchScore(messageTokens: string[], labelTokens: string[]) {
  if (!labelTokens.length || !messageTokens.length) return 0
  const matched = labelTokens.filter((labelToken) =>
    messageTokens.some((messageToken) => serviceTokensMatch(labelToken, messageToken))
  ).length
  if (!matched) return 0

  const coverage = matched / labelTokens.length
  const specificity = Math.min(1, labelTokens.length / Math.max(1, messageTokens.length))
  return coverage * 0.9 + specificity * 0.1
}

function serviceTokensMatch(left: string, right: string) {
  if (left === right) return true
  const canonicalLeft = singularServiceToken(left)
  const canonicalRight = singularServiceToken(right)
  if (canonicalLeft === canonicalRight) return true
  if (left.length < 6 || right.length < 6) return false
  return editDistanceAtMostOne(left, right)
}

function singularServiceToken(token: string) {
  if (token.length >= 7 && token.endsWith('ciones')) return `${token.slice(0, -6)}cion`
  if (token.length >= 6 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length >= 5 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function editDistanceAtMostOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false
  let differences = 0
  let leftIndex = 0
  let rightIndex = 0

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    differences += 1
    if (differences > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) differences += 1
  return differences <= 1
}

function discardUngroundedCatalogSelections(
  extraction: BookingV2Extraction,
  message: string,
  catalog: BookingV2DomainCatalog,
  state: BookingV2State
): BookingV2Extraction {
  const groundedName = !extraction.name.value ||
    (
      !nameCollidesWithCatalog(extraction.name.value, catalog) &&
      messageGroundsEvidence(message, extraction.name.evidence)
    )
  const groundedService = !extraction.service.value || catalog.services.some((service) =>
    service.id === extraction.service.value &&
    messageGroundsEvidence(message, extraction.service.evidence) &&
    messageGroundsService(message, service)
  )
  const compatibleProfessionals = catalog.professionals.filter((professional) =>
    !state.draft.service || professional.serviceIds.includes(state.draft.service)
  )
  const professionalResolution = resolveProfessionalReference(message, compatibleProfessionals)
  const groundedProfessional =
    !extraction.professional.value ||
    (
      professionalResolution !== null &&
      professionalResolution.kind !== 'ambiguous' &&
      professionalResolution.professionalId === extraction.professional.value &&
      messageGroundsEvidence(message, extraction.professional.evidence)
    )
  const groundedDate = !extraction.date.value ||
    (
      messageGroundsEvidence(message, extraction.date.evidence) &&
      dateMatchesRequestedWeekday(message, extraction.date.value)
    )
  const groundedTime = !extraction.time.value ||
    messageGroundsEvidence(message, extraction.time.evidence)
  const groundedAdditionalServices = (extraction.additionalServices ?? []).filter((field) =>
    Boolean(field.value) &&
    catalog.services.some((service) =>
      service.id === field.value &&
      messageGroundsEvidence(message, field.evidence) &&
      messageGroundsService(message, service)
    )
  )
  const groundedCorrection = extraction.correction.field === null ||
    (
      messageGroundsEvidence(message, extraction.correction.evidence) &&
      (
        !extraction.correction.newValue ||
        !['service', 'professional', 'date'].includes(extraction.correction.field) ||
        (
        extraction.correction.field === 'service'
          ? catalog.services.some((service) =>
              service.id === extraction.correction.newValue &&
              messageGroundsService(message, service)
            )
          : extraction.correction.field === 'professional'
            ? professionalResolution !== null &&
              professionalResolution.kind !== 'ambiguous' &&
              professionalResolution.professionalId === extraction.correction.newValue
            : dateMatchesRequestedWeekday(message, extraction.correction.newValue)
        )
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
    date: groundedDate
      ? extraction.date
      : { value: null, confidence: 0, evidence: '' },
    time: groundedTime
      ? extraction.time
      : { value: null, confidence: 0, evidence: '' },
    additionalServices: groundedAdditionalServices,
    correction: groundedCorrection
      ? extraction.correction
      : { ...extraction.correction, newValue: null }
  }
}

function queueServicesFromExtraction(
  state: BookingV2State,
  extraction: BookingV2Extraction,
  catalog: BookingV2DomainCatalog
) {
  const primaryServiceId = state.draft.service ?? extraction.service.value
  if (!primaryServiceId || extraction.service.confidence < 0.85) return state
  const services = (extraction.additionalServices ?? [])
    .filter((field) =>
      field.value &&
      field.confidence >= 0.85 &&
      field.evidence &&
      field.value !== primaryServiceId &&
      catalog.serviceIds.has(field.value)
    )
    .map((field) => ({
      serviceId: field.value!,
      evidence: field.evidence
    }))
  if (!services.length) return state
  return addCombinedServices(state, services)
}

type ExplicitServiceGroup =
  | { kind: 'selected'; serviceId: string; evidence: string }
  | { kind: 'ambiguous'; serviceIds: string[]; evidence: string }

function resolveExplicitServiceGroups(
  message: string,
  catalog: BookingV2DomainCatalog
): ExplicitServiceGroup[] {
  if (!hasMultipleServiceSignal(message)) return []
  let protectedMessage = ` ${normalize(message.replace(/[,;]/g, ' servicecomma '))} `
  const protectedServices: Array<{ marker: string; serviceId: string; evidence: string }> = []
  const labelsWithConjunction = catalog.services.flatMap((service) =>
    selectableServiceLabels(service)
      .filter((label) => /\by\b/.test(normalize(label)))
      .map((label) => ({ serviceId: service.id, label, normalizedLabel: normalize(label) }))
  ).sort((left, right) => right.normalizedLabel.length - left.normalizedLabel.length)

  for (const candidate of labelsWithConjunction) {
    const phrase = ` ${candidate.normalizedLabel} `
    if (!protectedMessage.includes(phrase)) continue
    const marker = `serviceref${protectedServices.length}`
    protectedMessage = protectedMessage.split(phrase).join(` ${marker} `)
    protectedServices.push({
      marker,
      serviceId: candidate.serviceId,
      evidence: candidate.label
    })
  }

  const groups = protectedMessage.trim()
    .split(/\b(?:servicecomma|y|tambien|ademas|mas)\b/)
    .flatMap((clause): ExplicitServiceGroup[] => {
      const protectedMatches = protectedServices.filter((service) => clause.includes(service.marker))
      const unprotectedClause = protectedMatches.reduce(
        (value, service) => value.replaceAll(service.marker, ' '),
        clause
      ).trim()
      const resolved = unprotectedClause
        ? resolveCatalogServiceSelection(unprotectedClause, catalog)
        : null
      return [
        ...protectedMatches.map((service) => ({
          kind: 'selected' as const,
          serviceId: service.serviceId,
          evidence: service.evidence
        })),
        ...(resolved?.kind === 'selected'
          ? [{ kind: 'selected' as const, serviceId: resolved.serviceId, evidence: clause.trim() }]
          : resolved?.kind === 'ambiguous'
            ? [{ kind: 'ambiguous' as const, serviceIds: resolved.serviceIds, evidence: clause.trim() }]
            : [])
      ]
    })

  const seen = new Set<string>()
  return groups.filter((group) => {
    const key = group.kind === 'selected'
      ? `selected:${group.serviceId}`
      : `ambiguous:${group.serviceIds.join(':')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 5)
}

function selectableServiceLabels(service: BookingV2DomainCatalog['services'][number]) {
  return [
    service.name,
    ...service.aliases.filter((label) =>
      normalize(label) !== normalize(service.category ?? '') &&
      normalize(label) !== normalize(service.parentServiceName ?? '')
    )
  ]
}

function pendingServiceDisambiguationGroups(
  pending: BookingV2PendingServiceDisambiguation
): BookingV2ServiceDisambiguationGroup[] {
  return [
    { serviceIds: pending.serviceIds, evidence: pending.evidence },
    ...(pending.remainingGroups ?? [])
  ]
}

function pendingServiceDisambiguationFromGroups(
  groups: BookingV2ServiceDisambiguationGroup[]
): BookingV2PendingServiceDisambiguation | null {
  const [current, ...remainingGroups] = groups
  if (!current) return null
  return {
    ...current,
    ...(remainingGroups.length ? { remainingGroups } : {})
  }
}

function resolvePendingServiceDisambiguation(
  message: string,
  pending: BookingV2PendingServiceDisambiguation | null,
  catalog: BookingV2DomainCatalog
) {
  if (!pending) return { selections: [], remainingGroups: [] }
  const selections: Array<{ serviceId: string; evidence: string }> = []
  const remainingGroups: BookingV2ServiceDisambiguationGroup[] = []
  for (const group of pendingServiceDisambiguationGroups(pending)) {
    const serviceIds = new Set(group.serviceIds)
    const groupCatalog = {
      ...catalog,
      services: catalog.services.filter((service) => serviceIds.has(service.id))
    }
    const resolution = resolveCatalogServiceSelection(message, groupCatalog)
    if (resolution?.kind === 'selected' && serviceIds.has(resolution.serviceId)) {
      selections.push({ serviceId: resolution.serviceId, evidence: message.trim() })
    } else {
      remainingGroups.push(group)
    }
  }
  return { selections, remainingGroups }
}

function applyResolvedServiceSelections(
  initialState: BookingV2State,
  selections: Array<{ serviceId: string; evidence: string }>
) {
  let state = initialState
  for (const selection of selections) {
    if (!state.draft.service) {
      state = acceptField(state, 'service', selection.serviceId)
      continue
    }
    if (combinedServiceIds(state).includes(selection.serviceId)) continue
    state = addCombinedServices(state, [selection])
  }
  return state
}

function prepareQuoteOnlySelectedServices(state: BookingV2State) {
  if (!state.quoteOnly || !state.draft.service || state.pendingServiceDisambiguation) return state
  const selectedServiceIds = Array.from(new Set([
    state.draft.service,
    ...state.combinedServices.map((service) => service.serviceId)
  ]))
  const [primaryServiceId, ...additionalServiceIds] = selectedServiceIds
  return {
    ...state,
    draft: {
      ...state.draft,
      service: primaryServiceId ?? null,
      professional: null,
      date: null,
      time: null
    },
    combinedServices: [],
    quoteOnly: queueRemainingServices(
      state.quoteOnly,
      additionalServiceIds,
      primaryServiceId ?? null
    )
  }
}

function hasMultipleServiceSignal(message: string) {
  return /\b(?:y|tambien|ademas|mas)\b/.test(normalize(message))
}

function selectedAddonIdsFromMessage(
  message: string,
  candidateServiceIds: string[],
  catalog: BookingV2DomainCatalog,
  extraction?: BookingV2Extraction | null
) {
  const candidates = new Set(candidateServiceIds)
  const extractedIds = [
    extraction?.service,
    ...(extraction?.additionalServices ?? [])
  ].flatMap((field) =>
    field?.value && field.confidence >= 0.85 && candidates.has(field.value)
      ? [field.value]
      : []
  )
  const normalizedMessage = ` ${normalize(message)} `
  const deterministicIds = catalog.services.flatMap((service) => {
    if (!candidates.has(service.id)) return []
    const matched = [service.name, ...service.aliases].some((label) => {
      const normalizedLabel = normalize(label)
      return normalizedLabel.length >= 3 && normalizedMessage.includes(` ${normalizedLabel} `)
    })
    return matched ? [service.id] : []
  })
  return Array.from(new Set([...extractedIds, ...deterministicIds]))
}

function deterministicAddonDecision(
  message: string,
  candidateServiceIds: string[]
):
  | { type: 'decline' }
  | { type: 'accept'; serviceId: string }
  | { type: 'ambiguous_affirmation' }
  | { type: 'unresolved' } {
  const normalized = normalize(message)
  if (
    /^(?:no|no gracias|ningun[oa]?|sin extras?|continuar|seguimos?|seguir|dejalo asi|dejarlo asi|como esta|solo esos?|solamente esos?)(?:\b|$)/.test(normalized) ||
    /^(?:prefiero|quiero) (?:continuar|seguir|dejarlo asi|solo esos?)/.test(normalized)
  ) {
    return { type: 'decline' }
  }
  const numericChoice = /^([1-9])$/.exec(normalized)
  if (numericChoice) {
    const serviceId = candidateServiceIds[Number(numericChoice[1]) - 1]
    return serviceId ? { type: 'accept', serviceId } : { type: 'unresolved' }
  }
  if (/^(?:si|dale|bueno|ok|okay|joya|perfecto|agregalo|sumalo)$/.test(normalized)) {
    return candidateServiceIds.length === 1
      ? { type: 'accept', serviceId: candidateServiceIds[0]! }
      : { type: 'ambiguous_affirmation' }
  }
  return { type: 'unresolved' }
}

function serviceSelectionKey(serviceIds: string[]) {
  return Array.from(new Set(serviceIds)).sort().join('|')
}

function conflictsWithExclusiveSelectedFamily(
  addonServiceId: string,
  selectedServiceIds: string[],
  catalog: BookingV2DomainCatalog
) {
  const addon = catalog.services.find((service) => service.id === addonServiceId)
  if (!addon?.parentServiceId || addon.parentSelectionMode === 'MULTIPLE') return false
  return selectedServiceIds.some((serviceId) => {
    const selected = catalog.services.find((service) => service.id === serviceId)
    return selected?.parentServiceId === addon.parentServiceId
  })
}

function evaluateServiceCombination(
  serviceIds: string[],
  catalog: BookingV2DomainCatalog
): 'ALLOWED' | 'REVIEW_REQUIRED' | 'BLOCKED' {
  let requiresReview = false
  for (let left = 0; left < serviceIds.length; left += 1) {
    for (let right = left + 1; right < serviceIds.length; right += 1) {
      const leftId = serviceIds[left]!
      const rightId = serviceIds[right]!
      const rule = combinationRuleFor(catalog, leftId, rightId)
      if (rule?.policy === 'BLOCKED') return 'BLOCKED'
      if (rule?.policy === 'REVIEW_REQUIRED') requiresReview = true
    }
  }
  return requiresReview ? 'REVIEW_REQUIRED' : 'ALLOWED'
}

function prepareCombinedServiceDecision(
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
): BookingV2State {
  if (state.quoteOnly) return state
  const selectedServiceIds = combinedServiceIds(state)
  if (selectedServiceIds.length < 2) {
    return state.combinedServiceDecisionQueue === null
      ? state
      : { ...state, combinedServiceDecisionQueue: null }
  }
  const needsDecision = (serviceId: string) => {
    const service = catalog.services.find((candidate) => candidate.id === serviceId)
    return Boolean(service && (
      service.validationEnabled ||
      service.requiresPhoto ||
      service.attentionMode === 'GUIDED_ESTIMATE' ||
      service.attentionMode === 'QUOTE' ||
      service.attentionMode === 'ADVISOR'
    ))
  }
  const queue = (state.combinedServiceDecisionQueue ?? selectedServiceIds)
    .filter((serviceId, index, ids) =>
      selectedServiceIds.includes(serviceId) && needsDecision(serviceId) && ids.indexOf(serviceId) === index
    )
  const queuedState = state.combinedServiceDecisionQueue === queue
    ? state
    : { ...state, combinedServiceDecisionQueue: queue }
  const activeServiceId = queue[0]
  if (!activeServiceId || activeServiceId === state.draft.service) return queuedState
  const evidenceByServiceId = new Map(state.combinedServices.map((service) => [service.serviceId, service.evidence]))
  return {
    ...queuedState,
    draft: {
      ...state.draft,
      service: activeServiceId,
      professional: null,
      date: null,
      time: null
    },
    combinedServices: selectedServiceIds
      .filter((serviceId) => serviceId !== activeServiceId)
      .map((serviceId) => ({ serviceId, evidence: evidenceByServiceId.get(serviceId) ?? '' })),
    serviceValidation: null,
    guidedEstimate: null,
    addonSuggestion: null,
    pendingCombinedAvailability: null
  }
}

function completeCombinedServiceDecision(state: BookingV2State, serviceId: string): BookingV2State {
  if (state.combinedServiceDecisionQueue === null) return state
  return {
    ...state,
    combinedServiceDecisionQueue: state.combinedServiceDecisionQueue.filter(
      (candidate) => candidate !== serviceId
    )
  }
}

function isServiceDecisionPlan(plan: BookingV2MessagePlan) {
  return [
    'show_service_preview_and_ask_name',
    'ask_estimate_option',
    'show_estimate',
    'show_base_estimate',
    'ask_estimate_decision',
    'ask_service_validation',
    'ask_category_advice_confirmation',
    'handoff'
  ].includes(plan.type)
}

function combinedAvailabilityMessages(reply: string) {
  const parts = reply.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return [reply]
  return [parts.slice(0, 2).join('\n\n'), parts.slice(2).join('\n\n')]
}

function withMultipleServicesAcknowledgement(
  result: BookingV2ProcessResult,
  catalog: BookingV2DomainCatalog
): BookingV2ProcessResult {
  if (result.state.quoteOnly) return result
  const serviceIds = [
    result.state.draft.service,
    ...result.state.combinedServices.map((service) => service.serviceId)
  ].filter((serviceId): serviceId is string => Boolean(serviceId))
  const names = serviceIds.map((serviceId) =>
    catalog.services.find((service) => service.id === serviceId)?.name ?? serviceId
  )
  const firstService = names[0]
  if (!firstService || names.length < 2) return result
  return {
    ...result,
    reply: [
      'Perfecto, vamos a reservar estos servicios juntos:',
      ...names.map((name) => `• ${name}`),
      `Duración total: ${serviceIds.reduce((total, serviceId) =>
        total + (catalog.services.find((service) => service.id === serviceId)?.duration ?? 0), 0)} min.`,
      result.reply
    ].join('\n')
  }
}

function messageGroundsEvidence(message: string, evidence: string) {
  const normalizedEvidence = normalize(evidence)
  return Boolean(normalizedEvidence) && normalize(message).includes(normalizedEvidence)
}

function sanitizeCatalogNameCollision(
  state: BookingV2State,
  catalog: BookingV2DomainCatalog
): BookingV2State {
  const queuedServices = state.queuedServices.filter((service, index, services) =>
    catalog.serviceIds.has(service.serviceId) &&
    service.serviceId !== state.draft.service &&
    services.findIndex((candidate) => candidate.serviceId === service.serviceId) === index
  )
  const combinedServices = state.combinedServices.filter((service, index, services) =>
    catalog.serviceIds.has(service.serviceId) &&
    service.serviceId !== state.draft.service &&
    services.findIndex((candidate) => candidate.serviceId === service.serviceId) === index
  )
  let sanitizedState = queuedServices.length === state.queuedServices.length &&
    combinedServices.length === state.combinedServices.length
    ? state
    : { ...state, queuedServices, combinedServices }
  if (sanitizedState.pendingServiceDisambiguation) {
    const groups = pendingServiceDisambiguationGroups(sanitizedState.pendingServiceDisambiguation)
      .map((group) => ({
        ...group,
        serviceIds: group.serviceIds.filter((serviceId, index, ids) =>
          catalog.serviceIds.has(serviceId) && ids.indexOf(serviceId) === index
        )
      }))
      .filter((group) => group.serviceIds.length > 1)
    sanitizedState = {
      ...sanitizedState,
      pendingServiceDisambiguation: pendingServiceDisambiguationFromGroups(groups)
    }
  }
  if (sanitizedState.pendingServiceSeparation && combinedServices.length === 0) {
    sanitizedState = { ...sanitizedState, pendingServiceSeparation: null }
  }
  if (
    sanitizedState.pendingCoordinatedAvailability &&
    sanitizedState.pendingCoordinatedAvailability.serviceIds.some((serviceId) =>
      !catalog.serviceIds.has(serviceId)
    )
  ) {
    sanitizedState = { ...sanitizedState, pendingCoordinatedAvailability: null }
  }
  if (sanitizedState.draft.service && !catalog.serviceIds.has(sanitizedState.draft.service)) {
    sanitizedState = {
      ...sanitizedState,
      draft: clearFieldAndDependents(sanitizedState.draft, 'service'),
      pendingProposal: sanitizedState.pendingProposal?.field === 'service'
        ? null
        : sanitizedState.pendingProposal,
      serviceValidation: null,
      guidedEstimate: null,
      advisorQuote: null,
      pendingDeposit: null,
      pendingServiceDisambiguation: null,
      pendingServiceSeparation: null,
      pendingServiceReplacement: null,
      pendingCoordinatedAvailability: null
    }
  }
  if (
    !sanitizedState.draft.name ||
    !nameCollidesWithCatalog(sanitizedState.draft.name, catalog)
  ) {
    return sanitizedState
  }

  return {
    ...sanitizedState,
    draft: {
      ...sanitizedState.draft,
      name: null
    },
    pendingProposal: sanitizedState.pendingProposal?.field === 'name'
      ? null
      : sanitizedState.pendingProposal
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

function messageGroundsService(
  message: string,
  service: BookingV2DomainCatalog['services'][number]
) {
  if ([service.name, ...service.aliases].some((label) => messageGroundsLabel(message, label))) {
    return true
  }
  if (!service.description?.trim()) return false

  const ignoredTokens = new Set([
    'para', 'como', 'este', 'esta', 'esto', 'servicio', 'incluye', 'ideal',
    'recomendado', 'recomendada', 'personalizado', 'personalizada'
  ])
  const messageTokens = new Set(
    normalize(message)
      .split(' ')
      .filter((token) => token.length >= 4 && !ignoredTokens.has(token))
  )
  const matchingDescriptionTokens = new Set(
    normalize(service.description)
      .split(' ')
      .filter((token) => token.length >= 4 && !ignoredTokens.has(token) && messageTokens.has(token))
  )
  return matchingDescriptionTokens.size >= 2
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

function shouldValidateAvailability(plan: BookingV2MessagePlan) {
  return plan.type === 'confirm_booking' ||
    (plan.type === 'ask_field' && plan.field === 'time') ||
    (plan.type === 'ask_field' && plan.field === 'professional') ||
    (plan.type === 'confirm_field' && plan.field === 'time')
}

function timeToValidate(plan: BookingV2MessagePlan, state: BookingV2State) {
  if (plan.type === 'confirm_booking') return state.draft.time
  if (plan.type === 'confirm_field' && plan.field === 'time') return plan.value
  return null
}
