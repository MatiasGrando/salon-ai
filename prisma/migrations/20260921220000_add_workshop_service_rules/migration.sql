ALTER TABLE "WorkshopShortcut"
  ADD COLUMN "recurrenceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "returnMonths" INTEGER,
  ADD COLUMN "returnKilometers" INTEGER,
  ADD COLUMN "customerInstructions" TEXT NOT NULL DEFAULT '';

ALTER TABLE "WorkshopShortcut"
  ADD CONSTRAINT "WorkshopShortcut_returnMonths_check" CHECK ("returnMonths" IS NULL OR ("returnMonths" >= 1 AND "returnMonths" <= 240)),
  ADD CONSTRAINT "WorkshopShortcut_returnKilometers_check" CHECK ("returnKilometers" IS NULL OR ("returnKilometers" >= 1 AND "returnKilometers" <= 1000000)),
  ADD CONSTRAINT "WorkshopShortcut_recurrence_check" CHECK (NOT "recurrenceEnabled" OR "returnMonths" IS NOT NULL OR "returnKilometers" IS NOT NULL);