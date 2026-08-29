/** Validates the only disposable database target permitted to mutating F10 contracts. */
export function resolveF10PgContractDatabase(label: string): string {
  const url = process.env.F10_PG_CONTRACT_DATABASE_URL
  if (!url) throw new Error(`Refusing ${label}: F10_PG_CONTRACT_DATABASE_URL is required`)
  assertF10PgContractDatabaseUrl(url, label)
  process.env.DATABASE_URL = url
  return url
}

/** Pure boundary check; contract callers must never infer a safe database. */
export function assertF10PgContractDatabaseUrl(url: string, label: string): void {
  const parsed = new URL(url)
  const allowedDatabase = /^\/salon_ai_f10_[a-z0-9_]+$/.test(parsed.pathname)
  if (parsed.protocol !== 'postgresql:' || parsed.username !== 'postgres' || parsed.password !== 'postgres'
    || parsed.hostname !== '127.0.0.1' || parsed.port !== '54322' || !allowedDatabase || parsed.search || parsed.hash) {
    throw new Error(`Refusing unsafe ${label} database`)
  }
}
