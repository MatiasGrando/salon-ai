/** Curated synthetic requests: controlled-provider checks, never customer transcripts or training data.
 * Fragmented cases run sequentially offline and do not test WhatsApp pre-send consolidation. */
export type Vertical = 'salon' | 'coaching' | 'mechanics'
export type Axis = 'action' | 'entities' | 'correction' | 'context' | 'unnecessaryQuestion' | 'grounding' | 'capability'
export type ExpectedTurn = {
  action?: string
  entities?: { serviceId?: string | null; date?: string | null; professionalNameHint?: string | null; professionalId?: string | null }
  correction?: string
  context?: { serviceId?: string | null; date?: string | null; professionalNameHint?: string | null; professionalId?: string | null }
  unnecessaryQuestion?: { absent: string[] }
  grounding?: { contains?: string[]; absent?: string[] }
  capability?: { action: 'CANCEL' | 'HUMAN_HANDOFF' | 'CREATE_BOOKING'; status: 'pending' | 'proposal_only'; noProposal?: boolean }
  gap?: Partial<Record<Axis, string>>
}
export type BehaviorTurn = { message: string; candidate: Record<string, unknown>; expected: ExpectedTurn }
export type BehaviorCase = { id: string; split: 'evaluation' | 'holdout'; vertical: Vertical; group: string; turns: BehaviorTurn[]; manualReview?: string }
export const baseCandidate = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
  serviceConfidence: 'uncertain', serviceCandidateIds: [] as string[], serviceCorrection: false }
const booking = (serviceId: string, serviceEvidence: string, extra: Record<string, unknown> = {}) =>
  ({ ...baseCandidate, intent: 'booking', serviceId, serviceEvidence, serviceConfidence: 'certain', ...extra })
const information = { ...baseCandidate, intent: 'information' }
const other = { ...baseCandidate }

/** Exemplars are guidance only, not scored or reused as held-out cases. */
export const orientationExamples = [
  { intent: 'information', input: '¿Cuál es la dirección?', criterion: 'Read only trusted tenant address; do not start booking.' },
  { intent: 'booking', input: 'Quiero reservar mañana', criterion: 'Keep tomorrow, ask only for missing service.' }
] as const

