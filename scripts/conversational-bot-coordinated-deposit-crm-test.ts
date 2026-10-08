import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import Fastify from 'fastify'
import { sendAuthorizationFailure } from '../src/services/authorization-response.js'
import { canStaffAccessRoute, STAFF_PRESET_DEFINITIONS } from '../src/services/staff-permission-service.js'
import {
  approveCurrentDepositProof, rejectCurrentDepositProof, normalizeDepositRejection,
  DepositReviewError, DepositReviewStateError
} from '../src/services/deposit-review-operation.js'

// Execute the production handler AST, without importing the CRM singleton or opening a DB.
// Wrapper transactions are intercepted; SQL ALL/rollback evidence belongs to the PGlite suite.
const source = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('crm.ts', source, ts.ScriptTarget.Latest, true)
const handlers = new Map<string, string>()
let selector = ''
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app' && node.expression.name.text === 'post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[1]) {
    handlers.set(node.arguments[0].text, node.arguments[1].getText(ast))
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'findActiveConversationDeposit') selector = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(selector)
const reviewer = {
  ...STAFF_PRESET_DEFINITIONS.SECRETARY_READ_ONLY.permissions,
  role: 'STAFF', staffProfile: 'SECRETARY', professionalId: null, agendaScope: 'ALL' as const,
  canCreateAppointments: false, canEditAppointments: false, canCancelAppointments: false, canManageScheduleBlocks: false,
  canForceAppointments: false, canViewCustomers: false, canCreateCustomers: false, canEditCustomers: false,
  canManageCustomerNotes: false, canManageCustomerMarketing: false, canViewConversations: false, canReplyConversations: false,
  canManageDeposits: true, canViewOperationalReports: false, canViewFinancialAmounts: false
}
type HarnessOptions = {
  auth?: boolean; permission?: boolean; authorized?: boolean; missing?: boolean; legacy?: boolean;
  cash?: boolean; failure?: Error; outcome?: 'APPLIED' | 'REPLAYED'; status?: string; source?: string; conversationMissing?: boolean
}
async function harness(route: string, config: HarnessOptions = {}) {
  const app = Fastify({ logger: false })
  const calls: Array<{ action: string; input: any }> = []
  const transactions: unknown[] = []
  let legacyCalls = 0, projectionCalls = 0, selectorCalls = 0
  const user = { id: 'reviewer-1', businessId: 'business-1', ...reviewer, canManageDeposits: config.permission !== false }
  const deposit = {
    id: 'deposit-2', businessId: 'business-1', appointmentId: 'appointment-2',
    visitId: config.legacy ? null : 'visit-2', source: config.source ?? 'BOT', conversationId: config.conversationMissing ? null : 'conversation-1',
    conversation: { id: 'conversation-1' }, status: config.status ?? 'PROOF_RECEIVED'
  }
  const legacy = () => { legacyCalls++; throw new Error('offline legacy boundary') }
  const prisma = {
    bookingDeposit: { findFirst: async (args: any) => {
      selectorCalls++
      assert.deepEqual(args.where, { conversationId: 'conversation-1', businessId: 'business-1', status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] } })
      if (config.missing) return null
      return Object.fromEntries(Object.entries(deposit).filter(([key]) => args.select[key]))
    } },
    $transaction: async (_callback: unknown, options?: unknown) => {
      if (config.legacy && config.source === 'WEB') return legacy()
      transactions.push(options)
      return { outcome: config.outcome ?? 'APPLIED', auditId: 'audit-1' }
    }
  }
  const wrap = (action: string) => async (client: any, input: any) => {
    calls.push({ action, input })
    if (config.failure) throw config.failure
    if (action === 'REJECT') normalizeDepositRejection(input.rejection)
    return action === 'APPROVE' ? approveCurrentDepositProof(client, input) : rejectCurrentDepositProof(client, input)
  }
  const dependencies = {
    app: Object.assign(app, { clock: () => new Date('2026-10-08T12:00:00Z') }), prisma,
    options: { cashRegisterEnabled: config.cash }, sendAuthorizationFailure,
    loadAuthorizedConversation: async (_client: unknown, actor: any, id: string) => {
      assert.equal(actor.id, user.id); assert.equal(id, 'conversation-1')
      return config.authorized === false ? null : { id, businessId: 'business-1' }
    },
    loadAuthorizedBookingDeposit: async (_client: unknown, actor: any, id: string) => {
      assert.equal(actor.id, user.id); assert.equal(id, 'deposit-2')
      return config.authorized === false || config.missing ? null : deposit
    },
    approveCurrentDepositProof: wrap('APPROVE'), rejectCurrentDepositProof: wrap('REJECT'),
    DepositReviewError, DepositReviewStateError,
    stateFromConversation: legacy, bookingDepositService: { expireOverdue: legacy },
    conversationWithLatestDeposit: async (id: string, actor: any) => {
      projectionCalls++; assert.equal(id, 'conversation-1'); assert.equal(actor.id, user.id)
      return { id, bookingDeposits: [{ id: deposit.id }] }
    }
  }
  app.addHook('preHandler', async (request, reply) => {
    if (config.auth !== false) (request as any).auth = { user }
    // The real CRM global RBAC predicate, applied at the same pre-handler boundary.
    if (config.auth !== false && !canStaffAccessRoute(user, request.method, request.url)) return sendAuthorizationFailure(reply, 'forbidden')
  })
  const handler = handlers.get(route)
  assert.ok(handler, `production route missing: ${route}`)
  const javascript = ts.transpileModule(`${selector}
app.post(${JSON.stringify(route)}, ${handler});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText
  new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies))
  const url = route.replace(':id', route.includes('/conversations/') ? 'conversation-1' : 'deposit-2')
  return { app, calls, transactions, inject: (key: string | null = ' review-1 ', body = { reason: 'Legible review reason', mode: 'FINAL' }) => app.inject({
    method: 'POST', url, headers: key === null ? {} : { 'idempotency-key': key }, payload: body
  }), counts: () => ({ legacyCalls, projectionCalls, selectorCalls }) }
}
const routes = [
  '/crm/conversations/:id/deposit/approve', '/crm/conversations/:id/deposit/reject',
  '/crm/deposits/:id/approve', '/crm/deposits/:id/reject'
]
let scenarios = 0
async function check(route: string, config: HarnessOptions, run: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>) {
  const h = await harness(route, config)
  try { await run(h); scenarios++ } finally { await h.app.close() }
}
for (const route of routes) {
  const action = route.endsWith('/approve') ? 'APPROVE' : 'REJECT'
  await check(route, {}, async h => {
    const response = await h.inject()
    assert.equal(response.statusCode, 200, `${route} must dispatch F8 before legacy`)
    assert.equal(h.calls.length, 1, `${route} must invoke the aggregate wrapper exactly once`)
    assert.deepEqual(h.calls[0], { action, input: {
      businessId: 'business-1', depositId: 'deposit-2', actorUserId: 'reviewer-1', operationKey: 'review-1', method: 'POST', path: route,
      ...(action === 'APPROVE' ? { projectCashPayment: true } : { rejection: { reason: 'Legible review reason', mode: 'FINAL' } })
    } })
    assert.deepEqual(h.transactions, [action === 'APPROVE' ? { timeout: 20_000 } : undefined])
    assert.equal(h.counts().legacyCalls, 0, 'no legacy expiry, notification, or conversation reset')
    assert.deepEqual(response.json(), route.includes('/conversations/') ? { id: 'conversation-1', bookingDeposits: [{ id: 'deposit-2' }] } : { ok: true, outcome: 'APPLIED' })
  })
  for (const key of [null, '', ' ', 'x'.repeat(513)]) await check(route, {}, async h => {
    assert.equal((await h.inject(key)).statusCode, 400); assert.equal(h.calls.length, 0); assert.equal(h.counts().legacyCalls, 0)
  })
  for (const [config, status] of [[{ auth: false }, 401], [{ permission: false }, 403], [{ authorized: false }, 404], [{ missing: true }, 404]] as const) {
    await check(route, config, async h => {
      assert.equal((await h.inject()).statusCode, status); assert.equal(h.calls.length, 0); assert.equal(h.counts().legacyCalls, 0)
      if (('auth' in config && config.auth === false) || ('permission' in config && config.permission === false) || ('authorized' in config && config.authorized === false)) assert.equal(h.counts().selectorCalls, 0)
    })
  }
  for (const [failure, status] of [[new DepositReviewError('invalid input'), 400], [new DepositReviewStateError('state conflict'), 409], [new Error('sealed membership corrupt'), 500]] as const) {
    await check(route, { failure }, async h => {
      const response = await h.inject()
      assert.equal(response.statusCode, status); assert.equal(h.calls.length, 1); assert.equal(h.counts().legacyCalls, 0)
      assert.equal(h.transactions.length, 0)
    })
  }
  await check(route, { legacy: true }, async h => {
    const response = await h.inject('')
    assert.equal(h.calls.length, 0, 'visitId NULL must not enter F8 or require its key')
    if (route.includes('/conversations/')) { assert.equal(response.statusCode, 500); assert.equal(h.counts().legacyCalls, 1) }
    else assert.equal(response.statusCode, 404, 'legacy BOT direct endpoint remains WEB-only')
  })
  await check(route, { outcome: 'REPLAYED' }, async h => {
    assert.equal((await h.inject()).statusCode, 200)
    assert.equal(h.calls.length, 1); assert.equal(h.counts().legacyCalls, 0)
  })
  if (route.includes('/conversations/')) await check(route, { conversationMissing: true }, async h => {
    assert.equal((await h.inject()).statusCode, 404); assert.equal(h.calls.length, 0); assert.equal(h.counts().legacyCalls, 0)
  })
  else await check(route, { legacy: true, source: 'WEB' }, async h => {
    assert.equal((await h.inject('')).statusCode, 500)
    assert.equal(h.calls.length, 0); assert.equal(h.counts().legacyCalls, 1, 'legacy WEB still enters its existing path')
  })
  if (action === 'APPROVE') await check(route, { cash: false, status: 'PENDING_PROOF' }, async h => {
    assert.equal((await h.inject()).statusCode, 200)
    assert.equal(h.calls[0]!.input.projectCashPayment, false, 'state eligibility belongs to transactional wrapper, not stale route snapshot')
  })
  else {
    await check(route, {}, async h => {
      assert.equal((await h.inject('resubmit-1', { reason: 'Try again', mode: 'RESUBMISSION_ALLOWED' })).statusCode, 200)
      assert.deepEqual(h.calls[0]!.input.rejection, { reason: 'Try again', mode: 'RESUBMISSION_ALLOWED' })
    })
    for (const body of [{ reason: '', mode: 'FINAL' }, { reason: 'x'.repeat(301), mode: 'FINAL' }, { reason: 'valid', mode: 'legacy' }]) await check(route, {}, async h => {
      assert.equal((await h.inject('reject-invalid', body)).statusCode, 400); assert.equal(h.transactions.length, 0)
    })
  }
}
console.log(`OK CRM review dispatch: ${scenarios} offline production-handler scenarios; SQL ALL semantics are tested separately.`)

// Consumer functions are read from the real CRM embedded script, not reimplemented.
const uiSource = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
function uiFunction(name: string) {
  const match = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(uiSource)
  assert.ok(match, `production UI function missing: ${name}`)
  const start = match.index
  const tail = uiSource.slice(start + match[0].length)
  const next = /\n    (?:async )?function /.exec(tail)
  assert.ok(next)
  return uiSource.slice(start, start + match[0].length + next.index)
}
function consumer(config: { legacy?: boolean; failure?: boolean; selectedDeposit?: boolean } = {}) {
  const deposit = { id: 'deposit-2', amount: 3000, status: 'PROOF_RECEIVED', visitId: config.legacy ? null : 'visit-2', source: 'WHATSAPP', conversationId: 'conversation-1' }
  const state = {
    selected: { id: 'conversation-1', bookingDeposits: [deposit] }, selectedDeposit: config.selectedDeposit ? deposit : null,
    deposits: [deposit], depositApprovalPendingIds: new Set<string>(), depositReviewOperationKeys: new Map<string, string>(),
    depositRejectionTarget: null as typeof deposit | null
  }
  const requests: Array<{ url: string; options: any }> = []
  const counts = { conversations: 0, deposits: 0, agenda: 0, confirmations: 0 }
  let generatedKeys = 0
  const els = {
    depositReject: {}, depositRejectionDialogSubmit: {}, depositRejectionReason: { value: '', focus() {} },
    depositRejectionMode: { value: '' }, depositRejectionFeedback: { textContent: '' }, depositRejectionDialog: { hidden: true }
  }
  const dependencies = {
    state, els, window: { setTimeout: (callback: () => void) => callback() },
    crypto: { randomUUID: () => 'stable-key-' + ++generatedKeys },
    requestCrmConfirmation: async () => { counts.confirmations++; return true }, formatCurrency: String,
    setDepositApprovalPending: (_deposit: unknown, pending: boolean) => pending ? state.depositApprovalPendingIds.add(deposit.id) : state.depositApprovalPendingIds.delete(deposit.id),
    setButtonLoading: () => true, renderDeposits() {}, renderEmptyDepositSelection() {}, renderSelected() {}, showCrmToast() {},
    getJson: async (url: string, options: any) => {
      requests.push({ url, options })
      if (config.failure) throw new Error('offline request failure')
      return { id: 'conversation-1', bookingDeposits: [deposit] }
    },
    loadConversations: async () => { counts.conversations++ }, loadDeposits: async () => { counts.deposits++ }, loadAgenda: async () => { counts.agenda++ }
  }
  const names = ['selectedDepositReviewUrl', 'approveSelectedDeposit', 'rejectSelectedDeposit', 'openDepositRejectionDialog', 'closeDepositRejectionDialog', 'submitDepositRejection']
  const code = ts.transpileModule(names.map(uiFunction).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const api = new Function(...Object.keys(dependencies), code + '\nreturn { approveSelectedDeposit, rejectSelectedDeposit, submitDepositRejection };')(...Object.values(dependencies)) as {
    approveSelectedDeposit(): Promise<void>; rejectSelectedDeposit(): Promise<void>; submitDepositRejection(event: { preventDefault(): void }): Promise<void>
  }
  return { ...api, state, els, requests, counts, generatedKeys: () => generatedKeys }
}
let consumerScenarios = 0
for (const selectedDeposit of [false, true]) {
  const h = consumer({ selectedDeposit, failure: true })
  await h.approveSelectedDeposit(); await h.approveSelectedDeposit()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[0]!.options.headers['Idempotency-Key'], 'stable-key-1', 'F8 conversation approval must send its stable operation key')
  assert.equal(h.requests[1]!.options.headers['Idempotency-Key'], 'stable-key-1', 'failed request retry must reuse the same key')
  assert.equal(h.generatedKeys(), 1)
  consumerScenarios++
}
for (const mode of ['RESUBMISSION_ALLOWED', 'FINAL']) {
  const h = consumer()
  await h.rejectSelectedDeposit()
  assert.equal(h.state.depositRejectionTarget?.id, 'deposit-2', 'F8 conversation rejection must reuse the existing explicit-mode dialog')
  assert.equal(h.requests.length, 0, 'opening a dialog must not reject before an explicit submission')
  assert.equal(h.els.depositRejectionDialog.hidden, false)
  h.els.depositRejectionReason.value = 'Reviewed reason'; h.els.depositRejectionMode.value = mode
  await h.submitDepositRejection({ preventDefault() {} })
  assert.equal(h.requests[0]!.url, '/crm/deposits/deposit-2/reject')
  assert.equal(h.requests[0]!.options.headers['Idempotency-Key'], 'stable-key-1')
  assert.deepEqual(JSON.parse(h.requests[0]!.options.body), { reason: 'Reviewed reason', mode })
  assert.equal(h.counts.conversations, 1, 'conversation status must refresh after dialog review')
  consumerScenarios++
}
const retry = consumer({ failure: true })
await retry.rejectSelectedDeposit()
retry.els.depositRejectionReason.value = 'Retry review'; retry.els.depositRejectionMode.value = 'FINAL'
await retry.submitDepositRejection({ preventDefault() {} }); await retry.submitDepositRejection({ preventDefault() {} })
assert.equal(retry.requests.length, 2)
assert.equal(retry.requests[0]!.options.headers['Idempotency-Key'], retry.requests[1]!.options.headers['Idempotency-Key'])
assert.equal(retry.els.depositRejectionDialog.hidden, false)
consumerScenarios++
for (const action of ['approveSelectedDeposit', 'rejectSelectedDeposit'] as const) {
  const h = consumer({ legacy: true })
  await h[action]()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0]!.options.headers['Idempotency-Key'], undefined, 'legacy NULL contract unchanged')
  assert.equal(h.state.depositRejectionTarget, null)
  assert.equal(h.counts.confirmations, 1)
  consumerScenarios++
}
// A new proof for the same obligation is a new decision, not a replay of its prior rejection.
const cycle = consumer()
await cycle.rejectSelectedDeposit()
cycle.els.depositRejectionReason.value = 'First review'; cycle.els.depositRejectionMode.value = 'RESUBMISSION_ALLOWED'
await cycle.submitDepositRejection({ preventDefault() {} })
// The server delivers a fresh PROOF_RECEIVED DTO after the customer resubmits.
cycle.state.selected.bookingDeposits[0]!.status = 'PROOF_RECEIVED'
await cycle.rejectSelectedDeposit()
cycle.els.depositRejectionReason.value = 'Second review'; cycle.els.depositRejectionMode.value = 'FINAL'
await cycle.submitDepositRejection({ preventDefault() {} })
assert.equal(cycle.requests.length, 2)
assert.equal(cycle.requests[0]!.options.headers['Idempotency-Key'], 'stable-key-1')
assert.equal(cycle.requests[1]!.options.headers['Idempotency-Key'], 'stable-key-2', 'a successful decision must not reuse its key for a later proof')
assert.equal(cycle.state.depositReviewOperationKeys.has('reject:deposit-2'), false)
consumerScenarios++
const uiProjection = /const conversationDepositSelect = ([\s\S]*?) satisfies Prisma.BookingDepositSelect/.exec(source)
assert.ok(uiProjection)
const projectionCode = ts.transpileModule('const selected = ' + uiProjection[1] + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const selected = new Function(projectionCode + ';return selected')() as Record<string, boolean>
assert.equal(selected.visitId, true, 'conversation DTO must expose its F8 marker without any proof metadata')
assert.deepEqual(Object.keys(selected).sort(), ['amount', 'id', 'status', 'visitId'])
consumerScenarios++
console.log(`OK CRM consumers: ${consumerScenarios} production-function scenarios; stable keys, explicit rejection modes, legacy and minimal DTO.`)
