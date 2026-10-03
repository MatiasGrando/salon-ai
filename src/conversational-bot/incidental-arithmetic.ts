/** A standalone, single binary integer calculation; never alters booking state or trusts a model number. */
export type IncidentalCalculation = {
  left: number
  operator: '+' | '-' | '*' | '/'
  right: number
  result: number
  text: string
}

const expression = /^(?:¿\s*)?(?:(?:y\s+)|(?:(?:(?:decime|dime)\s+)?cuanto\s+(?:es|da)\s+)|(?:calcula\s+))?(-?\d{1,6})\s*(\+|-|\*|\/|x|×|÷|mas|menos|por|dividido\s+por)\s*(-?\d{1,6})\s*[?!.]?$/u
const canonicalOperator = (value: string): IncidentalCalculation['operator'] => {
  if (value === 'x' || value === '×' || value === 'por') return '*'
  if (value === '÷' || value === 'dividido por') return '/'
  if (value === 'mas') return '+'
  if (value === 'menos') return '-'
  return value as IncidentalCalculation['operator']
}

/** Parse only an isolated arithmetic utterance. The caller decides whether side topics are allowed. */
export function parseIncidentalArithmetic(message: string): IncidentalCalculation | null {
  if (typeof message !== 'string' || message.length > 100) return null
  const normalized = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/gu, ' ')
  const match = expression.exec(normalized)
  if (!match) return null
  const left = Number(match[1]), right = Number(match[3])
  const operator = canonicalOperator(match[2]!)
  const result = operator === '+' ? left + right : operator === '-' ? left - right
    : operator === '*' ? left * right : right === 0 ? NaN : left / right
  if (!Number.isSafeInteger(result)) return null
  return { left, operator, right, result, text: `${left} ${operator} ${right} es ${result}.` }
}