export const behaviorCases: readonly BehaviorCase[] = [
  { id: 'salon.greeting.01', split: 'evaluation', vertical: 'salon', group: 'greeting', turns: [
    { message: 'buenas', candidate: other, expected: { action: 'no_service_change', entities: { serviceId: null },
      unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] }, grounding: { absent: ['reservado', '$'] } } }
  ], manualReview: 'El nombre, tono y longitud se evalúan después contra la configuración editable elegida para este negocio; el proveedor fake no prueba naturalidad.' },
  { id: 'salon.address.01', split: 'evaluation', vertical: 'salon', group: 'information', turns: [
    { message: 'donde estan?', candidate: information, expected: { action: 'information_read', entities: { serviceId: null },
      grounding: { contains: ['Calle QA 100'], absent: ['reservado'] }, unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] } } }
  ] },
  { id: 'coaching.hours.01', split: 'evaluation', vertical: 'coaching', group: 'information', turns: [
    { message: 'horario de atencion', candidate: information, expected: { action: 'information_read', entities: { serviceId: null },
      grounding: { contains: ['Lunes a viernes'], absent: ['reservado'] }, unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] } } }
  ] },
  { id: 'mechanics.catalog.01', split: 'evaluation', vertical: 'mechanics', group: 'information', turns: [
    { message: 'que servicios tienen?', candidate: information, expected: { action: 'information_read', entities: { serviceId: null },
      grounding: { contains: ['Cambio de aceite', 'Revisión de frenos'], absent: ['reservado'] }, unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] } } }
  ] },
  { id: 'salon.price.01', split: 'evaluation', vertical: 'salon', group: 'information', turns: [
    { message: 'cuanto sale Iluminación?', candidate: information, expected: { action: 'information_read', entities: { serviceId: null },
      grounding: { contains: ['Iluminación', '160.000'], absent: ['reservado'] }, unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] } } }
  ] },
  { id: 'mechanics.booking.01', split: 'evaluation', vertical: 'mechanics', group: 'intake', turns: [
    { message: 'quiero Cambio de aceite mañana', candidate: booking('oil', 'Cambio de aceite'), expected: {
      action: 'select_service', entities: { serviceId: 'oil', date: '2026-10-02' }, grounding: { absent: ['reservado'] } } }
  ] },
  { id: 'coaching.fragments.01', split: 'evaluation', vertical: 'coaching', group: 'fragmented', turns: [
    { message: 'quiero una sesión', candidate: { ...baseCandidate, intent: 'booking', serviceEvidence: 'sesión', serviceCandidateIds: ['individual', 'group'] },
      expected: { action: 'clarify_service', entities: { serviceId: null }, grounding: { contains: ['Sesión individual', 'Sesión grupal'] } } },
    { message: 'mañana', candidate: { ...baseCandidate, intent: 'booking' }, expected: {
      action: 'no_service_change', context: { serviceId: null, date: '2026-10-02' } } },
    { message: 'individual con Mara', candidate: booking('individual', 'individual', { professionalMention: 'Mara' }), expected: {
      action: 'select_service', entities: { serviceId: 'individual', date: '2026-10-02' }, context: { professionalNameHint: null },
      grounding: { contains: ['Mara'], absent: ['reservado'] } } }
  ] },
  { id: 'salon.correction.01', split: 'evaluation', vertical: 'salon', group: 'correction', turns: [
    { message: 'quiero Iluminación', candidate: booking('lights', 'Iluminación'), expected: {
      action: 'select_service', entities: { serviceId: 'lights' }, grounding: { contains: ['requiere una consulta'] } } },
    { message: 'no, mejor Corte hombre', candidate: booking('cut', 'Corte hombre', { serviceCorrection: true }), expected: {
      action: 'select_service', correction: 'corrected', entities: { serviceId: 'cut' },
      grounding: { contains: ['Corte hombre'], absent: ['requiere una consulta', 'reservado'] } } }
  ] },
  { id: 'salon.typo.01', split: 'evaluation', vertical: 'salon', group: 'ambiguity', turns: [
    { message: 'quiero corte hombnre', candidate: { ...baseCandidate, intent: 'booking', serviceEvidence: 'corte hombnre' }, expected: {
      action: 'no_service_change', entities: { serviceId: null }, grounding: { contains: ['Corte hombre'], absent: ['reservado'] } } }
  ], manualReview: 'La sugerencia es una aclaración, nunca una selección automática.' },
  { id: 'salon.context-read.01', split: 'evaluation', vertical: 'salon', group: 'context', turns: [
    { message: 'quiero Corte hombre', candidate: booking('cut', 'Corte hombre'), expected: {
      action: 'select_service', entities: { serviceId: 'cut' } } },
    { message: 'donde estan?', candidate: information, expected: { action: 'information_read', context: { serviceId: 'cut' },
      grounding: { contains: ['Calle QA 100'] }, unnecessaryQuestion: { absent: ['¿Qué servicio necesitás?'] } } }
  ] },
  { id: 'mechanics.cancel.01', split: 'evaluation', vertical: 'mechanics', group: 'capability', turns: [
    { message: 'quiero cancelar mi turno', candidate: { ...baseCandidate, intent: 'booking' }, expected: {
      action: 'pending_action_unavailable', capability: { action: 'CANCEL', status: 'pending', noProposal: true },
      grounding: { absent: ['cancelado', 'reservado'] } } }
  ] },
  { id: 'coaching.handoff.01', split: 'evaluation', vertical: 'coaching', group: 'capability', turns: [
    { message: 'quiero hablar con una persona', candidate: other, expected: {
      action: 'pending_action_unavailable', capability: { action: 'HUMAN_HANDOFF', status: 'pending', noProposal: true },
      grounding: { absent: ['te transferí', 'ya te atiende'] } } }
  ] },
  { id: 'salon.product.01', split: 'evaluation', vertical: 'salon', group: 'capability', turns: [
    { message: 'venden shampoo?', candidate: other, expected: { action: 'no_service_change',
      gap: { capability: 'Product inventory is not an implemented bot action; no inventory answer is scored.' },
      grounding: { absent: ['Sí, vendemos', 'precio del shampoo'] } } }
  ] },
  { id: 'mechanics.digression.01', split: 'evaluation', vertical: 'mechanics', group: 'digression', turns: [
    { message: 'me contas un chiste?', candidate: other, expected: { action: 'no_service_change', entities: { serviceId: null },
      grounding: { absent: ['reservado', 'turno confirmado'] }, gap: { unnecessaryQuestion: 'Natural redirection requires a real model response and human review against the selected business configuration.' } } }
  ], manualReview: 'Evaluar redirección y preguntas sobrantes con una muestra real; forma y tono se juzgan según la configuración editable del negocio.' },
  { id: 'salon.date-correction.01', split: 'evaluation', vertical: 'salon', group: 'correction', turns: [
    { message: 'quiero Corte hombre mañana', candidate: booking('cut', 'Corte hombre'), expected: {
      action: 'select_service', entities: { serviceId: 'cut', date: '2026-10-02' } } },
    { message: 'no, mejor el 03/10/2026', candidate: { ...baseCandidate, intent: 'booking' }, expected: {
      action: 'no_service_change', context: { serviceId: 'cut', date: '2026-10-03' },
      grounding: { absent: ['reservado'] } } }
  ] },
  { id: 'salon.early-professional.01', split: 'evaluation', vertical: 'salon', group: 'fragmented', turns: [
    { message: 'un turno con Ramiro mañana', candidate: { ...baseCandidate, intent: 'booking', professionalMention: 'Ramiro' }, expected: {
      action: 'no_service_change', entities: { serviceId: null, date: '2026-10-02', professionalNameHint: 'ramiro' } } },
    { message: 'Corte hombre', candidate: booking('cut', 'Corte hombre'), expected: {
      action: 'select_service', context: { serviceId: 'cut', date: '2026-10-02', professionalNameHint: null, professionalId: 'ramiro' },
      grounding: { contains: ['Ramiro'], absent: ['reservado'] } } }
  ] },
  { id: 'salon.ambiguous-with-context.01', split: 'evaluation', vertical: 'salon', group: 'ambiguity', turns: [
    { message: 'un turno con Ramiro mañana', candidate: { ...baseCandidate, intent: 'booking', professionalMention: 'Ramiro' }, expected: {
      action: 'no_service_change', context: { serviceId: null, date: '2026-10-02', professionalNameHint: 'ramiro' } } },
    { message: 'un corte', candidate: { ...baseCandidate, intent: 'booking', serviceEvidence: 'corte', serviceCandidateIds: ['cut', 'beard'] }, expected: {
      action: 'clarify_service', context: { serviceId: null, date: '2026-10-02', professionalNameHint: 'ramiro' },
      grounding: { contains: ['Corte hombre', 'Corte y barba'] } } },
    { message: 'Corte hombre', candidate: booking('cut', 'Corte hombre'), expected: {
      action: 'select_service', entities: { serviceId: 'cut', date: '2026-10-02', professionalNameHint: null, professionalId: 'ramiro' },
      grounding: { contains: ['Ramiro'], absent: ['reservado'] } } }
  ], manualReview: 'Fragmented turns are sequential offline only; this does not verify WhatsApp pre-send consolidation.' },
  { id: 'coaching.holdout.01', split: 'holdout', vertical: 'coaching', group: 'reserved', turns: [
    { message: 'pasado mañana con Mara, mejor la sesión grupal', candidate: booking('group', 'sesión grupal', { professionalMention: 'Mara' }),
      expected: { entities: { serviceId: 'group' }, correction: 'corrected' } }
  ] },
  { id: 'mechanics.holdout.01', split: 'holdout', vertical: 'mechanics', group: 'reserved', turns: [
    { message: '¿Me revisan el auto y cuánto sale?', candidate: information, expected: { action: 'information_read' } }
  ] }
]
