ALTER TYPE "InstagramPublicationStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "InstagramPublicationStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "InstagramPublication"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "scheduleTimezone" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "destinationInstagramAccountId" TEXT,
  ADD COLUMN "destinationApiAccountId" TEXT,
  ADD COLUMN "videoDeleteRequestedAt" TIMESTAMP(3),
  ADD CONSTRAINT "InstagramPublication_schedule_pair" CHECK (("scheduledAt" IS NULL) = ("scheduleTimezone" IS NULL)),
  ADD CONSTRAINT "InstagramPublication_revision_nonnegative" CHECK ("revision" >= 0),
  ADD CONSTRAINT "InstagramPublication_destination_pair" CHECK (("destinationInstagramAccountId" IS NULL) = ("destinationApiAccountId" IS NULL)),
  ADD CONSTRAINT "InstagramPublication_scheduled_target" CHECK ("status"::text <> 'SCHEDULED' OR
    ("scheduledAt" IS NOT NULL AND "scheduleTimezone" IS NOT NULL AND "scheduleTimezone" <> '' AND
      "destinationInstagramAccountId" IS NOT NULL AND "destinationInstagramAccountId" <> '' AND
      "destinationApiAccountId" IS NOT NULL AND "destinationApiAccountId" <> ''));

CREATE INDEX "InstagramPublication_status_scheduledAt_idx" ON "InstagramPublication"("status", "scheduledAt");
-- No backfill from current credentials: legacy destination and desired time remain unknown.
