import assert from 'node:assert/strict'
import {
  ANY_PROFESSIONAL_ID,
  acceptField,
  confidenceLevel,
  confirmProposal,
  createEmptyBookingV2State,
  nextMissingField,
  proposeCorrection,
  proposeField,
  recordLowConfidence,
  rejectProposal
} from '../src/services/booking-v2-state.js'
import { applyBookingV2Extraction } from '../src/services/booking-v2-interpreter.js'
import type { BookingV2Extraction } from '../src/services/booking-v2-extractor.js'
import { buildBookingV2MessagePlan } from '../src/services/booking-v2-dialogue.js'
import { BookingV2DomainService, createBookingV2DomainCatalog } from '../src/services/booking-v2-domain.js'
import type { BookingProvider } from '../src/providers/booking-provider.js'
import {
  conversationPatchFromState,
  stateFromConversation
} from '../src/services/booking-v2-conversation-state.js'
import { BookingV2Engine } from '../src/services/booking-v2-engine.js'
import {
  calculateBookingV2Deposit,
  renderBookingV2DepositRequest,
  renderBookingV2PaymentInstructions
} from '../src/services/booking-v2-deposit.js'
import type { BookingV2Catalog } from '../src/services/booking-v2-interpreter.js'
import type { BookingV2CatalogOption } from '../src/services/booking-v2-extractor.js'
import {
  formatServiceOptions,
  renderBookingV2Response
} from '../src/services/booking-v2-response-renderer.js'
import {
  businessInformationTopicsFromRouting,
  deterministicConversationRouting,
  mergeConversationRouting,
  normalizeConversationRouting
} from '../src/services/conversation-router.js'
import {
  renderBusinessKnowledgeAnswers,
  renderCatalogServiceQuery
} from '../src/services/business-knowledge-service.js'
import {
  acceptedAdvisorQuoteAmount,
  bookingV2StateAfterGoingBack,
  clearBookingV2StateFromField,
  composeBusinessInformationResumeReply,
  freshBookingV2State,
  isBookingV2ConversationClosing,
  isBookingV2GreetingOnlyMessage,
  isPostBookingWellbeingQuestion,
  mergeBookingV2AgendaFromRouting,
  pendingRequestFromRouting,
  splitWhatsAppReply,
  shouldShowBookingV2IntentFallback,
  shouldRouteBookingV2HumanHandoff,
  withBusinessInformationFollowUp
} from '../src/services/conversation-service.js'
import { BotCopyService } from '../src/services/bot-copy-service.js'
import { removeCurrentInboundFromHistory } from '../src/services/conversation-router-context-service.js'
import { mergeBookingV2ConversationalCopy } from '../src/services/ai-message-understanding-service.js'
import {
  applyAssistantPersonalityToReply,
  assistantPersonalityPreview,
  buildAssistantPersonalityInstructions,
  normalizeAssistantPersonality,
  personalityForPreset
} from '../src/services/assistant-personality-service.js'
import {
  buildIncomingConversationUpsert,
  isSupportedDepositProof,
  WhatsAppWebhookService
} from '../src/services/whatsapp-webhook-service.js'
import {
  PHOTO_QUOTE_ACKNOWLEDGEMENT,
  PhotoQuoteAcknowledgementService
} from '../src/services/photo-quote-acknowledgement-service.js'
import { conversationCompletionPatchFromAppointment } from '../src/services/conversation-opportunity-service.js'

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'una reserva manual completa el chat y descarta el borrador derivado',
    run: () => {
      const completedAt = new Date('2026-07-29T12:00:00.000Z')
      const patch = conversationCompletionPatchFromAppointment(completedAt)
      assert.equal(patch.currentStep, 'COMPLETED')
      assert.equal(patch.aiEnabled, true)
      assert.equal(patch.selectedServiceId, null)
      assert.equal(patch.selectedProfessionalId, null)
      assert.equal(patch.selectedDate, null)
      assert.equal(patch.selectedTime, null)
      assert.equal(patch.misunderstandingCount, 0)
      assert.equal(patch.humanHandoffResolvedAt, completedAt)
    }
  },
  {
    name: 'respeta el orden canonico aunque haya datos adelantados',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'service', 'service-1')
      state = acceptField(state, 'date', '2026-07-10')
      assert.equal(nextMissingField(state.draft), 'name')
      state = acceptField(state, 'name', 'Juan')
      assert.equal(nextMissingField(state.draft), 'professional')
    }
  },
  {
    name: 'clasifica confianza alta media y baja',
    run: () => {
      assert.equal(confidenceLevel(0.95), 'high')
      assert.equal(confidenceLevel(0.7), 'medium')
      assert.equal(confidenceLevel(0.2), 'low')
    }
  },
  {
    name: 'seña fija conserva el monto configurado',
    run: () => {
      assert.deepEqual(calculateBookingV2Deposit({
        mode: 'FIXED',
        value: 20000,
        servicePrice: 90000,
        estimateMinimum: null
      }), {
        mode: 'FIXED',
        configuredValue: 20000,
        baseAmount: null,
        amount: 20000
      })
    }
  },
  {
    name: 'seña porcentual usa la banda minima del estimativo',
    run: () => {
      const calculation = calculateBookingV2Deposit({
        mode: 'PERCENTAGE',
        value: 30,
        servicePrice: 80000,
        estimateMinimum: 100000
      })
      assert.deepEqual(calculation, {
        mode: 'PERCENTAGE',
        configuredValue: 30,
        baseAmount: 100000,
        amount: 30000
      })
      const reply = renderBookingV2DepositRequest({
        serviceName: 'Iluminación',
        calculation: calculation!
      })
      assert.equal(reply.includes('$ 30.000'), true)
      assert.equal(reply.includes('$ 100.000'), true)
      assert.equal(reply.includes('comprobante'), true)
      assert.equal(reply.includes('confirmará el turno'), true)
    }
  },
  {
    name: 'pedido de seña incluye transferencia y enlace configurados',
    run: () => {
      const instructions = renderBookingV2PaymentInstructions({
        transferEnabled: true,
        alias: 'barber.colapinta',
        cbu: '1234567890123456789012',
        cvu: null,
        accountHolder: 'Barber Colapinta',
        paymentLinkEnabled: true,
        paymentLink: 'https://example.com/pagar',
        instructions: 'Incluí tu nombre en el concepto.'
      })
      assert.equal(instructions.includes('Alias: barber.colapinta'), true)
      assert.equal(instructions.includes('CBU: 1234567890123456789012'), true)
      assert.equal(instructions.includes('Titular: Barber Colapinta'), true)
      assert.equal(instructions.includes('https://example.com/pagar'), true)
      assert.equal(instructions.includes('Incluí tu nombre'), true)
    }
  },
  {
    name: 'confianza media no modifica el borrador hasta confirmar',
    run: () => {
      const initial = createEmptyBookingV2State()
      const proposed = proposeField(initial, {
        field: 'service',
        value: 'haircut',
        confidence: 0.72,
        evidence: 'quiero un corte'
      })
      assert.equal(proposed.draft.service, null)
      assert.equal(proposed.pendingProposal?.value, 'haircut')

      const confirmed = confirmProposal(proposed)
      assert.equal(confirmed.draft.service, 'haircut')
      assert.equal(confirmed.pendingProposal, null)
    }
  },
  {
    name: 'rechazar una propuesta conserva el estado anterior',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'service', 'haircut')
      state = proposeField(state, {
        field: 'professional',
        value: 'professional-2',
        confidence: 0.68,
        evidence: 'creo que con Nico'
      })
      state = rejectProposal(state)
      assert.equal(state.draft.service, 'haircut')
      assert.equal(state.draft.professional, null)
    }
  },
  {
    name: 'confianza baja no guarda y suma incomprension',
    run: () => {
      const state = recordLowConfidence(createEmptyBookingV2State())
      assert.equal(state.draft.service, null)
      assert.equal(state.pendingProposal, null)
      assert.equal(state.misunderstandingCount, 1)
    }
  },
  {
    name: 'cambiar servicio invalida profesional y horario pero conserva fecha',
    run: () => {
      let state = completeDraft()
      state = acceptField(state, 'service', 'beard')
      assert.equal(state.draft.name, 'Juan')
      assert.equal(state.draft.service, 'beard')
      assert.equal(state.draft.professional, null)
      assert.equal(state.draft.date, '2026-07-10')
      assert.equal(state.draft.time, null)
    }
  },
  {
    name: 'confirmar mejor otro dia limpia fecha y horario',
    run: () => {
      let state = completeDraft()
      state = proposeCorrection(state, 'date', 'mejor quiero otro dia')
      assert.equal(state.draft.date, '2026-07-10')
      state = confirmProposal(state)
      assert.equal(state.draft.name, 'Juan')
      assert.equal(state.draft.service, 'haircut')
      assert.equal(state.draft.professional, 'professional-1')
      assert.equal(state.draft.date, null)
      assert.equal(state.draft.time, null)
      assert.equal(nextMissingField(state.draft), 'date')
    }
  },
  {
    name: 'rechazar cambio de dia conserva fecha y horario',
    run: () => {
      let state = completeDraft()
      state = proposeCorrection(state, 'date', 'mejor quiero otro dia')
      state = rejectProposal(state)
      assert.equal(state.draft.date, '2026-07-10')
      assert.equal(state.draft.time, '15:00')
    }
  },
  {
    name: 'acepta campos claros y confirma solamente el campo medio',
    run: () => {
      const interpretation = applyBookingV2Extraction(
        createEmptyBookingV2State(),
        extraction({
          name: field('Juan', 0.98, 'soy Juan'),
          service: field('haircut', 0.7, 'quiero un corte'),
          date: field('2026-07-10', 0.94, 'el viernes')
        }),
        catalog()
      )
      assert.equal(interpretation.state.draft.name, 'Juan')
      assert.equal(interpretation.state.draft.date, '2026-07-10')
      assert.equal(interpretation.state.draft.service, null)
      assert.equal(interpretation.state.pendingProposal?.field, 'service')
      assert.equal(interpretation.outcome, 'confirmation_required')
    }
  },
  {
    name: 'rechaza ids inventados aunque la IA declare confianza alta',
    run: () => {
      const interpretation = applyBookingV2Extraction(
        createEmptyBookingV2State(),
        extraction({
          service: field('invented-service', 0.99, 'quiero algo inventado')
        }),
        catalog()
      )
      assert.equal(interpretation.state.draft.service, null)
      assert.equal(interpretation.outcome, 'no_change')
    }
  },
  {
    name: 'evidencia de baja confianza en el campo actual suma incomprension',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'name', 'Juan')
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          service: field(null, 0.2, 'quiero cortarme el lope')
        }),
        catalog()
      )
      assert.equal(interpretation.outcome, 'not_understood')
      assert.equal(interpretation.affectedField, 'service')
      assert.equal(interpretation.state.misunderstandingCount, 1)
    }
  },
  {
    name: 'una correccion se confirma antes de modificar el borrador',
    run: () => {
      const state = completeDraft()
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          correction: {
            field: 'date',
            newValue: null,
            confidence: 0.93,
            evidence: 'mejor quiero otro dia'
          }
        }),
        catalog()
      )
      assert.equal(interpretation.state.draft.date, '2026-07-10')
      assert.equal(interpretation.state.pendingProposal?.kind, 'correction')
      assert.equal(interpretation.outcome, 'confirmation_required')
    }
  },
  {
    name: 'no interpreta como correccion un campo que todavia no fue elegido',
    run: () => {
      const interpretation = applyBookingV2Extraction(
        acceptField(createEmptyBookingV2State(), 'name', 'Mati'),
        extraction({
          correction: {
            field: 'service',
            newValue: null,
            confidence: 0.9,
            evidence: 'Corte'
          }
        }),
        catalog()
      )

      assert.equal(interpretation.state.pendingProposal, null)
      assert.equal(interpretation.nextField, 'service')
      assert.equal(interpretation.outcome, 'no_change')
    }
  },
  {
    name: 'no inventa una correccion de fecha a partir de una hora compacta',
    run: () => {
      const interpretation = applyBookingV2Extraction(
        completeDraft(),
        extraction({
          correction: {
            field: 'date',
            newValue: '2026-07-28',
            confidence: 0.9,
            evidence: '1830'
          }
        }),
        catalog()
      )

      assert.equal(interpretation.state.pendingProposal, null)
      assert.equal(interpretation.state.draft.date, '2026-07-10')
    }
  },
  {
    name: 'confianza baja genera una repregunta humana del campo actual',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'name', 'Juan')
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          service: field(null, 0.15, 'quiero cortarme el lope')
        }),
        catalog()
      )
      const plan = buildBookingV2MessagePlan(interpretation)
      assert.deepEqual(plan, {
        type: 'ask_field',
        field: 'service',
        reason: 'not_understood',
        misunderstandingCount: 1
      })
    }
  },
  {
    name: 'tres incomprensiones generan derivacion',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'name', 'Juan')
      state = recordLowConfidence(state)
      state = recordLowConfidence(state)
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          service: field(null, 0.1, 'texto imposible')
        }),
        catalog()
      )
      assert.deepEqual(buildBookingV2MessagePlan(interpretation), {
        type: 'handoff',
        reason: 'repeated_misunderstanding'
      })
    }
  },
  {
    name: 'correccion ambigua genera confirmacion sin cambiar datos',
    run: () => {
      const interpretation = applyBookingV2Extraction(
        completeDraft(),
        extraction({
          correction: {
            field: 'date',
            newValue: null,
            confidence: 0.9,
            evidence: 'mejor otro dia'
          }
        }),
        catalog()
      )
      assert.deepEqual(buildBookingV2MessagePlan(interpretation), {
        type: 'confirm_correction',
        field: 'date',
        value: null,
        evidence: 'mejor otro dia'
      })
    }
  },
  {
    name: 'rechaza profesional incompatible con el servicio elegido',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'service', 'haircut')
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          professional: field('professional-2', 0.95, 'con Ana')
        }),
        catalog()
      )
      assert.equal(interpretation.state.draft.professional, null)
      assert.equal(interpretation.outcome, 'no_change')
    }
  },
  {
    name: 'acepta profesional compatible con el servicio elegido',
    run: () => {
      let state = createEmptyBookingV2State()
      state = acceptField(state, 'service', 'haircut')
      const interpretation = applyBookingV2Extraction(
        state,
        extraction({
          professional: field('professional-1', 0.95, 'con Nico')
        }),
        catalog()
      )
      assert.equal(interpretation.state.draft.professional, 'professional-1')
      assert.equal(interpretation.outcome, 'accepted')
    }
  },
  {
    name: 'consulta disponibilidad solo para profesionales compatibles',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte', aliases: ['corte de pelo'], duration: 30, price: 15000, category: null },
          { id: 'beard', name: 'Barba', aliases: [], duration: 20, price: null, category: null }
        ],
        professionals: [
          { id: 'professional-1', name: 'Nico', serviceIds: ['haircut'] },
          { id: 'professional-2', name: 'Ana', serviceIds: ['beard'] }
        ]
      })
      const provider = fakeBookingProvider({
        'professional-1': ['15:00', '15:30'],
        'professional-2': ['16:00']
      })
      const domain = new BookingV2DomainService({} as never, provider)

      const availability = await domain.findAvailabilityOptions({
        catalog: domainCatalog,
        serviceId: 'haircut',
        date: '2026-07-10'
      })

      assert.equal(availability.ok, true)
      assert.deepEqual(provider.calls.map((call) => call.professionalId), ['professional-1'])
      if (availability.ok) {
        assert.deepEqual(availability.options.map((option) => option.time), ['15:00', '15:30'])
      }
    }
  },
  {
    name: 'reutiliza los datos existentes de la conversacion vieja',
    run: () => {
      const state = stateFromConversation({
        selectedCustomerName: 'Juan Perez',
        selectedServiceId: 'haircut',
        selectedProfessionalId: 'professional-1',
        selectedDate: '2026-07-10',
        selectedTime: null,
        misunderstandingCount: 2
      })

      assert.deepEqual(state.draft, {
        name: 'Juan Perez',
        service: 'haircut',
        professional: 'professional-1',
        date: '2026-07-10',
        time: null
      })
      assert.equal(state.pendingProposal, null)
      assert.equal(state.misunderstandingCount, 2)
      assert.deepEqual(conversationPatchFromState(state), {
        selectedCustomerName: 'Juan Perez',
        selectedServiceId: 'haircut',
        selectedProfessionalId: 'professional-1',
        selectedDate: '2026-07-10',
        selectedTime: null,
        misunderstandingCount: 2,
        bookingV2State: null
      })
    }
  },
  {
    name: 'persiste y recupera una confirmacion pendiente',
    run: () => {
      let state = createEmptyBookingV2State()
      state = proposeField(state, {
        field: 'service',
        value: 'haircut',
        confidence: 0.7,
        evidence: 'quiero un corte'
      })
      const patch = conversationPatchFromState(state)

      assert.deepEqual(patch.bookingV2State, {
        version: 1,
        pendingProposal: {
          field: 'service',
          value: 'haircut',
          confidence: 0.7,
          evidence: 'quiero un corte',
          kind: 'field'
        }
      })

      const restored = stateFromConversation({
        selectedCustomerName: null,
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: patch.bookingV2State
      })

      assert.deepEqual(restored.pendingProposal, state.pendingProposal)
    }
  },
  {
    name: 'persiste la seña pendiente con el contexto de la reserva',
    run: () => {
      const state = {
        ...completeDraft(),
        pendingDeposit: {
          depositId: 'deposit-1',
          appointmentId: 'appointment-1',
          serviceId: 'haircut',
          mode: 'PERCENTAGE' as const,
          configuredValue: 30,
          baseAmount: 100000,
          amount: 30000,
          status: 'awaiting_proof' as const,
          expiresAt: '2026-07-10T15:30:00.000Z'
        }
      }
      const patch = conversationPatchFromState(state)
      const restored = stateFromConversation({
        ...patch,
        bookingV2State: patch.bookingV2State
      })
      assert.deepEqual(restored.pendingDeposit, state.pendingDeposit)
      assert.equal(restored.draft.time, '15:00')
    }
  },
  {
    name: 'persiste el presupuesto del asesor y su aceptacion',
    run: () => {
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'illumination',
          professional: null,
          date: null,
          time: null
        },
        advisorQuote: {
          serviceId: 'illumination',
          amount: 160000,
          note: 'Incluye producto',
          status: 'awaiting_acceptance' as const,
          quotedAt: '2026-07-28T23:45:00.000Z'
        }
      }
      const patch = conversationPatchFromState(state)
      const restored = stateFromConversation({
        ...patch,
        bookingV2State: patch.bookingV2State
      })
      assert.deepEqual(restored.advisorQuote, state.advisorQuote)
      assert.equal(restored.draft.service, 'illumination')
      assert.equal(acceptedAdvisorQuoteAmount(restored, 'illumination'), null)
      restored.advisorQuote = restored.advisorQuote
        ? { ...restored.advisorQuote, status: 'accepted' }
        : null
      assert.equal(acceptedAdvisorQuoteAmount(restored, 'illumination'), 160000)
    }
  },
  {
    name: 'ignora estado booking v2 invalido guardado en la conversacion',
    run: () => {
      const state = stateFromConversation({
        selectedCustomerName: null,
        selectedServiceId: null,
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: {
          version: 1,
          pendingProposal: {
            field: 'service',
            value: 123,
            confidence: 0.8,
            evidence: 'corte',
            kind: 'field'
          }
        }
      })

      assert.equal(state.pendingProposal, null)
    }
  },
  {
    name: 'cancelar una reserva en curso conserva el cliente y limpia todo el borrador',
    run: () => {
      const cancelled = freshBookingV2State('Mati')
      assert.deepEqual(cancelled.draft, {
        name: 'Mati',
        service: null,
        professional: null,
        date: null,
        time: null
      })
      assert.equal(cancelled.pendingProposal, null)
      assert.equal(cancelled.guidedEstimate, null)
      assert.equal(cancelled.advisorQuote, null)
      assert.equal(cancelled.pendingDeposit, null)
    }
  },
  {
    name: 'volver retrocede exactamente un paso sin dejar estados que traben el flujo',
    run: () => {
      const initial = completeDraft()
      const cases = [
        ['CONFIRM', 'time'],
        ['ASK_TIME', 'date'],
        ['ASK_DATE', 'professional'],
        ['ASK_PROFESSIONAL', 'service']
      ] as const

      for (const [step, expectedField] of cases) {
        const previous = bookingV2StateAfterGoingBack(initial, step)
        assert.equal(nextMissingField(previous.draft), expectedField, step)
        assert.equal(previous.pendingProposal, null, step)
        assert.equal(previous.pendingDeposit, null, step)
      }

      const guided = {
        ...initial,
        guidedEstimate: {
          serviceId: 'haircut',
          stage: 'awaiting_decision' as const,
          optionId: 'short',
          optionLabel: 'Corto',
          priceMin: 10000,
          priceMax: 15000
        }
      }
      const previousGuided = bookingV2StateAfterGoingBack(guided, 'ASK_SERVICE')
      assert.equal(previousGuided.draft.service, null)
      assert.equal(previousGuided.guidedEstimate, null)
    }
  },
  {
    name: 'router acepta navegacion y pedido de ayuda semanticos sin palabras reservadas',
    run: () => {
      const cases = [
        ['cancel_booking', 'dejemos esta gestión acá'],
        ['go_back', 'mejor regresemos a lo que elegí antes'],
        ['restart_booking', 'arranquemos una nueva desde cero'],
        ['request_human', 'estoy perdido con cuál me conviene']
      ] as const
      for (const [type, evidence] of cases) {
        const routing = normalizeConversationRouting({
          intents: [{ type, topic: null, confidence: 0.94, evidence }],
          bookingMessage: null,
          bookingExtraction: null,
          catalogQuery: null
        })
        assert.equal(routing.intents[0]?.type, type)
        assert.equal(routing.intents[0]?.confidence, 0.94)
      }
    }
  },
  {
    name: 'una consulta informativa no deriva por una sospecha debil de pedir humano',
    run: () => {
      const informative = normalizeConversationRouting({
        intents: [
          { type: 'business_information', topic: 'prices', confidence: 0.8, evidence: 'qué inversión requiere' },
          { type: 'request_human', topic: null, confidence: 0.6, evidence: 'qué inversión requiere' }
        ],
        bookingMessage: null,
        bookingExtraction: null,
        catalogQuery: null
      })
      const explicitHuman = normalizeConversationRouting({
        intents: [
          { type: 'business_information', topic: 'prices', confidence: 0.8, evidence: 'precio' },
          { type: 'request_human', topic: null, confidence: 0.9, evidence: 'quiero hablar con alguien' }
        ],
        bookingMessage: null,
        bookingExtraction: null,
        catalogQuery: null
      })

      assert.equal(shouldRouteBookingV2HumanHandoff({ ...informative, source: 'ai' }), false)
      assert.equal(shouldRouteBookingV2HumanHandoff({ ...explicitHuman, source: 'ai' }), true)
    }
  },
  {
    name: 'motor carga catalogo extrae aplica reglas y devuelve patch',
    run: async () => {
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        fakeExtractor(extraction({
          name: field('Juan', 0.95, 'soy Juan'),
          service: field('haircut', 0.95, 'corte de pelo')
        }))
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: null,
        message: 'soy Juan y quiero corte de pelo',
        currentDate: new Date('2026-07-01T12:00:00')
      })

      assert.equal(result.state.draft.name, 'Juan')
      assert.equal(result.state.draft.service, 'haircut')
      assert.equal(result.conversationPatch.selectedCustomerName, 'Juan')
      assert.equal(result.conversationPatch.selectedServiceId, 'haircut')
      assert.deepEqual(result.plan, {
        type: 'ask_field',
        field: 'professional',
        reason: 'missing',
        misunderstandingCount: 0
      })
      assert.equal(result.reply.includes('• Nico'), true)
      assert.equal(result.reply.includes('• Cualquier profesional'), true)
      assert.equal(result.reply.includes('Ana'), false)
    }
  },
  {
    name: 'propone profesional ante apodo probable y espera confirmacion',
    run: async () => {
      const nicknameCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'roots',
          name: 'Raices',
          aliases: ['raices'],
          duration: 60,
          price: 40000,
          category: null
        }],
        professionals: [
          { id: 'tamara', name: 'Tamara', serviceIds: ['roots'] },
          { id: 'lucas', name: 'Lucas', serviceIds: ['roots'] }
        ]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: nicknameCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )
      const conversation = {
        selectedCustomerName: 'Mati',
        selectedServiceId: 'roots',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null
      }

      const proposed = await engine.process({
        businessId: 'business-1',
        conversation,
        message: 'con tami'
      })

      assert.equal(proposed.state.draft.professional, null)
      assert.equal(proposed.state.pendingProposal?.field, 'professional')
      assert.equal(proposed.state.pendingProposal?.value, 'tamara')
      assert.equal(proposed.plan.type, 'confirm_field')
      assert.equal(proposed.reply.includes('• Tamara'), true)
      assert.equal(proposed.reply.includes('• Lucas'), true)
      assert.equal(proposed.reply.includes('• Cualquier profesional'), true)
      assert.equal(proposed.reply.includes('¿Te agendo con Tamara?'), true)

      const confirmed = await engine.process({
        businessId: 'business-1',
        conversation: proposed.conversationPatch,
        message: 'si'
      })
      assert.equal(confirmed.state.draft.professional, 'tamara')
      assert.equal(confirmed.state.pendingProposal, null)
      assert.equal(confirmed.plan.type === 'ask_field' ? confirmed.plan.field : null, 'date')
    }
  },
  {
    name: 'propone profesional ante typo de una letra sin entrar en loop',
    run: async () => {
      const typoCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'haircut',
          name: 'Corte',
          aliases: ['corte'],
          duration: 30,
          price: 15000,
          category: null
        }],
        professionals: [
          { id: 'lucas', name: 'Lucas', serviceIds: ['haircut'] },
          { id: 'tamara', name: 'Tamara', serviceIds: ['haircut'] }
        ]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: typoCatalog }),
        fakeExtractor(null)
      )
      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'con lcas'
      })

      assert.equal(result.state.pendingProposal?.field, 'professional')
      assert.equal(result.state.pendingProposal?.value, 'lucas')
      assert.equal(result.plan.type, 'confirm_field')
      assert.match(result.reply, /agendo con Lucas/i)
    }
  },
  {
    name: 'cuenta falta de avance y deriva al tercer intento desconocido',
    run: async () => {
      const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
      let conversation = {
        selectedCustomerName: 'Mati',
        selectedServiceId: 'haircut',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null as unknown
      }

      const first = await engine.process({
        businessId: 'business-1',
        conversation,
        message: 'con zzz'
      })
      assert.equal(first.outcome, 'not_understood')
      assert.equal(first.state.misunderstandingCount, 1)

      const second = await engine.process({
        businessId: 'business-1',
        conversation: first.conversationPatch,
        message: 'con zzz'
      })
      assert.equal(second.state.misunderstandingCount, 2)
      assert.equal(second.plan.type, 'ask_field')

      const third = await engine.process({
        businessId: 'business-1',
        conversation: second.conversationPatch,
        message: 'con zzz'
      })
      assert.equal(third.state.misunderstandingCount, 3)
      assert.deepEqual(third.plan, { type: 'handoff', reason: 'repeated_misunderstanding' })
    }
  },
  {
    name: 'propone profesional ante diminutivo espanol',
    run: async () => {
      const nicknameCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'haircut',
          name: 'Corte',
          aliases: ['corte'],
          duration: 30,
          price: 15000,
          category: null
        }],
        professionals: [
          { id: 'marcos', name: 'Marcos', serviceIds: ['haircut'] },
          { id: 'lucas', name: 'Lucas', serviceIds: ['haircut'] }
        ]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: nicknameCatalog }),
        fakeExtractor(null)
      )
      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Marquitos'
      })

      assert.equal(result.state.pendingProposal?.value, 'marcos')
      assert.equal(result.reply.includes('¿Te agendo con Marcos?'), true)
    }
  },
  {
    name: 'comprension estructurada conserva un servicio adelantado mientras pide el nombre',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'illumination',
          name: 'Iluminación',
          aliases: ['iluminacion'],
          duration: 90,
          price: 50000,
          priceMode: 'STARTING_AT',
          category: 'Coloración',
          attentionMode: 'QUOTE',
          requiresPhoto: true,
          estimateExplanation: 'El precio puede variar según el largo, la cantidad de cabello y el resultado buscado.'
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['illumination']
        }]
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), extractor)
      const routing = {
        intents: [
          { type: 'book_appointment' as const, topic: null, confidence: 0.98, evidence: 'hacerme unas iluminaciones' },
          { type: 'request_quote' as const, topic: null, confidence: 0.96, evidence: 'saber presupuestos' },
          { type: 'availability_preference' as const, topic: null, confidence: 0.9, evidence: 'horarios' }
        ],
        bookingMessage: 'Quería hacerme unas iluminaciones, saber presupuestos y horarios.',
        source: 'ai' as const
      }
      const initialState = mergeBookingV2AgendaFromRouting({
        state: createEmptyBookingV2State(),
        routing,
        now: new Date('2026-08-01T12:00:00.000Z')
      })
      const first = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(initialState),
        message: 'Quería hacerme unas iluminaciones, saber presupuestos y horarios.',
        understandingExtraction: null
      })

      assert.equal(first.state.draft.service, 'illumination')
      assert.equal(first.state.draft.name, null)
      assert.deepEqual(first.plan, {
        type: 'show_service_preview_and_ask_name'
      })
      assert.equal(first.reply.includes('precio comienza desde'), true)
      assert.equal(first.reply.includes('$ 50.000') || first.reply.includes('$ 50.000'), true)
      assert.equal(first.reply.includes('¿Me decís tu nombre?'), true)
      assert.equal(first.reply.includes('servicios disponibles'), false)
      assert.deepEqual(
        first.state.agenda.map((item) => ({
          intent: item.intent,
          serviceId: item.serviceId,
          serviceInformationProvided: item.serviceInformationProvided
        })),
        [
          {
            intent: 'request_quote',
            serviceId: 'illumination',
            serviceInformationProvided: true
          },
          {
            intent: 'check_availability',
            serviceId: 'illumination',
            serviceInformationProvided: false
          }
        ]
      )
      assert.equal(extractor.calls.length, 0)

      const pendingRequest = pendingRequestFromRouting({
        currentStep: 'START',
        state: first.state,
        now: new Date('2026-08-01T12:00:00.000Z'),
        routing
      })
      assert.ok(pendingRequest)

      const persisted = conversationPatchFromState({
        ...first.state,
        pendingRequest
      })
      const restored = stateFromConversation(persisted)
      assert.equal(restored.pendingRequest?.message.includes('iluminaciones'), true)

      const second = await engine.process({
        businessId: 'business-1',
        conversation: persisted,
        message: 'Caro'
      })
      assert.equal(second.state.draft.name, 'Caro')
      assert.equal(second.state.draft.service, 'illumination')
      assert.deepEqual(second.plan, {
        type: 'handoff',
        reason: 'photo_required'
      })
      assert.equal(second.reply.includes('¡Perfecto, Caro!'), true)
      assert.equal(second.reply.includes('precio comienza desde'), false)
      assert.equal(second.reply.includes('foto clara del estado actual'), true)
      assert.equal(second.reply.includes('puede demorar unos minutos'), true)
      assert.equal(second.reply.includes('horarios disponibles'), true)
      assert.equal(
        second.state.agenda.find((item) => item.intent === 'request_quote')?.status,
        'pending'
      )
      assert.deepEqual(
        second.state.agenda.find((item) => item.intent === 'check_availability'),
        {
          intent: 'check_availability',
          status: 'blocked',
          evidence: 'horarios',
          serviceId: 'illumination',
          serviceInformationProvided: false,
          blockedBy: 'quote_pending',
          createdAt: '2026-08-01T12:00:00.000Z'
        }
      )

      const quoteAccepted = await engine.resume({
        businessId: 'business-1',
        conversation: conversationPatchFromState({
          ...second.state,
          advisorQuote: {
            serviceId: 'illumination',
            amount: 75000,
            note: null,
            status: 'accepted',
            quotedAt: '2026-08-01T12:10:00.000Z'
          }
        })
      })
      assert.equal(
        quoteAccepted.state.agenda.find((item) => item.intent === 'request_quote')?.status,
        'completed'
      )
      assert.deepEqual(
        quoteAccepted.state.agenda.find((item) => item.intent === 'check_availability')?.status,
        'pending'
      )
      assert.equal(
        quoteAccepted.plan.type === 'ask_field' ? quoteAccepted.plan.field : null,
        'professional'
      )

      let availabilityState = acceptField(
        quoteAccepted.state,
        'professional',
        'professional-1'
      )
      availabilityState = acceptField(availabilityState, 'date', '2026-08-03')
      const availabilityShown = await engine.resume({
        businessId: 'business-1',
        conversation: conversationPatchFromState(availabilityState)
      })
      assert.equal(
        availabilityShown.state.agenda.find((item) => item.intent === 'check_availability')?.status,
        'completed'
      )
      assert.equal(availabilityShown.reply.includes('horarios disponibles'), true)
    }
  },
  {
    name: 'divide respuestas largas sin romper parrafos ni listas',
    run: () => {
      const reply = [
        'Los horarios del local son:\nLunes: 09:00 a 20:00\nMartes: 09:00 a 20:00',
        'Para Iluminación, el precio comienza desde $ 50.000 y puede variar según el trabajo necesario.',
        '¿Me decís tu nombre?'
      ].join('\n\n')
      const messages = splitWhatsAppReply(reply, 100)
      assert.equal(messages.length, 3)
      assert.equal(messages.every((message) => message.length <= 100), true)
      assert.equal(messages.join('\n\n'), reply)
      assert.equal(messages[2], '¿Me decís tu nombre?')
    }
  },
  {
    name: 'motor acepta un nombre simple sin pedir confirmacion innecesaria',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: null,
        message: 'matias',
        currentDate: new Date('2026-07-01T12:00:00')
      })

      assert.equal(result.state.draft.name, 'Matias')
      assert.equal(result.plan.type, 'ask_field')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'service')
      assert.equal(result.reply.includes('servicios disponibles'), true)
      assert.equal(result.reply.includes('Tu nombre es'), false)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'el catalogo ofrece explicitamente pedir ayuda para elegir',
    run: () => {
      const reply = renderBookingV2Response({
        plan: {
          type: 'ask_field',
          field: 'service',
          reason: 'missing',
          misunderstandingCount: 0
        },
        draft: {
          name: 'Mati',
          service: null,
          professional: null,
          date: null,
          time: null
        },
        catalog: fakeDomainCatalog()
      })

      assert.equal(reply.includes('• No sé cuál necesito'), true)
    }
  },
  {
    name: 'categoria configurable ofrece asesoramiento y confirma antes de derivar',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          {
            id: 'nutrition-1',
            name: 'Tratamiento nutritivo',
            aliases: ['nutricion'],
            duration: 60,
            price: 30000,
            category: 'Nutrición',
            categoryAdviceEnabled: true
          },
          {
            id: 'nutrition-2',
            name: 'Alisado molecular',
            aliases: ['nutricion'],
            duration: 90,
            price: 45000,
            category: 'Nutrición',
            categoryAdviceEnabled: true
          },
          {
            id: 'haircut',
            name: 'Corte',
            aliases: [],
            duration: 30,
            price: 15000,
            category: 'Cortes'
          }
        ],
        professionals: [{
          id: 'professional-1',
          name: 'Mica',
          serviceIds: ['nutrition-1', 'nutrition-2', 'haircut']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )
      const namedState = acceptField(createEmptyBookingV2State(), 'name', 'Mati')

      const categoryMenu = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(namedState),
        message: 'quiero un turno de nutricion'
      })
      assert.equal(categoryMenu.plan.type, 'ask_field')
      assert.equal(categoryMenu.state.categoryAdvice?.stage, 'offered')
      assert.equal(
        categoryMenu.reply.includes('Hablar con un profesional para elegir mi servicio de Nutrición'),
        true
      )
      assert.equal(categoryMenu.reply.includes('respuesta puede demorar'), true)

      const confirmation = await engine.process({
        businessId: 'business-1',
        conversation: categoryMenu.conversationPatch,
        message: 'necesito asesoramiento'
      })
      assert.equal(confirmation.plan.type, 'ask_category_advice_confirmation')
      assert.equal(confirmation.state.categoryAdvice?.stage, 'awaiting_confirmation')
      assert.equal(confirmation.reply.includes('¿Querés continuar?'), true)
      assert.equal(confirmation.reply.includes('Volver a los tratamientos'), true)

      const returned = await engine.process({
        businessId: 'business-1',
        conversation: confirmation.conversationPatch,
        message: 'volver a los tratamientos'
      })
      assert.equal(returned.plan.type, 'ask_field')
      assert.equal(returned.state.categoryAdvice, null)
      assert.equal(returned.reply.includes('Tratamiento nutritivo'), true)
      assert.equal(returned.reply.includes('Corte —'), false)

      const handedOff = await engine.process({
        businessId: 'business-1',
        conversation: confirmation.conversationPatch,
        message: 'sí'
      })
      assert.deepEqual(handedOff.plan, {
        type: 'handoff',
        reason: 'category_advice_requested',
        categoryName: 'Nutrición'
      })
      assert.equal(handedOff.state.categoryAdvice?.stage, 'requested')
      assert.equal(handedOff.reply.includes('servicio de Nutrición'), true)
    }
  },
  {
    name: 'servicio configurable explica y valida antes de pedir profesional',
    run: async () => {
      const validationCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'full-color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloración',
          validationEnabled: true,
          validationMessage: 'Trabaja todo el cabello y permite lograr un color uniforme.',
          validationQuestion: '¿Seguimos con Color completo?'
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['full-color']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: validationCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier()
      )

      const selected = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'color completo'
      })

      assert.deepEqual(selected.plan, {
        type: 'ask_service_validation',
        reason: 'missing'
      })
      assert.equal(selected.reply.includes('Trabaja todo el cabello'), true)
      assert.equal(selected.reply.includes('¿Seguimos con Color completo?'), true)
      assert.equal(selected.state.serviceValidation?.stage, 'awaiting_confirmation')

      const confirmed = await engine.process({
        businessId: 'business-1',
        conversation: selected.conversationPatch,
        message: 'dale, mandale'
      })
      assert.equal(confirmed.state.serviceValidation?.stage, 'completed')
      assert.equal(confirmed.plan.type, 'ask_field')
      assert.equal(confirmed.plan.type === 'ask_field' ? confirmed.plan.field : null, 'professional')
      assert.equal(confirmed.reply.includes('Tamara'), true)
    }
  },
  {
    name: 'rechazar validacion vuelve a elegir servicio sin perder el nombre',
    run: async () => {
      const validationCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'full-color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloración',
          validationEnabled: true,
          validationMessage: 'Trabaja todo el cabello.',
          validationQuestion: '¿Seguimos?'
        }, {
          id: 'roots',
          name: 'Raíces',
          aliases: ['raices'],
          duration: 60,
          price: 40000,
          category: 'Coloración'
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: validationCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier()
      )
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'full-color',
          professional: null,
          date: null,
          time: null
        },
        serviceValidation: {
          serviceId: 'full-color',
          stage: 'awaiting_confirmation' as const
        }
      }
      const rejected = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(state),
        message: 'no, quiero elegir otro'
      })

      assert.equal(rejected.state.draft.name, 'Mati')
      assert.equal(rejected.state.draft.service, null)
      assert.equal(rejected.state.serviceValidation, null)
      assert.equal(rejected.plan.type, 'ask_field')
      assert.equal(rejected.plan.type === 'ask_field' ? rejected.plan.field : null, 'service')
    }
  },
  {
    name: 'durante validacion puede cambiar directamente a otro servicio',
    run: async () => {
      const validationCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'full-color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloración',
          validationEnabled: true,
          validationMessage: 'Trabaja todo el cabello.'
        }, {
          id: 'roots',
          name: 'Raíces',
          aliases: ['raices'],
          duration: 60,
          price: 40000,
          category: 'Coloración'
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['roots']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: validationCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier()
      )
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'full-color',
          professional: null,
          date: null,
          time: null
        },
        serviceValidation: {
          serviceId: 'full-color',
          stage: 'awaiting_confirmation' as const
        }
      }
      const changed = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(state),
        message: 'mejor raíces'
      })

      assert.equal(changed.state.draft.service, 'roots')
      assert.equal(changed.state.serviceValidation, null)
      assert.equal(changed.plan.type, 'ask_field')
      assert.equal(changed.plan.type === 'ask_field' ? changed.plan.field : null, 'professional')
    }
  },
  {
    name: 'duda en validacion avisa la derivacion y la posible demora',
    run: async () => {
      const validationCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'full-color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloración',
          validationEnabled: true,
          validationMessage: 'Trabaja todo el cabello.'
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: validationCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier()
      )
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'full-color',
          professional: null,
          date: null,
          time: null
        },
        serviceValidation: {
          serviceId: 'full-color',
          stage: 'awaiting_confirmation' as const
        }
      }
      const result = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(state),
        message: 'no sé cuál necesito'
      })

      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'service_validation_uncertain'
      })
      assert.equal(result.reply.includes('te derivo'), true)
      assert.equal(result.reply.includes('demorar unos minutos'), true)
      assert.equal(result.reply.includes('continuar con vos por acá'), true)
    }
  },
  {
    name: 'validacion pendiente se conserva al retomar la conversacion',
    run: async () => {
      const validationCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'full-color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloración',
          validationEnabled: true,
          validationMessage: 'Trabaja todo el cabello.'
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: validationCatalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier()
      )
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'full-color',
          professional: null,
          date: null,
          time: null
        },
        serviceValidation: {
          serviceId: 'full-color',
          stage: 'awaiting_confirmation' as const
        }
      }

      const resumed = await engine.resume({
        businessId: 'business-1',
        conversation: conversationPatchFromState(state)
      })

      assert.deepEqual(resumed.plan, {
        type: 'ask_service_validation',
        reason: 'missing'
      })
      assert.equal(resumed.state.draft.name, 'Mati')
      assert.equal(resumed.state.draft.service, 'full-color')
    }
  },
  {
    name: 'todas las derivaciones del motor avisan que pueden demorar',
    run: () => {
      const handoffCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'color',
          name: 'Color',
          aliases: [],
          duration: 90,
          price: null,
          category: null
        }],
        professionals: []
      })
      const reasons = [
        'repeated_misunderstanding',
        'no_compatible_professional',
        'quote_required',
        'advisor_required',
        'photo_required',
        'estimate_quote_requested',
        'service_selection_uncertain',
        'service_validation_uncertain'
      ] as const

      for (const reason of reasons) {
        const reply = renderBookingV2Response({
          plan: { type: 'handoff', reason },
          draft: {
            name: 'Mati',
            service: 'color',
            professional: null,
            date: null,
            time: null
          },
          catalog: handoffCatalog
        })
        assert.equal(reply.includes('demorar unos minutos'), true, reason)
      }
    }
  },
  {
    name: 'matriz cubre los cuatro modos de atencion y todas sus salidas principales',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          {
            id: 'direct',
            name: 'Corte directo',
            aliases: ['corte directo'],
            duration: 30,
            price: 15000,
            category: null,
            attentionMode: 'DIRECT_BOOKING'
          },
          {
            id: 'quote',
            name: 'Color personalizado',
            aliases: ['color personalizado'],
            duration: 90,
            price: 60000,
            category: null,
            attentionMode: 'QUOTE'
          },
          {
            id: 'advisor',
            name: 'Diagnostico experto',
            aliases: ['diagnostico experto'],
            duration: 45,
            price: null,
            category: null,
            attentionMode: 'ADVISOR'
          },
          {
            id: 'guided',
            name: 'Iluminacion guiada',
            aliases: ['iluminacion guiada'],
            duration: 180,
            price: 80000,
            category: null,
            attentionMode: 'GUIDED_ESTIMATE',
            estimateQuestion: '¿Qué largo tiene tu cabello?',
            estimateOptions: [
              { id: 'short', label: 'Hasta los hombros', priceMin: 80000, priceMax: 100000, note: null },
              { id: 'long', label: 'Más largo que los hombros', priceMin: 110000, priceMax: 140000, note: null }
            ],
            estimateAllowsBooking: true
          }
        ],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['direct', 'guided']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor((message) =>
          message.includes('revisen')
            ? { decision: 'request_exact_quote', confidence: 0.93 }
            : { decision: 'continue_booking', confidence: 0.94 }
        ),
        fakeEstimateOptionExtractor((message) => ({
          optionId: message.includes('espalda') ? 'long' : null,
          confidence: message.includes('espalda') ? 0.95 : 0
        }))
      )
      const namedConversation = conversationPatchFromState(
        acceptField(createEmptyBookingV2State(), 'name', 'Mati')
      )

      const direct = await engine.process({
        businessId: 'business-1',
        conversation: namedConversation,
        message: 'corte directo'
      })
      assert.equal(direct.plan.type === 'ask_field' ? direct.plan.field : null, 'professional')

      const quote = await engine.process({
        businessId: 'business-1',
        conversation: namedConversation,
        message: 'color personalizado'
      })
      assert.deepEqual(quote.plan, { type: 'handoff', reason: 'quote_required' })

      const advisor = await engine.process({
        businessId: 'business-1',
        conversation: namedConversation,
        message: 'diagnostico experto'
      })
      assert.deepEqual(advisor.plan, { type: 'handoff', reason: 'advisor_required' })

      const guided = await engine.process({
        businessId: 'business-1',
        conversation: namedConversation,
        message: 'iluminacion guiada'
      })
      assert.equal(guided.plan.type, 'ask_estimate_option')

      const band = await engine.process({
        businessId: 'business-1',
        conversation: guided.conversationPatch,
        message: 'me llega casi a media espalda'
      })
      assert.equal(band.plan.type, 'show_estimate')
      assert.equal(band.state.guidedEstimate?.optionId, 'long')

      const continueBooking = await engine.process({
        businessId: 'business-1',
        conversation: band.conversationPatch,
        message: 'me sirve, avancemos'
      })
      assert.equal(
        continueBooking.plan.type === 'ask_field' ? continueBooking.plan.field : null,
        'professional'
      )

      const exactQuote = await engine.process({
        businessId: 'business-1',
        conversation: band.conversationPatch,
        message: 'prefiero que lo revisen bien antes'
      })
      assert.deepEqual(exactQuote.plan, { type: 'handoff', reason: 'estimate_quote_requested' })
    }
  },
  {
    name: 'servicio con presupuesto deriva sin pedir profesional ni horario',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'color',
          name: 'Color completo',
          aliases: ['color'],
          duration: 90,
          price: 65000,
          category: 'Coloracion',
          attentionMode: 'QUOTE',
          requiresPhoto: false
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['color']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null)
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'quiero color completo'
      })

      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'quote_required'
      })
      assert.equal(result.reply.includes('presupuesto personalizado'), true)
      assert.equal(result.reply.includes('profesional'), false)
      assert.equal(result.reply.includes('horario'), false)
    }
  },
  {
    name: 'presupuesto aceptado evita una segunda derivacion y retoma por profesional',
    run: async () => {
      const quoteCatalog = createBookingV2DomainCatalog({
        services: [{
          id: 'illumination',
          name: 'Iluminacion',
          aliases: ['iluminacion'],
          duration: 90,
          price: 150000,
          category: 'Coloracion',
          attentionMode: 'QUOTE',
          requiresPhoto: true
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['illumination']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog: quoteCatalog }),
        fakeExtractor(null)
      )
      const state = {
        ...createEmptyBookingV2State(),
        draft: {
          name: 'Mati',
          service: 'illumination',
          professional: null,
          date: null,
          time: null
        },
        advisorQuote: {
          serviceId: 'illumination',
          amount: 160000,
          note: null,
          status: 'accepted' as const,
          quotedAt: '2026-07-28T23:45:00.000Z'
        }
      }
      const patch = conversationPatchFromState(state)
      const result = await engine.resume({
        businessId: 'business-1',
        conversation: {
          ...patch,
          bookingV2State: patch.bookingV2State
        }
      })
      assert.equal(result.plan.type, 'ask_field')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'professional')
      assert.equal(result.reply.includes('Tamara'), true)
      assert.equal(result.reply.includes('foto'), false)
    }
  },
  {
    name: 'servicio con asesoramiento deriva antes de reservar',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'nutrition',
          name: 'Nutricion',
          aliases: ['nutricion'],
          duration: 120,
          price: null,
          category: 'Tratamientos',
          attentionMode: 'ADVISOR',
          requiresPhoto: false
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null)
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'nutricion'
      })

      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'advisor_required'
      })
      assert.equal(result.reply.includes('requiere asesoramiento'), true)
    }
  },
  {
    name: 'pedido de fotos prevalece y no ofrece una reserva automatica',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'highlights',
          name: 'Iluminacion',
          aliases: ['iluminacion'],
          duration: 180,
          price: 160000,
          category: 'Coloracion',
          attentionMode: 'QUOTE',
          requiresPhoto: true
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null)
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'iluminacion'
      })

      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'photo_required'
      })
      assert.equal(result.reply.includes('foto clara'), true)
      assert.equal(result.reply.includes('resultado que busc'), true)
      assert.equal(result.availabilityOptions.length, 0)
    }
  },
  {
    name: 'webhook no crea conversacion si el numero receptor no pertenece a un comercio',
    run: () => {
      assert.equal(buildIncomingConversationUpsert(null, '5491199999999'), null)
    }
  },
  {
    name: 'webhook aisla la conversacion por comercio y telefono del cliente',
    run: () => {
      const businessA = buildIncomingConversationUpsert('business-a', '5491199999999')
      const businessB = buildIncomingConversationUpsert('business-b', '5491199999999')

      assert.notDeepEqual(businessA, businessB)
      assert.deepEqual(
        businessB,
        {
          where: {
            businessId_phone: {
              businessId: 'business-b',
              phone: '5491199999999'
            }
          },
          update: {},
          create: {
            businessId: 'business-b',
            phone: '5491199999999'
          },
          include: {
            business: true
          }
        }
      )
    }
  },
  {
    name: 'webhook conserva fotos entrantes con sus datos de Meta',
    run: () => {
      const messages = new WhatsAppWebhookService().extractIncomingMessages({
        entry: [{
          changes: [{
            value: {
              metadata: {
                phone_number_id: 'phone-number-1',
                display_phone_number: '5491100000000'
              },
              messages: [{
                id: 'wamid.image-1',
                from: '5491199999999',
                type: 'image',
                image: {
                  id: 'media-1',
                  mime_type: 'image/jpeg',
                  sha256: 'hash-1',
                  caption: 'Mi pelo actual'
                }
              }]
            }
          }]
        }]
      })

      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.text, 'Mi pelo actual')
      assert.deepEqual(messages[0]?.media, {
        type: 'image',
        id: 'media-1',
        mimeType: 'image/jpeg',
        sha256: 'hash-1',
        caption: 'Mi pelo actual'
      })
    }
  },
  {
    name: 'webhook conserva comprobantes PDF enviados como documento',
    run: () => {
      const messages = new WhatsAppWebhookService().extractIncomingMessages({
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: 'wamid.document-1',
                from: '5491199999999',
                type: 'document',
                document: {
                  id: 'media-document-1',
                  mime_type: 'application/pdf',
                  sha256: 'hash-document-1',
                  filename: 'comprobante.pdf'
                }
              }]
            }
          }]
        }]
      })

      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.text, 'Archivo recibido: comprobante.pdf')
      assert.deepEqual(messages[0]?.media, {
        type: 'document',
        id: 'media-document-1',
        mimeType: 'application/pdf',
        sha256: 'hash-document-1',
        filename: 'comprobante.pdf'
      })
    }
  },
  {
    name: 'comprobantes aceptan fotos PDF y documentos comunes pero no ejecutables',
    run: () => {
      assert.equal(isSupportedDepositProof({
        type: 'image',
        id: 'image-1',
        mimeType: 'image/jpeg'
      }), true)
      assert.equal(isSupportedDepositProof({
        type: 'document',
        id: 'pdf-1',
        mimeType: 'application/pdf',
        filename: 'comprobante.pdf'
      }), true)
      assert.equal(isSupportedDepositProof({
        type: 'document',
        id: 'sheet-1',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'transferencia.xlsx'
      }), true)
      assert.equal(isSupportedDepositProof({
        type: 'document',
        id: 'executable-1',
        mimeType: 'application/x-msdownload',
        filename: 'archivo.exe'
      }), false)
    }
  },
  {
    name: 'varias fotos separadas reciben un solo acuse para presupuesto',
    run: async () => {
      let acknowledged = false
      const outboundMessages: Array<{ body: string }> = []
      const sends: string[] = []
      const db = {
        service: {
          findFirst: async () => ({ id: 'illumination' })
        },
        conversation: {
          updateMany: async (args: { where: { photoQuoteAcknowledgedAt?: null }; data: Record<string, unknown> }) => {
            if ('photoQuoteAcknowledgedAt' in args.where) {
              if (acknowledged) return { count: 0 }
              acknowledged = true
              return { count: 1 }
            }
            acknowledged = false
            return { count: 1 }
          },
          update: async () => ({ id: 'conversation-1' })
        },
        message: {
          create: async (args: { data: { body: string } }) => {
            outboundMessages.push({ body: args.data.body })
            return { id: 'outbound-1' }
          }
        }
      }
      const sender = {
        sendTextMessage: async (input: { text: string }) => {
          sends.push(input.text)
          return { sent: true as const, to: '5491100000000', response: { messages: [{ id: 'wamid.out' }] } }
        }
      }
      const service = new PhotoQuoteAcknowledgementService(
        db as never,
        sender as never,
        (async () => ({ allowed: true as const })) as never
      )
      const input = {
        conversationId: 'conversation-1',
        businessId: 'business-1',
        phone: '5491100000000',
        selectedServiceId: 'illumination'
      }
      const first = await service.acknowledge(input)
      const second = await service.acknowledge(input)
      assert.equal(first?.sent, true)
      assert.equal(second, null)
      assert.equal(sends.length, 1)
      assert.equal(outboundMessages.length, 1)
      assert.equal(outboundMessages[0]?.body, PHOTO_QUOTE_ACKNOWLEDGEMENT)
    }
  },
  {
    name: 'estimativo guiado pregunta calcula y permite continuar la reserva',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'highlights',
          name: 'Iluminacion',
          aliases: ['iluminacion'],
          duration: 180,
          price: 80000,
          category: 'Coloracion',
          attentionMode: 'GUIDED_ESTIMATE',
          requiresPhoto: true,
          estimateExplanation: 'El precio depende del largo y del producto.',
          estimateQuestion: '¿Qué largo tiene tu cabello?',
          estimateOptions: [
            { id: 'short', label: 'Hasta los hombros', priceMin: 80000, priceMax: 100000, note: null },
            { id: 'long', label: 'Hasta media espalda', priceMin: 110000, priceMax: 140000, note: 'Puede variar según la cantidad de producto.' }
          ],
          estimateDisclaimer: 'Es un valor estimativo.',
          estimateAllowsBooking: true
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['highlights']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(() => ({
          decision: 'continue_booking',
          confidence: 0.96
        })),
        fakeEstimateOptionExtractor((message) => ({
          optionId: message === '2' ? 'long' : null,
          confidence: message === '2' ? 0.98 : 0
        }))
      )
      const selected = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'iluminacion'
      })
      assert.equal(selected.plan.type, 'ask_estimate_option')
      assert.equal(selected.reply.includes('¿Qué largo'), true)
      assert.equal(selected.reply.includes('2. Hasta media espalda'), true)

      const estimated = await engine.process({
        businessId: 'business-1',
        conversation: selected.conversationPatch,
        message: '2'
      })
      assert.equal(estimated.plan.type, 'show_estimate')
      assert.equal(estimated.reply.includes('110.000'), true)
      assert.equal(estimated.reply.includes('140.000'), true)
      assert.equal(estimated.reply.includes('continuar con la reserva'), true)

      const resumed = await engine.resume({
        businessId: 'business-1',
        conversation: estimated.conversationPatch
      })
      assert.equal(resumed.plan.type, 'ask_estimate_decision')
      assert.equal(resumed.state.guidedEstimate?.stage, 'awaiting_decision')

      const continued = await engine.process({
        businessId: 'business-1',
        conversation: estimated.conversationPatch,
        message: 'quiero reservar'
      })
      assert.equal(continued.plan.type, 'ask_field')
      assert.equal(continued.plan.type === 'ask_field' ? continued.plan.field : null, 'professional')
      assert.equal(continued.reply.includes('Tamara'), true)

      for (const naturalAnswer of ['Continuar', 'Reservo', 'Sigamos']) {
        const naturalContinuation = await engine.process({
          businessId: 'business-1',
          conversation: estimated.conversationPatch,
          message: naturalAnswer
        })
        assert.equal(naturalContinuation.plan.type, 'ask_field', naturalAnswer)
        assert.equal(
          naturalContinuation.plan.type === 'ask_field'
            ? naturalContinuation.plan.field
            : null,
          'professional',
          naturalAnswer
        )
      }
    }
  },
  {
    name: 'estimativo guiado sin bandas muestra el precio base y permite continuar',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'treatment',
          name: 'Tratamiento',
          aliases: ['tratamiento'],
          duration: 90,
          price: 50000,
          priceMode: 'STARTING_AT',
          category: 'Nutricion',
          attentionMode: 'GUIDED_ESTIMATE',
          requiresPhoto: false,
          estimateExplanation: 'El precio final depende del diagnóstico.',
          estimateQuestion: null,
          estimateOptions: [],
          estimateDisclaimer: 'Es un valor estimativo.',
          estimateAllowsBooking: true
        }],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['treatment']
        }]
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(() => ({
          decision: 'continue_booking',
          confidence: 0.96
        }))
      )
      const selected = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'tratamiento'
      })

      assert.equal(selected.plan.type, 'show_base_estimate')
      assert.equal(selected.reply.includes('desde'), true)
      assert.equal(selected.reply.includes('50.000'), true)
      assert.equal(selected.reply.includes('continuar con la reserva'), true)
      assert.equal(selected.state.guidedEstimate?.stage, 'awaiting_decision')
      assert.equal(selected.state.guidedEstimate?.priceMin, 50000)

      const continued = await engine.process({
        businessId: 'business-1',
        conversation: selected.conversationPatch,
        message: 'quiero reservar'
      })
      assert.equal(continued.plan.type, 'ask_field')
      assert.equal(continued.plan.type === 'ask_field' ? continued.plan.field : null, 'professional')
    }
  },
  {
    name: 'estimativo guiado deriva con contexto si piden presupuesto exacto',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [{
          id: 'highlights',
          name: 'Iluminacion',
          aliases: [],
          duration: 180,
          price: 80000,
          category: null,
          attentionMode: 'GUIDED_ESTIMATE',
          requiresPhoto: true,
          estimateQuestion: '¿Qué largo tiene tu cabello?',
          estimateOptions: [
            { id: 'short', label: 'Hasta los hombros', priceMin: 80000, priceMax: 100000, note: null }
          ],
          estimateAllowsBooking: true
        }],
        professionals: []
      })
      const engine = new BookingV2Engine(
        fakeDomainPort({ catalog }),
        fakeExtractor(null),
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(() => ({
          decision: 'request_exact_quote',
          confidence: 0.98
        }))
      )
      const state = {
        selectedCustomerName: 'Mati',
        selectedServiceId: 'highlights',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: {
          version: 1,
          pendingProposal: null,
          guidedEstimate: {
            serviceId: 'highlights',
            stage: 'awaiting_decision',
            optionId: 'short',
            optionLabel: 'Hasta los hombros',
            priceMin: 80000,
            priceMax: 100000
          }
        }
      }
      const result = await engine.process({
        businessId: 'business-1',
        conversation: state,
        message: 'prefiero un presupuesto exacto'
      })
      assert.deepEqual(result.plan, { type: 'handoff', reason: 'photo_required' })
      assert.equal(result.reply.includes('foto clara'), true)
      assert.equal(result.conversationPatch.bookingV2State?.guidedEstimate?.optionLabel, 'Hasta los hombros')
    }
  },
  {
    name: 'motor reconoce nombres simples con espacios acentos y guiones',
    run: async () => {
      const cases = [
        ['mati', 'Mati'],
        ['maría josé', 'María José'],
        ['ana-maría', 'Ana-María']
      ] as const

      for (const [message, expectedName] of cases) {
        const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
        const result = await engine.process({
          businessId: 'business-1',
          conversation: null,
          message,
          currentDate: new Date('2026-07-01T12:00:00')
        })
        assert.equal(result.state.draft.name, expectedName)
        assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'service')
      }
    }
  },
  {
    name: 'motor no confunde saludos o pedidos con nombres simples',
    run: async () => {
      for (const message of [
        'hola',
        'quiero un turno',
        'no sé',
        'corte hombre',
        'corte',
        'barba',
        'reset total',
        'página web',
        'me llamo'
      ]) {
        const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
        const result = await engine.process({
          businessId: 'business-1',
          conversation: null,
          message,
          currentDate: new Date('2026-07-01T12:00:00')
        })
        assert.equal(result.state.draft.name, null)
        assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'name')
      }
    }
  },
  {
    name: 'motor sanea un servicio guardado como nombre sin perder la reserva',
    run: async () => {
      const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Corte',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: '2026-07-10',
          selectedTime: '15:00',
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'hola',
        currentDate: new Date('2026-07-01T12:00:00')
      })

      assert.equal(result.state.draft.name, null)
      assert.equal(result.state.draft.service, 'haircut')
      assert.equal(result.state.draft.professional, 'professional-1')
      assert.equal(result.state.draft.date, '2026-07-10')
      assert.equal(result.state.draft.time, '15:00')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'name')
    }
  },
  {
    name: 'motor reanuda y sanea el nombre sin borrar servicio profesional fecha y hora',
    run: async () => {
      const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
      const result = await engine.resume({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Barba',
          selectedServiceId: 'beard',
          selectedProfessionalId: 'professional-2',
          selectedDate: '2026-07-10',
          selectedTime: '15:30',
          misunderstandingCount: 1,
          bookingV2State: null
        },
        currentDate: new Date('2026-07-01T12:00:00')
      })

      assert.equal(result.state.draft.name, null)
      assert.equal(result.state.draft.service, 'beard')
      assert.equal(result.state.draft.professional, 'professional-2')
      assert.equal(result.state.draft.date, '2026-07-10')
      assert.equal(result.state.draft.time, '15:30')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'name')
    }
  },
  {
    name: 'extractor recibe explicitamente el campo esperado del flujo',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        extractor,
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )

      await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'no sé'
      })

      assert.equal(
        (extractor.calls[0] as { expectedField?: string } | undefined)?.expectedField,
        'professional'
      )
      assert.equal(
        (extractor.calls[0] as { services?: BookingV2CatalogOption[] } | undefined)
          ?.services?.find((service) => service.id === 'haircut')?.description,
        'Incluye lavado, corte personalizado y finalización.'
      )
    }
  },
  {
    name: 'motor incluye horarios disponibles cuando pide horario',
    run: async () => {
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        fakeExtractor(extraction({
          date: field('2026-07-10', 0.95, 'el viernes')
        }))
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Juan',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'el viernes'
      })

      assert.equal(result.plan.type, 'ask_field')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'time')
      assert.deepEqual(result.availabilityOptions.map((option) => option.time), ['15:00', '15:30'])
      assert.equal(result.reply.includes('• Nico: 15:00, 15:30'), true)
      assert.equal(result.reply.includes('todos los horarios disponibles'), true)
      assert.equal(result.reply.includes('¿Cuál te queda mejor?'), true)
    }
  },
  {
    name: 'motor convierte domingo en el proximo domingo sin confiar en una fecha incorrecta de IA',
    run: async () => {
      const domain = fakeDomainPort()
      const engine = new BookingV2Engine(
        domain,
        fakeExtractor(extraction({
          date: field('2026-08-07', 0.99, 'Domingo puede ser?')
        }))
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Rami',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Domingo puede ser?',
        currentDate: new Date('2026-08-04T01:05:47.138Z')
      })

      assert.equal(result.state.draft.date, '2026-08-09')
      assert.deepEqual(domain.availabilityCalls, ['2026-08-09'])
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'time')
    }
  },
  {
    name: 'motor rechaza el domingo cerrado y nunca lo sustituye por el viernes',
    run: async () => {
      const domain = fakeDomainPort({ availabilityOptions: [] })
      const engine = new BookingV2Engine(domain, fakeExtractor(null))

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Rami',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Domingo puede ser?',
        currentDate: new Date('2026-08-04T01:05:47.138Z')
      })

      assert.equal(result.state.draft.date, null)
      assert.deepEqual(domain.availabilityCalls, ['2026-08-09'])
      assert.equal(domain.availabilityCalls.includes('2026-08-07'), false)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'date')
      assert.equal(result.reply.includes('09/08/2026 no tiene horarios disponibles'), true)
    }
  },
  {
    name: 'motor prioriza el profesional esperado y no lo confunde con el nombre',
    run: async () => {
      const extractor = fakeExtractor(extraction({
        name: field('Ana', 0.7, 'Ana')
      }))
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        extractor,
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'beard',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Ana'
      })

      assert.equal(result.state.draft.name, 'Mati')
      assert.equal(result.state.draft.professional, 'professional-2')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'date')
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor reconoce un profesional por nombre apellido o nombre completo',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte', aliases: [], duration: 30, price: 15000, category: null }
        ],
        professionals: [
          { id: 'tamara-grando', name: 'Tamara Grando', serviceIds: ['haircut'] },
          { id: 'lucas-perez', name: 'Lucas Pérez', serviceIds: ['haircut'] }
        ]
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)
      const conversation = {
        selectedCustomerName: 'Mati',
        selectedServiceId: 'haircut',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null
      }

      for (const message of ['Tamara', 'Grando', 'Con Tamara Grando puede ser?']) {
        const result = await engine.process({
          businessId: 'business-1',
          conversation,
          message
        })
        assert.equal(result.state.draft.professional, 'tamara-grando', message)
        assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'date', message)
      }
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor interpreta con Sebas puede ser como apodo de Sebastian',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte', aliases: [], duration: 30, price: 15000, category: null }
        ],
        professionals: [
          { id: 'sebastian-gomez', name: 'Sebastián Gómez', serviceIds: ['haircut'] },
          { id: 'lucas-perez', name: 'Lucas Pérez', serviceIds: ['haircut'] }
        ]
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: '¿Con Sebas puede ser?'
      })

      assert.equal(result.state.draft.professional, null)
      assert.equal(result.state.pendingProposal?.value, 'sebastian-gomez')
      assert.equal(result.plan.type, 'confirm_field')
      assert.match(result.reply, /Sebastián Gómez/)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor pide el nombre completo cuando varios profesionales comparten nombre',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte', aliases: [], duration: 30, price: 15000, category: null }
        ],
        professionals: [
          { id: 'tamara-grando', name: 'Tamara Grando', serviceIds: ['haircut'] },
          { id: 'tamara-lopez', name: 'Tamara López', serviceIds: ['haircut'] }
        ]
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)
      const conversation = {
        selectedCustomerName: 'Mati',
        selectedServiceId: 'haircut',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null
      }

      const ambiguous = await engine.process({
        businessId: 'business-1',
        conversation,
        message: 'Tamara'
      })
      assert.equal(ambiguous.state.draft.professional, null)
      assert.deepEqual(ambiguous.plan, {
        type: 'clarify_professional',
        professionalIds: ['tamara-grando', 'tamara-lopez']
      })
      assert.match(ambiguous.reply, /Tamara Grando/)
      assert.match(ambiguous.reply, /Tamara López/)
      assert.match(ambiguous.reply, /nombre completo/i)

      const resolved = await engine.process({
        businessId: 'business-1',
        conversation,
        message: 'Con Tamara López'
      })
      assert.equal(resolved.state.draft.professional, 'tamara-lopez')
      assert.equal(resolved.plan.type === 'ask_field' ? resolved.plan.field : null, 'date')
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor pide aclaracion cuando varios profesionales comparten apellido',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte', aliases: [], duration: 30, price: 15000, category: null }
        ],
        professionals: [
          { id: 'tamara-grando', name: 'Tamara Grando', serviceIds: ['haircut'] },
          { id: 'lucas-grando', name: 'Lucas Grando', serviceIds: ['haircut'] }
        ]
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Con Grando'
      })

      assert.equal(result.state.draft.professional, null)
      assert.equal(result.plan.type, 'clarify_professional')
      assert.match(result.reply, /Tamara Grando/)
      assert.match(result.reply, /Lucas Grando/)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor acepta cualquier profesional y asigna uno al elegir horario',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

      const professionalResult = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Cualquier profesional'
      })

      assert.equal(professionalResult.state.draft.professional, ANY_PROFESSIONAL_ID)
      assert.equal(professionalResult.plan.type === 'ask_field' ? professionalResult.plan.field : null, 'date')

      const timeResult = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: ANY_PROFESSIONAL_ID,
          selectedDate: '2026-07-27',
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: '15hs'
      })

      assert.equal(timeResult.state.draft.professional, 'professional-1')
      assert.equal(timeResult.state.draft.time, '15:00')
      assert.equal(timeResult.plan.type, 'confirm_booking')
      assert.equal(timeResult.reply.includes('con Nico'), true)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor acepta un servicio equivalente sin confirmacion innecesaria',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'color', name: 'Corte y color', aliases: [], duration: 60, price: 40000, category: null }
        ],
        professionals: [
          { id: 'professional-1', name: 'Lucas', serviceIds: ['color'] }
        ]
      })
      const extractor = fakeExtractor(extraction({
        service: field('color', 0.65, 'Color y corte')
      }))
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Color y corte'
      })

      assert.equal(result.state.draft.service, 'color')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'professional')
      assert.equal(result.reply.includes('• Lucas'), true)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor no elige un servicio que el cliente nunca menciono',
    run: async () => {
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        fakeExtractor(extraction({
          service: field('haircut', 0.9, 'quiero un turno')
        }))
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Matias',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'si quiero un turno'
      })

      assert.equal(result.state.draft.service, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'service')
      assert.equal(result.reply.includes('• Corte'), true)
      assert.equal(result.reply.includes('• Barba'), true)
      assert.equal(result.reply.includes('¿Querés reservar Corte?'), false)
    }
  },
  {
    name: 'la descripcion aporta contexto para interpretar el servicio pedido',
    run: async () => {
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        fakeExtractor(extraction({
          service: field('haircut', 0.9, 'lavado y finalización')
        }))
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Matias',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'quiero algo con lavado y finalización'
      })

      assert.equal(result.state.draft.service, 'haircut')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'professional')
    }
  },
  {
    name: 'motor aclara un servicio parcial ambiguo sin preguntar si quiere modificarlo',
    run: async () => {
      const domainCatalog = createBookingV2DomainCatalog({
        services: [
          { id: 'haircut', name: 'Corte Hombre', aliases: [], duration: 30, price: 15000, category: null },
          { id: 'color', name: 'Corte y color', aliases: [], duration: 60, price: 40000, category: null }
        ],
        professionals: []
      })
      const extractor = fakeExtractor(extraction({
        correction: {
          field: 'service',
          newValue: null,
          confidence: 0.9,
          evidence: 'Corte'
        }
      }))
      const engine = new BookingV2Engine(fakeDomainPort({ catalog: domainCatalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Corte'
      })

      assert.equal(result.state.draft.service, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'service')
      assert.equal(result.reply.includes('más de una opción'), true)
      assert.equal(result.reply.includes('Corte Hombre'), true)
      assert.equal(result.reply.includes('Corte y color'), true)
      assert.equal(result.reply.includes('modificar'), false)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor no pide horario cuando el dia elegido no tiene disponibilidad',
    run: async () => {
      const extractor = fakeExtractor(extraction({
        date: field('2026-07-26', 0.6, 'Hoy')
      }))
      const engine = new BookingV2Engine(
        fakeDomainPort({ availabilityOptions: [] }),
        extractor
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'Hoy?',
        currentDate: new Date('2026-07-26T14:00:00Z')
      })

      assert.equal(result.state.draft.date, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'date')
      assert.equal(result.reply.includes('26/07/2026 no tiene horarios disponibles'), true)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor rechaza un horario que no figura en la disponibilidad real',
    run: async () => {
      const extractor = fakeExtractor(extraction({
        time: field('15:00', 0.95, '15hs')
      }))
      const engine = new BookingV2Engine(
        fakeDomainPort({
          availabilityOptions: [
            { time: '16:00', professionalId: 'professional-1', professionalName: 'Nico' }
          ]
        }),
        extractor
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: '2026-07-27',
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: '15hs'
      })

      assert.equal(result.state.draft.time, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'time')
      assert.equal(result.reply.includes('• Nico: 16:00'), true)
    }
  },
  {
    name: 'motor acepta horarios compactos sin confundirlos con una fecha',
    run: async () => {
      const extractor = fakeExtractor(extraction({
        correction: {
          field: 'date',
          newValue: '2026-07-28',
          confidence: 0.9,
          evidence: '1830'
        }
      }))
      const engine = new BookingV2Engine(
        fakeDomainPort({
          availabilityOptions: [
            { time: '18:30', professionalId: 'professional-1', professionalName: 'Nico' }
          ]
        }),
        extractor
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: '2026-07-28',
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: '1830'
      })

      assert.equal(result.state.draft.date, '2026-07-28')
      assert.equal(result.state.draft.time, '18:30')
      assert.equal(result.plan.type, 'confirm_booking')
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor resuelve una hora de doce horas contra la disponibilidad real',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(
        fakeDomainPort({
          availabilityOptions: [
            { time: '18:00', professionalId: 'professional-1', professionalName: 'Nico' }
          ]
        }),
        extractor
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'haircut',
          selectedProfessionalId: 'professional-1',
          selectedDate: '2026-07-28',
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'si a las 6'
      })

      assert.equal(result.state.draft.time, '18:00')
      assert.equal(result.plan.type, 'confirm_booking')
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'cambiar el horario desde la confirmacion limpia solo la hora',
    run: () => {
      let state = acceptField(createEmptyBookingV2State(), 'name', 'Mati')
      state = acceptField(state, 'service', 'haircut')
      state = acceptField(state, 'professional', 'professional-1')
      state = acceptField(state, 'date', '2026-07-28')
      state = acceptField(state, 'time', '18:30')

      const changed = clearBookingV2StateFromField(state, 'time')

      assert.equal(changed.draft.name, 'Mati')
      assert.equal(changed.draft.service, 'haircut')
      assert.equal(changed.draft.professional, 'professional-1')
      assert.equal(changed.draft.date, '2026-07-28')
      assert.equal(changed.draft.time, null)
      assert.equal(nextMissingField(changed.draft), 'time')
    }
  },
  {
    name: 'motor confirma propuesta pendiente sin gastar extractor',
    run: async () => {
      const namedState = acceptField(createEmptyBookingV2State(), 'name', 'Mati')
      const pending = conversationPatchFromState(proposeField(namedState, {
        field: 'service',
        value: 'haircut',
        confidence: 0.7,
        evidence: 'quiero un corte'
      }))
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        extractor,
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: pending.bookingV2State
        },
        message: 'si'
      })

      assert.equal(result.outcome, 'proposal_confirmed')
      assert.equal(result.state.draft.service, 'haircut')
      assert.equal(result.conversationPatch.bookingV2State, null)
      assert.equal(result.reply.includes('• Nico'), true)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'motor rechaza propuesta pendiente sin modificar borrador',
    run: async () => {
      const pending = conversationPatchFromState(proposeField(createEmptyBookingV2State(), {
        field: 'service',
        value: 'haircut',
        confidence: 0.7,
        evidence: 'quiero un corte'
      }))
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(
        fakeDomainPort(),
        extractor,
        fakeServiceValidationClassifier(),
        fakeEstimateDecisionExtractor(),
        fakeEstimateOptionExtractor(),
        fakeChoiceExtractor()
      )

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: null,
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: pending.bookingV2State
        },
        message: 'no'
      })

      assert.equal(result.outcome, 'proposal_rejected')
      assert.equal(result.state.draft.service, null)
      assert.deepEqual(result.plan, {
        type: 'ask_field',
        field: 'name',
        reason: 'missing',
        misunderstandingCount: 0
      })
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'renderiza confirmacion final con nombres legibles',
    run: () => {
      const draft = completeDraft().draft
      const reply = renderBookingV2Response({
        plan: { type: 'confirm_booking' },
        draft,
        catalog: fakeDomainCatalog()
      })

      assert.equal(
        reply,
        'Perfecto. ¿Confirmás la reserva para Corte con Nico el 10/07/2026 a las 15:00?'
      )
    }
  },
  {
    name: 'catalogo jerarquico agrupa variantes reservables por categoria',
    run: () => {
      const lines = formatServiceOptions([
        {
          id: 'classic',
          name: 'Corte — Clasico',
          aliases: ['clasico'],
          duration: 30,
          price: 15000,
          category: 'Cortes',
          parentServiceId: 'haircut',
          parentServiceName: 'Corte'
        },
        {
          id: 'fade',
          name: 'Corte — Degrade',
          aliases: ['degrade'],
          duration: 45,
          price: 18000,
          category: 'Cortes',
          parentServiceId: 'haircut',
          parentServiceName: 'Corte'
        },
        {
          id: 'beard',
          name: 'Barba',
          aliases: [],
          duration: 20,
          price: 12000,
          category: 'Barba'
        }
      ])

      assert.deepEqual(lines, [
        'Cortes:',
        '• Corte — Clasico — 30 min — $ 15.000',
        '• Corte — Degrade — 45 min — $ 18.000',
        'Barba:',
        '• Barba — 20 min — $ 12.000'
      ])
    }
  },
  {
    name: 'dominio incorpora la categoria como alias navegable',
    run: async () => {
      const domain = new BookingV2DomainService({
        service: {
          findMany: async () => [
            {
              id: 'full-color',
              name: 'Color Completo',
              aliases: [],
              duration: 90,
              price: 65000,
              category: 'Coloracion',
              catalogCategory: { name: 'Coloracion' },
              parentService: null,
              parentServiceId: null
            }
          ]
        },
        professional: {
          findMany: async () => []
        }
      } as never)

      const catalog = await domain.loadCatalog('business-1')

      assert.equal(catalog.services[0]?.aliases.includes('Coloracion'), true)
    }
  },
  {
    name: 'catalogo diferencia precio fijo de precio desde',
    run: () => {
      const lines = formatServiceOptions([
        {
          id: 'haircut',
          name: 'Corte',
          aliases: [],
          duration: 30,
          price: 35000,
          priceMode: 'FIXED',
          category: null
        },
        {
          id: 'roots',
          name: 'Raíces',
          aliases: [],
          duration: 60,
          price: 45000,
          priceMode: 'STARTING_AT',
          category: null
        }
      ])

      assert.equal(lines[0]?.includes('Corte — 30 min — $'), true)
      assert.equal(lines[0]?.toLowerCase().includes('desde'), false)
      assert.equal(lines[1]?.toLowerCase().includes('raíces — 60 min — desde $'), true)
      assert.equal(lines[1]?.includes('45.000'), true)
    }
  },
  {
    name: 'categoria navegable muestra solo sus servicios',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          { id: 'full-color', name: 'Color Completo', aliases: ['Coloracion'], duration: 90, price: 65000, category: 'Coloracion' },
          { id: 'roots', name: 'Raíces', aliases: ['Coloracion'], duration: 60, price: 40000, category: 'Coloracion' },
          { id: 'haircut', name: 'Corte Hombre', aliases: ['corte'], duration: 30, price: 15000, category: 'Cortes' }
        ],
        professionals: []
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: null,
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'quiero coloración'
      })

      assert.equal(result.state.draft.service, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'service')
      assert.equal(result.reply.includes('Para Coloracion tengo estas opciones'), true)
      assert.equal(result.reply.includes('Color Completo'), true)
      assert.equal(result.reply.includes('Raíces'), true)
      assert.equal(result.reply.includes('Corte Hombre'), false)
      assert.equal(extractor.calls.length, 0)
    }
  },
  {
    name: 'frases naturales seleccionan servicios dentro de la categoria',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          { id: 'full-color', name: 'Color Completo', aliases: ['Coloracion'], duration: 90, price: 65000, category: 'Coloracion' },
          { id: 'roots', name: 'Raíces', aliases: ['Coloracion'], duration: 60, price: 40000, category: 'Coloracion' }
        ],
        professionals: [
          { id: 'professional-1', name: 'Tamara', serviceIds: ['full-color', 'roots'] }
        ]
      })

      for (const [message, serviceId] of [
        ['quiero color completo', 'full-color'],
        ['quiero hacerme las raíces', 'roots']
      ] as const) {
        const extractor = fakeExtractor(null)
        const engine = new BookingV2Engine(fakeDomainPort({ catalog }), extractor)
        const result = await engine.process({
          businessId: 'business-1',
          conversation: {
            selectedCustomerName: 'Mati',
            selectedServiceId: null,
            selectedProfessionalId: null,
            selectedDate: null,
            selectedTime: null,
            misunderstandingCount: 0,
            bookingV2State: null
          },
          message
        })

        assert.equal(result.state.draft.service, serviceId)
        assert.equal(result.reply.includes('Tamara'), true)
        assert.equal(extractor.calls.length, 0)
      }
    }
  },
  {
    name: 'servicio sin profesionales informa el problema y no acepta cualquiera',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          { id: 'roots', name: 'Raíces', aliases: ['Coloracion'], duration: 60, price: 40000, category: 'Coloracion' }
        ],
        professionals: []
      })
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), extractor)

      const result = await engine.process({
        businessId: 'business-1',
        conversation: {
          selectedCustomerName: 'Mati',
          selectedServiceId: 'roots',
          selectedProfessionalId: null,
          selectedDate: null,
          selectedTime: null,
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'cualquiera'
      })

      assert.equal(result.state.draft.professional, null)
      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'no_compatible_professional'
      })
      assert.equal(result.reply.includes('no tengo profesionales habilitados'), true)
      assert.equal(result.reply.includes('Raíces'), true)
    }
  },
  {
    name: 'renderiza todos los horarios sin cortar despues del sexto',
    run: () => {
      const availabilityOptions = [
        '09:00',
        '09:30',
        '10:00',
        '10:30',
        '11:00',
        '11:30',
        '15:00',
        '15:30'
      ].map((time) => ({
        time,
        professionalId: 'professional-1',
        professionalName: 'Nico'
      }))

      const reply = renderBookingV2Response({
        plan: {
          type: 'ask_field',
          field: 'time',
          reason: 'missing',
          misunderstandingCount: 0
        },
        draft: {
          name: 'Mati',
          service: 'haircut',
          professional: 'professional-1',
          date: '2026-07-27',
          time: null
        },
        catalog: fakeDomainCatalog(),
        availabilityOptions
      })

      assert.equal(reply.includes('todos los horarios disponibles'), true)
      assert.equal(reply.includes('09:00, 09:30, 10:00, 10:30, 11:00, 11:30, 15:00, 15:30'), true)
    }
  },
  {
    name: 'capa conversacional conserva literalmente la respuesta obligatoria',
    run: () => {
      const requiredReply = [
        'Estos son todos los horarios disponibles 😊',
        '• Nico: 18:00, 18:30',
        '¿Cuál te queda mejor?'
      ].join('\n')

      const composed = mergeBookingV2ConversationalCopy(
        requiredReply,
        '¡Dale, Mati! 😊'
      )

      assert.equal(composed.endsWith(requiredReply), true)
      assert.equal(composed.startsWith('¡Dale, Mati! 😊'), true)
    }
  },
  {
    name: 'capa conversacional rechaza prefijos con datos o preguntas inventadas',
    run: () => {
      const requiredReply = '¿Qué día te gustaría venir?'

      assert.equal(
        mergeBookingV2ConversationalCopy(requiredReply, 'Tengo 3 horarios disponibles'),
        requiredReply
      )
      assert.equal(
        mergeBookingV2ConversationalCopy(requiredReply, '¿Querés venir mañana?'),
        requiredReply
      )
      assert.equal(
        mergeBookingV2ConversationalCopy(requiredReply, '¡Hola Matías! 😊'),
        requiredReply
      )
      assert.equal(
        mergeBookingV2ConversationalCopy(
          requiredReply,
          '¡Qué lindo es explorar nuevos lugares! 😊'
        ),
        requiredReply
      )
      assert.equal(
        mergeBookingV2ConversationalCopy(
          requiredReply,
          'Espero que estés teniendo un buen día 😊'
        ),
        requiredReply
      )
    }
  },
  {
    name: 'personalidad normaliza valores y aplica presets seguros',
    run: () => {
      const elegant = personalityForPreset('elegant', 'Lola')
      assert.equal(elegant.name, 'Lola')
      assert.equal(elegant.treatment, 'usted')
      assert.equal(elegant.emojiLevel, 'low')
      assert.equal(assistantPersonalityPreview(elegant).includes('su asistente personal'), true)

      const normalized = normalizeAssistantPersonality({
        preset: 'inexistente',
        name: '  Mia  ',
        emojiLevel: 'muchos',
        preferredEmojis: ['💖', '✨']
      })
      assert.equal(normalized.preset, 'warm')
      assert.equal(normalized.name, 'Mia')
      assert.equal(normalized.emojiLevel, 'moderate')
    }
  },
  {
    name: 'personalidad cambia identidad tratamiento y emojis sin tocar datos',
    run: () => {
      const profile = normalizeAssistantPersonality({
        preset: 'direct',
        name: 'Lola',
        role: 'asistente de reservas',
        treatment: 'usted',
        emojiLevel: 'none',
        responseLength: 'short',
        preferredEmojis: [],
        customInstructions: ''
      })
      const requiredReply = '¡Hola! Soy Cami 😊 ¿Querés reservar a las 18:30?'
      const styled = applyAssistantPersonalityToReply(requiredReply, profile)

      assert.equal(styled.includes('Lola'), true)
      assert.equal(styled.includes('¿Quiere reservar a las 18:30?'), true)
      assert.equal(styled.includes('😊'), false)
      assert.equal(styled.includes('18:30'), true)
    }
  },
  {
    name: 'instrucciones de personalidad conservan preferencias configuradas',
    run: () => {
      const profile = normalizeAssistantPersonality({
        preset: 'relaxed',
        name: 'Mia',
        customInstructions: 'Evitar respuestas solemnes'
      })
      const instructions = buildAssistantPersonalityInstructions(profile)

      assert.equal(instructions.includes('Tu nombre es Mia'), true)
      assert.equal(instructions.includes('Preset de tono: relaxed'), true)
      assert.equal(instructions.includes('Evitar respuestas solemnes'), true)
    }
  },
  {
    name: 'renderiza baja confianza repreguntando el campo actual',
    run: () => {
      const reply = renderBookingV2Response({
        plan: {
          type: 'ask_field',
          field: 'service',
          reason: 'not_understood',
          misunderstandingCount: 1
        },
        draft: createEmptyBookingV2State().draft,
        catalog: fakeDomainCatalog()
      })

      assert.equal(reply.includes('Disculpame, no te entendí bien.'), true)
      assert.equal(reply.includes('• Corte — 30 min'), true)
      assert.equal(reply.includes('15.000'), true)
      assert.equal(reply.includes('• Barba — 20 min — precio a consultar'), true)
    }
  },
  {
    name: 'pedido de nombre no vuelve a presentar al asistente',
    run: () => {
      const reply = renderBookingV2Response({
        plan: {
          type: 'ask_field',
          field: 'name',
          reason: 'missing',
          misunderstandingCount: 0
        },
        draft: createEmptyBookingV2State().draft,
        catalog: fakeDomainCatalog()
      })

      assert.equal(reply, '¿Me decís tu nombre?')
      assert.equal(reply.includes('Hola'), false)
      assert.equal(reply.includes('Soy Cami'), false)
    }
  },
  {
    name: 'router conserva multiples intenciones informativas',
    run: () => {
      const routing = normalizeConversationRouting({
        intents: [
          {
            type: 'business_information',
            topic: 'opening_hours',
            confidence: 0.96,
            evidence: 'a que hora abren'
          },
          {
            type: 'business_information',
            topic: 'address',
            confidence: 0.91,
            evidence: 'donde quedan'
          },
          {
            type: 'book_appointment',
            topic: null,
            confidence: 0.94,
            evidence: 'quiero un corte'
          }
        ],
        bookingMessage: 'quiero un corte manana'
      })

      assert.deepEqual(
        routing.intents.map((intent) => [intent.type, intent.topic]),
        [
          ['business_information', 'opening_hours'],
          ['business_information', 'address'],
          ['book_appointment', null]
        ]
      )
      assert.equal(routing.bookingMessage, 'quiero un corte manana')
    }
  },
  {
    name: 'router normaliza intenciones y datos de reserva en una sola comprension',
    run: () => {
      const routing = normalizeConversationRouting({
        intents: [
          {
            type: 'book_appointment',
            topic: null,
            confidence: 0.97,
            evidence: 'hacerme unas iluminaciones'
          },
          {
            type: 'request_quote',
            topic: null,
            confidence: 0.95,
            evidence: 'saber presupuestos'
          },
          {
            type: 'availability_preference',
            topic: null,
            confidence: 0.91,
            evidence: 'horarios'
          }
        ],
        bookingMessage: 'hacerme unas iluminaciones, saber presupuestos y horarios',
        bookingExtraction: extraction({
          service: field('illumination', 0.98, 'iluminaciones')
        })
      })

      assert.equal(routing.bookingExtraction?.service.value, 'illumination')
      assert.equal(routing.bookingExtraction?.service.evidence, 'iluminaciones')
      assert.deepEqual(
        routing.intents.map((intent) => intent.type),
        ['book_appointment', 'request_quote', 'availability_preference']
      )
      assert.equal(
        deterministicConversationRouting(
          'Quería hacerme unas iluminaciones, saber presupuestos y horarios.'
        ).bookingMessage !== null,
        true
      )
    }
  },
  {
    name: 'bienvenida neutral se limita a saludos sin asumir una reserva',
    run: () => {
      assert.equal(isBookingV2GreetingOnlyMessage('Hola'), true)
      assert.equal(isBookingV2GreetingOnlyMessage('buenas tardes'), true)
      assert.equal(isBookingV2GreetingOnlyMessage('hola como estas?'), true)
      assert.equal(isBookingV2GreetingOnlyMessage('Hola, hasta que hora estan abiertos?'), false)
      assert.equal(isBookingV2GreetingOnlyMessage('hola quiero reservar'), false)
    }
  },
  {
    name: 'retomada posterior al turno no inventa que preguntaron como esta',
    run: () => {
      const copy = new BotCopyService()
      const plainGreeting = copy.reopenAfterBooking({
        customerName: 'Mati',
        askedHowAreYou: isPostBookingWellbeingQuestion('hola')
      })
      assert.equal(plainGreeting, '¡Hola Mati! 😊\n\n¿En qué te puedo ayudar?')
      assert.equal(plainGreeting.includes('gracias por preguntar'), false)
      assert.equal(plainGreeting.includes('Reservar otro turno'), false)

      const wellbeingGreeting = copy.reopenAfterBooking({
        customerName: 'Mati',
        askedHowAreYou: isPostBookingWellbeingQuestion('hola, ¿cómo estás?')
      })
      assert.equal(wellbeingGreeting.includes('Todo bien, gracias por preguntar.'), true)
    }
  },
  {
    name: 'intencion desconocida o social no inicia una reserva',
    run: () => {
      const unknown = deterministicConversationRouting('si queres salir a comer?')
      assert.equal(unknown.bookingMessage, null)
      assert.equal(shouldShowBookingV2IntentFallback('START', unknown), true)

      assert.equal(shouldShowBookingV2IntentFallback('START', {
        intents: [{
          type: 'social_message',
          topic: null,
          confidence: 0.92,
          evidence: 'si queres salir a comer'
        }],
        bookingMessage: null,
        source: 'ai'
      }), true)

      assert.equal(shouldShowBookingV2IntentFallback('ASK_SERVICE', unknown), false)
      assert.equal(shouldShowBookingV2IntentFallback('START', {
        ...unknown,
        bookingMessage: 'quiero reservar'
      }), false)

      const reply = new BotCopyService().intentNotUnderstood()
      assert.equal(reply.includes('No estoy segura de haber entendido'), true)
      assert.equal(reply.includes('Consultar servicios y precios'), true)
      assert.equal(reply.includes('Reservar o cambiar un turno'), true)
      assert.equal(reply.includes('Hablar con una persona'), true)
    }
  },
  {
    name: 'respuesta informativa pregunta si puede ayudar en algo mas',
    run: () => {
      assert.equal(
        withBusinessInformationFollowUp('Barber Colapinta queda en Villa Urquiza.'),
        'Barber Colapinta queda en Villa Urquiza.\n\n¿Te puedo ayudar en algo más?'
      )

      const formal = applyAssistantPersonalityToReply(
        withBusinessInformationFollowUp('La dirección es Av. Siempre Viva 123.'),
        normalizeAssistantPersonality({
          preset: 'elegant',
          treatment: 'usted'
        })
      )
      assert.equal(formal.includes('¿Puedo ayudarle en algo más?'), true)
    }
  },
  {
    name: 'cierre conversacional acepta negativas y expresiones informales',
    run: () => {
      for (const message of [
        'no',
        'no gracias',
        'nop',
        'nono gracias',
        'nada más',
        'joya',
        'estamos',
        'era eso',
        'con eso estamos'
      ]) {
        assert.equal(isBookingV2ConversationClosing(message), true, message)
      }
      assert.equal(isBookingV2ConversationClosing('no, quiero otro horario'), false)
      assert.equal(isBookingV2ConversationClosing('quiero reservar'), false)
    }
  },
  {
    name: 'cierre conversacional acepta variantes detectadas por la ia',
    run: () => {
      assert.equal(isBookingV2ConversationClosing('tamo joya', {
        intents: [
          {
            type: 'stop_flow',
            topic: null,
            confidence: 0.92,
            evidence: 'tamo joya'
          }
        ],
        bookingMessage: null,
        source: 'ai'
      }), true)
    }
  },
  {
    name: 'router determinista entiende consultas del local y mensajes mixtos',
    run: () => {
      const routing = deterministicConversationRouting(
        'A que hora abren y donde quedan? Tambien quiero reservar un corte manana.'
      )

      assert.deepEqual(
        businessInformationTopicsFromRouting(routing),
        ['opening_hours', 'address']
      )
      assert.equal(routing.bookingMessage?.includes('quiero reservar un corte'), true)
    }
  },
  {
    name: 'router reconoce formas naturales de preguntar la ubicacion',
    run: () => {
      const routing = deterministicConversationRouting(
        'hola que tal, queria saber donde esta el local',
        { currentStep: 'START' }
      )
      assert.deepEqual(businessInformationTopicsFromRouting(routing), ['address'])
      assert.equal(routing.bookingMessage, null)
    }
  },
  {
    name: 'router conserva informacion de ia cuando la evidencia esta en el mensaje',
    run: () => {
      const message = 'me indicarias como llegar hasta ustedes'
      const merged = mergeConversationRouting({
        intents: [
          {
            type: 'business_information',
            topic: 'address',
            confidence: 0.92,
            evidence: 'como llegar hasta ustedes'
          }
        ],
        bookingMessage: null
      }, deterministicConversationRouting(message, { currentStep: 'START' }), message)

      assert.deepEqual(
        businessInformationTopicsFromRouting({ ...merged, source: 'ai' }),
        ['address']
      )
      assert.equal(merged.bookingMessage, null)
    }
  },
  {
    name: 'router diferencia horarios del local de horarios de una reserva',
    run: () => {
      const openingHours = deterministicConversationRouting(
        'queria saber los horarios',
        { currentStep: 'START' }
      )
      assert.deepEqual(businessInformationTopicsFromRouting(openingHours), ['opening_hours'])
      assert.equal(openingHours.bookingMessage, null)

      const bookingAvailability = deterministicConversationRouting(
        'que horarios tenes',
        { currentStep: 'ASK_TIME' }
      )
      assert.deepEqual(businessInformationTopicsFromRouting(bookingAvailability), [])
    }
  },
  {
    name: 'router no deja que la ia convierta horarios del local en una reserva',
    run: () => {
      const message = 'queria saber los horarios'
      const deterministic = deterministicConversationRouting(message, {
        currentStep: 'START'
      })
      const merged = mergeConversationRouting({
        intents: [
          {
            type: 'availability_preference',
            topic: null,
            confidence: 0.9,
            evidence: 'los horarios'
          }
        ],
        bookingMessage: message
      }, deterministic, message)

      assert.deepEqual(
        businessInformationTopicsFromRouting({ ...merged, source: 'ai' }),
        ['opening_hours']
      )
      assert.equal(merged.bookingMessage, null)
      assert.equal(
        merged.intents.some((intent) => intent.type === 'availability_preference'),
        false
      )
    }
  },
  {
    name: 'consulta de precio no inicia una reserva aunque mencione un servicio',
    run: () => {
      const message = 'y cuanto cuesta un corte?'
      const deterministic = deterministicConversationRouting(message, {
        currentStep: 'START'
      })
      assert.deepEqual(businessInformationTopicsFromRouting(deterministic), ['prices'])
      assert.equal(deterministic.bookingMessage, null)

      const merged = mergeConversationRouting({
        intents: [
          {
            type: 'business_information',
            topic: 'prices',
            confidence: 0.95,
            evidence: 'cuanto cuesta un corte'
          },
          {
            type: 'book_appointment',
            topic: null,
            confidence: 0.7,
            evidence: 'un corte'
          },
          {
            type: 'request_quote',
            topic: null,
            confidence: 0.7,
            evidence: 'cuanto cuesta un corte'
          }
        ],
        bookingMessage: 'un corte',
        bookingExtraction: extraction({
          service: field('haircut', 0.7, 'un corte')
        })
      }, deterministic, message)

      assert.equal(merged.bookingMessage, null)
      assert.equal(merged.bookingExtraction, null)
      assert.equal(
        merged.intents.some((intent) => intent.type === 'book_appointment'),
        false
      )
      assert.equal(
        merged.intents.some((intent) => intent.type === 'request_quote'),
        false
      )
    }
  },
  {
    name: 'router reconoce pedidos generales de precios y catalogo',
    run: () => {
      for (const message of [
        'si quiero saber los precios',
        'me mostras los precios?',
        'quiero ver el catalogo',
        'que tarifas tienen?'
      ]) {
        const routing = deterministicConversationRouting(message, {
          currentStep: 'START'
        })
        assert.deepEqual(
          businessInformationTopicsFromRouting(routing),
          ['prices'],
          message
        )
        assert.equal(routing.bookingMessage, null, message)
      }
    }
  },
  {
    name: 'consulta informativa conserva una reserva cuando la intencion es explicita',
    run: () => {
      const message = 'cuanto sale el corte y quiero reservar un turno'
      const routing = deterministicConversationRouting(message, {
        currentStep: 'START'
      })

      assert.deepEqual(businessInformationTopicsFromRouting(routing), ['prices'])
      assert.equal(routing.bookingMessage, message)
    }
  },
  {
    name: 'router completa una parte de reserva omitida por la IA',
    run: () => {
      const message = 'A que hora abren manana y quiero un corte despues de las 18?'
      const aiRouting = normalizeConversationRouting({
        intents: [
          {
            type: 'business_information',
            topic: 'opening_hours',
            confidence: 0.9,
            evidence: 'a que hora abren'
          },
          {
            type: 'availability_preference',
            topic: null,
            confidence: 0.8,
            evidence: 'despues de las 18'
          }
        ],
        bookingMessage: null
      })

      const merged = mergeConversationRouting(
        aiRouting,
        deterministicConversationRouting(message),
        message
      )

      assert.equal(merged.bookingMessage, message)
      assert.deepEqual(
        merged.intents.map((intent) => intent.type),
        ['business_information', 'availability_preference']
      )
    }
  },
  {
    name: 'router no reutiliza una consulta informativa anterior en un saludo',
    run: () => {
      const merged = mergeConversationRouting(
        normalizeConversationRouting({
          intents: [
            {
              type: 'business_information',
              topic: 'website',
              confidence: 0.9,
              evidence: 'pagina web'
            },
            {
              type: 'social_message',
              topic: null,
              confidence: 0.95,
              evidence: 'Hola'
            }
          ],
          bookingMessage: null
        }),
        deterministicConversationRouting('Hola'),
        'Hola'
      )

      assert.deepEqual(
        merged.intents.map((intent) => intent.type),
        ['social_message']
      )
      assert.deepEqual(businessInformationTopicsFromRouting({ ...merged, source: 'ai' }), [])
    }
  },
  {
    name: 'contexto del router excluye el mensaje actual duplicado',
    run: () => {
      const history = removeCurrentInboundFromHistory([
        { direction: 'INBOUND', body: 'Tenes pagina web?' },
        { direction: 'OUTBOUND', body: 'La pagina es https://example.com' },
        { direction: 'INBOUND', body: 'Hola' }
      ], 'Hola')

      assert.deepEqual(history, [
        { direction: 'INBOUND', body: 'Tenes pagina web?' },
        { direction: 'OUTBOUND', body: 'La pagina es https://example.com' }
      ])
    }
  },
  {
    name: 'router determinista reconoce formas naturales de pedir servicios',
    run: () => {
      for (const message of ['Cuales servicios hay?', 'Que servicios hay?', 'Mostrame los servicios']) {
        assert.deepEqual(
          businessInformationTopicsFromRouting(deterministicConversationRouting(message)),
          ['services']
        )
      }
    }
  },
  {
    name: 'router determinista reconoce consultas sobre profesionales',
    run: () => {
      for (const message of ['Quienes atienden?', 'Que profesionales hay?', 'Con quien me puedo atender?']) {
        assert.deepEqual(
          businessInformationTopicsFromRouting(deterministicConversationRouting(message)),
          ['professionals']
        )
      }
    }
  },
  {
    name: 'router comprende consultas puntuales sin exigir palabras literales',
    run: () => {
      const catalog = {
        services: [
          {
            id: 'treatment',
            name: 'Tratamiento',
            description: 'Tratamiento capilar personalizado.',
            aliases: ['tratamientos']
          },
          {
            id: 'haircut',
            name: 'Corte Hombre',
            description: 'Corte de pelo.',
            aliases: ['corte', 'corte de pelo']
          }
        ],
        professionals: []
      }
      const treatment = deterministicConversationRouting(
        'dame informacion sobre tratamiento',
        { currentStep: 'START', catalog }
      )
      assert.deepEqual(businessInformationTopicsFromRouting(treatment), ['services'])
      assert.equal(treatment.catalogQuery?.serviceId, 'treatment')
      assert.deepEqual(treatment.catalogQuery?.requestedInformation, ['general'])
      assert.equal(treatment.bookingMessage, null)

      const haircutPrice = deterministicConversationRouting(
        'decime el precio del corte de pelo',
        { currentStep: 'ASK_PROFESSIONAL', catalog }
      )
      assert.deepEqual(businessInformationTopicsFromRouting(haircutPrice), ['prices'])
      assert.equal(haircutPrice.catalogQuery?.serviceId, 'haircut')
      assert.deepEqual(haircutPrice.catalogQuery?.requestedInformation, ['price'])
      assert.equal(haircutPrice.bookingMessage, null)
    }
  },
  {
    name: 'router conserva la consulta de ia cuando esta respaldada por el catalogo',
    run: () => {
      const message = 'contame un poco sobre tratamiento'
      const catalog = {
        services: [{
          id: 'treatment',
          name: 'Tratamiento',
          description: 'Tratamiento capilar personalizado.',
          aliases: ['tratamientos']
        }],
        professionals: []
      }
      const merged = mergeConversationRouting({
        intents: [{
          type: 'business_information',
          topic: 'services',
          confidence: 0.96,
          evidence: 'contame un poco sobre tratamiento'
        }],
        bookingMessage: null,
        bookingExtraction: null,
        catalogQuery: {
          serviceId: 'treatment',
          requestedInformation: ['general'],
          confidence: 0.96,
          evidence: 'tratamiento'
        }
      }, deterministicConversationRouting(message), message, catalog)

      assert.deepEqual(
        businessInformationTopicsFromRouting({ ...merged, source: 'ai' }),
        ['services']
      )
      assert.equal(merged.catalogQuery?.serviceId, 'treatment')
      assert.equal(merged.bookingMessage, null)
    }
  },
  {
    name: 'router tolera un typo y aclara una referencia ambigua a corte',
    run: () => {
      const catalog = {
        services: [
          { id: 'haircut', name: 'Corte Hombre', description: 'Corte de pelo.' },
          { id: 'haircut-color', name: 'Corte y color', description: 'Corte con color.' },
          { id: 'roots', name: 'Raíces', description: 'Coloración de raíces.' }
        ],
        professionals: []
      }

      const typo = deterministicConversationRouting(
        'precio de corto hombre',
        { currentStep: 'START', catalog }
      )
      assert.equal(typo.catalogQuery?.serviceId, 'haircut')
      assert.deepEqual(typo.catalogQuery?.candidateServiceIds, ['haircut'])
      assert.deepEqual(typo.catalogQuery?.requestedInformation, ['price'])
      assert.equal(typo.bookingMessage, null)

      const ambiguous = deterministicConversationRouting(
        'cual es el precio del corte',
        { currentStep: 'START', catalog }
      )
      assert.equal(ambiguous.catalogQuery?.serviceId, null)
      assert.deepEqual(
        new Set(ambiguous.catalogQuery?.candidateServiceIds),
        new Set(['haircut', 'haircut-color'])
      )
      assert.deepEqual(ambiguous.catalogQuery?.requestedInformation, ['price'])
      assert.deepEqual(businessInformationTopicsFromRouting(ambiguous), ['prices'])
      assert.equal(ambiguous.bookingMessage, null)
    }
  },
  {
    name: 'conocimiento del negocio responde sobre el servicio solicitado',
    run: () => {
      const business = {
        name: 'Salon Demo',
        slug: 'salon-demo',
        landingEnabled: true,
        publicWhatsapp: null,
        contactEmail: null,
        publicAddress: null,
        publicAddressArea: null,
        publicMapsUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        businessHours: [],
        services: [
          {
            id: 'treatment',
            name: 'Tratamiento',
            description: 'Nutre y repara el cabello.',
            duration: 30,
            price: 25000,
            priceMode: 'STARTING_AT' as const
          },
          {
            id: 'haircut',
            name: 'Corte Hombre',
            description: 'Corte personalizado.',
            duration: 30,
            price: 15000,
            priceMode: 'FIXED' as const
          }
        ],
        professionals: [{ name: 'Tamara', services: ['Tratamiento'] }]
      }
      const treatment = renderCatalogServiceQuery(business, {
        serviceId: 'treatment',
        requestedInformation: ['general'],
        confidence: 0.96,
        evidence: 'tratamiento'
      })
      assert.equal(treatment?.includes('Nutre y repara el cabello.'), true)
      assert.equal(treatment?.includes('Duración: 30 min.'), true)
      assert.equal(treatment?.includes('desde $'), true)
      assert.equal(treatment?.includes('Corte Hombre'), false)

      const haircut = renderCatalogServiceQuery(business, {
        serviceId: 'haircut',
        requestedInformation: ['price'],
        confidence: 0.96,
        evidence: 'precio del corte de pelo'
      })
      assert.equal(haircut?.includes('$'), true)
      assert.equal(haircut?.includes('15.000'), true)
      assert.equal(haircut?.includes('Tratamiento'), false)
    }
  },
  {
    name: 'conocimiento del negocio muestra candidatos cuando corte es ambiguo',
    run: () => {
      const answer = renderCatalogServiceQuery({
        name: 'Salon Demo',
        slug: 'salon-demo',
        landingEnabled: true,
        publicWhatsapp: null,
        contactEmail: null,
        publicAddress: null,
        publicAddressArea: null,
        publicMapsUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        businessHours: [],
        services: [
          {
            id: 'haircut',
            name: 'Corte Hombre',
            description: 'Corte clásico.',
            duration: 30,
            price: 15000,
            priceMode: 'FIXED'
          },
          {
            id: 'haircut-color',
            name: 'Corte y color',
            description: 'Corte con color.',
            duration: 60,
            price: 40000,
            priceMode: 'FIXED'
          }
        ],
        professionals: []
      }, {
        serviceId: null,
        candidateServiceIds: ['haircut', 'haircut-color'],
        requestedInformation: ['price'],
        confidence: 0.82,
        evidence: 'corte'
      })

      assert.match(answer ?? '', /más de un servicio relacionado/i)
      assert.match(answer ?? '', /Corte Hombre — \$\s15\.000/)
      assert.match(answer ?? '', /Corte y color — \$\s40\.000/)
      assert.match(answer ?? '', /¿Sobre cuál querés más información\?/)
    }
  },
  {
    name: 'conocimiento del negocio responde solo con datos cargados',
    run: () => {
      const replies = renderBusinessKnowledgeAnswers({
        name: 'Salon Demo',
        slug: 'salon-demo',
        landingEnabled: true,
        publicWhatsapp: '1155555555',
        contactEmail: null,
        publicAddress: 'Av. Siempre Viva 123',
        publicAddressArea: 'Palermo',
        publicMapsUrl: 'https://maps.example/demo',
        instagramUrl: 'https://instagram.com/salon-demo',
        facebookUrl: null,
        businessHours: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          { dayOfWeek: 6, startTime: '10:00', endTime: '14:00' }
        ],
        services: [{
          name: 'Corte',
          description: 'Incluye lavado, corte personalizado y finalización.',
          duration: 30,
          price: 15000,
          priceMode: 'STARTING_AT'
        }],
        professionals: [
          { name: 'Nico', services: ['Corte'] }
        ]
      }, ['opening_hours', 'address', 'website', 'booking_channels', 'email', 'prices'], 'example.com')

      assert.equal(replies[0]?.includes('Lunes: 09:00 a 18:00'), true)
      assert.equal(replies[1]?.includes('Av. Siempre Viva 123, Palermo'), true)
      assert.equal(replies[2], 'La página de Salon Demo es https://salon-demo.example.com')
      assert.equal(replies[3], 'Podés reservar por este chat o desde https://salon-demo.example.com/reservar')
      assert.equal(replies[4]?.includes('No tengo el email'), true)
      assert.equal(replies[5]?.startsWith('Estos son los precios de nuestros servicios:'), true)
      assert.equal(replies[5]?.includes('Corte (30 min)'), true)
      assert.equal(replies[5]?.includes('15.000'), true)
      assert.equal(replies[5]?.includes('Desde'), true)
      assert.equal(replies[5]?.includes('Incluye lavado, corte personalizado y finalización.'), true)

      const professionalReplies = renderBusinessKnowledgeAnswers({
        name: 'Salon Demo',
        slug: 'salon-demo',
        landingEnabled: true,
        publicWhatsapp: null,
        contactEmail: null,
        publicAddress: null,
        publicAddressArea: null,
        publicMapsUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        businessHours: [],
        services: [],
        professionals: [
          { name: 'Nico', services: ['Corte'] }
        ]
      }, ['professionals'], 'example.com')

      assert.equal(professionalReplies[0]?.includes('Nico'), true)
      assert.equal(professionalReplies[0]?.includes('Corte'), true)
    }
  },
  {
    name: 'consulta de horarios del local responde y retoma cada etapa sin perder datos',
    run: async () => {
      const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
      const states = [
        createEmptyBookingV2State(),
        acceptField(createEmptyBookingV2State(), 'name', 'Caro'),
        acceptField(acceptField(createEmptyBookingV2State(), 'name', 'Caro'), 'service', 'haircut'),
        acceptField(
          acceptField(acceptField(createEmptyBookingV2State(), 'name', 'Caro'), 'service', 'haircut'),
          'professional',
          'professional-1'
        ),
        acceptField(
          acceptField(
            acceptField(acceptField(createEmptyBookingV2State(), 'name', 'Caro'), 'service', 'haircut'),
            'professional',
            'professional-1'
          ),
          'date',
          '2026-07-10'
        ),
        completeDraft()
      ]
      const currentSteps = [
        'ASK_CUSTOMER_NAME',
        'ASK_SERVICE',
        'ASK_PROFESSIONAL',
        'ASK_DATE',
        'ASK_TIME',
        'CONFIRM'
      ]

      for (const [index, state] of states.entries()) {
        const currentStep = currentSteps[index]
        assert.ok(currentStep)
        const routing = deterministicConversationRouting(
          '¿Cuáles son los horarios del local?',
          { currentStep }
        )
        assert.deepEqual(businessInformationTopicsFromRouting(routing), ['opening_hours'])
        assert.equal(routing.bookingMessage, null)

        const resumed = await engine.resume({
          businessId: 'business-1',
          conversation: conversationPatchFromState(state)
        })
        const reply = composeBusinessInformationResumeReply(
          'Los horarios del local son de 09:00 a 20:00.',
          resumed.reply
        )

        assert.equal(reply.startsWith('Los horarios del local son de 09:00 a 20:00.'), true)
        assert.equal(reply.endsWith(resumed.reply), true)
        assert.deepEqual(resumed.state.draft, state.draft)
      }
    }
  },
  {
    name: 'consultas informativas interrumpen y retoman cualquier modo sin perder estado',
    run: async () => {
      const catalog = createBookingV2DomainCatalog({
        services: [
          { id: 'direct', name: 'Corte', aliases: ['corte'], duration: 30, price: 15000, category: null, attentionMode: 'DIRECT_BOOKING' },
          { id: 'quote', name: 'Color', aliases: ['color'], duration: 90, price: 60000, category: null, attentionMode: 'QUOTE' },
          { id: 'advisor', name: 'Diagnostico', aliases: ['diagnostico'], duration: 45, price: null, category: null, attentionMode: 'ADVISOR' },
          {
            id: 'guided',
            name: 'Iluminacion',
            aliases: ['iluminacion'],
            duration: 180,
            price: 80000,
            category: null,
            attentionMode: 'GUIDED_ESTIMATE',
            estimateOptions: [{ id: 'short', label: 'Corto', priceMin: 80000, priceMax: 100000, note: null }],
            estimateAllowsBooking: true
          }
        ],
        professionals: [{
          id: 'professional-1',
          name: 'Tamara',
          serviceIds: ['direct', 'quote', 'guided']
        }]
      })
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), fakeExtractor(null))
      const base = acceptField(createEmptyBookingV2State(), 'name', 'Mati')
      const direct = acceptField(base, 'service', 'direct')
      const quote = {
        ...acceptField(base, 'service', 'quote'),
        advisorQuote: {
          serviceId: 'quote',
          amount: 70000,
          note: null,
          status: 'accepted' as const,
          quotedAt: '2026-08-03T12:00:00.000Z'
        }
      }
      const advisor = acceptField(base, 'service', 'advisor')
      const guided = {
        ...acceptField(base, 'service', 'guided'),
        guidedEstimate: {
          serviceId: 'guided',
          stage: 'awaiting_option' as const,
          optionId: null,
          optionLabel: null,
          priceMin: null,
          priceMax: null
        }
      }
      const states = [direct, quote, advisor, guided]
      const topics = [
        ['opening_hours', '¿en qué momento suelen atender?'],
        ['prices', '¿qué inversión requiere?'],
        ['professionals', '¿quiénes forman parte del equipo?'],
        ['services', 'contame un poco más de lo que hacen']
      ] as const

      for (const state of states) {
        for (const [topic, evidence] of topics) {
          const routing = normalizeConversationRouting({
            intents: [{ type: 'business_information', topic, confidence: 0.92, evidence }],
            bookingMessage: null,
            bookingExtraction: null,
            catalogQuery: null
          })
          assert.deepEqual(businessInformationTopicsFromRouting({ ...routing, source: 'ai' }), [topic])

          const resumed = await engine.resume({
            businessId: 'business-1',
            conversation: conversationPatchFromState(state)
          })
          const combined = composeBusinessInformationResumeReply(
            `Respuesta informativa sobre ${topic}.`,
            resumed.reply
          )
          assert.equal(combined.includes(`Respuesta informativa sobre ${topic}.`), true)
          assert.equal(combined.endsWith(resumed.reply), true)
          assert.deepEqual(resumed.state.draft, state.draft)
        }
      }
    }
  },
  {
    name: 'motor puede retomar sin consumir extractor ni modificar borrador',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)
      const conversation = {
        selectedCustomerName: 'Juan',
        selectedServiceId: 'haircut',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null
      }

      const result = await engine.resume({
        businessId: 'business-1',
        conversation
      })

      assert.equal(result.plan.type, 'ask_field')
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'professional')
      assert.deepEqual(result.conversationPatch, {
        selectedCustomerName: 'Juan',
        selectedServiceId: 'haircut',
        selectedProfessionalId: null,
        selectedDate: null,
        selectedTime: null,
        misunderstandingCount: 0,
        bookingV2State: null
      })
      assert.equal(extractor.calls.length, 0)
    }
  }
]

