import { validateDepositProofImage, DepositProofImageValidationError, DEPOSIT_PROOF_MAX_BYTES, type DepositProofImageValidationResult } from './deposit-proof-image-validation.js'
import { validateDepositProofPdf, DepositProofValidationError, type DepositProofPdfValidationResult } from './deposit-proof-pdf-validation.js'
export { DepositProofValidationError } from './deposit-proof-pdf-validation.js'
export type DepositProofValidationResult = DepositProofImageValidationResult | DepositProofPdfValidationResult

/** Technical admission only. No OCR, payment inference, approval or I/O. */
export async function validateDepositProof(input: { data: Uint8Array; declaredMimeType?: string | null; filename?: string | null }): Promise<DepositProofValidationResult> {
  if (!input.data.byteLength || input.data.byteLength > DEPOSIT_PROOF_MAX_BYTES) throw new DepositProofValidationError('TOO_LARGE')
  const pdfMagic = Buffer.from(input.data).subarray(0, 5).toString('ascii') === '%PDF-'
  const declaredPdf = String(input.declaredMimeType ?? '').trim().toLowerCase() === 'application/pdf'
  if (pdfMagic || declaredPdf) return validateDepositProofPdf(input)
  try { return await validateDepositProofImage(input) }
  catch (error) {
    if (error instanceof DepositProofImageValidationError) throw new DepositProofValidationError(error.code)
    throw error
  }
}
