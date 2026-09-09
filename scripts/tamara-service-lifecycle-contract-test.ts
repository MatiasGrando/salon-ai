import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const gateway = readFileSync(new URL('../src/services/tamara-options-bot-gateway.ts', import.meta.url), 'utf8')
const catalogStart = gateway.indexOf('async getCategories')
const catalogEnd = gateway.indexOf('async getAvailableDates', catalogStart)
const catalogMethods = gateway.slice(catalogStart, catalogEnd)
const activeServiceFilters = catalogMethods.match(/isBookable: true,\s*isActive: true,\s*attentionMode: 'DIRECT_BOOKING'/g) ?? []
assert.equal(activeServiceFilters.length, 2, 'Tamara debe filtrar servicios inactivos tanto al listar categorías como servicios')
console.log('Tamara service lifecycle contract: OK')