for (const test of tests) {
  await test.run()
  console.log(`OK: ${test.name}`)
}

console.log(`\n${tests.length} pruebas de contrato de Booking V2 pasaron.`)

function completeDraft() {
  let state = createEmptyBookingV2State()
  state = acceptField(state, 'name', 'Juan')
  state = acceptField(state, 'service', 'haircut')
  state = acceptField(state, 'professional', 'professional-1')
  state = acceptField(state, 'date', '2026-07-10')
  state = acceptField(state, 'time', '15:00')
  return state
}

function catalog() {
  return {
    serviceIds: new Set(['haircut', 'beard']),
    professionalIds: new Set(['professional-1', 'professional-2']),
    professionalServiceIds: new Map([
      ['professional-1', new Set(['haircut', 'beard'])],
      ['professional-2', new Set(['beard'])]
    ])
  }
}

function field(value: string | null, confidence: number, evidence: string) {
  return { value, confidence, evidence }
}

function extraction(
  overrides: Partial<BookingV2Extraction>
): BookingV2Extraction {
  const empty = field(null, 0, '')
  return {
    name: empty,
    service: empty,
    professional: empty,
    date: empty,
    time: empty,
    correction: {
      field: null,
      newValue: null,
      confidence: 0,
      evidence: ''
    },
    ...overrides
  }
}

