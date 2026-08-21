export function logBookingExtractionDiagnostic(
  stage: string,
  payload: Record<string, unknown>
) {
  if (process.env.BOOKING_EXTRACTION_DIAGNOSTIC?.trim() !== '1') return
  console.info('[booking-extraction-diagnostic]', JSON.stringify({ stage, ...payload }))
}
