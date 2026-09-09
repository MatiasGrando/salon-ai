ALTER TABLE "WorkshopPerformer"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "WorkshopPerformer_businessId_active_name_idx"
ON "WorkshopPerformer"("businessId", "active", "name");
