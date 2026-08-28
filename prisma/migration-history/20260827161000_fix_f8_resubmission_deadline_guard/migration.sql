-- A resubmission deadline is renewed from the review transaction's DB clock.
-- It may be earlier than the original deadline when review happens before the
-- old hold is close to expiring; the invariant is that the new deadline is in
-- the future, not that it is greater than a historical deadline.
CREATE OR REPLACE FUNCTION "reject_f8_booking_deposit_terms_update"() RETURNS trigger AS $$
BEGIN
  IF OLD."visitId" IS NOT NULL AND OLD."snapshotSealedAt" IS NOT NULL AND NOT (
    NEW."id" IS NOT DISTINCT FROM OLD."id" AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId"
    AND NEW."appointmentId" IS NOT DISTINCT FROM OLD."appointmentId" AND NEW."conversationId" IS NOT DISTINCT FROM OLD."conversationId"
    AND NEW."visitId" IS NOT DISTINCT FROM OLD."visitId" AND NEW."source" IS NOT DISTINCT FROM OLD."source"
    AND NEW."mode" IS NOT DISTINCT FROM OLD."mode" AND NEW."configuredValue" IS NOT DISTINCT FROM OLD."configuredValue"
    AND NEW."baseAmount" IS NOT DISTINCT FROM OLD."baseAmount" AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
    AND NEW."holdTtlMinutes" IS NOT DISTINCT FROM OLD."holdTtlMinutes" AND NEW."holdTtlProvenance" IS NOT DISTINCT FROM OLD."holdTtlProvenance"
    AND NEW."snapshotSealedAt" IS NOT DISTINCT FROM OLD."snapshotSealedAt" AND NEW."proofMessageId" IS NOT DISTINCT FROM OLD."proofMessageId"
    AND NEW."proofData" IS NOT DISTINCT FROM OLD."proofData" AND NEW."proofMimeType" IS NOT DISTINCT FROM OLD."proofMimeType"
    AND NEW."proofFilename" IS NOT DISTINCT FROM OLD."proofFilename" AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    AND (
      (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
       AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" AND NEW."reviewedAt" IS NOT DISTINCT FROM OLD."reviewedAt"
       AND NEW."reviewedByUserId" IS NOT DISTINCT FROM OLD."reviewedByUserId" AND NEW."rejectionReason" IS NOT DISTINCT FROM OLD."rejectionReason"
       AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt" AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason")
      OR (OLD."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
       AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt"
       AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason")
      OR (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
       AND NEW."expiredAt" IS NOT NULL AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED')
      OR (OLD."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
       AND NEW."expiredAt" IS NOT NULL AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED')
      OR (OLD."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" AND NEW."status" IN ('APPROVED'::"BookingDepositStatus", 'REJECTED'::"BookingDepositStatus")
       AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewedByUserId" IS NOT NULL)
      OR (OLD."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" AND NEW."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus"
       AND NEW."expiresAt" > clock_timestamp() AND NEW."expiredAt" IS NULL AND NEW."expirationReason" IS NULL
       AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewedByUserId" IS NOT NULL AND NEW."rejectionReason" IS NOT NULL)
    )
  ) THEN RAISE EXCEPTION 'sealed F8 BookingDeposit terms are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
