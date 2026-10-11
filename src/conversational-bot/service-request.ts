import { serviceEvidenceMeaning } from './service-evidence-grounding.js';
import { affirmativeMatchAnswer } from './contextual-matching.js';
import { selectionBasket, type BasketMutation } from './service-basket.js';
import type { DialogueService, DialogueState } from './engine.js';
import { isCustomerText } from './customer-text.js';
import { SERVICE_INFORMATION_ASPECTS, type ServiceInformationAspect } from './information-contract.js';
import { neutralOwnedServiceInquiry } from './service-information-scope.js';
import { parseEstimateOptions } from '../bot-options/domain/service-booking.js';
export type ServiceRequest = {
    purpose: 'inquiry' | 'booking';
    disposition: 'clear' | 'alternatives' | 'needs_detail' | 'unverified_variant';
    serviceIds: readonly string[];
    correction: boolean;
    continuation: boolean;
    basis: 'exact_public_name' | 'documented_variant' | 'semantic_equivalent' | 'related_category';
    sourceQuote: string | null;
    /** Literal display object and read facet, never catalog or booking authority. */
    subject?: string | null;
    aspect?: ServiceInformationAspect | null;
};
export type ServiceRequestContext = ServiceRequest & {
    businessId: string;
    request: string;
    /** Latest original clarification; never inherited evidence or catalog identity. */
    detail?: string;
    /** Server-rendered candidate name; a renamed catalog entry requires fresh clarification. */
    candidateName?: string;
    /** Server-confirmed catalog reference only; never proof of a requested variant. */
    referenceConfirmed?: true;
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
        item.subject != null && !isCustomerText(item.subject, 300) ||
        item.aspect != null && !SERVICE_INFORMATION_ASPECTS.includes(item.aspect as ServiceInformationAspect) ||
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
        sourceQuote: item.sourceQuote as string | null,
        ...(item.subject !== undefined ? { subject: item.subject as string | null } : {}),
        ...(item.aspect !== undefined ? { aspect: item.aspect as ServiceInformationAspect | null } : {})
    };
}
export function parseServiceRequestContext(value: unknown, businessId: string): ServiceRequestContext {
    const item = value as Record<string, unknown>;
    const keys = 'basis,businessId,continuation,correction,disposition,purpose,request,serviceIds,sourceQuote';
    if (!item || Object.keys(item).filter(key => !['candidateName', 'detail', 'referenceConfirmed', 'subject', 'aspect'].includes(key)).sort().join(',') !== keys ||
        item.candidateName !== undefined && !bounded(item.candidateName, 200) ||
        item.detail !== undefined && !isCustomerText(item.detail, 300) ||
        item.referenceConfirmed !== undefined && (item.referenceConfirmed !== true || !bounded(item.candidateName, 200) ||
            !Array.isArray(item.serviceIds) || item.serviceIds.length !== 1 || item.basis !== 'related_category' ||
            !['needs_detail', 'unverified_variant'].includes(String(item.disposition))) ||
        item.businessId !== businessId || !isCustomerText(item.request, 300) ||
        typeof item.subject === 'string' && !item.request.includes(item.subject)) {
        throw new Error('invalid service request scope');
    }
    return { ...parseServiceRequest(item), businessId, request: item.request,
        ...(item.candidateName !== undefined ? { candidateName: item.candidateName as string } : {}),
        ...(item.detail !== undefined ? { detail: item.detail as string } : {}),
        ...(item.referenceConfirmed === true ? { referenceConfirmed: true as const } : {}) };
}
/** Retain an object only for an admitted current clarification of the same request. */
export function retainServiceRequestBase(previous: ServiceRequestContext | undefined, current: ServiceRequest,
    evidence: string, services: readonly DialogueService[], admitted: boolean): string {
    if (!admitted || !previous || !current.continuation || current.correction || current.disposition === 'clear' ||
        previous.purpose !== current.purpose ||
        previous.serviceIds.some(id => !services.some(service => service.id === id)) ||
        current.serviceIds.some(id => !previous.serviceIds.includes(id)) ||
        previous.candidateName !== undefined && (previous.serviceIds.length !== 1 ||
            previous.candidateName !== services.find(service => service.id === previous.serviceIds[0])?.name)) return evidence;
    return previous.request;
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
export function assessServiceIdentity(evidence: string, proposedId: string, confidence: number, services: readonly DialogueService[], retainedIds: readonly string[] = []): ServiceIdentityAssessment {
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
    // A unique reference to a retained, freshly named draft item is not a new generic catalog request.
    const retained = matching.filter(item => retainedIds.includes(item.id));
    if (retained.length === 1 && retained[0]!.id === proposedId) return { kind: 'supported', serviceIds: [service.id] };
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
    if (request.continuation && !request.correction &&
        !(request.purpose === 'inquiry' && previous?.purpose === 'booking') && previous?.disposition === 'needs_detail' &&
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

/** Display never truncates a suffix qualifier; proof always retains the full original request. */
export function serviceRequestSubject(request: ServiceRequestContext): string {
    return request.subject && normalized(request.request).endsWith(normalized(request.subject)) ? request.subject : request.request;
}
/** Only a complete current catalog-category phrase resolves on published selection.
 * A proposed subject can narrow that phrase only when the existing neutral reader consumes every other word. */
export function serviceRequestCaveat(request: ServiceRequestContext, services: readonly DialogueService[]): string {
    const meaning = request.subject && request.aspect && neutralOwnedServiceInquiry(request.request, request.subject, request.aspect)
        ? request.subject : request.request;
    const terms = identityWords(serviceEvidenceMeaning(meaning, services));
    const candidates = services.filter(service => request.serviceIds.includes(service.id));
    const category = !request.detail && terms.length > 0 && candidates.length === request.serviceIds.length && candidates.length > 0 &&
        candidates.every(service => [service.name, ...service.aliases ?? []].some(label => terms.every(term => identityWords(label).includes(term))));
    return category ? '' : 'No tengo confirmado si incluye «' + serviceRequestSubject(request) + '».';
}
/** One server acknowledgment owns selection; the downstream standard question may already own its greeting. */
export function serviceSelectionNote(request: ServiceRequestContext, names: readonly string[], next: string, services: readonly DialogueService[]): string {
    return [next.startsWith('Perfecto') ? '' : 'Perfecto, seguimos con ' + names.join(' + ') + '.', serviceRequestCaveat(request, services)].filter(Boolean).join('\n');
}

/** Short actual question; catalog options remain context, not matching or selection authority. */
export function serviceRequestQuestion(request: ServiceRequestContext): string {
    if (request.referenceConfirmed) return '¿Querés elegir el servicio publicado o consultar esa técnica con el equipo?';
    if (request.disposition === 'alternatives') return '¿Cuál de estas opciones te interesa?';
    if (request.disposition === 'needs_detail' && request.basis === 'semantic_equivalent' && request.candidateName) {
        return '¿Te referís al servicio publicado ' + request.candidateName + ' o buscás un procedimiento distinto?';
    }
    if (request.serviceIds.length === 1) return '¿Te referís a ese servicio o qué resultado buscás?';
    if (request.serviceIds.length > 1) return '¿Alguna corresponde a lo que buscás o podés contarme el resultado que querés?';
    return '¿Podés contarme un poco más sobre el resultado que buscás?';
}
/** Verify only a server-owned live referent; the model owns the speech-act interpretation. */
export function validServiceReferenceContext(request: ServiceRequestContext | undefined, serviceId: string,
    businessId: string, services: readonly DialogueService[],
    question: { role: string; question: string; options: readonly { id: string; label: string }[]; complete: boolean } | undefined): boolean {
    return !!request && request.businessId === businessId && !request.referenceConfirmed && request.basis === 'related_category' &&
        ['needs_detail', 'unverified_variant'].includes(request.disposition) && request.serviceIds.length === 1 &&
        request.serviceIds[0] === serviceId && !!request.candidateName && !!question?.complete &&
        question.role === 'service' && question.question === serviceRequestQuestion(request) &&
        question.options.length === 1 && question.options[0]!.id === serviceId &&
        question.options[0]!.label === request.candidateName &&
        services.find(service => service.id === serviceId)?.name === request.candidateName;
}


/** Published choice proof is bounded to the actual displayed catalog question, not the technique. */
export function validServiceCandidateContext(request: ServiceRequestContext | undefined, serviceId: string,
    businessId: string, services: readonly DialogueService[],
    question: { businessId?: string; role: string; question: string; options: readonly { id: string; label: string }[]; complete: boolean } | undefined,
    bookingOnly = true): boolean {
    return !!request && request.businessId === businessId && (!bookingOnly || request.purpose === 'booking') &&
        request.disposition !== 'clear' && request.serviceIds.includes(serviceId) && !!question?.complete &&
        question.businessId === businessId && (!bookingOnly || question.role === 'service') &&
        question.question === serviceRequestQuestion(request) && question.options.length === request.serviceIds.length &&
        request.serviceIds.every(id => question.options.some(option => option.id === id &&
            services.some(service => service.id === id && service.name === option.label))) &&
        (request.candidateName === undefined || request.serviceIds.length === 1 &&
            services.find(service => service.id === request.serviceIds[0])?.name === request.candidateName);
}
/** Shared semantic/click selection retains unrelated peers and resolves only its own pending member. */
export function serviceCandidateMutation(state: Pick<DialogueState, 'serviceId' | 'basket'>, request: ServiceRequestContext,
    serviceId: string, evidence: string, confidence: number): BasketMutation {
    const basket = selectionBasket(state);
    const target = basket.members.find(member => member.mode === 'alternatives' && member.serviceIds.includes(serviceId) ||
        member.mode === 'unresolved' && member.evidence === request.request);
    return { kind: 'basket', mutation: target ? 'replace' : request.correction || !basket.members.length ? 'set' : 'add',
        scope: target ? 'members' : 'all', targetMemberIds: target ? [target.memberId] : [],
        members: [{ mode: 'single', serviceIds: [serviceId], evidence, confidence }], evidence, confidence };
}
/** Material and continuation are explicit, so frame projection cannot discard the active question. */
export function serviceRequestDelivery(request: ServiceRequestContext, services: readonly DialogueService[]) {
    const question = serviceRequestQuestion(request);
    const reply = serviceRequestReply(request, services);
    const body = reply.includes(question) ? reply.replace(question, '').trim() : reply;
    return { reply: body + '\n' + question, facts: [{ id: 'procedure', text: body }, { id: 'next', text: question }] };
}

export function serviceRequestReply(request: ServiceRequestContext, services: readonly DialogueService[]): string {
    const candidates = services.filter(service => request.serviceIds.includes(service.id));
    const description = serviceRequestSubject(request) + (request.detail ? ' — ' + request.detail : '');
    if (request.referenceConfirmed && candidates.length === 1 && candidates[0]!.name === request.candidateName) {
        return 'Perfecto, te referís al servicio publicado ' + candidates[0]!.name + '.\n' +
            serviceRequestCaveat(request, services) + '\n' + serviceRequestQuestion(request);
    }
    if (request.disposition === 'alternatives') {
        return 'Para «' + description + '», estas son las opciones del catálogo:\n' +
            candidates.map(service => '• ' + service.name).join('\n') + '\n' + serviceRequestQuestion(request);
    }
    if (request.disposition === 'needs_detail' && request.basis === 'semantic_equivalent' && candidates.length === 1) {
        return 'No tengo información confirmada sobre «' + description + '». ' +
            '¿Te referís al servicio publicado ' + candidates[0]!.name + ' o buscás un procedimiento distinto?';
    }
    const uncertainty = 'No tengo información confirmada sobre «' + description + '». ';
    // Related catalog entries are clarification options, not proof of the requested technique.
    if (candidates.length === 1) {
        return uncertainty + 'En el catálogo está ' + candidates[0]!.name + ', que podría estar relacionado. ' +
            '¿Te referís a ese servicio o qué resultado buscás?';
    }
    if (candidates.length > 1) {
        return uncertainty + 'Estas opciones del catálogo podrían estar relacionadas:\n' +
            candidates.map(service => '• ' + service.name).join('\n') +
            '\n¿Alguna corresponde a lo que buscás o podés contarme el resultado que querés?';
    }
    return uncertainty + '¿Podés contarme un poco más sobre el resultado que buscás?';
}
/** Bounded public catalog text is context, not instructions or variant authorization. */
export function publicServiceRequestCatalog(services: readonly DialogueService[]) {
    return services.map(service => ({
        id: service.id,
        name: service.name,
        aliases: (service.aliases ?? []).filter(alias => bounded(alias, 200)).slice(0, 20),
        description: typeof service.description === 'string' ? service.description.slice(0, 2000) : null,
        price: service.price !== null && Number.isFinite(service.price) && service.price >= 0 ? service.price : null,
        priceMode: service.priceMode === 'STARTING_AT' ? 'STARTING_AT' : 'FIXED',
        durationMinutes: service.durationMinutes != null && Number.isFinite(service.durationMinutes) && service.durationMinutes > 0 ? service.durationMinutes : null,
        durationMinMinutes: service.durationMinMinutes != null && Number.isFinite(service.durationMinMinutes) && service.durationMinMinutes > 0 ? service.durationMinMinutes : null,
        durationMaxMinutes: service.durationMaxMinutes != null && Number.isFinite(service.durationMaxMinutes) && service.durationMaxMinutes > 0 ? service.durationMaxMinutes : null,
        guidance: service.bookingPolicy ? {
            attentionMode: service.bookingPolicy.attentionMode,
            question: service.bookingPolicy.estimateQuestion,
            options: (parseEstimateOptions(service.bookingPolicy.estimateOptions) ?? []).map(option => ({ id: option.id, label: option.label, priceMin: option.priceMin, priceMax: option.priceMax })),
            requiresConsultation: service.requiresConsultation
        } : null
    }));
}
/** A legacy category proposal needs catalog-backed confirmation, not an automatic selection. */
export function requiresServiceVerification(evidence: string, service: DialogueService, services: readonly DialogueService[], confidence = 1): boolean {
    const proof = assessServiceIdentity(evidence, service.id, confidence, services);
    return proof.kind !== 'supported' && proof.kind !== 'alternatives';
}
