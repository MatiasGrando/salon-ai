/**
 * F4.6/F4.7 — Renderer de vistas hacia payloads de WhatsApp.
 *
 * Traduce el ViewModel del dominio a la forma que el adaptador de Meta envía,
 * validando ANTES de llamar al proveedor:
 *
 * - cuerpo interactivo ≤ 1024 caracteres (code points Unicode);
 * - hasta 3 reply buttons con títulos ≤ 20, o lista de ≤ 10 filas
 *   (título ≤ 24, descripción ≤ 72);
 * - textos del botón/encabezado dentro de límites;
 * - IDs ASCII ≤ 64 bytes generados desde tokens opacos;
 * - nunca trunca ambiguamente importes, unidades ni la etiqueta "Desde":
 *   el corte es por párrafo → línea → palabra → code point.
 *
 * Si el cuerpo no entra, se divide en mensajes informativos previos y el
 * interactivo final lleva el último fragmento: sólo ese abre prompt y depende
 * de la entrega aceptada de los anteriores (outbox ordenado).
 */

import { randomBytes as defaultRandomBytes } from 'node:crypto'
import {
  MAX_ACTION_ID_BYTES,
  buildInteractiveActionId,
  encodeChoiceTokenFromBytes,
  type RandomBytesFn
} from '../domain/prompt-tokens.js'
import type { BotOptionsViewModel, ViewChoice } from '../domain/views.js'

export const WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS = 1024
export const WHATSAPP_BUTTON_TITLE_MAX = 20
export const WHATSAPP_ROW_TITLE_MAX = 24
export const WHATSAPP_ROW_DESCRIPTION_MAX = 72
export const WHATSAPP_BUTTONS_MAX = 3
export const WHATSAPP_LIST_ROWS_MAX = 10

export class RendererError extends Error {
  constructor(readonly reason: 'too_many_choices' | 'empty_view' | 'token_budget') {
    super(`renderer: ${reason}`)
  }
}

/** Cuenta code points Unicode (no UTF-16 units): emojis cuentan 1. */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Divide texto en fragmentos de a lo sumo `max` code points respetando,
 * en orden: párrafos (\n\n) → líneas (\n) → espacios → code points.
 * Nunca parte un par de suplentes ni deja un token numérico cortado salvo
 * que una sola palabra exceda `max`.
 */
export function splitUnicodeSafe(text: string, max: number): string[] {
  if (max <= 0) throw new Error('El límite debe ser positivo')
  if (codePointLength(text) <= max) return text.length > 0 ? [text] : []

  const chunks: string[] = []
  const pushChunk = (candidate: string) => {
    if (candidate.trim().length === 0) return
    if (codePointLength(candidate) <= max) {
      chunks.push(candidate.trim())
      return
    }
    // Bajar granularidad: líneas.
    for (const line of candidate.split('\n')) {
      if (codePointLength(line) <= max) {
        chunks.push(line.trim())
        continue
      }
      // Palabras.
      let current = ''
      for (const word of line.split(' ')) {
        const candidateLine = current.length === 0 ? word : `${current} ${word}`
        if (codePointLength(candidateLine) <= max) {
          current = candidateLine
          continue
        }
        if (current.length > 0) chunks.push(current)
        if (codePointLength(word) <= max) {
          current = word
        } else {
          // Una sola palabra excede el máximo: corte duro por code points.
          const points = Array.from(word)
          for (let i = 0; i < points.length; i += max) {
            chunks.push(points.slice(i, i + max).join(''))
          }
          current = ''
        }
      }
      if (current.length > 0) chunks.push(current)
    }
  }

  for (const paragraph of text.split('\n\n')) pushChunk(paragraph)

  return chunks.filter((chunk) => chunk.length > 0)
}

/** Corte por palabra para títulos: nunca parte un importe o unidad por la mitad salvo caso extremo. */
export function truncateLabelWordSafe(label: string, max: number): { label: string; hardTruncated: boolean } {
  if (codePointLength(label) <= max) return { label, hardTruncated: false }
  const cut = label.slice(0, max + 1)
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace >= Math.floor(max / 2)) {
    return { label: cut.slice(0, lastSpace).trimEnd(), hardTruncated: false }
  }
  return { label: Array.from(label).slice(0, max).join('').trimEnd(), hardTruncated: true }
}

export type WhatsAppScreenItem =
  | { type: 'informative_text'; body: string }
  | {
      type: 'interactive'
      mode: 'buttons' | 'list'
      body: string
      /** IDs ya compuestos `b1.<prompt>.<choice>` en el mismo orden que labels. */
      actionIds: string[]
      buttons?: Array<{ id: string; title: string }>
      rows?: Array<{ id: string; title: string; description?: string }>
      buttonText?: string
      sectionTitle?: string
    }
  | { type: 'none' }

