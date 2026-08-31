import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  RendererError,
  MAX_CHOICE_TOKEN_ATTEMPTS,
  WHATSAPP_BUTTONS_MAX,
  WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS,
  WHATSAPP_LIST_ROWS_MAX,
  codePointLength,
  renderWhatsAppScreen,
  splitUnicodeSafe,
  truncateLabelWordSafe
} from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import { menuView, recoveryView, STALE_PROMPT_NOTICE, textView, withStalePromptNotice, type BotOptionsViewModel } from '../src/bot-options/domain/views.js'
import { parseInteractiveActionId } from '../src/bot-options/domain/prompt-tokens.js'

const rng = () => randomBytes(8)
const screen = (view: BotOptionsViewModel) =>
  renderWhatsAppScreen(view, { promptToken: 'p'.repeat(16), generateChoiceBytes: rng })

const refreshed = withStalePromptNotice(menuView('Elegí una opción', [{ actionType: 'navigation.home', label: 'Menú principal' }]))
assert.deepEqual(refreshed.informativeTexts, [STALE_PROMPT_NOTICE])
assert.equal(refreshed.interactiveBody, 'Elegí una opción')
assert.equal(refreshed.choices[0]?.actionType, 'navigation.home')

// ─── splitUnicodeSafe (F3.8) ─────────────────────────────────────────────────

assert.deepEqual(splitUnicodeSafe('hola', 10), ['hola'])
assert.deepEqual(splitUnicodeSafe('', 10), [])

const paragraphs = splitUnicodeSafe('uno dos tres\n\ncuatro cinco seis', 8)
assert.ok(paragraphs.every((chunk) => codePointLength(chunk) <= 8))
assert.equal(paragraphs.join(' '), 'uno dos tres cuatro cinco seis')

// Emoji = 1 code point y nunca se parte por la mitad.
const emojiText = '😀😀😀😀😀'
assert.deepEqual(splitUnicodeSafe(emojiText, 3), ['😀😀😀', '😀😀'])

// Importes con separador de miles no se cortan internamente al haber espacios.
const money = 'El valor es $1.500.000 por sesión de 45 min adicional'
for (const chunk of splitUnicodeSafe(money, 20)) {
  assert.ok(codePointLength(chunk) <= 20)
}

// Palabra única más larga que el máximo: corte duro por code points.
const hard = splitUnicodeSafe('a'.repeat(15), 10)
assert.equal(hard.length, 2)
assert.equal(hard[0]!.length, 10)

// ─── truncateLabelWordSafe ────────────────────────────────────────────────────

assert.deepEqual(truncateLabelWordSafe('Corte clásico', 20), { label: 'Corte clásico', hardTruncated: false })
const cut = truncateLabelWordSafe('Corte clásico con lavado premium incluido', 20)
assert.equal(cut.label, 'Corte clásico con')
assert.equal(cut.hardTruncated, false)

// ─── F3.8: límites de WhatsApp antes del proveedor ────────────────────────────

// Menú con más de 3 opciones → lista.
const listScreen = screen(
  menuView('¿Qué querés hacer?', [
    { actionType: 'menu.start_booking', label: 'Sacar un turno' },
    { actionType: 'menu.browse_services', label: 'Ver servicios y precios — desde $8.000' },
    { actionType: 'menu.business_hours', label: 'Consultar horarios' },
    { actionType: 'menu.manage_appointment', label: 'Gestionar un turno' },
    { actionType: 'handoff.request', label: 'Hablar con el equipo' }
  ])
)
const interactiveList = listScreen.items.find((item) => item.type === 'interactive')
assert.ok(interactiveList && interactiveList.type === 'interactive' && interactiveList.mode === 'list')
assert.equal(interactiveList.rows?.length, 5)
for (const row of interactiveList.rows ?? []) {
  assert.ok([...row.title].length <= 24)
  if (row.description !== undefined) assert.ok([...row.description].length <= 72)
}
for (const id of interactiveList.actionIds) {
  const parsed = parseInteractiveActionId(id)
  assert.equal(parsed.ok, true)
}
assert.equal(listScreen.choiceMappings.length, 5)
assert.deepEqual(
  listScreen.choiceMappings.map(({ actionType, labelSnapshot, sortOrder }) => ({ actionType, labelSnapshot, sortOrder })),
  [
    { actionType: 'menu.start_booking', labelSnapshot: 'Sacar un turno', sortOrder: 0 },
    { actionType: 'menu.browse_services', labelSnapshot: 'Ver servicios y precios — desde $8.000', sortOrder: 1 },
    { actionType: 'menu.business_hours', labelSnapshot: 'Consultar horarios', sortOrder: 2 },
    { actionType: 'menu.manage_appointment', labelSnapshot: 'Gestionar un turno', sortOrder: 3 },
    { actionType: 'handoff.request', labelSnapshot: 'Hablar con el equipo', sortOrder: 4 }
  ]
)
for (const mapping of listScreen.choiceMappings) {
  assert.equal(mapping.actionId.includes(mapping.choiceToken), true)
}

