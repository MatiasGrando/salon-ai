import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = [
  new URL('../src', import.meta.url),
  new URL('../scripts', import.meta.url)
]
const migrationRoot = new URL('../prisma/migrations', import.meta.url)
const suspiciousTokens = [
  String.fromCharCode(0xc3),
  String.fromCharCode(0xc2),
  String.fromCharCode(0xe2, 0x20ac)
]
const violations: string[] = []

function inspectDirectory(directory: string) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      inspectDirectory(path)
      continue
    }
    if (!path.endsWith('.ts')) continue
    const source = readFileSync(path, 'utf8')
    const lines = source.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (suspiciousTokens.some((token) => line.includes(token))) {
        violations.push(`${path}:${index + 1}`)
      }
    })
  }
}

for (const root of roots) inspectDirectory(root.pathname.replace(/^\/(.:)/, '$1'))

inspectMigrationFiles(migrationRoot.pathname.replace(/^\/(.:)/, '$1'))

assert.deepEqual(
  violations,
  [],
  `Se encontraron textos con codificación corrupta:\n${violations.join('\n')}`
)

console.log('Text encoding contract: OK (fuentes UTF-8 sin secuencias corruptas)')

function inspectMigrationFiles(directory: string) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      inspectMigrationFiles(path)
      continue
    }
    if (!path.endsWith('migration.sql')) continue
    const bytes = readFileSync(path)
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      violations.push(`${path}:1 (UTF-8 BOM)`)
    }
  }
}
