import assert from 'node:assert/strict'
import { behaviorCases, orientationExamples, type Axis, type BehaviorCase, type Vertical } from './conversational-bot-behavior-cases.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { ACTION_REGISTRY } from '../src/conversational-bot/actions.js'

// This is a controlled-provider motor/guard evaluation, not live-model comprehension or style quality.
type AxisTally = { passed: number; failed: number; gap: number; skipped: number; denominator: number; accuracy: number | null }
type TurnResult = { caseId: string; turn: number; group: string; axes: Partial<Record<Axis, 'pass' | 'fail' | 'gap' | 'skip'>>; errors: string[] }
type Report = { mode: 'controlled-provider'; turnsRun: number; holdoutSkipped: number; holdoutIds: string[]; gaps: Array<{ caseId: string; axis: Axis; reason: string }>; manualReviewPending: string[];
  byAxis: Record<Axis, AxisTally>; byGroup: Record<string, Record<Axis, AxisTally>>; turns: TurnResult[] }
const axes: Axis[] = ['action', 'entities', 'correction', 'context', 'unnecessaryQuestion', 'grounding', 'capability']

const makeTally = (): AxisTally => ({ passed: 0, failed: 0, gap: 0, skipped: 0, denominator: 0, accuracy: null })
const makeAxes = () => Object.fromEntries(axes.map(axis => [axis, makeTally()])) as Record<Axis, AxisTally>
function fixture(vertical: Vertical) {
  const businessId = `qa-${vertical}`
  const services: DialogueService[] = vertical === 'salon' ? [
    { id: 'cut', name: 'Corte hombre', durationMinutes: 30, price: 27000, requiresConsultation: false },
    { id: 'beard', name: 'Corte y barba', durationMinutes: 45, price: 32000, requiresConsultation: false },
    { id: 'lights', name: 'Iluminación', durationMinutes: 60, price: 160000, priceMode: 'STARTING_AT', requiresConsultation: true }
  ] : vertical === 'coaching' ? [
    { id: 'individual', name: 'Sesión individual', durationMinutes: 60, price: 25000, requiresConsultation: false },
    { id: 'group', name: 'Sesión grupal', durationMinutes: 90, price: 15000, requiresConsultation: false }
  ] : [
    { id: 'oil', name: 'Cambio de aceite', durationMinutes: 45, price: 40000, requiresConsultation: false },
    { id: 'brakes', name: 'Revisión de frenos', durationMinutes: 60, price: null, requiresConsultation: false }
  ]
  const professionals = (vertical === 'salon' ? ['Ramiro', 'Ana'] : [vertical === 'coaching' ? 'Mara' : 'Alex'])
    .map((name, priority) => ({ id: name.toLowerCase(), name, priority }))
  const port: DialoguePort = {
    catalog: async () => services,
    availability: async (_service, date, professionalId) => ({
      professionals,
      slots: ['2026-10-02', '2026-10-03'].includes(date) ? professionals
        .filter(professional => !professionalId || professional.id === professionalId)
        .map(professional => ({ date, time: '17:00', startAt: `${date}T20:00:00.000Z`,
          professionalId: professional.id, professionalName: professional.name,
          band: 'AFTERNOON' as const, occupiedMinutes: 0 })) : []
    }),
    information: async () => ({ businessId, name: `QA ${vertical}`, address: 'Calle QA 100', area: null,
      mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null,
      facebook: null, tiktok: null, description: null, hours: 'Lunes a viernes: 09:00 a 18:00' })
  }
  return { context: { businessId, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T15:00:00Z') }, port }
}
const equalFields = (actual: Record<string, unknown>, expected: Record<string, unknown>) =>
  Object.entries(expected).every(([key, value]) => key === 'professionalId'
    ? (actual.professional && typeof actual.professional === 'object' && 'id' in actual.professional ? actual.professional.id : null) === value
    : actual[key] === value)

async function evaluateBehavior(cases: readonly BehaviorCase[]): Promise<Report> {
  const report: Report = { mode: 'controlled-provider', turnsRun: 0, holdoutSkipped: 0,
    holdoutIds: [], gaps: [], manualReviewPending: [], byAxis: makeAxes(), byGroup: {}, turns: [] }
  for (const scenario of cases) {
    if (scenario.split === 'holdout') { report.holdoutSkipped++; report.holdoutIds.push(scenario.id); continue }
    if (scenario.manualReview) report.manualReviewPending.push(scenario.id)
    const { context, port } = fixture(scenario.vertical)
    let state = initialDialogueState(context.businessId)
    const group = report.byGroup[scenario.group] ??= makeAxes()
    for (const [index, turn] of scenario.turns.entries()) {
      const provider = async (input: { firstReplyFacts?: readonly { id: string }[] }) => ({ ...turn.candidate,
        firstReply: { opening: null, factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [], closing: null } })
      const response = await respondWithAiInterpreter(context, state, turn.message, port, provider,
        { responseProvider: async input => ({ opening: null, factIds: input.facts.map(fact => fact.id), closing: null }) })
      const result: TurnResult = { caseId: scenario.id, turn: index + 1, group: scenario.group, axes: {}, errors: [] }
      const expected = turn.expected
      const checks: Partial<Record<Axis, boolean>> = {
        action: expected.action === undefined ? undefined : response.interpretation.decision.acceptedAction === expected.action,
        entities: expected.entities === undefined ? undefined : equalFields(response.state, expected.entities),
        correction: expected.correction === undefined ? undefined : response.interpretation.decision.outcome === expected.correction,
        context: expected.context === undefined ? undefined : equalFields(response.state, expected.context),
        unnecessaryQuestion: expected.unnecessaryQuestion === undefined ? undefined :
          expected.unnecessaryQuestion.absent.every(text => !response.reply.includes(text)),
        grounding: expected.grounding === undefined ? undefined :
          (expected.grounding.contains ?? []).every(text => response.reply.includes(text)) &&
          (expected.grounding.absent ?? []).every(text => !response.reply.includes(text)),
        capability: expected.capability === undefined ? undefined :
          ACTION_REGISTRY[expected.capability.action].status === expected.capability.status &&
          (!expected.capability.noProposal || response.proposal === null)
      }
      for (const axis of axes) {
        const tally = report.byAxis[axis], grouped = group[axis]
        if (expected.gap?.[axis]) { tally.gap++; grouped.gap++; result.axes[axis] = 'gap'; report.gaps.push({ caseId: scenario.id, axis, reason: expected.gap[axis]! }); continue }
        if (checks[axis] === undefined) { tally.skipped++; grouped.skipped++; result.axes[axis] = 'skip'; continue }
        tally.denominator++; grouped.denominator++
        if (checks[axis]) { tally.passed++; grouped.passed++; result.axes[axis] = 'pass' }
        else { tally.failed++; grouped.failed++; result.axes[axis] = 'fail'; result.errors.push(axis) }
      }
      report.turns.push(result)
      report.turnsRun++
      state = response.state
    }
  }
  for (const metrics of [report.byAxis, ...Object.values(report.byGroup)])
    for (const axis of axes) metrics[axis].accuracy = metrics[axis].denominator ?
      metrics[axis].passed / metrics[axis].denominator : null
  return report
}

const report = await evaluateBehavior(behaviorCases)
assert.equal(report.mode, 'controlled-provider')
assert.equal(orientationExamples.length, 2, 'guidance examples are not evaluation turns')
assert.ok(report.turnsRun >= 14, 'score observed turns, not just fixture count')
assert.equal(report.holdoutSkipped, 2, 'reserved holdout is never executed in this runner')
assert.deepEqual(report.holdoutIds.sort(), ['coaching.holdout.01', 'mechanics.holdout.01'])
assert.ok(report.gaps.some(gap => gap.caseId === 'salon.product.01' && gap.axis === 'capability'))
assert.ok(report.byAxis.action.denominator > 0)
assert.ok(report.byAxis.context.denominator > 0)
assert.ok(report.byAxis.capability.gap > 0, 'unsupported product inventory is disclosed')
assert.ok(report.manualReviewPending.length > 0, 'editable style is not faked as model quality')
assert.ok(report.turns.every(turn => turn.axes.action !== undefined || turn.axes.entities !== undefined))
const baselineFailures = report.turns.filter(turn => turn.errors.length)
if (baselineFailures.length) console.error('controlled evaluation failures:', JSON.stringify(baselineFailures))
assert.equal(baselineFailures.length, 0, 'baseline controlled fixtures must have no untracked failure')
const corrupted = structuredClone(behaviorCases.find(scenario => scenario.id === 'mechanics.booking.01')!)
corrupted.turns[0]!.candidate.serviceId = 'foreign'
const penalty = await evaluateBehavior([corrupted])
assert.equal(penalty.turnsRun, 1)
assert.equal(penalty.byAxis.action.denominator, 1)
assert.equal(penalty.byAxis.action.failed, 1, 'bad interpreter output must lower action score')
assert.equal(penalty.byAxis.action.accuracy, 0)
assert.deepEqual(penalty.turns[0]!.errors, ['action'])
const byGroup = Object.fromEntries(Object.entries(report.byGroup).map(([group, metrics]) => [group,
  Object.fromEntries(axes.filter(axis => metrics[axis].denominator || metrics[axis].gap)
    .map(axis => [axis, { passed: metrics[axis].passed, denominator: metrics[axis].denominator, gap: metrics[axis].gap }]))]))
console.log('conversational behavior evaluation:', JSON.stringify({ mode: report.mode,
  caveat: 'Injected interpretations test motor/guards, not real AI understanding or configured style',
  turnsRun: report.turnsRun, byAxis: report.byAxis, byGroup, holdoutIds: report.holdoutIds,
  gaps: report.gaps, manualReviewPending: report.manualReviewPending }))
