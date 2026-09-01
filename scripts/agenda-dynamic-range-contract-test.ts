import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

function extractFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `debe existir ${name}`)
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`no se pudo extraer ${name}`)
}

const calculateAgendaDisplayRangeSource = extractFunction(crmUiSource, 'calculateAgendaDisplayRange')
const calculateAgendaDisplayRange = new Function(`return (${calculateAgendaDisplayRangeSource})`)() as (input: {
  visibleDays: Date[]
  businessHours: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
  appointments: Array<{ startAt: string; totalDurationMinutes?: number; service?: { duration?: number }; status?: string }>
}) => { start: number; end: number }

const monday = new Date(2026, 7, 31)
const tuesday = new Date(2026, 8, 1)

assert.deepEqual(calculateAgendaDisplayRange({
  visibleDays: [tuesday],
  businessHours: [
    { dayOfWeek: 1, startTime: '07:00', endTime: '22:00' },
    { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' }
  ],
  appointments: []
}), { start: 8 * 60, end: 19 * 60 }, 'debe usar solamente los horarios de los dias visibles y agregar una hora')

assert.deepEqual(calculateAgendaDisplayRange({
  visibleDays: [monday, tuesday],
  businessHours: [
    { dayOfWeek: 1, startTime: '08:30', endTime: '17:30' },
    { dayOfWeek: 2, startTime: '10:00', endTime: '20:15' }
  ],
  appointments: []
}), { start: 7 * 60, end: 22 * 60 }, 'debe crear un eje comun y redondear el margen hacia afuera')

assert.deepEqual(calculateAgendaDisplayRange({
  visibleDays: [tuesday],
  businessHours: [{ dayOfWeek: 2, startTime: '09:00', endTime: '18:00' }],
  appointments: [
    { startAt: new Date(2026, 8, 1, 6, 30).toISOString(), totalDurationMinutes: 30 },
    { startAt: new Date(2026, 8, 1, 19, 15).toISOString(), service: { duration: 60 } }
  ]
}), { start: 6 * 60, end: 21 * 60 }, 'debe ampliar el rango antes de renderizar para incluir turnos excepcionales completos')

assert.deepEqual(calculateAgendaDisplayRange({
  visibleDays: [tuesday],
  businessHours: [{ dayOfWeek: 2, startTime: '00:30', endTime: '23:30' }],
  appointments: []
}), { start: 0, end: 24 * 60 }, 'debe limitar el margen al inicio y fin del dia')

assert.deepEqual(calculateAgendaDisplayRange({
  visibleDays: [tuesday],
  businessHours: [],
  appointments: []
}), { start: 8 * 60, end: 20 * 60 }, 'debe conservar un rango util cuando no hay horarios configurados')

assert.match(crmUiSource, /--agenda-visible-hours:/, 'el alto del calendario debe depender del rango calculado')
assert.match(crmUiSource, /visibleStartMinute - displayRange\.start/, 'los turnos deben posicionarse desde el origen visible')
assert.match(crmUiSource, /agendaMobileScrollMinute = displayRange\.start/, 'el scroll debe conservar la hora y no un pixel absoluto al cambiar el rango')
assert.doesNotMatch(crmUiSource, /Array\.from\(\{ length: 24 \}/, 'el renderer activo no debe generar siempre 24 etiquetas')
assert.doesNotMatch(crmUiSource, /Array\.from\(\{ length: 48 \}/, 'el renderer activo no debe generar siempre 48 slots')

console.log('OK: el rango de agenda usa horarios visibles y se expande para incluir turnos excepcionales.')
