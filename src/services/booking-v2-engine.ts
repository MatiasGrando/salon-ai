import { BookingV2DomainService } from './booking-v2-domain.js'
import type { BookingV2AvailabilityOption, BookingV2DomainCatalog } from './booking-v2-domain.js'
import { BookingV2Extractor, type BookingV2Extraction } from './booking-v2-extractor.js'
import { buildBookingV2MessagePlan, type BookingV2MessagePlan } from './booking-v2-dialogue.js'
import { renderBookingV2Response } from './booking-v2-response-renderer.js'
import { applyBookingV2Extraction, type BookingV2Interpretation } from './booking-v2-interpreter.js'
import {
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

    if (initialState.pendingProposal) {
      const confirmation = readConfirmation(input.message)
      if (confirmation === 'yes') {
        return this.fromState(confirmProposal(initialState), 'proposal_confirmed', null, null)
      }
      if (confirmation === 'no') {
        return this.fromState(rejectProposal(initialState), 'proposal_rejected', null, null)
      }
      return this.fromInterpretation({
        state: initialState,
        nextField: nextMissingField(initialState.draft),
        outcome: 'confirmation_required',
        affectedField: initialState.pendingProposal.field
      }, null, null)
    }

    const catalog = await this.domain.loadCatalog(input.businessId)
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
    outcome: BookingV2ProcessResult['outcome'] = interpretation.outcome
  ): Promise<BookingV2ProcessResult> {
    const plan = buildBookingV2MessagePlan(interpretation)
    const availabilityOptions = await this.availabilityOptionsForPlan(plan, interpretation.state, catalog)
    return {
      state: interpretation.state,
      conversationPatch: conversationPatchFromState(interpretation.state),
      plan,
      reply: renderBookingV2Response({
        plan,
        draft: interpretation.state.draft,
        catalog,
        availabilityOptions
      }),
      availabilityOptions,
      extraction,
      outcome
    }
  }

  private async availabilityOptionsForPlan(
    plan: BookingV2MessagePlan,
    state: BookingV2State,
    catalog: BookingV2DomainCatalog | null
  ) {
    if (plan.type !== 'ask_field' || plan.field !== 'time') return []
    if (!catalog || !state.draft.service || !state.draft.date) return []

    const availability = await this.domain.findAvailabilityOptions({
      catalog,
      serviceId: state.draft.service,
      professionalId: state.draft.professional,
      date: state.draft.date
    })

    return availability.ok ? availability.options : []
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
