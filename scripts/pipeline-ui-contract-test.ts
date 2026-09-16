import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const read = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), 'utf8')
const [moduleSource, crmSource] = await Promise.all([
  read('src/routes/crm-ui/pipeline.ts'),
  read('src/routes/crm-ui.ts')
])

assert.match(moduleSource, /user-supplied weex-crm\.html prototype/)
assert.match(moduleSource, /export const pipelineStyles/)
assert.match(moduleSource, /export const pipelineMarkup/)
assert.match(moduleSource, /export const pipelineScript/)
const markupSource = moduleSource.slice(moduleSource.indexOf('export const pipelineMarkup'), moduleSource.indexOf('export const pipelineScript'))
const stylesSource = moduleSource.slice(moduleSource.indexOf('export const pipelineStyles'), moduleSource.indexOf('export const pipelineMarkup'))
assert.equal((markupSource.match(/id="pipeline-shell"/g) || []).length, 1)

// Visual approval contract: the integrated surface must preserve the supplied
// WEEX prototype's information architecture and distinctive design language.
for (const prototypeMarker of [
  'Leads de Formulario',
  'Pipeline de Prospectos',
  'Simular Formulario',
  'pl-terminal-zone',
  'pl-tables',
  'pl-task-quick-add'
]) assert.ok(moduleSource.includes(prototypeMarker), 'falta paridad con weex-crm.html: ' + prototypeMarker)
assert.match(moduleSource, /Mis Tareas (?:&|&amp;) Pendientes/)

for (const prototypeColor of ['#0EA5E9', '#10B981', '#2563EB', '#090B0E', '#131722']) {
  assert.ok(stylesSource.includes(prototypeColor), 'falta color del sistema visual WEEX: ' + prototypeColor)
}

assert.match(stylesSource, /Plus\+Jakarta\+Sans/)
assert.doesNotMatch(stylesSource, /--pl-gold|#e8b83e|#f6d77f/i)

for (const feature of [
  'pl-tab-leads',
  'pl-tab-tasks',
  'pl-board',
  'pl-won',
  'pl-no-response',
  'pl-lead-dialog',
  'pl-task-dialog',
  'pl-settings-dialog',
  '/pipeline/leads',
  '/pipeline/tasks',
  '/pipeline/responsibles',
  'expectedRevision',
  'PIPELINE_REVISION_CONFLICT'
]) assert.ok(moduleSource.includes(feature), 'falta integración UI: ' + feature)

for (const accessibleFeature of [
  'data-pl-move-stage',
  'data-pl-change-outcome',
  'data-pl-move-task-status',
  'data-pl-retry',
  ':focus-visible',
  'aria-busy',
  'plCaptureOpenForm',
  'plRestoreOpenForm',
  'plRollbackLeadMove',
  'plRollbackTaskMove'
]) assert.ok(moduleSource.includes(accessibleFeature), 'falta recuperación/accesibilidad: ' + accessibleFeature)

assert.match(moduleSource, /addEventListener\('keydown'/)
assert.match(moduleSource, /event\.key !== 'Enter'/)
assert.match(moduleSource, /event\.key !== ' '/)
assert.match(moduleSource, /plLoadAll\(true\)[\s\S]+plToast/)
assert.match(moduleSource, /role="(?:status|alert)"/)
assert.match(moduleSource, /Respuestas del formulario/)
assert.match(moduleSource, /lead\.formAnswers/)
assert.match(moduleSource, /escapeHtml\(answer\.label\)/)
assert.match(moduleSource, /escapeHtml\(answer\.value\)/)

assert.doesNotMatch(moduleSource, /localStorage|sessionStorage/)
assert.doesNotMatch(moduleSource, /\bonclick\s*=|\bonchange\s*=|\bonkeydown\s*=/)
assert.doesNotMatch(moduleSource, /\b(?:alert|confirm|prompt)\s*\(/)
assert.doesNotMatch(moduleSource, /window\.[A-Za-z_$][\w$]*\s*=/)

for (const match of markupSource.matchAll(/\b(?:id|class)="([^"]+)"/g)) {
  for (const token of match[1]!.split(/\s+/).filter(Boolean)) {
    assert.ok(token === 'pipeline-shell' || token.startsWith('pl-'), 'selector sin prefijo pl-: ' + token)
  }
}
for (const selector of stylesSource.matchAll(/(^|\})\s*(\.[A-Za-z_-][\w-]*)/gm)) {
  assert.ok(selector[0].includes('#pipeline-shell'), 'estilo no namespaced: ' + selector[0])
}

assert.match(crmSource, /from '.\/crm-ui\/pipeline\.js'/)
assert.match(crmSource, /\$\{pipelineStyles\}/)
assert.match(crmSource, /\$\{pipelineMarkup\}/)
assert.match(crmSource, /\$\{pipelineScript\}/)

const rendered = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
assert.equal((rendered.match(/id="pipeline-shell"/g) || []).length, 1)
assert.match(rendered, /id="pl-board"/)
assert.doesNotMatch(rendered, /pipeline-placeholder/)

console.log('pipeline-ui-contract-test: ok')

