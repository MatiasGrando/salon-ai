import assert from 'node:assert/strict'
import scenariosJson from '../test/fixtures/forja-salon-eval-scenarios.json'
import {
  businessInformationTopicsFromRouting,
  deterministicConversationRouting,
  type BusinessInformationTopic
} from '../src/services/conversation-router.js'
import { renderBusinessKnowledgeAnswers, type BusinessKnowledge } from '../src/services/business-knowledge-service.js'
import { isHumanHandoffMessage } from '../src/services/conversation-service.js'

type RoutingScenario = {
  id: string
  category: 'business-information' | 'out-of-scope'
  message: string
  expectedTopics: BusinessInformationTopic[]
  expectsBookingMessage: boolean
}

type HandoffScenario = {
  id: string
  category: 'handoff'
  message: string
  expectedHandoff: boolean
}

type EvalScenario = RoutingScenario | HandoffScenario

const scenarios = scenariosJson as EvalScenario[]
const allowedCategories = new Set(['business-information', 'handoff', 'out-of-scope'])

function main() {
  assertScenarioCatalog()

  for (const scenario of scenarios) {
    if (scenario.category === 'handoff') {
      assert.equal(
        isHumanHandoffMessage(scenario.message),
        scenario.expectedHandoff,
        `${scenario.id}: clasificación de handoff incorrecta`
      )
      pass(scenario.id)
      continue
    }

    const routing = deterministicConversationRouting(scenario.message)
    const topics = businessInformationTopicsFromRouting(routing).sort()

    assert.deepEqual(
      topics,
      scenario.expectedTopics.slice().sort(),
      `${scenario.id}: temas de información incorrectos`
    )
    assert.equal(
      Boolean(routing.bookingMessage),
      scenario.expectsBookingMessage,
      `${scenario.id}: señal de reserva incorrecta`
    )

    if (scenario.category === 'out-of-scope') {
      assert.deepEqual(
        routing.intents.map((intent) => intent.type),
        ['unknown'],
        `${scenario.id}: un mensaje fuera del salón no debe activar herramientas`
      )
    }

    pass(scenario.id)
  }

  assertGroundedBusinessAnswers()
  console.log(`\n${scenarios.length + 3} contratos de chat adaptados de Forja aprobados.`)
}

function assertScenarioCatalog() {
  assert.ok(scenarios.length >= 9, 'La batería adaptada de Forja no puede quedar vacía')
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length, 'Los ids deben ser únicos')

  for (const scenario of scenarios) {
    assert.match(scenario.id, /^[a-z0-9-]+$/, `${scenario.id}: id inválido`)
    assert.ok(allowedCategories.has(scenario.category), `${scenario.id}: categoría inválida`)
    assert.ok(scenario.message.trim().length > 0, `${scenario.id}: falta el mensaje del cliente`)
  }
}

function assertGroundedBusinessAnswers() {
  const business = fixtureBusiness()

  const [prices] = renderBusinessKnowledgeAnswers(business, ['prices'])
  assert.match(prices, /Corte \(30 min\).*precio a consultar/i)
  assert.doesNotMatch(prices, /\$\s*0/)
  pass('precio-a-consultar-no-inventado')

  const [address] = renderBusinessKnowledgeAnswers(business, ['address'])
  assert.match(address, /no tengo la direcci[oó]n exacta cargad[ao] de forma confiable/i)
  assert.doesNotMatch(address, /calle|avenida|av\./i)
  pass('direccion-ausente-no-inventada')

  const [hours] = renderBusinessKnowledgeAnswers(business, ['opening_hours'])
  assert.match(hours, /Lunes: 09:00 a 18:00/)
  assert.doesNotMatch(hours, /Domingo/)
  pass('horarios-salen-de-datos-cargados')
}

function fixtureBusiness(): BusinessKnowledge {
  return {
    name: 'Salón QA',
    slug: 'salon-qa',
    landingEnabled: true,
    publicWhatsapp: null,
    contactEmail: null,
    publicAddress: null,
    publicAddressArea: null,
    publicMapsUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    businessHours: [
      {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '18:00'
      }
    ],
    services: [
      {
        name: 'Corte',
        duration: 30,
        price: null
      }
    ],
    professionals: []
  }
}

function pass(name: string) {
  console.log(`OK: ${name}`)
}

main()
