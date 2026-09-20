ALTER TABLE "Customer"
ADD COLUMN "instagramUserId" TEXT,
ADD COLUMN "instagramUsername" TEXT;

ALTER TABLE "PipelineLead"
ADD COLUMN "customerId" TEXT;

CREATE UNIQUE INDEX "Customer_businessId_instagramUserId_key"
ON "Customer"("businessId", "instagramUserId");

CREATE INDEX "Customer_businessId_instagramUsername_idx"
ON "Customer"("businessId", "instagramUsername");

CREATE INDEX "PipelineLead_businessId_customerId_idx"
ON "PipelineLead"("businessId", "customerId");

ALTER TABLE "PipelineLead"
ADD CONSTRAINT "PipelineLead_businessId_customerId_fkey"
FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
