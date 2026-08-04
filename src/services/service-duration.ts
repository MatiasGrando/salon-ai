export type ServiceDurationInput = {
  duration: number
  customerDurationMin?: number | null
  customerDurationMax?: number | null
}

export function customerDurationRange(service: ServiceDurationInput) {
  const min = positiveInteger(service.customerDurationMin) ?? service.duration
  const max = positiveInteger(service.customerDurationMax) ?? min
  return {
    min,
    max: Math.max(min, max),
    differsFromAgenda: min !== service.duration || max !== service.duration
  }
}

export function formatCustomerDuration(service: ServiceDurationInput) {
  const range = customerDurationRange(service)
  return range.min === range.max
    ? `${range.min} min`
    : `${range.min} a ${range.max} min`
}

export function normalizeCustomerDuration(
  minValue?: number | string | null,
  maxValue?: number | string | null
):
  | { ok: true; min: number | null; max: number | null }
  | { ok: false; message: string } {
  const min = normalizeNullableNumber(minValue)
  const rawMax = normalizeNullableNumber(maxValue)
  if (min === null && rawMax === null) return { ok: true, min: null, max: null }
  if (min === null || !Number.isInteger(min) || min <= 0) {
    return { ok: false, message: 'La duración informada al cliente debe ser un entero mayor a 0' }
  }
  const max = rawMax === null ? min : rawMax
  if (!Number.isInteger(max) || max <= 0) {
    return { ok: false, message: 'La duración máxima informada al cliente debe ser un entero mayor a 0' }
  }
  if (max < min) {
    return { ok: false, message: 'La duración máxima no puede ser menor que la mínima' }
  }
  return { ok: true, min, max }
}

function positiveInteger(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function normalizeNullableNumber(value?: number | string | null) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
