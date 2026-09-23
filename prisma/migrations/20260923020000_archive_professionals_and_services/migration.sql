ALTER TABLE "Professional" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Service" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Professional_businessId_archivedAt_idx" ON "Professional"("businessId", "archivedAt");
CREATE INDEX "Service_businessId_archivedAt_idx" ON "Service"("businessId", "archivedAt");
