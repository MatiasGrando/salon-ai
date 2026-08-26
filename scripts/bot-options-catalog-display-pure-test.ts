import assert from 'node:assert/strict'
import {
  CATALOG_CONTEXTUAL_PAGE_SIZE,
  catalogPageOffset,
  catalogServiceDetailView,
  catalogServiceRowLabel,
  formatCatalogDuration,
  formatCatalogPrice,
  toCatalogPage,
  type CatalogServiceItem
} from '../src/bot-options/application/catalog-queries.js'
import { codePointLength, renderWhatsAppScreen, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS } from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import { type BotOptionsViewModel } from '../src/bot-options/domain/views.js'
import { generatePromptToken } from '../src/bot-options/domain/prompt-tokens.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function service(overrides: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id: 'svc_1',
    categoryId: 'cat_1',
    parentServiceId: null,
    kind: 'SERVICE',
    name: 'Corte cl\u00e1sico',
    description: null,
    durationMinutes: 30,
    durationMinMinutes: null,
    durationMaxMinutes: null,
    price: 8000,
    priceMode: 'FIXED',
    isBookable: true,
    requiresConsultation: false,
    ...overrides
  }
}

function toViewModel(detail: { informativeTexts: string[]; interactiveBody: string }): BotOptionsViewModel {
  return {
    bodyKind: 'detail',
    informativeTexts: detail.informativeTexts,
    interactiveBody: detail.interactiveBody,
    choices: [{ actionType: 'service.book', label: 'Reservar este servicio' }]
  }
}

/** Verifica que TODOS los cuerpos finales del renderer respetan el límite de code points. */
function assertAllRenderedBodiesRespectLimit(rendered: ReturnType<typeof renderWhatsAppScreen>): void {
  for (const item of rendered.items) {
    if (item.type === 'none') continue
    const cp = codePointLength(item.body)
    assert.ok(
      cp <= WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS,
      `rendered body has ${cp} code points, limit is ${WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS}`
    )
  }
}

const testPromptToken = generatePromptToken()

// ─── formatCatalogPrice ───────────────────────────────────────────────────────

// Precio fijo se formatea como moneda ARS.
assert.equal(formatCatalogPrice(25000, 'FIXED'), '$\u00a025.000')

// Precio STARTING_AT agrega "Desde".
assert.equal(formatCatalogPrice(8000, 'STARTING_AT'), 'Desde $\u00a08.000')

// Sin precio público: null (se omite en fila; el detalle aplica copy contextual).
assert.equal(formatCatalogPrice(null, 'FIXED'), null)
assert.equal(formatCatalogPrice(null, 'STARTING_AT'), null)

// Precio cero se formatea.
assert.equal(formatCatalogPrice(0, 'FIXED'), '$\u00a00')

// Precio grande.
assert.equal(formatCatalogPrice(150000, 'FIXED'), '$\u00a0150.000')

// ─── formatCatalogDuration ────────────────────────────────────────────────────

// Duración fija.
assert.equal(formatCatalogDuration(45, null, null), '45 min')

// Duración fija de 0: null (no se muestra).
assert.equal(formatCatalogDuration(0, null, null), null)

// Rango cuando min < max.
assert.equal(formatCatalogDuration(null, 40, 50), '40\u201350 min')

// Rango cuando min === max: usa durationMinutes si existe.
assert.equal(formatCatalogDuration(45, 45, 45), '45 min')

// Sin duración: null.
assert.equal(formatCatalogDuration(null, null, null), null)

// Prioridad rango sobre fijo cuando ambos existen y son válidos.
assert.equal(formatCatalogDuration(45, 40, 50), '40\u201350 min')

// ─── catalogServiceRowLabel ───────────────────────────────────────────────────

// Label con precio fijo y duración fija.
const fullItem = service({
  name: 'Corte premium',
  price: 25000,
  priceMode: 'FIXED',
  durationMinutes: 45
})
assert.equal(catalogServiceRowLabel(fullItem), 'Corte premium \u2014 $\u00a025.000 \u00b7 45 min')