function fakeBookingProvider(slotsByProfessional: Record<string, string[]>) {
  const calls: Array<{ professionalId: string; serviceId: string; date: string }> = []
  const provider: BookingProvider & { calls: typeof calls } = {
    calls,
    async getAvailability(input) {
      calls.push(input)
      return {
        ok: true,
        slots: slotsByProfessional[input.professionalId] ?? []
      }
    },
    async createAppointment() {
      return {
        ok: false,
        statusCode: 501,
        message: 'No usado en pruebas'
      }
    },
    async cancelAppointment() {}
  }
  return provider
}

function fakeDomainPort(input?: {
  catalog?: ReturnType<typeof fakeDomainCatalog>
  availabilityOptions?: Array<{
    time: string
    professionalId: string
    professionalName: string
  }>
}) {
  const domainCatalog = input?.catalog ?? fakeDomainCatalog()
  const availabilityOptions = input?.availabilityOptions ?? [
    { time: '15:00', professionalId: 'professional-1', professionalName: 'Nico' },
    { time: '15:30', professionalId: 'professional-1', professionalName: 'Nico' }
  ]
  const availabilityCalls: string[] = []

  return {
    availabilityCalls,
    async loadCatalog() {
      return domainCatalog
    },
    toExtractionCatalog() {
      return {
        services: domainCatalog.services.map((service): BookingV2CatalogOption => ({
          id: service.id,
          name: service.name,
          aliases: service.aliases,
          ...(service.description === undefined ? {} : { description: service.description })
        })),
        professionals: domainCatalog.professionals.map((professional): BookingV2CatalogOption => ({
          id: professional.id,
          name: professional.name
        }))
      }
    },
    toInterpreterCatalog(): BookingV2Catalog {
      return {
        serviceIds: domainCatalog.serviceIds,
        professionalIds: domainCatalog.professionalIds,
        professionalServiceIds: domainCatalog.professionalServiceIds
      }
    },
    async findAvailabilityOptions(request: { date: string }) {
      availabilityCalls.push(request.date)
      return {
        ok: true as const,
        options: availabilityOptions
      }
    }
  }
}

