import 'dotenv/config'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

type NumericValue = string | number | null

type StatementSnapshot = {
  queryId: string
  calls: number
  rows: number
  totalExecMs: number
  sharedBlocksHit: number
  sharedBlocksRead: number
  tempBlocksRead: number
  tempBlocksWritten: number
  query: string
}

type DatabaseCounters = Record<string, number>

type UsageSnapshot = {
  capturedAt: string
  label: string
  database: string
  statsResetAt: string | null
  supabaseCycleEgressGb: number | null
  databaseCounters: DatabaseCounters
  statements: StatementSnapshot[]
}

type StatementDelta = StatementSnapshot & {
  callsDelta: number
  rowsDelta: number
  totalExecMsDelta: number
  sharedBlocksHitDelta: number
  sharedBlocksReadDelta: number
  tempBlocksReadDelta: number
  tempBlocksWrittenDelta: number
}

const outputDirectory = resolve('measurements/database-usage')
const connectionString = process.env.DATABASE_URL

if (!connectionString) throw new Error('DATABASE_URL no está configurada')

const args = process.argv.slice(2)
const label = argumentValue('--label') ?? localDateLabel(new Date())
const egressInput = argumentValue('--egress-gb')
const supabaseCycleEgressGb = egressInput === undefined ? null : Number(egressInput)

if (egressInput !== undefined && (!Number.isFinite(supabaseCycleEgressGb) || supabaseCycleEgressGb! < 0)) {
  throw new Error('--egress-gb debe ser un número mayor o igual a cero')
}

await mkdir(outputDirectory, { recursive: true })

const previousPath = await latestSnapshotPath()
const client = new pg.Client({ connectionString, statement_timeout: 20_000 })

await client.connect()
try {
  const identityResult = await client.query<{ database: string }>('SELECT current_database() AS database')
  const resetResult = await client.query<{ stats_reset: Date | null }>(
    'SELECT stats_reset FROM pg_stat_statements_info'
  )
  const countersResult = await client.query<Record<string, NumericValue>>(`
      SELECT
        xact_commit,
        xact_rollback,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted,
        temp_files,
        temp_bytes
      FROM pg_stat_database
      WHERE datname = current_database()
    `)
  const statementsResult = await client.query<Record<string, NumericValue>>(`
      SELECT
        queryid::text AS query_id,
        calls,
        rows,
        total_exec_time,
        shared_blks_hit,
        shared_blks_read,
        temp_blks_read,
        temp_blks_written,
        LEFT(REGEXP_REPLACE(query, E'[\\n\\r\\t ]+', ' ', 'g'), 1200) AS query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY rows DESC
      LIMIT 2000
    `)

  const snapshot: UsageSnapshot = {
    capturedAt: new Date().toISOString(),
    label,
    database: identityResult.rows[0]?.database ?? 'unknown',
    statsResetAt: resetResult.rows[0]?.stats_reset?.toISOString() ?? null,
    supabaseCycleEgressGb,
    databaseCounters: numericRecord(countersResult.rows[0] ?? {}),
    statements: statementsResult.rows.map((row) => ({
      queryId: String(row.query_id),
      calls: numeric(row.calls),
      rows: numeric(row.rows),
      totalExecMs: numeric(row.total_exec_time),
      sharedBlocksHit: numeric(row.shared_blks_hit),
      sharedBlocksRead: numeric(row.shared_blks_read),
      tempBlocksRead: numeric(row.temp_blks_read),
      tempBlocksWritten: numeric(row.temp_blks_written),
      query: String(row.query ?? '')
    }))
  }

  const stamp = snapshot.capturedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const baseName = `${stamp}_${safeLabel(label)}`
  const snapshotPath = resolve(outputDirectory, `${baseName}.json`)
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

  console.log(`Medición guardada: ${snapshotPath}`)

  if (!previousPath) {
    console.log('Línea de base creada. Repetí el comando mañana para generar la comparación.')
  } else {
    const previous = JSON.parse(await readFile(previousPath, 'utf8')) as UsageSnapshot
    const report = buildReport(previous, snapshot)
    const reportPath = resolve(outputDirectory, `${baseName}.md`)
    await writeFile(reportPath, report, 'utf8')
    console.log(`Comparación guardada: ${reportPath}`)
    console.log(report)
  }
} finally {
  await client.end()
}

