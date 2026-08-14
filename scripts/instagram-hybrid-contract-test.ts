import assert from 'node:assert/strict'
import { renderCatalogServiceQuery } from '../src/services/business-knowledge-service.js'
import { deterministicConversationRouting } from '../src/services/conversation-router.js'
import {
  buildInstagramRouterInput,
  buildWhatsappUrl,
  composeInstagramReply,
  requiresWhatsappContinuation,
  splitInstagramReply
} from '../src/services/instagram-webhook-service.js'

const catalog = {
  services: [
    {
      id: 'lighting',
      name: 'Iluminación',
      description: 'Mechas y reflejos personalizados.',
      aliases: ['iluminaciones']
    },
    {
      id: 'haircut',
      name: 'Corte Hombre',
      description: 'Corte personalizado.'
    }
  ],
  professionals: []
}

const knowledge = {
  name: 'Barber Colapinta',
  slug: 'barber-colapinta',
  landingEnabled: true,
  publicWhatsapp: '5491112345678',
  contactEmail: null,
  publicAddress: null,
  publicAddressArea: null,
  publicMapsUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  businessHours: [],
  services: [
    {
      id: 'lighting',
      name: 'Iluminación',
      description: 'Mechas y reflejos personalizados.',
      duration: 90,
      price: 50000,
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
  professionals: []
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'Instagram responde una consulta puntual sin derivar a WhatsApp',
    run: () => {
      const routing = deterministicConversationRouting(
        'cual es el precio de las iluminaciones',
        { currentStep: 'START', catalog }
      )
      const informationReply = renderCatalogServiceQuery(knowledge, routing.catalogQuery!)
      assert.equal(requiresWhatsappContinuation(routing), false)
      const reply = composeInstagramReply({
        businessName: knowledge.name,
        assistantName: 'Cami',
        customerMessage: 'cual es el precio de las iluminaciones',
        routing,
        informationReply,
        requiresWhatsapp: false,
        whatsappUrl: null
      })
      assert.match(reply, /Iluminación/)
      assert.match(reply, /desde.*50\.000/i)
      assert.doesNotMatch(reply, /wa\.me/)
    }
  },
  {
    name: 'Instagram deriva una reserva y conserva la consulta original',
    run: () => {
      const message = 'quiero reservar iluminaciones'
      const routing = deterministicConversationRouting(message, { currentStep: 'START', catalog })
      assert.equal(requiresWhatsappContinuation(routing), true)
      const whatsappUrl = buildWhatsappUrl('54 9 11 1234-5678', 'IG-ABCDEF12', message, 'booking')
      assert.ok(whatsappUrl)
      const decoded = decodeURIComponent(whatsappUrl)
      assert.match(decoded, /quiero reservar/i)
      assert.match(decoded, /quiero reservar iluminaciones/i)
      assert.match(decoded, /IG-ABCDEF12/)
      const reply = composeInstagramReply({
        businessName: knowledge.name,
        assistantName: 'Cami',
        customerMessage: message,
        routing,
        informationReply: null,
        requiresWhatsapp: true,
        whatsappUrl
      })
      assert.match(reply, /continuemos por WhatsApp/i)
      assert.match(reply, /wa\.me/)
    }
  },
  {
    name: 'Instagram deriva una consulta sobre como reservar sin iniciar el flujo dentro de Instagram',
    run: () => {
      const message = 'por donde puedo reservar un turno'
      const routing = deterministicConversationRouting(message, { currentStep: 'START', catalog })
      assert.equal(requiresWhatsappContinuation(routing), true)
      assert.equal(
        routing.intents.some((intent) =>
          intent.type === 'business_information' && intent.topic === 'booking_channels'
        ),
        true
      )
      const whatsappUrl = buildWhatsappUrl(knowledge.publicWhatsapp, 'IG-CHANNEL1', message)
      const reply = composeInstagramReply({
        businessName: knowledge.name,
        assistantName: 'Cami',
        customerMessage: message,
        routing,
        informationReply: null,
        requiresWhatsapp: true,
        whatsappUrl
      })
      assert.match(reply, /continuemos por WhatsApp/i)
      assert.match(decodeURIComponent(whatsappUrl!), /por donde puedo reservar un turno/i)
    }
  },
  {
    name: 'Instagram responde el precio y deriva si el mensaje tambien pide reservar',
    run: () => {
      const message = 'cuanto salen las iluminaciones y quiero reservar'
      const routing = deterministicConversationRouting(message, { currentStep: 'START', catalog })
      const informationReply = renderCatalogServiceQuery(knowledge, routing.catalogQuery!)
      const whatsappUrl = buildWhatsappUrl(knowledge.publicWhatsapp, 'IG-12345678', message)
      const reply = composeInstagramReply({
        businessName: knowledge.name,
        assistantName: 'Cami',
        customerMessage: message,
        routing,
        informationReply,
        requiresWhatsapp: requiresWhatsappContinuation(routing),
        whatsappUrl
      })
      assert.match(reply, /50\.000/)
      assert.match(reply, /continuemos por WhatsApp/i)
    }
  },
  {
    name: 'el contexto del router de Instagram contiene catalogo y datos disponibles',
    run: () => {
      const input = buildInstagramRouterInput({
        message: 'que servicios tienen',
        business: {
          name: knowledge.name,
          slug: knowledge.slug,
          landingEnabled: true,
          publicWhatsapp: knowledge.publicWhatsapp,
          contactEmail: null,
          publicAddress: 'Beethoven 3531',
          publicAddressArea: 'Villa Urquiza',
          publicMapsUrl: null,
          instagramUrl: null,
          facebookUrl: null,
          tiktokUrl: null,
          businessHours: [],
          services: [{
            id: 'lighting',
            name: 'Iluminación',
            description: 'Mechas personalizadas.',
            category: 'Coloración',
            aliases: [{ name: 'iluminaciones' }],
            catalogCategory: { name: 'Coloración' },
            parentService: null
          }],
          professionals: []
        }
      })
      assert.equal(input.currentStep, 'START')
      assert.equal(input.catalog.services[0]?.id, 'lighting')
      assert.equal(input.catalog.services[0]?.aliases?.includes('iluminaciones'), true)
      assert.equal(input.business.availableInformation.includes('services'), true)
      assert.equal(input.business.availableInformation.includes('address'), true)
      assert.equal(input.business.availableInformation.includes('booking_channels'), true)
    }
  },
  {
    name: 'las respuestas largas de Instagram se dividen sin perder contenido',
    run: () => {
      const reply = `${'Servicio completo '.repeat(20)}\n\n${'Segundo bloque '.repeat(20)}`
      const messages = splitInstagramReply(reply, 120)
      assert.ok(messages.length > 1)
      assert.equal(messages.every((message) => message.length <= 120), true)
      assert.equal(messages.join(' ').includes('Segundo bloque'), true)
    }
  }
]

for (const test of tests) {
  test.run()
  console.log(`OK: ${test.name}`)
}

console.log(`\n${tests.length} pruebas del canal híbrido de Instagram pasaron.`)
