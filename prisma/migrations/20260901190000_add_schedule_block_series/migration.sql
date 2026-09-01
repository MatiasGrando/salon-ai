ALTER TABLE "ScheduleBlock" ADD COLUMN "seriesId" TEXT;

CREATE INDEX "ScheduleBlock_businessId_seriesId_idx"
ON "ScheduleBlock"("businessId", "seriesId");
