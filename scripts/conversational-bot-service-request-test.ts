import assert from 'node:assert/strict';
import { initialDialogueState, parseDialogueState, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js';
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js';
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js';
import { resolveServiceRequest } from '../src/conversational-bot/service-request.js';
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js';
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-04T12:00:00Z') };
const services: DialogueService[] = [
    { id: 'cut', name: 'Corte hombre', description: 'Corte clásico con tijera o máquina', aliases: ['Corte masculino'], durationMinutes: 30, requiresConsultation: false, price: 100 },
    { id: 'cut-w', name: 'Corte mujer', durationMinutes: 30, requiresConsultation: false, price: 150 },
    { id: 'lights', name: 'Iluminación', description: 'Mechas y balayage', durationMinutes: 60, requiresConsultation: true, price: 500 }
];
const base = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null };
const req = (evidence: string, purpose = 'inquiry', disposition = 'unverified_variant', serviceIds: string[] = []) => ({ kind: 'service_request', evidence, confidence: 1, purpose, disposition, serviceIds, correction: false, basis: disposition === 'clear' ? 'exact_public_name' : 'related_category', sourceQuote: null, continuation: false });
let calls = 0;
const port: DialoguePort = { catalog: async () => services, availability: async () => { calls++; return { professionals: [], slots: [] }; } };
const say = (message: string, operation: object, previous = initialDialogueState('tenant'), others: object[] = []) => respondWithAiInterpreter(context, previous, message, port, (async () => ({ ...base, turnPlan: { version: 1, operations: [operation, ...others] } })) as AiInterpretationProvider);
const previous = { ...initialDialogueState('tenant'), customerName: 'Matías', date: '2026-10-05' };
const unknown = await say('¿Hacen corte francés?', req('corte francés'), previous);
assert.equal(unknown.interpretation.mode, 'ai', 'unknown procedure is a valid semantic result, not provider failure');
assert.equal(unknown.state.serviceId, null);
assert.equal(unknown.state.date, previous.date);
assert.equal(unknown.state.customerName, 'Matías');
assert.match(unknown.reply, /corte francés/i);
assert.match(unknown.reply, /confirmad|información/i);
assert.doesNotMatch(unknown.reply, /no (?:lo )?(?:hacemos|ofrecemos)|foto|capacidad/i);
assert.equal(calls, 0, 'a question about capabilities never queries agenda');
assert.equal((unknown.state as any).serviceRequest.request, 'corte francés');
assert.deepEqual((parseDialogueState(JSON.parse(JSON.stringify(unknown.state)), 'tenant') as any).serviceRequest, (unknown.state as any).serviceRequest);
const follow = await say('con tijera', { ...req('con tijera', 'inquiry', 'needs_detail'), continuation: true }, unknown.state);
assert.equal(follow.state.serviceRequest?.request, 'corte francés', 'follow-up retains the initial literal request');
assert.match(follow.reply, /corte francés/);
const different = await say('teñirme arcoíris', req('teñirme arcoíris'), follow.state);
assert.equal(different.state.serviceRequest?.request, 'teñirme arcoíris', 'a new procedure must not inherit the old literal request');
const pendingCategory = await say('color fantasía', req('color fantasía', 'inquiry', 'unverified_variant', ['lights']));
const lateral = await say('dónde están', { kind: 'information', evidence: 'dónde están', confidence: 1, target: { kind: 'business', actions: ['ADDRESS'] } }, pendingCategory.state);
assert.deepEqual(lateral.state.serviceRequest?.serviceIds, ['lights'], 'lateral reads retain current category context');
const found = await say('corte masculino', req('corte masculino', 'inquiry', 'clear', ['cut']), follow.state);
assert.equal(found.state.serviceId, null);
assert.equal(found.state.serviceRequest, undefined);
assert.equal(found.state.customerName, 'Matías');
const retiredPort: DialoguePort = { ...port, catalog: async () => services.filter(s => s.id !== 'cut') };
const retired = await respondWithAiInterpreter(context, { ...initialDialogueState('tenant'), serviceRequest: { purpose: 'inquiry', disposition: 'alternatives', serviceIds: ['cut', 'cut-w'], correction: false, basis: 'related_category', sourceQuote: null, continuation: false, businessId: 'tenant', request: 'cortes' } } as any, 'sigo consultando', retiredPort, (async () => ({ ...base, intent: 'other', turnPlan: { version: 1, operations: [] } })) as AiInterpretationProvider);
assert.deepEqual(retired.state.serviceRequest?.serviceIds, ['cut-w']);
assert.match(retired.reply, /confirmada/);
assert.throws(() => parseDialogueState({ ...unknown.state, serviceRequest: { ...unknown.state.serviceRequest, businessId: 'foreign' } }, 'tenant'), /scope/);
const legacyUnknown = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'aclararme el pelo', port, (async () => ({ ...base, serviceId: 'lights', serviceEvidence: 'aclararme el pelo', serviceConfidence: 'certain' })) as AiInterpretationProvider);
assert.equal(legacyUnknown.state.serviceId, null, 'legacy category proposals cannot automatically trigger a review policy');
assert.doesNotMatch(legacyUnknown.reply, /requiere|foto/i);
const basketUnknown = await say('corte hombre y aclararme el pelo', { kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], evidence: 'corte hombre y aclararme el pelo', confidence: 1, members: [
        { mode: 'single', serviceIds: ['cut'], evidence: 'corte hombre', confidence: 1 },
        { mode: 'single', serviceIds: ['lights'], evidence: 'aclararme el pelo', confidence: 1 }
    ] });
