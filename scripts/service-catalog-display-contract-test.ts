import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BookingV2Engine } from '../src/services/booking-v2-engine.js'
import {
  catalogCategoryOptions,
  createBookingV2DomainCatalog,
  normalizeCatalogDisplayMode,
  type BookingV2DomainCatalog
} from '../src/services/booking-v2-domain.js'
import {
  conversationPatchFromState
} from '../src/services/booking-v2-conversation-state.js'
import {
  acceptField,
  createEmptyBookingV2State
} from '../src/services/booking-v2-state.js'
import {
  catalogRecoveryActionFromInteractiveReply,
  catalogRecoveryDecisionButtons
} from '../src/services/conversation-service.js'
import {
  detectContextualServiceCatalogPresentationIntent,
  detectServiceCatalogPresentationIntent
} from '../src/services/service-catalog-presentation-intent.js'

const categoriesCatalog = createBookingV2DomainCatalog({
  displayMode: 'CATEGORIES_FIRST',
  services: [
    {
      id: 'tinte',
      name: 'Color completo',
      aliases: ['coloración'],
      duration: 90,
      price: 65000,
      category: 'Coloración',
      categoryId: 'color'
    },
    {
      id: 'raices',
      name: 'Raíces',
      aliases: ['coloración'],
      duration: 60,
      price: 40000,
      category: 'Coloración',
      categoryId: 'color'
    },
    {
      id: 'corte',
      name: 'Corte',
      aliases: ['cortes'],
      duration: 30,
      price: 15000,
      category: 'Cortes',
      categoryId: 'cuts'
    }
  ],
  professionals: []
})

const allServicesCatalog = createBookingV2DomainCatalog({
  displayMode: 'ALL_SERVICES',
  services: categoriesCatalog.services,
  professionals: []
})

const reservableCategoriesCatalog = createBookingV2DomainCatalog({
  displayMode: 'CATEGORIES_FIRST',
  services: categoriesCatalog.services,
  professionals: [
    { id: 'lucas', name: 'Lucas', serviceIds: ['tinte'] },
    { id: 'tamara', name: 'Tamara', serviceIds: ['tinte', 'raices'] }
  ]
})

function fakeDomain(catalog: BookingV2DomainCatalog) {
  return {
    async loadCatalog() {
      return catalog
    },
    toExtractionCatalog() {
      return {
        services: catalog.services.map((service) => ({
          id: service.id,
          name: service.name,
          aliases: service.aliases
        })),
        professionals: catalog.professionals.map((professional) => ({
          id: professional.id,
          name: professional.name,
          aliases: []
        }))
      }
    },
    toInterpreterCatalog() {
      return {
        serviceIds: catalog.serviceIds,
        professionalIds: catalog.professionalIds,
        professionalServiceIds: catalog.professionalServiceIds
      }
    },
    async findAvailabilityOptions() {
      return { ok: true as const, options: [] }
    }
  }
}

const nullExtractor = {
  async extract() {
    return null
  }
}

const nullChoiceExtractor = {
  async extract() {
    return { choiceId: null, confidence: 0 }
  }
}

const unusedClassifier = {
  async classify() {
    return { decision: null, confidence: 0 }
  }
}

const unusedDecisionExtractor = {
  async extract() {
    return { decision: 'unclear' as const, confidence: 0 }
  }
}

const unusedOptionExtractor = {
  async extract() {
    return { optionId: null, confidence: 0 }
  }
}

function engineFor(
  catalog: BookingV2DomainCatalog,
  choiceExtractor: {
    extract(input: {
      message: string
      question: string
      choices: Array<{ id: string; meaning: string }>
    }): Promise<{ choiceId: string | null; confidence: number }>
  } = nullChoiceExtractor
) {
  return new BookingV2Engine(
    fakeDomain(catalog),
    nullExtractor,
    unusedClassifier,
    unusedDecisionExtractor,
    unusedOptionExtractor,
    choiceExtractor
  )
}

