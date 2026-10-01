/** Safe provider failure metadata only; never retain response bodies or exception messages. */
export type ProviderFailure = {
  code: 'http' | 'transport' | 'timeout' | 'incomplete' | 'refusal' | 'json' | 'shape'
  httpStatus: number | null
  requestId: string | null
}
export class ProviderDiagnosticError extends Error {
  constructor(readonly diagnostic: ProviderFailure) {
    super('AI provider failed')
    this.name = 'ProviderDiagnosticError'
  }
}
export function safeRequestId(headers: Headers): string | null {
  const value = headers.get('x-request-id')
  return value && /^req[-_][A-Za-z0-9_-]{4,94}$/.test(value) ? value : null
}
export function providerFailure(error: unknown): ProviderFailure {
  return error instanceof ProviderDiagnosticError ? error.diagnostic
    : { code: 'transport', httpStatus: null, requestId: null }
}
export function providerError(code: ProviderFailure['code'], response?: Response): ProviderDiagnosticError {
  return new ProviderDiagnosticError({
    code,
    httpStatus: response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status : null,
    requestId: response ? safeRequestId(response.headers) : null
  })
}