assert.equal(basketUnknown.state.basket?.members[0]?.serviceIds[0], 'cut', 'companions remain selected');
assert.equal(basketUnknown.state.basket?.members[1]?.mode, 'unresolved');
assert.match(basketUnknown.reply, /aclararme el pelo/);
assert.doesNotMatch(basketUnknown.reply, /requiere|foto/i);
const unknownClear = await say('Quiero teñirme arcoíris', { ...req('teñirme arcoíris', 'booking', 'clear', ['lights']), basis: 'semantic_equivalent' });
assert.equal(unknownClear.interpretation.mode, 'ai');
assert.equal(unknownClear.state.serviceId, null, 'a valid category ID cannot prove an undocumented variant');
assert.doesNotMatch(unknownClear.reply, /foto|requiere consulta|no (?:lo )?hacemos/i);
assert.match(unknownClear.reply, /Iluminación|contarme|información/);
const fakeProof = await say('balayage', { ...req('balayage', 'booking', 'clear', ['lights']), basis: 'documented_variant', sourceQuote: 'Hacemos colores arcoíris' });
assert.equal(fakeProof.state.serviceId, null);
const proven = await say('balayage', { ...req('balayage', 'inquiry', 'clear', ['lights']), basis: 'documented_variant', sourceQuote: 'Mechas y balayage' });
assert.equal(proven.state.serviceId, null);
assert.match(proven.reply, /Iluminación/);
assert.equal(proven.state.serviceRequest, undefined, 'documented inquiry resolves without booking');
const needs = await say('Quiero aclararme el pelo', req('aclararme el pelo', 'booking', 'needs_detail', ['lights']));
assert.equal(needs.state.serviceId, null, 'a related category is not a verified requested variant');
assert.match(needs.reply, /aclararme el pelo/i);
assert.match(needs.reply, /cont|resultado|detalle/i);
assert.doesNotMatch(needs.reply, /foto|capacidad/i);
const alternatives = await say('¿Hacen cortes?', req('cortes', 'inquiry', 'alternatives', ['cut', 'cut-w']));
assert.equal(alternatives.state.serviceId, null);
assert.match(alternatives.reply, /Corte hombre/);
assert.match(alternatives.reply, /Corte mujer/);
const clear = await say('¿Hacen corte masculino?', req('corte masculino', 'inquiry', 'clear', ['cut']));
assert.equal(clear.state.serviceId, null, 'a clear inquiry still must not initiate a booking');
assert.match(clear.reply, /Corte hombre/i);
assert.equal(calls, 0);
const independent = await say('Quiero teñirme arcoíris mañana', req('teñirme arcoíris', 'booking'), undefined, [{ kind: 'date', expression: 'mañana', value: '2026-10-05', evidence: 'mañana', confidence: 1 }]);
assert.equal(independent.state.date, '2026-10-05');
assert.equal(independent.state.serviceId, null);
assert.match(independent.reply, /arcoíris/);
assert.throws(() => parseTurnPlan({ version: 1, operations: [req('inventado')] }, 'otro mensaje', ['cut']), /evidence/);
assert.throws(() => parseTurnPlan({ version: 1, operations: [req('corte', 'inquiry', 'clear', ['foreign'])] }, 'corte', ['cut']), /catalog/);
assert.throws(() => parseTurnPlan({ version: 1, operations: [req('corte', 'inquiry', 'clear', [])] }, 'corte', ['cut']));
const low = await say('corte francés', { ...req('corte francés'), confidence: 0.2 });
assert.equal(low.state.serviceId, null);
assert.match(low.reply, /corte francés/);
let body: any;
const provider = createOpenAiInterpretationProvider({ apiKey: 'fake', fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...base, turnPlan: { version: 1, operations: [] } }) }] }] }));
    } });
