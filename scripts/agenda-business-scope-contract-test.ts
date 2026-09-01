import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const appointmentRouteSource = await readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
const scheduleBlockRouteSource = await readFile(new URL('../src/routes/schedule-block.ts', import.meta.url), 'utf8')

function extractFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `debe existir ${name}`)
  const signatureEnd = source.indexOf(') {', start)
  assert.notEqual(signatureEnd, -1, `debe encontrarse el cuerpo de ${name}`)
  const bodyStart = signatureEnd + 2
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`no se pudo extraer ${name}`)
}

const loadAgendaSource = extractFunction(crmUiSource, 'loadAgenda')
const staffVisibleSectionsSource = extractFunction(crmUiSource, 'staffVisibleSections')
const setSectionSource = extractFunction(crmUiSource, 'setSection')

assert.match(appointmentRouteSource, /businessId es requerido para consultar turnos/, 'turnos debe fallar cerrado sin negocio')
assert.match(scheduleBlockRouteSource, /businessId es requerido para consultar bloqueos/, 'bloqueos debe fallar cerrado sin negocio')
assert.match(appointmentRouteSource, /requireAuthorizedBusiness\(prisma, authUser, query\.businessId\)/, 'turnos debe validar acceso al negocio')
assert.match(scheduleBlockRouteSource, /requireAuthorizedBusiness\(prisma, authUser, query\.businessId\)/, 'bloqueos debe validar acceso al negocio')

assert.match(loadAgendaSource, /if \(!state\.businessId\)/, 'la interfaz no debe consultar sin negocio')
assert.match(loadAgendaSource, /new AbortController\(\)/, 'cada carga debe poder cancelar la anterior')
assert.match(loadAgendaSource, /Promise\.all\(/, 'turnos y bloqueos deben resolverse antes de actualizar el estado')
assert.match(loadAgendaSource, /state\.businessId !== businessId/, 'una respuesta vieja no debe cruzarse con otro negocio')
assert.match(loadAgendaSource, /requestId !== state\.agendaLoadRequest/, 'una carga anterior no debe sobrescribir una nueva')
assert.match(staffVisibleSectionsSource, /!state\.businessId/, 'la navegacion debe esperar a que exista un negocio')
assert.match(setSectionSource, /section === 'agenda' && !state\.businessId/, 'el acceso rapido a Agenda tambien debe fallar cerrado')

console.log('OK: Agenda exige un negocio autorizado y descarta cargas obsoletas.')
