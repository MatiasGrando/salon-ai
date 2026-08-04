import assert from 'node:assert/strict'
import { BookingV2ChoiceExtractor } from '../src/services/booking-v2-choice-extractor.js'
import { BookingV2EstimateDecisionExtractor } from '../src/services/booking-v2-estimate-decision-extractor.js'
import { BookingV2EstimateOptionExtractor } from '../src/services/booking-v2-estimate-option-extractor.js'
import { BookingV2ServiceValidationClassifier } from '../src/services/booking-v2-service-validation.js'
import { ConversationRouter } from '../src/services/conversation-router.js'

const choiceExtractor = new BookingV2ChoiceExtractor()
const choiceCases = [
  {
    message: 'Me cierra, avancemos con eso',
    question: '¿Querés aceptar el presupuesto y reservar?',
    choices: [
      { id: 'accept_quote', meaning: 'Acepta y continúa.' },
      { id: 'reject_quote', meaning: 'Rechaza y no continúa.' }
    ],
    expected: 'accept_quote'
  },
  {
    message: 'Esto se me va, prefiero dejarlo acá',
    question: '¿Querés aceptar el presupuesto y reservar?',
    choices: [
      { id: 'accept_quote', meaning: 'Acepta y continúa.' },
      { id: 'reject_quote', meaning: 'Rechaza y no continúa.' }
    ],
    expected: 'reject_quote'
  },
  {
    message: 'Cerramos así entonces',
    question: '¿Confirmás definitivamente la reserva?',
    choices: [
      { id: 'confirm_booking', meaning: 'Confirma todos los datos.' },
      { id: 'change_booking', meaning: 'Quiere modificar algo.' }
    ],
    expected: 'confirm_booking'
  },
  {
    message: 'Antes prefiero ajustar una cosa',
    question: '¿Confirmás definitivamente la reserva?',
    choices: [
      { id: 'confirm_booking', meaning: 'Confirma todos los datos.' },
      { id: 'change_booking', meaning: 'Quiere modificar algo.' }
    ],
    expected: 'change_booking'
  }
] as const

for (const test of choiceCases) {
  const result = await choiceExtractor.extract({
    message: test.message,
    question: test.question,
    choices: [...test.choices]
  })
  console.log(`CHOICE | ${test.message} | ${result.choiceId} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.choiceId, test.expected, test.message)
  assert.ok(result.confidence >= 0.65, test.message)
}

const finalConfirmationChoices = [
  { id: 'confirm_booking', meaning: 'Confirma todos los datos y crea el turno.' },
  { id: 'change_service', meaning: 'Cambia el servicio.' },
  { id: 'change_professional', meaning: 'Cambia el profesional.' },
  { id: 'change_date', meaning: 'Cambia el día.' },
  { id: 'change_time', meaning: 'Cambia el horario.' },
  { id: 'cancel_booking', meaning: 'Abandona esta reserva.' },
  { id: 'review_options', meaning: 'No confirma pero no especifica el cambio.' }
]
for (const [message, expected] of [
  ['Quedemos una hora más tarde', 'change_time'],
  ['Prefiero que me atienda otra persona', 'change_professional'],
  ['Me conviene venir otro día', 'change_date'],
  ['En realidad quiero hacerme otro tratamiento', 'change_service'],
  ['Mejor no cerremos nada', 'cancel_booking']
] as const) {
  const result = await choiceExtractor.extract({
    message,
    question: '¿Confirmás definitivamente esta reserva?',
    choices: finalConfirmationChoices
  })
  console.log(`FINAL CHANGE | ${message} | ${result.choiceId} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.choiceId, expected, message)
  assert.ok(result.confidence >= 0.65, message)
}

const changeProfessionalDecision = await choiceExtractor.extract({
  message: 'quiero cambiar de profesional',
  question: '¿El cliente quiere descartar el profesional elegido y volver a seleccionar quién lo atenderá?',
  choices: [
    { id: 'change_professional', meaning: 'Quiere cambiar o volver a elegir el profesional de esta reserva.' },
    { id: 'keep_professional', meaning: 'No quiere cambiar el profesional; está haciendo otra consulta o respondiendo otra cosa.' }
  ]
})
console.log(`CHANGE PROFESSIONAL | ${changeProfessionalDecision.choiceId} | ${changeProfessionalDecision.confidence.toFixed(2)}`)
assert.equal(changeProfessionalDecision.choiceId, 'change_professional')
assert.ok(changeProfessionalDecision.confidence >= 0.85)

