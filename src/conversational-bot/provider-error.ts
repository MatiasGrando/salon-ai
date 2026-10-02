import { sanitizeResponseFormat, type ResponseFormatFailure } from './responses-json.js'

/** Safe provider failure metadata only; never retain response bodies or exception messages. */
export type ProviderFailure = {
  code: 'http' | 'transport' | 'timeout' | 'incomplete' | 'refusal' | 'json' | 'shape'
  httpStatus: number | null
  requestId: string | null
  responseFormat?: ResponseFormatFailure
}
const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
const safeId = (value: unknown): string | null =>
  typeof value === 'string' && /^req[-_][A-Za-z0-9_-]{4,94}$/.test(value) ? value : null
function sanitizeFailure(value: unknown): ProviderFailure {
  const code = field(value, 'code')
  const httpStatus = field(value, 'httpStatus')
  const responseFormat = sanitizeResponseFormat(field(value, 'responseFormat'))
  return {
    code: ['http', 'transport', 'timeout', 'incomplete', 'refusal', 'json', 'shape'].includes(code as string) ? code as ProviderFailure['code'] : 'transport',
    httpStatus: typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    requestId: safeId(field(value, 'requestId')),
    ...(responseFormat ? { responseFormat } : {})
  }
}
export class ProviderDiagnosticError extends Error {
  readonly diagnostic: ProviderFailure
  constructor(diagnostic: ProviderFailure) {
    super('AI provider failed')
    this.name = 'ProviderDiagnosticError'
    this.diagnostic = sanitizeFailure(diagnostic)
  }
}
export function safeRequestId(headers: Headers): string | null {
  return safeId(headers.get('x-request-id'))
}
export function providerFailure(error: unknown): ProviderFailure {
  return error instanceof ProviderDiagnosticError ? sanitizeFailure(error.diagnostic)
    : { code: 'transport', httpStatus: null, requestId: null }
}
export function providerError(code: ProviderFailure['code'], response?: Response, responseFormat?: ResponseFormatFailure): ProviderDiagnosticError {
  return new ProviderDiagnosticError({
    code,
    httpStatus: response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status : null,
    requestId: response ? safeRequestId(response.headers) : null,
    ...(responseFormat ? { responseFormat } : {})
  })
}
