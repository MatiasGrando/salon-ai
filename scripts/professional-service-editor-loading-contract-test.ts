import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const crm = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const routes = await readFile(new URL('../src/routes/professional.ts', import.meta.url), 'utf8')

assert.match(
  routes,
  /app\.get\('\/professionals\/:id'[\s\S]*?authorizedProfessionalWhere\(request\.auth!\.user, params\.id\)[\s\S]*?includeImages \? professionalInclude : professionalIncludeWithoutImages/,
  'el editor debe poder pedir el profesional actual con sus asignaciones canónicas'
)

const editStart = crm.indexOf('    async function editProfessional(id, options = {})')
const editEnd = crm.indexOf('\n    async function deleteProfessional', editStart)
assert.notEqual(editStart, -1, 'debe existir editProfessional')
const edit = crm.slice(editStart, editEnd)

assert.match(edit, /professionalEditRequest/, 'debe invalidar respuestas viejas si se toca editar más de una vez')
assert.match(edit, /Promise\.all\(/, 'debe esperar profesional y catálogo antes de completar el formulario')
assert.match(edit, /includeImages=false/, 'la sincronización móvil no debe descargar imágenes pesadas')
assert.ok(
  edit.indexOf('await Promise.all(') < edit.indexOf('renderProfessionalServiceOptions('),
  'los checks no deben renderizarse antes de terminar la sincronización'
)
assert.match(edit, /setButtonLoading\([^,]+, true, 'Cargando\.\.\.'\)/, 'el botón debe mostrar que la edición se está cargando')
assert.match(edit, /No se pudo cargar el profesional/, 'un fallo de carga debe ser visible y no abrir un formulario vacío')
assert.doesNotMatch(crm, /return 'Corte, Color, Peinados'/, 'la tarjeta no debe inventar servicios mientras el catálogo está cargando')

console.log('Professional service editor loading contract: OK')