const navigationChoices = [
  { id: 'cancel_booking', meaning: 'Abandona la reserva en curso.' },
  { id: 'go_back', meaning: 'Vuelve al paso anterior de la reserva.' },
  { id: 'restart_booking', meaning: 'Comienza una nueva reserva desde cero.' },
  { id: 'not_navigation', meaning: 'Es una consulta o pedido distinto.' }
]
for (const [message, expected] of [
  ['Dejemos esta gestión acá por ahora', 'cancel_booking'],
  ['Mejor regresemos a lo que había elegido antes', 'go_back'],
  ['Arranquemos una nueva desde cero', 'restart_booking'],
  ['¿En qué momento suelen levantar la persiana?', 'not_navigation'],
  ['¿Qué inversión requiere hacerse color?', 'not_navigation'],
  ['¿Quiénes tienen mano para este trabajo?', 'not_navigation'],
  ['Contame bien qué incluye lo que hacen', 'not_navigation']
] as const) {
  const result = await choiceExtractor.extract({
    message,
    question: '¿Quiere navegar dentro de la reserva o está haciendo otra consulta?',
    choices: navigationChoices
  })
  console.log(`NAVIGATION | ${message} | ${result.choiceId} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.choiceId, expected, message)
  assert.ok(result.confidence >= 0.65, message)
}

const estimateDecisionExtractor = new BookingV2EstimateDecisionExtractor()
for (const [message, expected] of [
  ['Continuar', 'continue_booking'],
  ['Reservo', 'continue_booking'],
  ['Sigamos nomás', 'continue_booking'],
  ['Dale, avancemos con eso', 'continue_booking'],
  ['Quiero coordinar el turno', 'continue_booking'],
  ['Me sirve, hagámoslo', 'continue_booking'],
  ['Quiero que me digan el precio final', 'request_exact_quote'],
  ['Prefiero que lo revise alguien', 'request_exact_quote'],
  ['Antes quiero una cotización precisa', 'request_exact_quote'],
  ['Que me evalúen y me confirmen cuánto queda', 'request_exact_quote'],
  ['¿Cuánto tarda?', 'unclear'],
  ['No sé todavía', 'unclear']
] as const) {
  const result = await estimateDecisionExtractor.extract({
    message,
    serviceName: 'Tratamiento',
    allowsBooking: true,
    requiresPhoto: false
  })
  console.log(`ESTIMATE DECISION | ${message} | ${result.decision} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.decision, expected, message)
  if (expected !== 'unclear') assert.ok(result.confidence >= 0.65, message)
}