const namedState = acceptField(createEmptyBookingV2State(), 'name', 'Mati')

assert.equal(normalizeCatalogDisplayMode(undefined), 'ALL_SERVICES')
assert.equal(normalizeCatalogDisplayMode('CATEGORIES_FIRST'), 'CATEGORIES_FIRST')
assert.equal(normalizeCatalogDisplayMode('INVALID'), 'ALL_SERVICES')
assert.deepEqual(
  catalogCategoryOptions(categoriesCatalog).map((category) => category.name),
  ['Coloración', 'Cortes']
)
for (const message of [
  'quiero saber qué servicios tienen',
  'quiero saber de todos los servicios',
  'quiero saber todos los servicios',
  'pasame la lista de servicios',
  'qué ofrecen',
  'mostrame el catálogo completo',
  'ver todos',
  'mostrar todos los servicios',
  'quiero ver el catálogo'
]) {
  assert.equal(detectServiceCatalogPresentationIntent(message), 'show_all', message)
}
assert.equal(detectServiceCatalogPresentationIntent('quiero un turno'), 'use_business_default')
assert.equal(detectServiceCatalogPresentationIntent('quiero reservar'), 'use_business_default')
assert.equal(
  detectServiceCatalogPresentationIntent('quiero reservar todos los servicios'),
  'use_business_default'
)
assert.equal(
  detectServiceCatalogPresentationIntent('quiero reservar, qué servicios tienen'),
  'show_all'
)
assert.equal(detectServiceCatalogPresentationIntent('quiero teñirme'), null)
assert.equal(detectServiceCatalogPresentationIntent('quiero saber las opciones de color'), null)
assert.equal(detectServiceCatalogPresentationIntent('ver categorías'), 'show_categories')
assert.equal(detectServiceCatalogPresentationIntent('Ver servicios'), 'use_business_default')
assert.equal(detectServiceCatalogPresentationIntent('todos'), null)
for (const message of ['todos', 'si ver', 'sí, ver', 'sí quiero ver']) {
  assert.equal(detectContextualServiceCatalogPresentationIntent(message), 'show_all', message)
}

const categoryMenu = await engineFor(categoriesCatalog).resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState)
})
assert.match(categoryMenu.reply, /tipo de servicio/i)
assert.match(categoryMenu.reply, /Coloración/)
assert.match(categoryMenu.reply, /Cortes/)
assert.doesNotMatch(categoryMenu.reply, /Color completo/)
assert.doesNotMatch(categoryMenu.reply, /\$\s*65\.000/)

const unsupportedNamedState = {
  ...namedState,
  unsupportedServiceRequest: { normalizedRequest: 'servicio inventado', count: 1 }
}
const defaultCategoriesFromButtonText = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(unsupportedNamedState),
  message: 'Ver servicios'
})
assert.equal(defaultCategoriesFromButtonText.state.catalogNavigation, null)
assert.equal(defaultCategoriesFromButtonText.state.unsupportedServiceRequest, null)
assert.match(defaultCategoriesFromButtonText.reply, /tipo de servicio/i)
assert.match(defaultCategoriesFromButtonText.reply, /Coloración/)
assert.doesNotMatch(defaultCategoriesFromButtonText.reply, /Color completo/)

const defaultAllServicesFromButtonText = await engineFor(allServicesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Ver servicios'
})
assert.match(defaultAllServicesFromButtonText.reply, /Color completo/)
assert.match(defaultAllServicesFromButtonText.reply, /Corte/)

const openedCategory = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Coloración'
})
assert.equal(openedCategory.state.catalogNavigation?.categoryName, 'Coloración')
assert.match(openedCategory.reply, /Color completo/)
assert.match(openedCategory.reply, /Raíces/)
assert.doesNotMatch(openedCategory.reply, /• Corte/)

