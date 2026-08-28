-- F1.8 prerequisite for F6 availability. Additive only: existing businesses
-- are intentionally NOT backfilled with an invented timezone. The bot must
-- remain fail-closed until an explicit settings row exists.
BEGIN;

CREATE TABLE "BusinessBotOptionsSettings" (
  "businessId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30,
  "bookingLeadTimeHours" INTEGER NOT NULL DEFAULT 0,
  "morningCutTime" TEXT NOT NULL DEFAULT '12:30',
  "eveningCutTime" TEXT NOT NULL DEFAULT '16:30',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessBotOptionsSettings_pkey" PRIMARY KEY ("businessId"),
  CONSTRAINT "BusinessBotOptionsSettings_businessId_fkey" FOREIGN KEY ("businessId")
    REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessBotOptionsSettings_horizon_check" CHECK ("bookingHorizonDays" BETWEEN 1 AND 90),
  CONSTRAINT "BusinessBotOptionsSettings_lead_check" CHECK (
    "bookingLeadTimeHours" >= 0 AND "bookingLeadTimeHours" < "bookingHorizonDays" * 24
  ),
  CONSTRAINT "BusinessBotOptionsSettings_cut_format_check" CHECK (
    "morningCutTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "eveningCutTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "morningCutTime" < "eveningCutTime"
  )
);

ALTER TABLE "Professional"
  ADD COLUMN "botBookingPriority" INTEGER NOT NULL DEFAULT 100,
  ADD CONSTRAINT "Professional_botBookingPriority_check" CHECK ("botBookingPriority" >= 0);

COMMIT;
