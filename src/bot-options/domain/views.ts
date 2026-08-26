/**
 * F4.3 — ViewModel del motor determinístico por opciones.
 *
 * La vista describe QUÉ se muestra y qué acciones ofrece, sin detalles de
 * WhatsApp: el renderer decide botón vs lista, truncamientos permitidos,
 * partición de textos largos y límites 1024/3/10/20/24/72. Sólo la vista
 * interactiva final abre prompt; los textos informativos previos no crean
 * opciones ni consumen tokens.
 */

import type {
  BotOptionsActionPayload,
  BotOptionsActionType,
  BotOptionsEntityRef
} from './actions.js'

export type ViewChoice = {
  actionType: BotOptionsActionType
  label: string
  entityRef?: BotOptionsEntityRef | undefined
  payload?: BotOptionsActionPayload | undefined
}

export type ViewBodyKind = 'menu' | 'detail' | 'summary' | 'confirmation' | 'recovery' | 'notice'

export type BotOptionsViewModel = {
  bodyKind: ViewBodyKind
  /** Textos informativos que viajan como mensajes separados ANTES del interactivo. */
  informativeTexts: string[]
  /** Cuerpo del mensaje interactivo final; el renderer valida los 1024 caracteres. */
  interactiveBody: string | null
  choices: ViewChoice[]
}

export function textView(text: string): BotOptionsViewModel {
  return { bodyKind: 'notice', informativeTexts: [], interactiveBody: text, choices: [] }
}

export function menuView(body: string, choices: ViewChoice[]): BotOptionsViewModel {
  return { bodyKind: 'menu', informativeTexts: [], interactiveBody: body, choices }
}

export function recoveryView(body: string, choices: ViewChoice[]): BotOptionsViewModel {
  return { bodyKind: 'recovery', informativeTexts: [], interactiveBody: body, choices }
}

export const HUMAN_CHOICE: ViewChoice = { actionType: 'handoff.request', label: 'Hablar con el equipo' }
export const HOME_CHOICE: ViewChoice = { actionType: 'navigation.home', label: 'Menú principal' }
export const BACK_CHOICE: ViewChoice = { actionType: 'navigation.back', label: 'Volver' }
export const NAVIGATION_MENU_CHOICE: ViewChoice = {
  actionType: 'navigation.open',
  label: 'Opciones de navegación'
}
export const NAVIGATION_MENU_CLOSE_CHOICE: ViewChoice = {
  actionType: 'navigation.close',
  label: 'Volver a la pantalla'
}

/**
 * Política adaptativa de navegación global (reglas-funcionales.md §10):
 * las globales van directas cuando entran en la capacidad de la pantalla; si no,
 * se ofrecen dentro de "Opciones de navegación" consumiendo una sola fila.
 *
 * `capacity` es el máximo de choices que el renderer admite para esta pantalla
 * (3 en reply buttons, 10 filas menos contextuales reservadas en listas).
 * `back === null` significa que el estado no admite Volver genérico.
 */
export type GlobalNavigationPlan = {
  /** Choices globales que se agregan directo tras las contextuales. */
  directChoices: ViewChoice[]
  /** true cuando Volver quedó dentro del menú de navegación en vez de directo. */
  backInsideMenu: boolean
}

export function composeGlobalNavigation(input: {
  capacity: number
  contextualCount: number
  back: ViewChoice | null
}): GlobalNavigationPlan {
  const remaining = input.capacity - input.contextualCount
  if (input.back) {
    if (remaining >= 3) {
      return { directChoices: [input.back, HOME_CHOICE, HUMAN_CHOICE], backInsideMenu: false }
    }
    if (remaining >= 1) {
      return { directChoices: [NAVIGATION_MENU_CHOICE], backInsideMenu: true }
    }
    return { directChoices: [], backInsideMenu: true }
  }
  if (remaining >= 2) {
    return { directChoices: [HOME_CHOICE, HUMAN_CHOICE], backInsideMenu: false }
  }
  if (remaining >= 1) {
    return { directChoices: [NAVIGATION_MENU_CHOICE], backInsideMenu: false }
  }
  return { directChoices: [], backInsideMenu: false }
}
