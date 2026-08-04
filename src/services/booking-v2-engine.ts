import {
  BookingV2DomainService,
  catalogCategoryOptions,
  catalogServicesForCategory
} from './booking-v2-domain.js'
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
  acceptField,
  clearFieldAndDependents,
  confirmProposal,
  createEmptyBookingV2State,
  nextMissingField,
  proposeField,
  recordLowConfidence,
  rejectProposal,
  type BookingField,
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

  async process(input: BookingV2ProcessInput): Promise<BookingV2ProcessResult> {
    const storedState = stateFromConversation(input.conversation)
    const catalog = await this.domain.loadCatalog(input.businessId)
    const initialState = sanitizeCatalogNameCollision(storedState, catalog)

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
          return this.guidedEstimateResult(state, {
            type: 'show_base_estimate',
            priceMin: service.price,
            allowsBooking: service.estimateAllowsBooking !== false
          }, catalog, 'accepted')
        }
        const optionExtraction = await this.estimateOptionExtractor.extract({
          message: input.message,
          serviceName: service.name,
          options: (service.estimateOptions ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            note: option.note
          }))
        })
        const option = optionExtraction.confidence >= 0.65
          ? service.estimateOptions?.find((candidate) => candidate.id === optionExtraction.optionId)
          : null
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
        nextField: nextMissingField(initialState.draft),
        outcome: 'confirmation_required',
        affectedField: initialState.pendingProposal.field
      }, null, catalog)
    }

    const serviceChoice =
      nextMissingField(initialState.draft) === 'service' &&
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

    const catalogNavigationResult = await this.handleCatalogNavigation({
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
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'name'
      }, null, catalog)
    }

    let stateForExtraction = initialState
    const deterministicService = resolveExpectedService(input.message, initialState, catalog)
    if (deterministicService?.kind === 'selected') {
      const state = acceptField(initialState, 'service', deterministicService.serviceId)
      if (nextMissingField(initialState.draft) === 'service') {
        return this.fromInterpretation({
          state,
          nextField: nextMissingField(state.draft),
          outcome: 'accepted',
          affectedField: 'service'
        }, null, catalog)
      }
      stateForExtraction = state
    }
    if (
      deterministicService?.kind === 'ambiguous' &&
      nextMissingField(initialState.draft) === 'service'
    ) {
      const serviceSuggestions = catalog.services.filter((service) =>
        deterministicService.serviceIds.includes(service.id)
      )
      const adviceCategory = sharedAdviceCategory(serviceSuggestions)
      const state: BookingV2State = {
        ...initialState,
        categoryAdvice: adviceCategory
          ? {
              categoryName: adviceCategory,
              stage: 'offered'
            }
          : null
      }
      return this.fromInterpretation({
        state,
        nextField: 'service',
        outcome: 'no_change',
        affectedField: 'service'
      }, null, catalog, 'no_change', {
        serviceSuggestions
      })
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
        nextField: nextMissingField(state.draft),
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
        nextField: nextMissingField(state.draft),
        outcome: 'confirmation_required',
        affectedField: 'professional'
      }, null, catalog)
    }

    const deterministicDate = resolveExpectedDate(
      input.message,
      stateForExtraction,
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
        nextField: nextMissingField(state.draft),
        outcome: 'accepted',
        affectedField: 'time'
      }, null, catalog)
    }

    const extractionCatalog = this.domain.toExtractionCatalog(catalog)
    const rawExtraction = input.understandingExtraction === undefined
      ? await this.extractor.extract({
          message: input.message,
          draft: stateForExtraction.draft,
          expectedField: nextMissingField(stateForExtraction.draft),
          services: extractionCatalog.services,
          professionals: extractionCatalog.professionals,
          ...(input.currentDate ? { currentDate: input.currentDate } : {})
        })
      : input.understandingExtraction

    if (!rawExtraction) {
      const expectedField = nextMissingField(stateForExtraction.draft)
      if (
        shouldCountFailedProfessionalSelection(input.message, expectedField) ||
        shouldCountFailedCatalogSelection(input.message, expectedField, catalog)
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
        nextField: nextMissingField(stateForExtraction.draft),
        outcome: 'no_change',
        affectedField: deterministicService?.kind === 'selected' ? 'service' : null
      }, null, catalog)
    }
    const extraction = discardUngroundedCatalogSelections(
      rawExtraction,
      input.message,
      catalog,
      stateForExtraction
    )

    const interpretation = applyBookingV2Extraction(
      stateForExtraction,
      extraction,
      this.domain.toInterpreterCatalog(catalog)
    )
    const expectedField = nextMissingField(stateForExtraction.draft)
    const affectedField = expectedField === 'confirmation' ? null : expectedField
    const effectiveInterpretation = interpretation.outcome === 'no_change' &&
      shouldCountFailedProfessionalSelection(input.message, expectedField)
      ? {
          state: recordLowConfidence(interpretation.state),
          nextField: expectedField,
          outcome: 'not_understood' as const,
          affectedField
        }
      : interpretation

    return this.fromInterpretation(
      effectiveInterpretation,
      extraction,
      catalog
    )
  }

  private async handleCatalogNavigation(input: {
    message: string
    state: BookingV2State
    catalog: BookingV2DomainCatalog
  }): Promise<BookingV2ProcessResult | null> {
    if (
      input.catalog.displayMode !== 'CATEGORIES_FIRST' ||
      nextMissingField(input.state.draft) !== 'service'
    ) {
      return null
    }
    const categories = catalogCategoryOptions(input.catalog)
    if (!categories.some((category) => category.name !== 'Otros')) return null

    const directService = resolveCatalogServiceSelection(input.message, input.catalog)
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
    if (isShowAllServicesMessage(normalizedMessage)) {
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
        nextField: nextMissingField(state.draft),
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
    const canEvaluateSelectedService = Boolean(
      selectedService && effectiveInterpretation.state.draft.name
    )
    const assistedSelectedService = Boolean(
      selectedService && (
        selectedService.requiresPhoto || (
          selectedService.attentionMode !== undefined &&
          selectedService.attentionMode !== 'DIRECT_BOOKING'
        )
      )
    )
    if (selectedService && !effectiveInterpretation.state.draft.name && assistedSelectedService) {
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
      offeredCategoryServices(effectiveInterpretation.state, catalog)

    return {
      state: effectiveInterpretation.state,
      conversationPatch: conversationPatchFromState(effectiveInterpretation.state),
      plan,
      reply: renderBookingV2Response({
        plan,
        draft: effectiveInterpretation.state.draft,
        agenda: effectiveInterpretation.state.agenda,
        catalogNavigation: effectiveInterpretation.state.catalogNavigation,
        catalog,
        availabilityOptions,
        unavailableDate,
        ...(serviceSuggestions ? { serviceSuggestions } : {})
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
    const reconciledState = reconcileBookingV2Agenda(state, plan, [])
    return {
      state: reconciledState,
      conversationPatch: conversationPatchFromState(reconciledState),
      plan,
      reply: renderBookingV2Response({
        plan,
        draft: reconciledState.draft,
        agenda: reconciledState.agenda,
        catalogNavigation: reconciledState.catalogNavigation,
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

function isShowAllServicesMessage(normalizedMessage: string) {
  return [
    'ver todos',
    'ver todos los servicios',
    'mostrar todos',
    'mostrar todos los servicios',
    'todos los servicios',
    'catalogo completo'
  ].includes(normalizedMessage)
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

  const exactMatches = catalog.services.filter((service) =>
    [service.name, ...service.aliases].some((label) => selectionSignature(label) === signature)
  )
  if (exactMatches.length === 1) {
    return {
      kind: 'selected' as const,
      serviceId: exactMatches[0]?.id ?? ''
    }
  }

  const messageTokens = serviceSelectionTokens(message)
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

function resolveExpectedDate(message: string, state: BookingV2State, currentDate: Date) {
  if (nextMissingField(state.draft) !== 'date') return null
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
      'los', 'me', 'para', 'por', 'querer', 'queria', 'quiero', 'un', 'una', 'unas',
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
    correction: groundedCorrection
      ? extraction.correction
      : { ...extraction.correction, newValue: null }
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
    (plan.type === 'confirm_field' && plan.field === 'time')
}

function timeToValidate(plan: BookingV2MessagePlan, state: BookingV2State) {
  if (plan.type === 'confirm_booking') return state.draft.time
  if (plan.type === 'confirm_field' && plan.field === 'time') return plan.value
  return null
}