const reservableCategory = await engineFor(reservableCategoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'Coloración'
})
const selectedCategoryService = await engineFor(reservableCategoriesCatalog).process({
  businessId: 'business-1',
  conversation: reservableCategory.conversationPatch,
  message: 'Raíces'
})
assert.equal(selectedCategoryService.state.draft.service, 'raices')
assert.match(selectedCategoryService.reply, /Tamara/)
assert.doesNotMatch(selectedCategoryService.reply, /Lucas/)
assert.match(selectedCategoryService.reply, /¿Querés atenderte con Tamara\?/)

const resumedCategory = await engineFor(categoriesCatalog).resume({
  businessId: 'business-1',
  conversation: openedCategory.conversationPatch
})
assert.equal(resumedCategory.state.catalogNavigation?.categoryName, 'Coloración')
assert.match(resumedCategory.reply, /Color completo/)
assert.doesNotMatch(resumedCategory.reply, /• Corte/)

const semanticCategory = await engineFor(categoriesCatalog, {
  async extract(input: { message: string; choices: Array<{ id: string }> }) {
    const categoryChoice = input.choices.find((choice) => choice.id === 'category:id:color')
    return input.message === 'quiero teñirme pero todavía no sé qué técnica' && categoryChoice
      ? { choiceId: categoryChoice.id, confidence: 0.93 }
      : { choiceId: null, confidence: 0 }
  }
}).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'quiero teñirme pero todavía no sé qué técnica'
})
assert.equal(semanticCategory.state.catalogNavigation?.categoryName, 'Coloración')
assert.match(semanticCategory.reply, /Color completo/)

const semanticCategoriesCatalog = createBookingV2DomainCatalog({
  displayMode: 'CATEGORIES_FIRST',
  services: [
    {
      id: 'color-adjustment',
      name: 'Arreglo de color',
      aliases: ['corrección de color'],
      description: 'Ajuste de un trabajo de color ya realizado.',
      duration: 120,
      price: 160000,
      category: 'Iluminación',
      categoryId: 'illumination'
    },
    {
      id: 'highlights',
      name: 'Iluminación (baby lights, balayage, contouring, etc)',
      aliases: ['balayage', 'baby lights'],
      description: 'Técnicas de iluminación para dar reflejos, mechas y claritos al cabello.',
      duration: 120,
      price: 160000,
      category: 'Iluminación',
      categoryId: 'illumination'
    },
    {
      id: 'brushing',
      name: 'Brushing',
      aliases: ['brushing con secador'],
      description: 'Peinado con brushing para dar forma y movimiento.',
      duration: 30,
      price: 25000,
      category: 'Peinados',
      categoryId: 'hairstyles'
    }
  ],
  professionals: []
})
const semanticCategoryCalls: Array<{
  message: string
  choices: Array<{ id: string; meaning: string }>
}> = []
const semanticCategoryEngine = engineFor(semanticCategoriesCatalog, {
  async extract(input: {
    message: string
    choices: Array<{ id: string; meaning: string }>
  }) {
    semanticCategoryCalls.push(input)
    const illumination = input.choices.find((choice) =>
      choice.id === 'category:id:illumination'
    )
    const noCategory = input.choices.find((choice) =>
      choice.id === 'no_category_match'
    )
    if (input.message === 'quiero unos claritos' || input.message === 'quiero hacerme reflejos') {
      return illumination ? { choiceId: illumination.id, confidence: 0.96 } : { choiceId: null, confidence: 0 }
    }
    if (input.message === 'quiero un efecto galaxia') {
      return noCategory ? { choiceId: noCategory.id, confidence: 0.99 } : { choiceId: null, confidence: 0 }
    }
    return { choiceId: null, confidence: 0 }
  }
})