function fakeDomainCatalog() {
  return createBookingV2DomainCatalog({
    services: [
      {
        id: 'haircut',
        name: 'Corte',
        description: 'Incluye lavado, corte personalizado y finalización.',
        aliases: ['corte de pelo'],
        duration: 30,
        price: 15000,
        category: null
      },
      { id: 'beard', name: 'Barba', aliases: [], duration: 20, price: null, category: null }
    ],
    professionals: [
      { id: 'professional-1', name: 'Nico', serviceIds: ['haircut', 'beard'] },
      { id: 'professional-2', name: 'Ana', serviceIds: ['beard'] }
    ]
  })
}

function fakeExtractor(result: BookingV2Extraction | null) {
  const calls: unknown[] = []
  return {
    calls,
    async extract(input: unknown) {
      calls.push(input)
      return result
    }
  }
}

function fakeServiceValidationClassifier() {
  return {
    async classify(input: { message: string }) {
      const message = input.message.toLowerCase()
      if (message.includes('no sé') || message.includes('no se')) {
        return { decision: 'uncertain' as const, confidence: 0.95 }
      }
      if (message.startsWith('no')) {
        return { decision: 'reject' as const, confidence: 0.95 }
      }
      if (message.includes('dale') || message.includes('sí') || message.includes('si')) {
        return { decision: 'confirm' as const, confidence: 0.95 }
      }
      return { decision: null, confidence: 0 }
    }
  }
}