await provider({ message: 'hola', state: unknown.state, services }, new AbortController().signal);
const input = JSON.parse(body.input);
assert.equal(input.services[0].description, services[0]!.description);
assert.deepEqual(input.services[0].aliases, services[0]!.aliases);
assert.equal(input.serviceRequest.request, 'corte francés');
assert.match(body.instructions, /service_request/);
const strictObjects = (schema: any) => {
    if (schema.type === 'object') {
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    }
    if (schema.properties)
        Object.values(schema.properties).forEach(strictObjects);
    if (schema.items)
        strictObjects(schema.items);
    if (schema.anyOf)
        schema.anyOf.forEach(strictObjects);
};
strictObjects(body.text.format.schema);
assert.throws(() => parseTurnPlan({ version: 1, operations: [req('corte', 'booking', 'clear', ['cut']), { kind: 'confirm_proposal', evidence: 'sí', confidence: 1 }] }, 'corte sí', ['cut']), /consent/);
assert.doesNotMatch(JSON.stringify(input.services), /configurationKey|requiresPhoto/);

const semanticQuestion = await say('cortarme con máquina', {
    ...req('cortarme con máquina', 'inquiry', 'clear', ['cut']), basis: 'semantic_equivalent'
}, previous);
const acceptedMeaning = await say('sí', {
    ...req('sí', 'inquiry', 'clear', ['cut']), continuation: true
}, semanticQuestion.state);
assert.equal(acceptedMeaning.state.serviceRequest, undefined, 'explicit clarification accepts only the proposed catalog identity');
assert.equal(acceptedMeaning.state.serviceId, null, 'clarification of an inquiry is not a booking');
assert.equal(acceptedMeaning.proposal, null);
assert.equal(acceptedMeaning.state.date, previous.date);
assert.match(acceptedMeaning.reply, /Corte hombre/);
const renamedPort: DialoguePort = { ...port, catalog: async () => services.map(service => service.id === 'cut' ? { ...service, name: 'Otro servicio' } : service) };
const renamedYes = await respondWithAiInterpreter(context, semanticQuestion.state, 'sí', renamedPort,
    (async () => ({ ...base, turnPlan: { version: 1, operations: [{ ...req('sí', 'inquiry', 'clear', ['cut']), continuation: true }] } })) as AiInterpretationProvider);
assert.ok(renamedYes.state.serviceRequest, 'a stale candidate label needs new clarification');
assert.equal(renamedYes.state.serviceId, null);
const unverifiedYes = await say('sí', {
    ...req('sí', 'booking', 'clear', ['lights']), continuation: true
}, pendingCategory.state);
assert.equal(unverifiedYes.state.serviceId, null, 'yes cannot establish an undocumented variant');
assert.ok(unverifiedYes.state.serviceRequest);
assert.equal(calls, 0, 'clarification never loads agenda for an inquiry or unverified procedure');


const legacyDirectVariant = await respondWithAiInterpreter(context, previous, 'corte arcoíris', port,
    (async () => ({ ...base, serviceId: 'cut', serviceEvidence: 'corte arcoíris' })) as AiInterpretationProvider);
assert.equal(legacyDirectVariant.state.serviceId, null, 'a direct booking policy cannot verify an undocumented variant');
assert.match(legacyDirectVariant.reply, /Corte hombre/);
assert.equal(legacyDirectVariant.state.date, previous.date);
const directVariant = await say('corte arcoíris', {
    kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'corte arcoíris', confidence: 1
}, previous);
assert.equal(directVariant.state.serviceId, null, 'legacy service operation also requires candidate clarification');
assert.match(directVariant.reply, /Corte hombre/);
const aliasBooking = await say('corte masculino', {
    kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'corte masculino', confidence: 1
});
assert.equal(aliasBooking.state.serviceId, 'cut', 'documented aliases remain legitimate semantic service identities');

const crowdedCatalog = Array.from({ length: 11 }, (_, index) => ({ ...services[0]!, id: 'service-' + index, name: 'Corte opción ' + index, aliases: [] }));
const rawClear = { purpose: 'inquiry' as const, disposition: 'clear' as const, serviceIds: ['service-0'],
    correction: false, continuation: false, basis: 'exact_public_name' as const, sourceQuote: null };
const crowdedResolution = resolveServiceRequest(rawClear, 'corte', 1, crowdedCatalog);
assert.equal(crowdedResolution.disposition, 'needs_detail', 'catalog ambiguity exceeding the typed limit requires detail, not truncated choices');
assert.deepEqual(crowdedResolution.serviceIds, []);
const punctuationResolution = resolveServiceRequest(rawClear, '!!!', 1, crowdedCatalog);
assert.equal(punctuationResolution.disposition, 'needs_detail', 'empty normalized evidence does not match every catalog item');
assert.deepEqual(punctuationResolution.serviceIds, []);
console.log('service request semantic resolution PASS');
