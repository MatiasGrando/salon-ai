import type { MeasurementMode } from './types.js'

export function measurePayloadBytes(payload: unknown, method: string, statusCode: number): { bytes: number | null; mode: MeasurementMode } {
  if (method === 'HEAD' || statusCode === 204 || statusCode === 304 || payload === null) return { bytes: 0, mode: 'zero_semantic' }
  if (typeof payload === 'string') return { bytes: Buffer.byteLength(payload), mode: 'serialized_string' }
  if (Buffer.isBuffer(payload)) return { bytes: payload.length, mode: 'buffer' }
  if (payload instanceof Uint8Array) return { bytes: payload.byteLength, mode: 'typed_array' }
  return { bytes: null, mode: 'unknown' }
}