function fakeEstimateDecisionExtractor(
  classify: (message: string) => {
    decision: 'continue_booking' | 'request_exact_quote' | 'unclear'
    confidence: number
  } = () => ({ decision: 'unclear', confidence: 0 })
) {
  return {
    async extract(input: { message: string }) {
      return classify(input.message)
    }
  }
}

function fakeEstimateOptionExtractor(
  extract: (message: string) => {
    optionId: string | null
    confidence: number
  } = () => ({ optionId: null, confidence: 0 })
) {
  return {
    async extract(input: { message: string }) {
      return extract(input.message)
    }
  }
}

function fakeChoiceExtractor() {
  return {
    async extract(input: { message: string; choices: Array<{ id: string }> }) {
      const message = input.message.toLowerCase()
      const available = new Set(input.choices.map((choice) => choice.id))
      if (
        available.has('request_service_advice') &&
        (message.includes('asesoramiento') || message.includes('no sé') || message.includes('no se'))
      ) {
        return { choiceId: 'request_service_advice', confidence: 0.95 }
      }
      if (available.has('request_advice') && (message.includes('sí') || message.includes('hablar'))) {
        return { choiceId: 'request_advice', confidence: 0.95 }
      }
      if (available.has('back_to_services') && message.includes('volver')) {
        return { choiceId: 'back_to_services', confidence: 0.95 }
      }
      if (available.has('reject') && message.startsWith('no')) {
        return { choiceId: 'reject', confidence: 0.95 }
      }
      if (available.has('confirm')) {
        return { choiceId: 'confirm', confidence: 0.95 }
      }
      return { choiceId: null, confidence: 0 }
    }
  }
}
