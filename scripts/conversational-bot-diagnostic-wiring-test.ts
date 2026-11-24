import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the real server wiring without booting the app, database or workers.
const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
let start: number | undefined
let end: number | undefined
function visit(node: ts.Node) {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        if (declaration.name.text === 'conversationalAi') start = node.getStart(tree)
        if (declaration.name.text === 'handler') end = node.getStart(tree)
      }
    }
  }
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(start !== undefined && end !== undefined && end > start, 'server AI initialization exists')
const wiring = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText
const diagnostic = {
  jobId: 'synthetic-job', mode: 'interpreted', reason: 'accepted',
  validation: { professional: 'accepted' }, interpretationMs: 10, aiCalls: 1
}

for (const whatsappEnabled of [false, true]) {
  for (const instagramEnabled of [false, true]) {
    const whatsapp: { onDiagnostic?: (value: unknown) => void } | undefined = whatsappEnabled ? {} : undefined
    const instagram: { onDiagnostic?: (value: unknown) => void } | undefined = instagramEnabled ? {} : undefined
    const logs: unknown[][] = []
    vm.runInNewContext(wiring, {
      resolveWhatsAppConversationAi: () => whatsapp,
      resolveInstagramConversationAi: () => instagram,
      process: { env: {} },
      console: { info: (...args: unknown[]) => logs.push(args) }
    })
    for (const [channel, ai] of [['WHATSAPP', whatsapp], ['INSTAGRAM', instagram]] as const) {
      if (!ai) continue
      assert.equal(typeof ai.onDiagnostic, 'function', `${channel} diagnostic must be connected independently`)
      ai.onDiagnostic!(diagnostic)
      const [prefix, encoded] = logs.at(-1)!
      assert.equal(prefix, '[conversational-bot-latency]')
      assert.deepEqual(JSON.parse(String(encoded)), { ...diagnostic, channel })
    }
    assert.equal(logs.length, Number(whatsappEnabled) + Number(instagramEnabled))
  }
}
console.log('conversational bot diagnostic wiring: ok')