for (const message of ['quiero unos claritos', 'quiero hacerme reflejos']) {
  const result = await semanticCategoryEngine.process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState),
    message
  })
  assert.equal(result.state.catalogNavigation?.categoryName, 'Iluminación', message)
  assert.match(result.reply, /Iluminación \(baby lights, balayage, contouring, etc\)/, message)
}

const unknownSemanticCategory = await semanticCategoryEngine.process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'quiero un efecto galaxia'
})
assert.equal(unknownSemanticCategory.state.catalogNavigation, null)
assert.match(unknownSemanticCategory.reply, /¿Qué tipo de servicio buscás\?/)
assert.match(unknownSemanticCategory.reply, /Iluminación/)
assert.match(unknownSemanticCategory.reply, /Peinados/)
assert.doesNotMatch(unknownSemanticCategory.reply, /Para Peinados tengo estas opciones/)

const semanticCategoryCall = semanticCategoryCalls.find((call) =>
  call.message === 'quiero unos claritos'
)
const illuminationChoice = semanticCategoryCall?.choices.find((choice) =>
  choice.id === 'category:id:illumination'
)
assert.match(illuminationChoice?.meaning ?? '', /Arreglo de color/)
assert.match(illuminationChoice?.meaning ?? '', /balayage/)
assert.match(illuminationChoice?.meaning ?? '', /reflejos, mechas y claritos/)
assert.equal(
  semanticCategoryCall?.choices.some((choice) => choice.id === 'no_category_match'),
  true
)

const showAll = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'ver todos los servicios'
})
assert.equal(showAll.state.catalogNavigation?.view, 'ALL_SERVICES')
assert.match(showAll.reply, /Color completo/)
assert.match(showAll.reply, /Corte/)
assert.doesNotMatch(showAll.reply, /tipo de servicio/i)

for (const message of ['todos', 'si ver', 'sí, ver']) {
  const contextualShowAll = await engineFor(categoriesCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState),
    message
  })
  assert.equal(contextualShowAll.state.catalogNavigation?.view, 'ALL_SERVICES', message)
  assert.match(contextualShowAll.reply, /Color completo/, message)
  assert.match(contextualShowAll.reply, /Corte/, message)
  assert.doesNotMatch(contextualShowAll.reply, /tipo de servicio/i, message)
}

const ambiguousYes = await engineFor(categoriesCatalog, {
  async extract() {
    return { choiceId: 'show_all_services', confidence: 0.99 }
  }
}).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'sí'
})
assert.equal(ambiguousYes.state.catalogNavigation, null)
assert.match(ambiguousYes.reply, /tipo de servicio/i)
assert.doesNotMatch(ambiguousYes.reply, /Color completo/)

for (const message of [
  'quiero saber qué servicios tienen',
  'quiero saber de todos los servicios',
  'quiero saber todos los servicios'
]) {
  const explicitFullCatalog = await engineFor(categoriesCatalog).process({
    businessId: 'business-1',
    conversation: conversationPatchFromState(namedState),
    message
  })
  assert.equal(explicitFullCatalog.state.catalogNavigation?.view, 'ALL_SERVICES', message)
  assert.match(explicitFullCatalog.reply, /Color completo/, message)
  assert.match(explicitFullCatalog.reply, /Corte/, message)
}

const staleAllServicesState = {
  ...namedState,
  catalogNavigation: {
    view: 'ALL_SERVICES' as const,
    categoryKey: null,
    categoryName: null,
    pendingCategoryKey: null,
    pendingCategoryName: null
  }
}
const genericBooking = await engineFor(categoriesCatalog, {
  async extract() {
    return { choiceId: 'show_all_services', confidence: 0.99 }
  }
}).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(staleAllServicesState),
  message: 'quiero un turno'
})
assert.equal(genericBooking.state.catalogNavigation, null)
assert.match(genericBooking.reply, /tipo de servicio/i)
assert.match(genericBooking.reply, /Coloración/)
assert.doesNotMatch(genericBooking.reply, /Color completo/)