export type RenderedWhatsAppScreen = {
  items: WhatsAppScreenItem[]
  /** El interactivo final depende de que los textos previos estén ACCEPTED. */
  interactiveDependsOnPrevious: boolean
}

function choiceLabelParts(choice: ViewChoice): { title: string; description: string | null } {
  const separator = choice.label.indexOf(' — ')
  if (separator > 0) {
    return {
      title: choice.label.slice(0, separator),
      description: choice.label.slice(separator + 3)
    }
  }
  return { title: choice.label, description: null }
}

function dedupeTitles(titles: string[], max: number): string[] {
  const seen = new Set<string>()
  return titles.map((title, index) => {
    if (!seen.has(title)) {
      seen.add(title)
      return title
    }
    const prefixed = truncateLabelWordSafe(`${index + 1}. ${title}`, max).label
    seen.add(prefixed)
    return prefixed
  })
}

/**
 * Punto de entrada del renderer. `generateChoiceToken` se inyecta para pruebas;
 * en producción usa crypto. Cada choice recibe su propio token nuevo.
 */
export function renderWhatsAppScreen(
  view: BotOptionsViewModel,
  input: { promptToken: string; generateChoiceBytes?: RandomBytesFn }
): RenderedWhatsAppScreen {
  const generateChoiceBytes = input.generateChoiceBytes ?? defaultRandomBytes

  if ((view.interactiveBody === null || view.interactiveBody.length === 0) && view.choices.length === 0 && view.informativeTexts.length === 0) {
    return { items: [{ type: 'none' }], interactiveDependsOnPrevious: false }
  }
  if (view.choices.length > WHATSAPP_LIST_ROWS_MAX) {
    throw new RendererError('too_many_choices')
  }

  const items: WhatsAppScreenItem[] = []
  for (const text of view.informativeTexts) {
    for (const chunk of splitUnicodeSafe(text, WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)) {
      items.push({ type: 'informative_text', body: chunk })
    }
  }

  let bodyChunks = splitUnicodeSafe(view.interactiveBody ?? '', WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS)
  if (bodyChunks.length === 0 && view.choices.length === 0) {
    // Sólo informativos.
    return {
      items,
      interactiveDependsOnPrevious: false
    }
  }

  const dependsOnPrevious = bodyChunks.length > 1 || items.length > 0
  while (bodyChunks.length > 1) {
    const [head, ...rest] = bodyChunks as [string, ...string[]]
    items.push({ type: 'informative_text', body: head })
    bodyChunks = rest
  }
  const finalBody = bodyChunks[0] ?? ''

  if (view.choices.length === 0) {
    items.push({ type: 'informative_text', body: finalBody })
    return { items, interactiveDependsOnPrevious: dependsOnPrevious }
  }

  const actionIds: string[] = []
  for (const _choice of view.choices) {
    const choiceToken = encodeChoiceTokenFromBytes(generateChoiceBytes(8))
    const id = buildInteractiveActionId(input.promptToken, choiceToken)
    if (Buffer.byteLength(id, 'ascii') > MAX_ACTION_ID_BYTES) throw new RendererError('token_budget')
    actionIds.push(id)
  }

  if (view.choices.length <= WHATSAPP_BUTTONS_MAX) {
    const titles = dedupeTitles(
      view.choices.map((choice) => truncateLabelWordSafe(choice.label, WHATSAPP_BUTTON_TITLE_MAX).label),
      WHATSAPP_BUTTON_TITLE_MAX
    )
    items.push({
      type: 'interactive',
      mode: 'buttons',
      body: finalBody,
      actionIds,
      buttons: view.choices.map((choice, index) => ({ id: actionIds[index]!, title: titles[index]! }))
    })
    return { items, interactiveDependsOnPrevious: dependsOnPrevious }
  }

  const rows = view.choices.map((choice, index) => {
    const { title, description } = choiceLabelParts(choice)
    const safeTitle = truncateLabelWordSafe(title, WHATSAPP_ROW_TITLE_MAX)
    const combinedDescription = safeTitle.hardTruncated
      ? [title, description].filter((part): part is string => Boolean(part)).join(' — ')
      : description ?? ''
    const safeDescription = combinedDescription.length > 0
      ? truncateLabelWordSafe(combinedDescription, WHATSAPP_ROW_DESCRIPTION_MAX)
      : null
    return {
      id: actionIds[index]!,
      title: safeTitle.label,
      ...(safeDescription && safeDescription.label.length > 0 ? { description: safeDescription.label } : {})
    }
  })

  items.push({
    type: 'interactive',
    mode: 'list',
    body: finalBody,
    actionIds,
    rows,
    buttonText: truncateLabelWordSafe('Elegí una opción', WHATSAPP_BUTTON_TITLE_MAX).label,
    sectionTitle: truncateLabelWordSafe('Opciones', WHATSAPP_BUTTON_TITLE_MAX).label
  })
  return { items, interactiveDependsOnPrevious: dependsOnPrevious }
}
