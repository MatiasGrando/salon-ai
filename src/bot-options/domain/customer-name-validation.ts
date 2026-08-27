/**
 * F6.2 — Validación pura de nombres Unicode para el motor determinístico.
 *
 * Reglas canónicas (reglas-funcionales.md §3):
 * - Normalizar a Unicode NFC sin transliterar ni quitar acentos.
 * - Evaluar 2–80 code points Unicode después de trim y colapso de espacios.
 * - Aceptar: letras de todos los alfabetos, marcas combinadas vinculadas a letras,
 *   espacios ASCII, apóstrofes rectos o tipográficos, guiones y puntos.
 * - Rechazar: dígitos, emoji, símbolos, URLs, emails, caracteres de control,
 *   saltos de línea, valores compuestos solo de puntuación, puntuación repetida
 *   sospechosa.
 * - Conservar mayúsculas y minúsculas; el sistema no aplica formato título.
 *
 * Este módulo es puro: no importa Prisma, Fastify, Meta ni relojes.
 * Devuelve el valor normalizado aceptado, no un booleano.
 */

export type CustomerNameValidationOk = {
  ok: true
  /** Nombre normalizado: NFC, trim, espacios colapsados. */
  normalized: string
}

export type CustomerNameValidationReject = {
  ok: false
  /** Razón legible del rechazo. */
  reason: string
}

export type CustomerNameValidationResult = CustomerNameValidationOk | CustomerNameValidationReject

// ─── Constantes ───────────────────────────────────────────────────────────────

const MIN_CODE_POINTS = 2
const MAX_CODE_POINTS = 80

/**
 * Caracteres Unicode permitidos en un nombre de cliente.
 *
 * Letras (\p{L}): todas las scripts —latino, cirílico, árabe, CJK, etc.
 * Marcas combinadas (\p{M}): acentos, tildes, virgulilla, etc.
 * Espacio: exclusivamente U+0020; tabs, saltos y separadores Unicode no se
 * reinterpretan como espacio.
 *
 * Puntuación permitida explícita (fuera de \p{L}\p{M}):
 * - U+0027, U+2018, U+2019 (apóstrofes recto y tipográficos)
 * - U+002D y U+2010–U+2015 (guiones)
 * - . (punto)
 *
 * NOTA: Usamos ranges Unicode explicitados porque \p{L} en regex nativo de
 * JS soporta Unicode Property Escapes desde ES2018 (Node 10+).
 */
const ALLOWED_NAME_CHARACTER = /^[\p{L}\p{M} '\u2018\u2019\u002D\u2010\u2011\u2012\u2013\u2014\u2015.]+$/u

/** Patrones que indican que el valor no es un nombre válido. */
const DIGIT_PATTERN = /\p{N}/u
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/
const URL_PATTERN = /https?:\/\/|www\./i
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/
// Puntuación repetida sospechosa: 3+ del mismo carácter consecutivo
const SUSPICIOUS_REPEATED_PUNCTUATION = /([\u2019\u2018\u0027\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u002E])\1{2,}/u

// Todo valor aceptado debe contener al menos una letra.
const LETTER_PATTERN = /\p{L}/u

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Valida y normaliza un nombre de cliente según las reglas F6.2.
 *
 * Flujo:
 * 1. Rechazo inmediato de vacío.
 * 2. Normalización NFC.
 * 3. Recorte y colapso exclusivo de espacios U+0020.
 * 4. Validación de longitud (2–80 code points).
 * 5. Rechazo de caracteres no permitidos (dígitos, control, URL, email, emoji).
 * 6. Rechazo de valores compuestos solo de puntuación.
 * 7. Rechazo de marcas sin letra base.
 * 8. Rechazo de puntuación repetida sospechosa.
 * 9. Aceptación con valor normalizado.
 */
export function validateCustomerName(raw: string): CustomerNameValidationResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'El nombre debe ser texto.' }
  }

  // 1. Normalización NFC (preserva acentos, ñ, etc.). Los controles y formatos
  // se rechazan ANTES de cualquier colapso para que tab/newline/ZWJ/ZWNJ/soft
  // hyphen nunca puedan convertirse o desaparecer durante la normalización.
  const nfc = raw.normalize('NFC')
  if (LINE_BREAK_PATTERN.test(nfc)) {
    return { ok: false, reason: 'El nombre no puede contener saltos de línea.' }
  }
  if (CONTROL_OR_FORMAT_PATTERN.test(nfc)) {
    return { ok: false, reason: 'El nombre contiene caracteres no permitidos.' }
  }

  // 2. Sólo U+0020 se recorta y colapsa. Cualquier otro separador Unicode queda
  // visible para la allowlist y se rechaza; no reinterpretamos whitespace.
  const collapsed = nfc.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')

  // 3. Longitud
  if (collapsed.length === 0) {
    return { ok: false, reason: 'El nombre no puede estar vacío.' }
  }

  // Conteo por code points (no por surrogate pairs)
  const codePoints = [...collapsed]
  if (codePoints.length < MIN_CODE_POINTS) {
    return { ok: false, reason: `El nombre debe tener al menos ${MIN_CODE_POINTS} caracteres.` }
  }
  if (codePoints.length > MAX_CODE_POINTS) {
    return { ok: false, reason: `El nombre no puede superar los ${MAX_CODE_POINTS} caracteres.` }
  }

  // 4. Rechazo de URLs y emails
  if (URL_PATTERN.test(collapsed)) {
    return { ok: false, reason: 'El nombre no puede contener direcciones web.' }
  }
  if (EMAIL_PATTERN.test(collapsed)) {
    return { ok: false, reason: 'El nombre no puede contener direcciones de correo.' }
  }

  // 5. Rechazo de dígitos
  if (DIGIT_PATTERN.test(collapsed)) {
    return { ok: false, reason: 'El nombre no puede contener números.' }
  }

  // 6. Rechazo de emoji y símbolos (allowlist positiva)
  //    Permitimos solo chars del regex ALLOWED_NAME_CHARACTER; todo lo demás se rechaza.
  if (!ALLOWED_NAME_CHARACTER.test(collapsed)) {
    return { ok: false, reason: 'El nombre contiene caracteres no permitidos.' }
  }

  // 7. Rechazo de valores sin letras.
  if (!LETTER_PATTERN.test(collapsed)) {
    return { ok: false, reason: 'El nombre debe contener al menos una letra.' }
  }

  // 8. Toda marca debe pertenecer a una secuencia iniciada por una letra. Esto
  // acepta varias marcas sobre la misma base, pero no marcas iniciales/sueltas.
  let markHasLetterBase = false
  for (const codePoint of collapsed) {
    if (/\p{L}/u.test(codePoint)) {
      markHasLetterBase = true
    } else if (/\p{M}/u.test(codePoint)) {
      if (!markHasLetterBase) {
        return { ok: false, reason: 'El nombre contiene una marca Unicode sin letra base.' }
      }
    } else {
      markHasLetterBase = false
    }
  }

  // 9. Rechazo de puntuación repetida sospechosa (3+ consecutivos del mismo tipo)
  if (SUSPICIOUS_REPEATED_PUNCTUATION.test(collapsed)) {
    return { ok: false, reason: 'El nombre contiene puntuación repetida sospechosa.' }
  }

  return { ok: true, normalized: collapsed }
}
