import assert from 'node:assert/strict'
import {
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
import type { BookingV2Catalog } from '../src/services/booking-v2-interpreter.js'
import type { BookingV2CatalogOption } from '../src/services/booking-v2-extractor.js'
import { renderBookingV2Response } from '../src/services/booking-v2-response-renderer.js'
import {
  businessInformationTopicsFromRouting,
  deterministicConversationRouting,
  mergeConversationRouting,
  normalizeConversationRouting
} from '../src/services/conversation-router.js'
import { renderBusinessKnowledgeAnswers } from '../src/services/business-knowledge-service.js'
import { isPositiveBookingV2Confirmation } from '../src/services/conversation-service.js'
import { removeCurrentInboundFromHistory } from '../src/services/conversation-router-context-service.js'

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
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
      assert.equal(result.reply.includes('• 15:00 con Nico'), true)
      assert.equal(result.reply.includes('• 15:30 con Nico'), true)
      assert.equal(result.reply.includes('¿Cuál te queda mejor?'), true)
    }
  },
  {
    name: 'motor confirma propuesta pendiente sin gastar extractor',
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
        message: 'si'
      })

      assert.equal(result.outcome, 'proposal_confirmed')
      assert.equal(result.state.draft.service, 'haircut')
      assert.equal(result.conversationPatch.bookingV2State, null)
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
          { name: 'Corte', duration: 30, price: 15000 }
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
      assert.equal(replies[5]?.includes('Corte (30 min)'), true)
      assert.equal(replies[5]?.includes('15.000'), true)

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

function fakeDomainPort() {
  const domainCatalog = fakeDomainCatalog()

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
        options: [
          { time: '15:00', professionalId: 'professional-1', professionalName: 'Nico' },
          { time: '15:30', professionalId: 'professional-1', professionalName: 'Nico' }
        ]
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
