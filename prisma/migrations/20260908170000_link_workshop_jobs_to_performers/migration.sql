ALTER TABLE "WorkshopJob"
ALTER COLUMN "responsible" DROP NOT NULL;

ALTER TABLE "WorkshopJob"
ADD COLUMN "performerId" TEXT;

ALTER TABLE "WorkshopPerformer"
ADD CONSTRAINT "WorkshopPerformer_businessId_id_key" UNIQUE ("businessId", "id");

ALTER TABLE "WorkshopJob"
ADD CONSTRAINT "WorkshopJob_businessId_performerId_fkey"
FOREIGN KEY ("businessId", "performerId")
REFERENCES "WorkshopPerformer"("businessId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WorkshopJob_businessId_performerId_date_idx"
ON "WorkshopJob"("businessId", "performerId", "date");
