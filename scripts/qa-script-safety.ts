const APPROVED_QA_DATABASE = {
  protocol: 'postgresql:',
  hostname: '127.0.0.1',
  port: '54322',
  pathname: '/salon_ai_test'
} as const

type QaScriptEnvironment = Record<string, string | undefined>

export function resolveQaScriptEnvironment(environment: QaScriptEnvironment) {
  const databaseUrl = environment.TEST_DATABASE_URL?.trim()
  const businessId = environment.QA_BUSINESS_ID?.trim()
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL es requerido para ejecutar un script QA destructivo.')
  if (!businessId) throw new Error('QA_BUSINESS_ID es requerido para ejecutar un script QA destructivo.')

  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL válida.')
  }
  for (const [field, expected] of Object.entries(APPROVED_QA_DATABASE)) {
    if (parsed[field as keyof URL] !== expected) {
      throw new Error('El script QA solo puede usar la base local aprobada salon_ai_test.')
    }
  }

  const activeDatabaseUrl = environment.DATABASE_URL?.trim()
  if (activeDatabaseUrl && activeDatabaseUrl !== databaseUrl) {
    throw new Error('DATABASE_URL apunta a otra base. El script QA se cancela antes de conectar.')
  }

  return { databaseUrl, businessId }
}