// Dos opciones → botones.
const buttonScreen = screen(
  menuView('¿Confirmás?', [
    { actionType: 'booking.confirm', label: 'Confirmar turno' },
    { actionType: 'navigation.back', label: 'Volver' }
  ])
)
const interactiveButtons = buttonScreen.items.find((item) => item.type === 'interactive')
assert.ok(interactiveButtons && interactiveButtons.type === 'interactive' && interactiveButtons.mode === 'buttons')
assert.equal(interactiveButtons.buttons?.length, 2)
for (const button of interactiveButtons.buttons ?? []) {
  assert.ok([...button.title].length <= 20)
}

// Títulos duplicados se desambiguan sin exceder límites.
const dupScreen = screen(
  menuView('Elegí', [
    { actionType: 'navigation.home', label: 'Volver' },
    { actionType: 'navigation.back', label: 'Volver' }
  ])
)
const dupInteractive = dupScreen.items.find((item) => item.type === 'interactive')
assert.ok(dupInteractive && dupInteractive.type === 'interactive')
const titles = (dupInteractive.buttons ?? []).map((button) => button.title)
assert.equal(new Set(titles).size, titles.length)

// El mapping conserva semántica completa sin zip posicional externo.
const semanticScreen = screen(menuView('Elegí horario', [{
  actionType: 'appointment.slot_select',
  label: '16:00',
  entityRef: { type: 'APPOINTMENT', id: 'apt_1' },
  payload: { startAt: '2026-09-03T16:00:00-03:00' }
}]))
assert.deepEqual(
  semanticScreen.choiceMappings.map(({ actionType, entityType, entityId, payload, labelSnapshot, sortOrder }) => ({
    actionType,
    entityType,
    entityId,
    payload,
    labelSnapshot,
    sortOrder
  })),
  [{
    actionType: 'appointment.slot_select',
    entityType: 'APPOINTMENT',
    entityId: 'apt_1',
    payload: { startAt: '2026-09-03T16:00:00-03:00' },
    labelSnapshot: '16:00',
    sortOrder: 0
  }]
)

// Colisiones dentro del mismo prompt se reintentan con cota y luego fallan explícitamente.
let collisionCalls = 0
const collisionRecovered = renderWhatsAppScreen(
  menuView('Elegí', [
    { actionType: 'navigation.home', label: 'Inicio' },
    { actionType: 'navigation.back', label: 'Volver' }
  ]),
  {
    promptToken: 'p'.repeat(16),
    generateChoiceBytes: () => {
      collisionCalls += 1
      return new Uint8Array(8).fill(collisionCalls <= 2 ? 1 : 2)
    }
  }
)
assert.equal(collisionCalls, 3)
assert.equal(new Set(collisionRecovered.choiceMappings.map((mapping) => mapping.choiceToken)).size, 2)

assert.throws(
  () => renderWhatsAppScreen(
    menuView('Elegí', [
      { actionType: 'navigation.home', label: 'Inicio' },
      { actionType: 'navigation.back', label: 'Volver' }
    ]),
    {
      promptToken: 'p'.repeat(16),
      generateChoiceBytes: () => new Uint8Array(8).fill(1)
    }
  ),
  (error: unknown) => error instanceof RendererError && error.reason === 'token_collision'
)
assert.equal(MAX_CHOICE_TOKEN_ATTEMPTS, 8)

// Más de diez opciones es un bug upstream: el renderer lo rechaza.
assert.throws(
  () =>
    screen(
      menuView(
        'Demasiadas',
        Array.from({ length: WHATSAPP_LIST_ROWS_MAX + 1 }, (_, i) => ({
          actionType: 'catalog.next_page' as const,
          label: `Opción ${i + 1}`
        }))
      )
    ),
  (error: unknown) => error instanceof RendererError && error.reason === 'too_many_choices'
)

// Cuerpo mayor a 1024 code points → fragmentos informativos + interactivo final.
const longText = Array.from({ length: WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS + 300 }, (_, i) =>
  i % 80 === 79 ? '\n' : 'a'
).join('')
const longView: BotOptionsViewModel = {
  bodyKind: 'detail',
  informativeTexts: [],
  interactiveBody: longText,
  choices: [{ actionType: 'service.book', label: 'Reservar este servicio' }]
}
const longRendered = screen(longView)
assert.ok(longRendered.interactiveDependsOnPrevious)
const informativeCount = longRendered.items.filter((item) => item.type === 'informative_text').length
assert.ok(informativeCount >= 1)
const finalInteractive = longRendered.items.at(-1)
assert.ok(finalInteractive && finalInteractive.type === 'interactive')
assert.ok(codePointLength(finalInteractive.body) <= WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
// Nada de contenido perdido: reensamblado cubre el texto original.
const rebuilt = longRendered.items
  .filter((item): item is Exclude<typeof item, { type: 'none' }> => item.type !== 'none')
  .map((item) => item.body)
  .join('\n')
const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()
assert.equal(normalizeWhitespace(rebuilt), normalizeWhitespace(longText), 'el split no puede perder contenido Unicode')

// ─── Vista silenciosa y sólo informativa ──────────────────────────────────────

const silent = screen(textView(''))
assert.deepEqual(silent.items, [{ type: 'none' }])
assert.deepEqual(silent.choiceMappings, [])

const onlyText = screen(recoveryView('Ahora no puedo responder eso.', []))
assert.equal(onlyText.interactiveDependsOnPrevious, false)
assert.ok(onlyText.items.every((item) => item.type === 'informative_text'))

console.log('OK bot-options renderer: límites 1024/3/10/20/24/72, IDs ≤64 y split Unicode cumplen el contrato.')