// Label con STARTING_AT y rango de duración.
const startingItem = service({
  name: 'Color completo',
  price: 15000,
  priceMode: 'STARTING_AT',
  durationMinutes: null,
  durationMinMinutes: 60,
  durationMaxMinutes: 120
})
assert.equal(catalogServiceRowLabel(startingItem), 'Color completo \u2014 Desde $\u00a015.000 \u00b7 60\u2013120 min')

// Label sin precio: sólo nombre y duración.
const noPriceItem = service({ price: null, durationMinutes: 30 })
assert.equal(catalogServiceRowLabel(noPriceItem), 'Corte cl\u00e1sico \u2014 30 min')

// Label sin precio ni duración: sólo nombre.
const minimalItem = service({ price: null, durationMinutes: null })
assert.equal(catalogServiceRowLabel(minimalItem), 'Corte cl\u00e1sico')

// Label con precio pero sin duración.
const priceOnly = service({ price: 12000, priceMode: 'FIXED', durationMinutes: null })
assert.equal(catalogServiceRowLabel(priceOnly), 'Corte cl\u00e1sico \u2014 $\u00a012.000')

// ─── catalogServiceDetailView — detalle cabe en interactivo ────────────────────

// Rejects non-positive maxInteractiveBodyCodePoints.
assert.throws(() => catalogServiceDetailView(service(), 0), /positive integer/)
assert.throws(() => catalogServiceDetailView(service(), -1), /positive integer/)
assert.throws(() => catalogServiceDetailView(service(), 1.5), /positive integer/)
assert.throws(() => catalogServiceDetailView(service(), NaN), /positive integer/)