const naturalColorRequest = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'hola quería teñirme'
})
assert.equal(naturalColorRequest.state.catalogNavigation?.categoryName, 'Coloración')
assert.match(naturalColorRequest.reply, /Color completo/)
assert.match(naturalColorRequest.reply, /Raíces/)
assert.doesNotMatch(naturalColorRequest.reply, /• Corte/)

const explicitColorBooking = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'quiero reservar color'
})
assert.equal(explicitColorBooking.state.catalogNavigation?.categoryName, 'Coloración')
assert.match(explicitColorBooking.reply, /Color completo/)
assert.doesNotMatch(explicitColorBooking.reply, /• Corte/)

const firstFailure = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState),
  message: 'algo distinto que no figura'
})
assert.equal(firstFailure.state.misunderstandingCount, 0)
assert.match(firstFailure.reply, /¿Qué tipo de servicio buscás\?/)
assert.match(firstFailure.reply, /Coloración/)
assert.match(firstFailure.reply, /Cortes/)

const secondFailure = await engineFor(categoriesCatalog).process({
  businessId: 'business-1',
  conversation: firstFailure.conversationPatch,
  message: 'sigue sin ser ninguna'
})
assert.equal(secondFailure.state.misunderstandingCount, 0)
assert.match(secondFailure.reply, /¿Qué tipo de servicio buscás\?/)
assert.match(secondFailure.reply, /Coloración/)
assert.match(secondFailure.reply, /Cortes/)

const allServicesMenu = await engineFor(allServicesCatalog).resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState)
})
assert.match(allServicesMenu.reply, /Color completo/)
assert.match(allServicesMenu.reply, /Corte/)

const uncategorizedCatalog = createBookingV2DomainCatalog({
  displayMode: 'CATEGORIES_FIRST',
  services: [{
    id: 'consulta',
    name: 'Consulta',
    aliases: [],
    duration: 30,
    price: null,
    category: null
  }],
  professionals: []
})
const uncategorizedMenu = await engineFor(uncategorizedCatalog).resume({
  businessId: 'business-1',
  conversation: conversationPatchFromState(namedState)
})
assert.match(uncategorizedMenu.reply, /Consulta/)

assert.deepEqual(catalogRecoveryDecisionButtons('conversation-1'), [
  { id: 'catalog_show_all:conversation-1', title: 'Ver todos' },
  { id: 'catalog_handoff:conversation-1', title: 'Hablar con equipo' },
  { id: 'catalog_restart:conversation-1', title: 'Volver a empezar' }
])
assert.equal(
  catalogRecoveryActionFromInteractiveReply('catalog_show_all:conversation-1', 'conversation-1'),
  'show_all'
)
assert.equal(
  catalogRecoveryActionFromInteractiveReply('catalog_handoff:conversation-1', 'conversation-1'),
  'handoff'
)
assert.equal(
  catalogRecoveryActionFromInteractiveReply('catalog_restart:conversation-1', 'conversation-1'),
  'restart'
)
assert.equal(
  catalogRecoveryActionFromInteractiveReply('catalog_show_all:otra', 'conversation-1'),
  null
)

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const crmRoute = readFileSync('src/routes/crm.ts', 'utf8')
const crmUi = readFileSync('src/routes/crm-ui.ts', 'utf8')
const migration = readFileSync(
  'prisma/migrations/20260804073000_add_service_catalog_display_mode/migration.sql',
  'utf8'
)

assert.match(schema, /serviceCatalogDisplayMode\s+ServiceCatalogDisplayMode\s+@default\(ALL_SERVICES\)/)
assert.match(crmRoute, /CATEGORIES_FIRST/)
assert.match(crmUi, /id="service-catalog-display-mode"/)
assert.match(crmUi, /Mostrar primero las categor&iacute;as/)
assert.match(migration, /DEFAULT 'ALL_SERVICES'/)

console.log('service-catalog-display-contract-test: OK')