function argumentValue(name: string) {
  const inline = args.find((value) => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1]?.trim() : undefined
}

async function latestSnapshotPath() {
  const files = (await readdir(outputDirectory))
    .filter((file) => file.endsWith('.json'))
    .sort()
  return files.length ? resolve(outputDirectory, files[files.length - 1]!) : null
}

function numeric(value: NumericValue | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function numericRecord(row: Record<string, NumericValue>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numeric(value)]))
}

function buildReport(previous: UsageSnapshot, current: UsageSnapshot) {
  const previousStatements = new Map(previous.statements.map((statement) => [statement.queryId, statement]))
  const resetChanged = previous.statsResetAt !== current.statsResetAt
  const deltas = current.statements.map((statement): StatementDelta => {
    const before = resetChanged ? undefined : previousStatements.get(statement.queryId)
    return {
      ...statement,
      callsDelta: delta(statement.calls, before?.calls),
      rowsDelta: delta(statement.rows, before?.rows),
      totalExecMsDelta: delta(statement.totalExecMs, before?.totalExecMs),
      sharedBlocksHitDelta: delta(statement.sharedBlocksHit, before?.sharedBlocksHit),
      sharedBlocksReadDelta: delta(statement.sharedBlocksRead, before?.sharedBlocksRead),
      tempBlocksReadDelta: delta(statement.tempBlocksRead, before?.tempBlocksRead),
      tempBlocksWrittenDelta: delta(statement.tempBlocksWritten, before?.tempBlocksWritten)
    }
  })
  const busiest = deltas
    .filter((statement) => statement.callsDelta > 0 || statement.rowsDelta > 0)
    .sort((left, right) => right.rowsDelta - left.rowsDelta || right.callsDelta - left.callsDelta)
    .slice(0, 20)
  const counterRows = Object.keys(current.databaseCounters).map((key) => {
    const value = delta(current.databaseCounters[key] ?? 0, resetChanged ? undefined : previous.databaseCounters[key])
    return `| ${key} | ${formatNumber(value)} |`
  })
  const egressDelta = previous.supabaseCycleEgressGb !== null && current.supabaseCycleEgressGb !== null
    ? Math.max(0, current.supabaseCycleEgressGb - previous.supabaseCycleEgressGb)
    : null

  return `# Medición de base de datos\n\n` +
    `- Desde: ${previous.capturedAt} (${previous.label})\n` +
    `- Hasta: ${current.capturedAt} (${current.label})\n` +
    `- Egress de Supabase en el período: ${egressDelta === null ? 'no informado' : `${egressDelta.toFixed(3)} GB`}\n` +
    `- Reinicio de estadísticas detectado: ${resetChanged ? 'sí; los deltas SQL no son comparables' : 'no'}\n\n` +
    `## Contadores de PostgreSQL\n\n| Contador | Diferencia |\n|---|---:|\n${counterRows.join('\n')}\n\n` +
    `## Consultas con más filas devueltas\n\n` +
    (busiest.length
      ? busiest.map((statement, index) =>
          `${index + 1}. **${formatNumber(statement.rowsDelta)} filas** en ${formatNumber(statement.callsDelta)} ejecuciones; ` +
          `${statement.totalExecMsDelta.toFixed(1)} ms acumulados.\n   \`${compactQuery(statement.query)}\``
        ).join('\n\n')
      : 'No hubo actividad SQL nueva en el período.') +
    `\n`
}

function delta(current: number, previous: number | undefined) {
  return Math.max(0, current - (previous ?? 0))
}

function compactQuery(query: string) {
  const compact = query.replace(/`/g, "'").replace(/\s+/g, ' ').trim()
  return compact.length > 360 ? `${compact.slice(0, 357)}...` : compact
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)
}

function localDateLabel(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function safeLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'snapshot'
}
