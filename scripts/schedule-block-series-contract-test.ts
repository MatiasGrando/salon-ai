import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAX_SCHEDULE_BLOCK_SERIES_DAYS,
  validateScheduleBlockSeriesOccurrences
} from '../src/services/schedule-block-series.js'

assert.equal(MAX_SCHEDULE_BLOCK_SERIES_DAYS, 14, 'la serie debe estar limitada a 14 dias')

const dailyOccurrences = Array.from({ length: 14 }, (_, index) => ({
  startAt: new Date(Date.UTC(2026, 8, 1 + index, 13)).toISOString(),
  endAt: new Date(Date.UTC(2026, 8, 1 + index, 14)).toISOString()
}))

assert.equal(
  validateScheduleBlockSeriesOccurrences(dailyOccurrences).length,
  14,
  'debe aceptar hasta 14 ocurrencias dentro de dos semanas'
)

assert.throws(
  () => validateScheduleBlockSeriesOccurrences([...dailyOccurrences, {
    startAt: new Date(Date.UTC(2026, 8, 15, 13)).toISOString(),
    endAt: new Date(Date.UTC(2026, 8, 15, 14)).toISOString()
  }]),
  /14 bloqueos/,
  'debe rechazar una ocurrencia numero 15'
)

assert.throws(
  () => validateScheduleBlockSeriesOccurrences([
    dailyOccurrences[0]!,
    {
      startAt: new Date(Date.UTC(2026, 8, 15, 13)).toISOString(),
      endAt: new Date(Date.UTC(2026, 8, 15, 14)).toISOString()
    }
  ]),
  /14 dias/,
  'debe rechazar series cuyo periodo supera 14 dias calendario'
)

assert.throws(
  () => validateScheduleBlockSeriesOccurrences([
    dailyOccurrences[0]!,
    {
      startAt: new Date(Date.UTC(2026, 8, 2, 13)).toISOString(),
      endAt: new Date(Date.UTC(2026, 8, 2, 15)).toISOString()
    }
  ]),
  /misma duracion/,
  'todas las ocurrencias deben conservar la duracion original'
)

const routeSource = await readFile(new URL('../src/routes/schedule-block.ts', import.meta.url), 'utf8')
const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const schemaSource = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

assert.match(routeSource, /post\('\/schedule-blocks\/series'/, 'debe existir una operacion atomica para crear la serie')
assert.match(routeSource, /validateScheduleBlockSeriesOccurrences/, 'el servidor debe validar siempre el limite')
assert.match(routeSource, /randomUUID\(\)/, 'las ocurrencias deben compartir un identificador de serie')
assert.match(schemaSource, /seriesId\s+String\?/, 'ScheduleBlock debe poder agrupar ocurrencias de una serie')

assert.match(crmUiSource, /id="block-repeat"/, 'el formulario debe permitir activar la repeticion')
assert.match(crmUiSource, /id="block-repeat-until"/, 'el formulario debe limitar la fecha final')
assert.match(crmUiSource, /data-block-repeat-day/, 'el formulario debe permitir elegir dias de la semana')
assert.match(crmUiSource, /MAX_BLOCK_REPEAT_DAYS\s*=\s*14/, 'la interfaz debe reflejar el limite de servidor')
assert.match(crmUiSource, /\/schedule-blocks\/series/, 'la interfaz debe crear toda la serie en una sola peticion')

console.log('OK: los bloqueos repetidos son atomicos, finitos y estan limitados a 14 dias.')
