/** Validates the only disposable database target permitted to mutating F11 contracts. */
export function resolveF11PgContractDatabase(label: string): string {
  const url = process.env.F11_PG_CONTRACT_DATABASE_URL
  if (!url) throw new Error(`Refusing ${label}: F11_PG_CONTRACT_DATABASE_URL is required`)
  assertF11PgContractDatabaseUrl(url, label, process.env.F11_PG_CONTRACT_ALLOWED_PORT)
  process.env.DATABASE_URL = url
  return url
}

export function assertF11PgContractDatabaseUrl(url: string, label: string, allowedPort = '54322'): void {
  const parsed = new URL(url)
  const allowedDatabase = /^\/salon_ai_f11_[a-z0-9_]+$/.test(parsed.pathname)
  const allowedUser = parsed.username === 'postgres' || parsed.username === 'supabase_admin'
  const validAllowedPort = /^\d{2,5}$/.test(allowedPort) && Number(allowedPort) >= 1024 && Number(allowedPort) <= 65535
  if (parsed.protocol !== 'postgresql:' || !allowedUser || parsed.password !== 'postgres'
    || parsed.hostname !== '127.0.0.1' || !validAllowedPort || parsed.port !== allowedPort || !allowedDatabase || parsed.search || parsed.hash) {
    throw new Error(`Refusing unsafe ${label} database`)
  }
}
