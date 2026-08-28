/** Validates the only disposable database target permitted to mutating F7/F8 contracts. */
export function resolveF8PgContractDatabase(label: string): string {
  const url = process.env.F8_PG_CONTRACT_DATABASE_URL
  if (!url) throw new Error(`Refusing ${label}: F8_PG_CONTRACT_DATABASE_URL is required`)
  assertF8PgContractDatabaseUrl(url, label)
  process.env.DATABASE_URL = url
  return url
}

/** Pure so the URL boundary can be tested without connecting to PostgreSQL. */
export function assertF8PgContractDatabaseUrl(url: string, label: string): void {
  const parsed = new URL(url)
  const allowedDatabase = /^\/salon_ai_f8_baseline_[a-z0-9_]+$/.test(parsed.pathname)

  if (
    parsed.protocol !== 'postgresql:'
    || parsed.username !== 'postgres'
    || parsed.password !== 'postgres'
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== '54322'
    || !allowedDatabase
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`Refusing unsafe ${label} database`)
  }
}
