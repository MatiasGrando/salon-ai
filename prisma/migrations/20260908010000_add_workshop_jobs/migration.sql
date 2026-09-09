CREATE TABLE "WorkshopJob" (
 "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL,
 "date" TEXT NOT NULL, "mileage" INTEGER NOT NULL, "responsible" TEXT NOT NULL,
 "notes" TEXT NOT NULL DEFAULT '', "lines" JSONB NOT NULL, "totalCents" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("businessId", "vehicleId") REFERENCES "WorkshopVehicle"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorkshopJob_businessId_date_idx" ON "WorkshopJob"("businessId", "date");
CREATE INDEX "WorkshopJob_businessId_vehicleId_date_idx" ON "WorkshopJob"("businessId", "vehicleId", "date");
CREATE TABLE "WorkshopShortcut" (
 "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL DEFAULT 1, "active" BOOLEAN NOT NULL DEFAULT true, "position" INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkshopShortcut_businessId_position_idx" ON "WorkshopShortcut"("businessId", "position");
CREATE TABLE "WorkshopPerformer" (
 "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "name" TEXT NOT NULL, "normalizedName" TEXT NOT NULL,
 FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkshopPerformer_businessId_normalizedName_key" ON "WorkshopPerformer"("businessId", "normalizedName");
