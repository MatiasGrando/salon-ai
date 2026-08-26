/**
 * F4.5 — Identidad opaca de prompts y opciones para WhatsApp.
 *
 * Formato de transporte (diseno-tecnico.md §5):
 *
 *   b1.<promptToken>.<choiceToken>
 *
 * - promptToken: 16 caracteres base64url (96 bits aleatorios).
 * - choiceToken: 11 caracteres base64url (64 bits aleatorios), único por prompt.
 * - Longitud total normal: 31 bytes ASCII, muy por debajo del presupuesto
 *   interno de 64 bytes y de los límites conservadores de Meta para IDs.
 * - El token NO contiene IDs de cliente, turno, servicio ni estado: no revela
 *   PII y su validez se resuelve por lookup tenant-scoped contra BotPrompt /
 *   BotPromptChoice, nunca decodificando contenido.
 */

import { randomBytes as defaultRandomBytes } from 'node:crypto'

export const ACTION_ID_PREFIX = 'b1'
export const PROMPT_TOKEN_LENGTH = 16
export const CHOICE_TOKEN_LENGTH = 11
/** Presupuesto interno máximo para el ID completo enviado al proveedor. */
export const MAX_ACTION_ID_BYTES = 64

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/

export type RandomBytesFn = (size: number) => Uint8Array

function toBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64url')
    : btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return encoded
}

/** Genera el token del prompt: 96 bits → 16 caracteres base64url sin padding. */
export function generatePromptToken(randomBytes: RandomBytesFn = defaultRandomBytes): string {
  const token = toBase64url(randomBytes(12))
  if (!isValidPromptToken(token)) throw new Error('El generador produjo un token de prompt inválido')
  return token
}

/** Genera el token de una opción: 64 bits → 11 caracteres base64url sin padding. */
export function generateChoiceToken(randomBytes: RandomBytesFn = defaultRandomBytes): string {
  const token = toBase64url(randomBytes(8))
  if (!isValidChoiceToken(token)) throw new Error('El generador produjo un token de opción inválido')
  return token
}

export function isValidPromptToken(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length === PROMPT_TOKEN_LENGTH &&
    BASE64URL_ALPHABET.test(value)
}

export function isValidChoiceToken(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length === CHOICE_TOKEN_LENGTH &&
    BASE64URL_ALPHABET.test(value)
}

/** Compone el ID interactivo completo; falla si excede el presupuesto interno. */
export function buildInteractiveActionId(promptToken: string, choiceToken: string): string {
  if (!isValidPromptToken(promptToken)) throw new Error('promptToken inválido')
  if (!isValidChoiceToken(choiceToken)) throw new Error('choiceToken inválido')
  const id = `${ACTION_ID_PREFIX}.${promptToken}.${choiceToken}`
  if (Buffer.byteLength(id, 'ascii') > MAX_ACTION_ID_BYTES) {
    throw new Error('El ID interactivo supera el presupuesto interno de bytes')
  }
  return id
}

export type ParsedInteractiveActionId = {
  ok: true
  prefix: typeof ACTION_ID_PREFIX
  promptToken: string
  choiceToken: string
}

export type RejectedInteractiveActionId = {
  ok: false
}

/** Parseo estricto: prefijo, longitudes exactas y alfabeto base64url. */
export function parseInteractiveActionId(value: unknown): ParsedInteractiveActionId | RejectedInteractiveActionId {
  if (typeof value !== 'string') return { ok: false }
  const parts = value.split('.')
  if (parts.length !== 3) return { ok: false }
  const [prefix, promptToken, choiceToken] = parts as [string, string, string]
  if (prefix !== ACTION_ID_PREFIX) return { ok: false }
  if (!isValidPromptToken(promptToken)) return { ok: false }
  if (!isValidChoiceToken(choiceToken)) return { ok: false }
  return { ok: true, prefix, promptToken, choiceToken }
}
