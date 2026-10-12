import { cancellationFingerprint, type CancellationSnapshot } from './appointment-management.js'
import { canonicalJsonHash } from './canonical-json.js'
export type OwnAppointmentAction = 'read' | 'cancel' | 'reschedule'
export type OwnAppointment = { key: string; label: string; snapshot: CancellationSnapshot }
export type OwnAppointments = { businessId: string; sessionId: string; revision: string; dbNow: string; items: OwnAppointment[]; hasMore: boolean }
export type OwnAppointmentInquiry = { action: OwnAppointmentAction; sessionId: string; options: { key: string; fingerprint: string; label:string }[] }
export const ownAppointmentKey = (snapshot: CancellationSnapshot) => 'appointment:' + canonicalJsonHash({ businessId: snapshot.scope.businessId, customerId: snapshot.scope.customerId,
  groupId: snapshot.groupId, appointmentIds: snapshot.members.map(item => item.appointmentId).sort() }).slice(0, 24)
export function ownAppointmentOptions(items: readonly OwnAppointment[]) {
  return items.map(item => ({ key: item.key, fingerprint: cancellationFingerprint(item.snapshot), label:item.label.length>600 ? item.label.slice(0,599)+'…' : item.label }))
}
export function parseOwnAppointmentInquiry(value: unknown): OwnAppointmentInquiry {
  const v = value as OwnAppointmentInquiry
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'action,options,sessionId' ||
    !['read','cancel','reschedule'].includes(v.action) || typeof v.sessionId !== 'string' || !v.sessionId || v.sessionId.length > 128 ||
    !Array.isArray(v.options) || v.options.length > 10 || new Set(v.options.map(o=>o.key)).size !== v.options.length ||
    v.options.some(o => !o || Object.keys(o).sort().join(',') !== 'fingerprint,key,label' || !/^appointment:[a-f0-9]{24}$/.test(o.key) || !/^[a-f0-9]{64}$/.test(o.fingerprint) ||
      typeof o.label!=='string' || !o.label.trim() || o.label.length>600 || /[\u0000-\u0009\u000b-\u001f]/.test(o.label))) throw new Error('invalid own appointment inquiry')
  return structuredClone(v)
}
