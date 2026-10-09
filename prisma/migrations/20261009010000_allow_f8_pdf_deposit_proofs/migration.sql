-- Format-only extension. Financial terms, evidence immutability, byte retention,
-- tenant membership, sequence, size and hash constraints remain unchanged.
ALTER TABLE "BookingDepositProof"
  DROP CONSTRAINT "BookingDepositProof_source_mime_allowed",
  DROP CONSTRAINT "BookingDepositProof_derived_mime_webp",
  ADD CONSTRAINT "BookingDepositProof_source_mime_allowed"
    CHECK ("sourceMimeType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  ADD CONSTRAINT "BookingDepositProof_derived_mime_matches_source"
    CHECK (
      ("sourceMimeType" IN ('image/jpeg', 'image/png', 'image/webp') AND "derivedMimeType" = 'image/webp')
      OR ("sourceMimeType" = 'application/pdf' AND "derivedMimeType" = 'application/pdf')
    );