const optionExtractor = new BookingV2EstimateOptionExtractor()
const options = [
  { id: 'short', label: 'Hasta los hombros', note: null },
  { id: 'long', label: 'Más largo que los hombros', note: null }
]
for (const [message, expected] of [
  ['Lo tengo más bien cortito, no llega a los hombros', 'short'],
  ['Me pasa bastante los hombros y llega a la espalda', 'long']
] as const) {
  const result = await optionExtractor.extract({ message, serviceName: 'Iluminación', options })
  console.log(`OPTION | ${message} | ${result.optionId} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.optionId, expected, message)
  assert.ok(result.confidence >= 0.65, message)
}

const validationClassifier = new BookingV2ServiceValidationClassifier()
for (const [message, expected] of [
  ['Sí, por lo que explicaste es justo lo que necesito', 'confirm'],
  ['No coincide con lo que estoy buscando', 'reject'],
  ['No sabría decirte si aplica para mi caso', 'uncertain']
] as const) {
  const result = await validationClassifier.classify({
    message,
    serviceName: 'Color completo',
    validationMessage: 'Trabaja todo el cabello.',
    validationQuestion: '¿Es el servicio que necesitás?'
  })
  console.log(`VALIDATION | ${message} | ${result.decision} | ${result.confidence.toFixed(2)}`)
  assert.equal(result.decision, expected, message)
  assert.ok(result.confidence >= 0.7, message)
}

const router = new ConversationRouter()
const routerCases = [
  ['Dejemos esta gestión acá por ahora', 'cancel_booking'],
  ['Mejor regresemos a lo que había elegido antes', 'go_back'],
  ['Arranquemos una nueva desde cero', 'restart_booking'],
  ['¿En qué momento suelen levantar la persiana?', 'business_information'],
  ['¿Qué inversión requiere hacerse color?', 'business_information'],
  ['¿Quiénes tienen mano para este trabajo?', 'business_information'],
  ['Contame bien qué incluye lo que hacen', 'service_detail']
] as const

for (const [message, expected] of routerCases) {
  const result = await router.route({
    message,
    currentStep: 'ASK_PROFESSIONAL',
    lastBotMessage: '¿Con quién preferís atenderte?',
    recentMessages: [],
    draft: {
      name: 'Mati',
      service: 'color',
      professional: null,
      date: null,
      time: null
    },
    business: {
      name: 'La Pelu',
      availableInformation: ['opening_hours', 'services', 'professionals', 'prices']
    },
    catalog: {
      services: [{ id: 'color', name: 'Color', aliases: ['coloracion'], description: 'Coloración completa.' }],
      professionals: [{ id: 'tamara', name: 'Tamara' }]
    }
  })
  const match = result.intents.find((intent) => intent.type === expected)
  console.log(`ROUTER | ${message} | ${result.intents.map((intent) => intent.type).join(',')} | ${match?.confidence.toFixed(2) ?? '-'}`)
  assert.ok(match && match.confidence >= 0.65, message)
}

const screenshotRouterCases = [
  {
    message: 'quiero un turno',
    currentStep: 'START',
    lastBotMessage: '¿En qué te puedo ayudar?',
    expectedIntent: 'book_appointment',
    expectsBooking: true
  },
  {
    message: 'queiro un turno de alisado molecular',
    currentStep: 'START',
    lastBotMessage: '¿En qué te puedo ayudar?',
    expectedIntent: 'book_appointment',
    expectedService: 'ordenador',
    expectsBooking: true
  },
  {
    message: '¿Qué horarios tiene Tamara?',
    currentStep: 'ASK_PROFESSIONAL',
    lastBotMessage: '¿Con quién preferís atenderte?',
    expectedIntent: 'professional_schedule',
    expectedProfessional: 'tamara',
    expectsBooking: false
  },
  {
    message: 'Si solicito un turno, ¿cuáles son los pasos? ¿Me lavan el cabello en el lugar?',
    currentStep: 'ASK_SERVICE',
    lastBotMessage: '¿Querés continuar con la reserva o pedir un presupuesto exacto?',
    expectedIntent: 'service_detail',
    draftService: 'ordenador',
    expectsBooking: false
  },
  {
    message: 'Iluminación',
    currentStep: 'ASK_SERVICE',
    lastBotMessage: '¿Cuál te interesa?',
    expectedIntent: 'book_appointment',
    expectedService: 'iluminacion',
    expectsBooking: true
  },
  {
    message: '¿Me agendás para esta semana?',
    currentStep: 'ASK_SERVICE',
    lastBotMessage: '¿Qué servicio querés reservar?',
    expectedIntent: 'book_appointment',
    expectsBooking: true
  },
  {
    message: '¿Es para sede Cañitas?',
    currentStep: 'ASK_PROFESSIONAL',
    lastBotMessage: '¿Con quién preferís atenderte?',
    expectedIntent: 'business_information',
    expectedTopic: 'address',
    expectsBooking: false
  },
  {
    message: 'Antes de seguir te quería preguntar otra cosa',
    currentStep: 'ASK_PROFESSIONAL',
    lastBotMessage: '¿Con quién preferís atenderte?',
    expectedIntent: 'other_query',
    expectsBooking: false
  }
] as const

for (const test of screenshotRouterCases) {
  const result = await router.route({
    message: test.message,
    currentStep: test.currentStep,
    lastBotMessage: test.lastBotMessage,
    recentMessages: [],
    draft: {
      name: test.currentStep === 'START' ? null : 'Mati',
      service: 'draftService' in test
        ? test.draftService
        : test.currentStep === 'ASK_PROFESSIONAL' ? 'iluminacion' : null,
      professional: null,
      date: null,
      time: null
    },
    business: {
      name: 'Glow',
      availableInformation: ['address', 'booking_channels', 'services', 'professionals', 'prices']
    },
    catalog: {
      services: [
        { id: 'iluminacion', name: 'Iluminación', aliases: ['balayage'], description: 'Iluminación y balayage.' },
        { id: 'ordenador', name: 'Ordenador molecular', aliases: ['alisado molecular'], description: 'Incluye nutrición, lavado, secado y planchado.' }
      ],
      professionals: [
        { id: 'tamara', name: 'Tamara', aliases: ['Tami'] },
        { id: 'cristian', name: 'Cristian' }
      ]
    }
  })
  const match = result.intents.find((intent) => intent.type === test.expectedIntent)
  console.log(`SCREENSHOT | ${test.message} | ${result.intents.map((intent) => intent.type).join(',')} | booking=${Boolean(result.bookingMessage)}`)
  const minimumConfidence = test.expectedIntent === 'other_query' ? 0.4 : 0.65
  assert.ok(match && match.confidence >= minimumConfidence, test.message)
  assert.equal(Boolean(result.bookingMessage), test.expectsBooking, test.message)
  if ('expectedTopic' in test) assert.equal(match.topic, test.expectedTopic, test.message)
  if ('expectedProfessional' in test) assert.equal(result.bookingExtraction?.professional.value, test.expectedProfessional, test.message)
  if ('expectedService' in test) assert.equal(result.bookingExtraction?.service.value, test.expectedService, test.message)
}

const otherQueryDecision = await choiceExtractor.extract({
  message: 'Antes de seguir te quería preguntar otra cosa',
  question: '¿El cliente está anunciando otra consulta sin haber escrito todavía cuál es?',
  choices: [
    { id: 'other_query', meaning: 'Anuncia una consulta nueva pero todavía no expresa la pregunta concreta.' },
    { id: 'concrete_query', meaning: 'Ya expresó una pregunta, selección o acción concreta.' }
  ]
})
console.log(`OTHER QUERY VERIFY | ${otherQueryDecision.choiceId} | ${otherQueryDecision.confidence.toFixed(2)}`)
assert.equal(otherQueryDecision.choiceId, 'other_query')
assert.ok(otherQueryDecision.confidence >= 0.85)

console.log('\n49 pruebas reales adicionales de comprensión pasaron.')
