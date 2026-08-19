export type ConfirmationIntent = 'confirm' | 'reject' | 'uncertain'

export type DeterministicConfirmation = {
  intent: ConfirmationIntent
  confidence: number
}

export function detectDeterministicConfirmation(message: string): DeterministicConfirmation | null {
  const normalized = normalizeConfirmationMessage(message)
  if (!normalized || /\bsi no\b/.test(normalized)) return null

  if (/\b(?:no se|no estoy seguro|tengo dudas|cual recomendas|que recomendas|necesito asesoramiento)\b/.test(normalized)) {
    return { intent: 'uncertain', confidence: 0.98 }
  }

  if (/^(?:no|nop|mejor no|no quiero|no sigamos|no continuemos|cambiemos|quiero otro|prefiero otro)\b/.test(normalized)) {
    return { intent: 'reject', confidence: 0.98 }
  }

  const tokens = new Set(normalized.split(' ').filter(Boolean))
  const affirmativeTokens = [
    'si', 'dale', 'claro', 'ok', 'okay', 'perfecto', 'confirmo', 'confirmado',
    'avancemos', 'sigamos', 'seguimos', 'continuemos', 'continuar', 'mandale',
    'hagamoslo', 'reservemoslo', 'reservar', 'obvio', 'porsupuesto'
  ]
  const affirmativePhrases = [
    'de una', 'me parece bien', 'me sirve', 'esta bien', 'quedamos asi',
    'quiero seguir', 'quiero continuar', 'quiero reservar', 'seguir con ese',
    'continuar con ese', 'por supuesto'
  ]
  if (
    affirmativeTokens.some((token) => tokens.has(token)) ||
    affirmativePhrases.some((phrase) => normalized.includes(phrase))
  ) {
    return { intent: 'confirm', confidence: 0.98 }
  }

  return null
}

function normalizeConfirmationMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
