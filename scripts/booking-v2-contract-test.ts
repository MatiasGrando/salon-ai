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
import { renderBusinessKnowledgeAnswers } from '../src/services/business-knowledge-service.js'
import {
  acceptedAdvisorQuoteAmount,
  isBookingV2ConversationClosing,
  isBookingV2GreetingOnlyMessage,
  isNegativeAdvisorQuoteDecision,
  isPostBookingWellbeingQuestion,
  isPositiveAdvisorQuoteDecision,
  isPositiveBookingV2Confirmation,
  shouldShowBookingV2IntentFallback,
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
    name: 'si no sabe que servicio elegir deriva inmediatamente a un asesor',
    run: async () => {
      const engine = new BookingV2Engine(fakeDomainPort(), fakeExtractor(null))
      const state = acceptField(createEmptyBookingV2State(), 'name', 'Mati')

      const result = await engine.process({
        businessId: 'business-1',
        conversation: conversationPatchFromState(state),
        message: 'no sé cuál necesito'
      })

      assert.deepEqual(result.plan, {
        type: 'handoff',
        reason: 'service_selection_uncertain'
      })
      assert.equal(result.state.draft.name, 'Mati')
      assert.equal(result.state.draft.service, null)
      assert.equal(result.reply.includes('ayudarte a elegir'), true)
      assert.equal(result.reply.includes('demorar unos minutos'), true)
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
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), fakeExtractor(null))
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
        fakeExtractor(null)
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
        fakeExtractor(null)
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
        fakeExtractor(null)
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
        fakeExtractor(null)
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
        fakeExtractor(null)
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
    name: 'aceptacion y rechazo del presupuesto entienden respuestas naturales',
    run: () => {
      assert.equal(isPositiveAdvisorQuoteDecision('si dale, reservemos'), true)
      assert.equal(isPositiveAdvisorQuoteDecision('de una'), true)
      assert.equal(isPositiveAdvisorQuoteDecision('me sirve'), true)
      assert.equal(isPositiveAdvisorQuoteDecision('mandale'), true)
      assert.equal(isNegativeAdvisorQuoteDecision('no gracias'), true)
      assert.equal(isNegativeAdvisorQuoteDecision('lo voy a pensar'), true)
      assert.equal(isNegativeAdvisorQuoteDecision('ni ahi'), true)
      assert.equal(isPositiveAdvisorQuoteDecision('cuanto demora?'), false)
      assert.equal(isNegativeAdvisorQuoteDecision('cuanto demora?'), false)
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
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), fakeExtractor(null))
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
      const engine = new BookingV2Engine(fakeDomainPort({ catalog }), fakeExtractor(null))
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
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

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
    name: 'motor prioriza el profesional esperado y no lo confunde con el nombre',
    run: async () => {
      const extractor = fakeExtractor(extraction({
        name: field('Ana', 0.7, 'Ana')
      }))
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

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
    name: 'motor permite cambiar la hora desde la confirmacion final',
    run: async () => {
      const extractor = fakeExtractor(null)
      const engine = new BookingV2Engine(
        fakeDomainPort({
          availabilityOptions: [
            { time: '18:00', professionalId: 'professional-1', professionalName: 'Nico' },
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
          selectedTime: '18:30',
          misunderstandingCount: 0,
          bookingV2State: null
        },
        message: 'quiero cambiar la hora'
      })

      assert.equal(result.state.draft.time, null)
      assert.equal(result.plan.type === 'ask_field' ? result.plan.field : null, 'time')
      assert.equal(result.reply.includes('• Nico: 18:00, 18:30'), true)
      assert.equal(result.reply.includes('Confirmás la reserva'), false)
      assert.equal(extractor.calls.length, 0)
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
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

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
      const engine = new BookingV2Engine(fakeDomainPort(), extractor)

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
    name: 'confirmacion critica requiere evidencia determinista explicita',
    run: () => {
      assert.equal(isPositiveBookingV2Confirmation('okey perfecto quedamos asi'), true)
      assert.equal(isPositiveBookingV2Confirmation('si confirmo y pasame la direccion'), true)
      assert.equal(isPositiveBookingV2Confirmation('pasame la direccion'), false)
      assert.equal(isPositiveBookingV2Confirmation('creo que podria estar bien'), false)
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
          }
        ],
        bookingMessage: 'un corte'
      }, deterministic, message)

      assert.equal(merged.bookingMessage, null)
      assert.equal(
        merged.intents.some((intent) => intent.type === 'book_appointment'),
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
        services: [
          { name: 'Corte', duration: 30, price: 15000, priceMode: 'STARTING_AT' }
        ],
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

  return {
    async loadCatalog() {
      return domainCatalog
    },
    toExtractionCatalog() {
      return {
        services: domainCatalog.services.map((service): BookingV2CatalogOption => ({
          id: service.id,
          name: service.name,
          aliases: service.aliases
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
    async findAvailabilityOptions() {
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
      { id: 'haircut', name: 'Corte', aliases: ['corte de pelo'], duration: 30, price: 15000, category: null },
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
