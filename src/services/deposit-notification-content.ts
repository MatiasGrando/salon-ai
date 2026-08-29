export const DEPOSIT_NOTIFICATION_TEXT = {
  PROOF_RECEIVED: 'Recibimos tu comprobante. El horario continúa reservado mientras el equipo verifica el pago. Te avisamos por acá cuando quede confirmado.',
  APPROVED: 'Aprobamos el comprobante y tu turno quedó confirmado. Te esperamos.',
  EXPIRED: 'Venció el plazo para enviar el comprobante y el horario fue liberado. Si necesitás ayuda, escribinos por acá.',
  RESUBMISSION: 'Revisamos el comprobante y necesitamos que envíes uno nuevo. El horario sigue reservado por un tiempo limitado.',
  FINAL_REJECTION: 'No pudimos validar el comprobante y el horario fue liberado. Si necesitás ayuda, escribinos por acá.',
  LATE_PROOF: 'Recibimos tu comprobante después del vencimiento. El horario no se reabre automáticamente; el equipo va a revisarlo y te responderá por acá.',
  INVALID_PROOF: 'No pudimos aceptar ese archivo como comprobante. Enviá una imagen JPEG, PNG o WebP de hasta 3 MB.',
  PROOF_UNAVAILABLE: 'No pudimos procesar el comprobante en este momento. Por favor, volvé a enviarlo más tarde.'
} as const

export type DepositNotificationKind = keyof typeof DEPOSIT_NOTIFICATION_TEXT

/** Text is intentionally static: never place proof filename, bytes, hashes or reviewer reason in the outbox. */
export function renderDepositNotification(kind: DepositNotificationKind) {
  return { type: 'informative_text' as const, body: DEPOSIT_NOTIFICATION_TEXT[kind] }
}