const simpleDetail = service({
  name: 'Corte cl\u00e1sico',
  description: 'Incluye lavado y secado.',
  price: 8000,
  priceMode: 'FIXED',
  durationMinutes: 30
})
const simpleView = catalogServiceDetailView(simpleDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.deepEqual(simpleView.informativeTexts, [])
assert.ok(simpleView.interactiveBody.includes('Corte cl\u00e1sico'))
assert.ok(simpleView.interactiveBody.includes('Incluye lavado y secado.'))
assert.ok(simpleView.interactiveBody.includes('$\u00a08.000'))
assert.ok(simpleView.interactiveBody.includes('30 min'))
// Duración fija sin rango → "Duración:" (no "estimada").
assert.ok(simpleView.interactiveBody.includes('Duraci\u00f3n: 30 min'))
assert.ok(!simpleView.interactiveBody.includes('Duraci\u00f3n estimada'))

// ─── catalogServiceDetailView — STARTING_AT con rango ─────────────────────────

const startingDetail = service({
  name: 'Color',
  price: 15000,
  priceMode: 'STARTING_AT',
  durationMinutes: null,
  durationMinMinutes: 60,
  durationMaxMinutes: 120
})
const startingView = catalogServiceDetailView(startingDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(startingView.interactiveBody.includes('Desde $\u00a015.000'))
assert.ok(startingView.interactiveBody.includes('60\u2013120 min'))
assert.ok(!startingView.interactiveBody.includes('Consultar con el equipo'))
// Rango → "Duración estimada:".
assert.ok(startingView.interactiveBody.includes('Duraci\u00f3n estimada: 60\u2013120 min'))

// ─── catalogServiceDetailView — sin precio público, requiere consulta ──────────

const consultDetail = service({
  name: 'Asesor\u00eda personalizada',
  price: null,
  requiresConsultation: true,
  durationMinutes: null
})
const consultView = catalogServiceDetailView(consultDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(consultView.interactiveBody.includes('Consultar con el equipo'))
assert.ok(!consultView.interactiveBody.includes('Desde'))

// ─── catalogServiceDetailView — sin precio público, reservable (NO requiere consulta) ──

// §3.1: "Consultar con el equipo" es el copy del precio cuando price=null,
// independientemente de requiresConsultation. Éste define la ACCIÓN (F5.5),
// no la presentación del precio.
const reservableNoPriceDetail = service({
  name: 'Corte express',
  price: null,
  requiresConsultation: false,
  durationMinutes: 20
})
const reservableNoPriceView = catalogServiceDetailView(reservableNoPriceDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(reservableNoPriceView.interactiveBody.includes('Consultar con el equipo'),
  'price=null must always show "Consultar con el equipo" regardless of requiresConsultation')
assert.ok(reservableNoPriceView.interactiveBody.includes('20 min'))

// ─── catalogServiceDetailView — sin precio, sin consulta, sin duración ─────────

const bareDetail = service({ price: null, durationMinutes: null, requiresConsultation: false })
const bareView = catalogServiceDetailView(bareDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.deepEqual(bareView.informativeTexts, [])
// price=null → siempre "Consultar con el equipo" en detalle.
assert.ok(bareView.interactiveBody.includes('Consultar con el equipo'))
assert.ok(!bareView.interactiveBody.includes('Duraci'))

// ─── catalogServiceDetailView — campos ausentes se omiten ─────────────────────

const omitDetail = service({ description: null, price: null, durationMinutes: null, requiresConsultation: false })
const omitView = catalogServiceDetailView(omitDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(!omitView.interactiveBody.includes('Sin descripci\u00f3n'))
assert.ok(!omitView.interactiveBody.includes('Duraci'))
// price=null siempre muestra "Consultar con el equipo".
assert.ok(omitView.interactiveBody.includes('Consultar con el equipo'))

// ─── catalogServiceDetailView — contenido largo precede al interactivo ─────────

const longDescription = 'Esta es una descripci\u00f3n muy extensa del servicio que contiene mucha informaci\u00f3n detallada sobre lo que incluye el corte, los productos utilizados, el tiempo estimado de duraci\u00f3n y cada detalle relevante para que el cliente tome una decisi\u00f3n informada. Incluye tambi\u00e9n informaci\u00f3n sobre pol\u00edticas de cancelaci\u00f3n y reprogramaci\u00f3n que el cliente debe conocer antes de reservar. '.repeat(10)
const longDetail = service({
  name: 'Corte premium',
  description: longDescription,
  price: 25000,
  priceMode: 'FIXED',
  durationMinutes: 45
})
const longView = catalogServiceDetailView(longDetail, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)

// La descripción larga va como informativo.
assert.equal(longView.informativeTexts.length, 1)
assert.equal(longView.informativeTexts[0], longDescription)

// El interactivo lleva un resumen breve.
assert.ok(longView.interactiveBody.includes('Corte premium'))
assert.ok(longView.interactiveBody.includes('$\u00a025.000'))
assert.ok(longView.interactiveBody.includes('Duraci\u00f3n: 45 min'))
// El interactivo NO incluye la descripción completa.
assert.ok(!longView.interactiveBody.includes('Esta es una descripci\u00f3n muy extensa'))

// ─── catalogServiceDetailView — descripción larga + sin precio ────────────────

const longNoPrice = service({
  name: 'Asesor\u00eda VIP',
  description: longDescription,
  price: null,
  requiresConsultation: true,
  durationMinutes: null
})
const longNoPriceView = catalogServiceDetailView(longNoPrice, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.equal(longNoPriceView.informativeTexts.length, 1)
assert.ok(longNoPriceView.interactiveBody.includes('Asesor\u00eda VIP'))
assert.ok(longNoPriceView.interactiveBody.includes('Consultar con el equipo'))
assert.ok(!longNoPriceView.interactiveBody.includes('Esta es una descripci\u00f3n muy extensa'))

// ─── catalogServiceDetailView — nombre largo sin descripción ──────────────────

const longNameItem = service({
  name: 'X'.repeat(1030),
  description: null,
  price: 5000,
  priceMode: 'FIXED',
  durationMinutes: 30
})
const longNameView = catalogServiceDetailView(longNameItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(longNameView.interactiveBody.includes('$\u00a05.000'))
assert.ok(longNameView.interactiveBody.includes('Duraci\u00f3n: 30 min'))

// ─── catalogServiceDetailView — límite exacto ─────────────────────────────────

const exactItem = service({
  name: 'Test',
  description: 'A'.repeat(1010),
  price: 1000,
  priceMode: 'FIXED',
  durationMinutes: 10
})
const exactView = catalogServiceDetailView(exactItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
const fullExact = ['Test', 'A'.repeat(1010), '$\u00a01.000', 'Duraci\u00f3n: 10 min'].join('\n\n')
if (codePointLength(fullExact) <= WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS) {
  assert.deepEqual(exactView.informativeTexts, [])
} else {
  assert.ok(exactView.informativeTexts.length >= 1)
}

// ─── Preexistent: pagination helpers intactos ──────────────────────────────────

assert.equal(CATALOG_CONTEXTUAL_PAGE_SIZE, 7)
assert.equal(catalogPageOffset(0), 0)
assert.equal(catalogPageOffset(1), 7)
assert.equal(catalogPageOffset(2), 14)

const allRows = Array.from({ length: 8 }, (_, i) => `item_${i}`)
const page0 = toCatalogPage(allRows, 0)
assert.equal(page0.items.length, 7)
assert.equal(page0.hasNext, true)
assert.equal(page0.hasPrevious, false)
const page1Rows = allRows.slice(catalogPageOffset(1))
const page1 = toCatalogPage(page1Rows, 1)
assert.equal(page1.items.length, 1)
assert.equal(page1.hasNext, false)
assert.equal(page1.hasPrevious, true)

assert.throws(() => catalogPageOffset(-1), /non-negative integer/)

// ─── Unicode: emoji en nombre y descripción ────────────────────────────────────

const emojiItem = service({
  name: 'Corte \u{1F488}',
  description: 'Servicio con estilo \u2728',
  price: 10000,
  priceMode: 'FIXED',
  durationMinutes: 30
})
const emojiView = catalogServiceDetailView(emojiItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(emojiView.interactiveBody.includes('Corte \u{1F488}'))
assert.ok(emojiView.interactiveBody.includes('\u2728'))
assert.equal(emojiView.informativeTexts.length, 0)

// Emoji en label de lista.
assert.ok(catalogServiceRowLabel(emojiItem).includes('Corte \u{1F488}'))

// Descripción con emoji que excede el límite → informativo + resumen.
const emojiLongDesc = '\u{1F488} '.repeat(600)
const emojiLongItem = service({
  name: 'Corte \u{1F488}',
  description: emojiLongDesc,
  price: 10000,
  priceMode: 'FIXED',
  durationMinutes: 30
})
const emojiLongView = catalogServiceDetailView(emojiLongItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.equal(emojiLongView.informativeTexts.length, 1)
assert.ok(emojiLongView.interactiveBody.includes('Corte \u{1F488}'))
assert.ok(!emojiLongView.interactiveBody.includes('\u{1F488} \u{1F488}'))

// ─── Unicode: caracteres combinantes y scripts mixtos ─────────────────────────

const combinatorItem = service({
  name: '\u0041\u0301rbol \u4e16\u754c \u0639\u0631\u0628\u064a',
  description: null,
  price: 5000,
  priceMode: 'FIXED',
  durationMinutes: 20
})
const combinatorView = catalogServiceDetailView(combinatorItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.ok(combinatorView.interactiveBody.includes('\u0041\u0301rbol'))
assert.ok(combinatorView.interactiveBody.includes('\u4e16\u754c'))
assert.ok(combinatorView.interactiveBody.includes('\u0639\u0631\u0628\u064a'))

// ─── Renderer integration: informativeTexts → interactiveDependsOnPrevious ─────

// Caso simple: detalle cabe en interactivo → sin informativos, sin dependencia.
const simpleIntegration = catalogServiceDetailView(
  service({ name: 'X', description: 'Corta', price: 1000, priceMode: 'FIXED', durationMinutes: 10 }),
  WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS
)
const simpleRendered = renderWhatsAppScreen(toViewModel(simpleIntegration), { promptToken: testPromptToken })
assert.equal(simpleRendered.interactiveDependsOnPrevious, false)
assert.ok(!simpleRendered.items.some((item) => item.type === 'informative_text'))
assertAllRenderedBodiesRespectLimit(simpleRendered)

// Caso largo: descripción excede límite → informativo + dependencia.
const longIntegration = catalogServiceDetailView(
  service({ name: 'Corte largo', description: 'A'.repeat(1500), price: 20000, priceMode: 'FIXED', durationMinutes: 45 }),
  WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS
)
assert.equal(longIntegration.informativeTexts.length, 1)
const longRendered = renderWhatsAppScreen(toViewModel(longIntegration), { promptToken: testPromptToken })
assert.equal(longRendered.interactiveDependsOnPrevious, true)
const informativeItems = longRendered.items.filter((item) => item.type === 'informative_text')
assert.ok(informativeItems.length >= 1)
const lastItem = longRendered.items.at(-1)
assert.ok(lastItem && lastItem.type === 'interactive')
assertAllRenderedBodiesRespectLimit(longRendered)

// ─── Renderer limits: TODOS los cuerpos respetan ≤1024 code points ────────────

// Verifica esto para cada escenario de catálogo que pasa por el renderer.
const limitScenarios = [
  { name: 'simple', detail: simpleIntegration },
  { name: 'long', detail: longIntegration },
  {
    name: 'emoji-long',
    detail: catalogServiceDetailView(
      service({ name: 'Corte \u{1F488}', description: '\u{1F488} '.repeat(800), price: 10000, priceMode: 'FIXED', durationMinutes: 30 }),
      WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS
    )
  },
  {
    name: 'no-price-long',
    detail: catalogServiceDetailView(
      service({ name: 'Asesora', description: 'X'.repeat(2000), price: null, requiresConsultation: true, durationMinutes: null }),
      WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS
    )
  }
]
for (const scenario of limitScenarios) {
  const rendered = renderWhatsAppScreen(toViewModel(scenario.detail), { promptToken: testPromptToken })
  assertAllRenderedBodiesRespectLimit(rendered)
}

// ─── Snapshot: estructura del detalle simple ───────────────────────────────────

const snapshotItem = service({
  name: 'Balayaje',
  description: 'Técnica de color.',
  price: 35000,
  priceMode: 'FIXED',
  durationMinutes: 90
})
const snapshot = catalogServiceDetailView(snapshotItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.deepEqual(snapshot, {
  informativeTexts: [],
  interactiveBody: 'Balayaje\n\nT\u00e9cnica de color.\n\n$\u00a035.000\n\nDuraci\u00f3n: 90 min'
})

// Snapshot: detalle con rango de duración.
const rangeSnapshotItem = service({
  name: 'Color',
  description: null,
  price: 15000,
  priceMode: 'STARTING_AT',
  durationMinutes: null,
  durationMinMinutes: 60,
  durationMaxMinutes: 120
})
const rangeSnapshot = catalogServiceDetailView(rangeSnapshotItem, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
assert.deepEqual(rangeSnapshot, {
  informativeTexts: [],
  interactiveBody: 'Color\n\nDesde $\u00a015.000\n\nDuraci\u00f3n estimada: 60\u2013120 min'
})

// Snapshot: sin precio público (reservable sin consulta) → "Consultar con el equipo".
const noPriceSnapshot = catalogServiceDetailView(
  service({ name: 'Corte rápido', price: null, requiresConsultation: false, durationMinutes: 15 }),
  WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS
)
assert.deepEqual(noPriceSnapshot, {
  informativeTexts: [],
  interactiveBody: 'Corte r\u00e1pido\n\nConsultar con el equipo\n\nDuraci\u00f3n: 15 min'
})

console.log('OK F5.4 catalog display pure: formatCatalogPrice, formatCatalogDuration, catalogServiceRowLabel, catalogServiceDetailView satisfy the contract.')
