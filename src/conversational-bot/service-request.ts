import { serviceEvidenceMeaning } from './service-evidence-grounding.js';
import { affirmativeMatchAnswer } from './contextual-matching.js';
import type { DialogueService } from './engine.js';
export type ServiceRequest = {
    purpose: 'inquiry' | 'booking';
    disposition: 'clear' | 'alternatives' | 'needs_detail' | 'unverified_variant';
    serviceIds: readonly string[];
    correction: boolean;
    continuation: boolean;
    basis: 'exact_public_name' | 'documented_variant' | 'semantic_equivalent' | 'related_category';
    sourceQuote: string | null;
};
export type ServiceRequestContext = ServiceRequest & {
    businessId: string;
    request: string;
    /** Server-rendered candidate name; a renamed catalog entry requires fresh clarification. */
    candidateName?: string;
};
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
export function parseServiceRequest(value: unknown, catalogIds?: readonly string[]): ServiceRequest {
    const item = value as Record<string, unknown>;
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !['inquiry', 'booking'].includes(String(item.purpose)) ||
        !['clear', 'alternatives', 'needs_detail', 'unverified_variant'].includes(String(item.disposition)) ||
        typeof item.correction !== 'boolean' || typeof item.continuation !== 'boolean' ||
        !['exact_public_name', 'documented_variant', 'semantic_equivalent', 'related_category'].includes(String(item.basis)) ||
        !(item.sourceQuote === null || bounded(item.sourceQuote, 500)) ||
        !Array.isArray(item.serviceIds) || item.serviceIds.length > 10 ||
        new Set(item.serviceIds).size !== item.serviceIds.length ||
        item.serviceIds.some(id => !bounded(id, 128) || catalogIds && !catalogIds.includes(id))) {
        throw new Error('invalid service request catalog');
    }
    if (item.disposition === 'clear' && item.serviceIds.length !== 1 ||
        item.disposition === 'alternatives' && item.serviceIds.length < 2) {
        throw new Error('invalid service request disposition');
    }
    return {
        purpose: item.purpose as ServiceRequest['purpose'],
        disposition: item.disposition as ServiceRequest['disposition'],
        serviceIds: [...item.serviceIds] as string[],
        correction: item.correction,
        continuation: item.continuation,
        basis: item.basis as ServiceRequest['basis'],
        sourceQuote: item.sourceQuote as string | null
    };
}
export function parseServiceRequestContext(value: unknown, businessId: string): ServiceRequestContext {
    const item = value as Record<string, unknown>;
    const keys = 'basis,businessId,continuation,correction,disposition,purpose,request,serviceIds,sourceQuote';
    if (!item || Object.keys(item).filter(key => key !== 'candidateName').sort().join(',') !== keys ||
        item.candidateName !== undefined && !bounded(item.candidateName, 200) ||
        item.businessId !== businessId || !bounded(item.request, 300)) {
        throw new Error('invalid service request scope');
    }
    return { ...parseServiceRequest(item), businessId, request: item.request,
        ...(item.candidateName !== undefined ? { candidateName: item.candidateName as string } : {}) };
}
export type ServiceIdentityAssessment = { kind: 'supported' | 'alternatives' | 'confirm' | 'unproven'; serviceIds: string[] };
const articles = new Set(['un', 'una', 'el', 'la', 'de', 'del']);
const identityWords = (value: string) => normalized(value).split(' ').filter(term => term && !articles.has(term) && term !== 'y');
/** One bounded edit of a complete public label. Retrieval scores never establish identity. */
function singleLabelEdit(left: string, right: string): boolean {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 4) return false;
    let a = 0, b = 0, edits = 0;
    while (a < left.length && b < right.length) {
        if (left[a] === right[b]) { a++; b++; continue; }
        if (++edits > 1) return false;
        if (left.length >= right.length) a++;
        if (right.length >= left.length) b++;
    }
    return edits + (a < left.length || b < right.length ? 1 : 0) === 1;
}
/** Pure current-catalog identity proof; literal grounding belongs to the unchanged plan parser. */
export function assessServiceIdentity(evidence: string, proposedId: string, confidence: number, services: readonly DialogueService[]): ServiceIdentityAssessment {
    const service = services.find(item => item.id === proposedId);
    const meaning = serviceEvidenceMeaning(evidence, services);
    const terms = identityWords(meaning);
    const unproven: ServiceIdentityAssessment = { kind: service && terms.length ? 'confirm' : 'unproven', serviceIds: service && terms.length ? [service.id] : [] };
    if (!service || !terms.length || confidence < 0.85 || /[?¿]/.test(evidence)) return unproven;
    const labels = (item: DialogueService) => [item.name, ...item.aliases ?? []];
    // A qualifier in an actual complete label (e.g. "sin formol") is public data, not a veto.
    const exact = services.filter(item => labels(item).some(label => normalized(label) === normalized(meaning)));
    if (exact.length === 1 && exact[0]!.id === proposedId) return { kind: 'supported', serviceIds: [service.id] };
    const close = services.filter(item => labels(item).some(label => {
        const words = identityWords(label);
        return words.length === terms.length && words.filter((word, index) => word !== terms[index]).length === 1 &&
            words.every((word, index) => singleLabelEdit(terms[index]!, word));
    }));
    if (!exact.length && close.length === 1 && close[0]!.id === proposedId) return { kind: 'supported', serviceIds: [service.id] };
    if (/\b(no|ni|sin|nunca|quizas|depende|tal vez|si)\b/.test(normalized(evidence))) return unproven;
    const matching = services.filter(item => labels(item).some(label => terms.every(term => identityWords(label).includes(term))));
    if (matching.length > 10) return { kind: 'unproven', serviceIds: [] };
    if (matching.length > 1) return { kind: 'alternatives', serviceIds: matching.map(item => item.id) };
    if (matching[0]?.id === service.id || service.description &&
        (' ' + normalized(service.description) + ' ').includes(' ' + normalized(meaning) + ' ')) return { kind: 'supported', serviceIds: [service.id] };
    return unproven;
}
/** Interpretation proposes meaning; a category ID alone never proves a documented variant. */
export function resolveServiceRequest(raw: ServiceRequest, evidence: string, confidence: number, services: readonly DialogueService[], previous?: ServiceRequestContext): ServiceRequest {
    const request = parseServiceRequest(raw, services.map(service => service.id));
    if (confidence < 0.85)
        return { ...request, disposition: 'needs_detail' };
    // A yes answers a single proposed catalog identity, never authorizes an undocumented variant.
    if (request.continuation && !request.correction && previous?.disposition === 'needs_detail' &&
        previous.basis === 'semantic_equivalent' && previous.serviceIds.length === 1 &&
        request.serviceIds.length === 1 && request.serviceIds[0] === previous.serviceIds[0] &&
        previous.candidateName === services.find(service => service.id === previous.serviceIds[0])?.name &&
        affirmativeMatchAnswer(evidence, [])) {
        return { ...request, purpose: previous.purpose, disposition: 'clear', basis: 'exact_public_name', sourceQuote: null };
    }
    if (request.disposition !== 'clear')
        return request;
    const assessment = assessServiceIdentity(evidence, request.serviceIds[0]!, confidence, services);
    if (assessment.kind === 'unproven') return { ...request, disposition: 'needs_detail', serviceIds: [] };
    if (assessment.kind === 'alternatives') return { ...request, disposition: 'alternatives', serviceIds: assessment.serviceIds };
    const service = services.find(item => item.id === request.serviceIds[0])!;
    const quote = request.sourceQuote;
    const documented = request.basis === 'documented_variant' && quote &&
        service.description?.includes(quote) &&
        (' ' + normalized(quote) + ' ').includes(' ' + normalized(evidence) + ' ');
    if (assessment.kind === 'supported' && request.basis !== 'documented_variant' || documented)
        return request;
    return {
        ...request,
        disposition: request.basis === 'semantic_equivalent' ? 'needs_detail' : 'unverified_variant'
    };
}
export function serviceRequestReply(request: ServiceRequestContext, services: readonly DialogueService[]): string {
    const candidates = services.filter(service => request.serviceIds.includes(service.id));
    if (request.disposition === 'alternatives') {
        return 'Para «' + request.request + '», ¿cuál de estas opciones te interesa?\n' +
            candidates.map(service => '• ' + service.name).join('\n');
    }
    if (request.disposition === 'needs_detail' && request.basis === 'semantic_equivalent' && candidates.length === 1) {
        return 'No tengo información confirmada sobre «' + request.request + '». ' +
            '¿Te referís al servicio publicado ' + candidates[0]!.name + ' o buscás un procedimiento distinto?';
    }
    if (request.disposition === 'needs_detail') {
        return 'Para ayudarte con «' + request.request + '», ¿podés contarme un poco más sobre el resultado que buscás?';
    }
    return 'No tengo información confirmada sobre «' + request.request +
        '». ¿Querés consultarlo con el equipo o contarme más sobre lo que necesitás?';
}
/** Bounded public catalog text is context, not instructions or variant authorization. */
export function publicServiceRequestCatalog(services: readonly DialogueService[]) {
    return services.map(service => ({
        id: service.id,
        name: service.name,
        aliases: (service.aliases ?? []).filter(alias => bounded(alias, 200)).slice(0, 20),
        description: typeof service.description === 'string' ? service.description.slice(0, 2000) : null,
        guidance: service.bookingPolicy ? {
            attentionMode: service.bookingPolicy.attentionMode,
            question: service.bookingPolicy.estimateQuestion,
            options: (service.bookingPolicy.estimateOptions ?? []).map(option => ({ id: option.id, label: option.label })),
            requiresConsultation: service.requiresConsultation
        } : null
    }));
}
/** A legacy category proposal needs catalog-backed confirmation, not an automatic selection. */
export function requiresServiceVerification(evidence: string, service: DialogueService, services: readonly DialogueService[], confidence = 1): boolean {
    const proof = assessServiceIdentity(evidence, service.id, confidence, services);
    return proof.kind !== 'supported' && proof.kind !== 'alternatives';
}
