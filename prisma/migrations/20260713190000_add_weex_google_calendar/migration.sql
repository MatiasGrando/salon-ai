ALTER TABLE "WeexAccount"
  ADD COLUMN "googleCalendarAccessToken" TEXT,
  ADD COLUMN "googleCalendarRefreshToken" TEXT,
  ADD COLUMN "googleCalendarTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "googleCalendarScope" TEXT;

ALTER TABLE "Appointment"
  ADD COLUMN "googleCalendarEventId" TEXT,
  ADD COLUMN "googleCalendarAccountId" TEXT;
