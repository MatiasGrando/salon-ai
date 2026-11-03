ALTER TABLE "Business" ADD COLUMN "allowGuestWebBooking" BOOLEAN NOT NULL DEFAULT false;

-- A capability grants only the newly created web booking, never phone-based history.
-- No financial ledger, payment or deposit terms are modified by this migration.
CREATE TABLE "GuestBookingAccess" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentIds" TEXT[] NOT NULL,
  "depositId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestBookingAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuestBookingAccess_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GuestBookingAccess_nonempty_appointments" CHECK (cardinality("appointmentIds") > 0)
);
CREATE UNIQUE INDEX "GuestBookingAccess_tokenHash_key" ON "GuestBookingAccess"("tokenHash");
CREATE INDEX "GuestBookingAccess_businessId_expiresAt_idx" ON "GuestBookingAccess"("businessId", "expiresAt");
