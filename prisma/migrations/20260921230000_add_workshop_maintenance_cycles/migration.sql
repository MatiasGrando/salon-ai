CREATE UNIQUE INDEX "WorkshopJob_businessId_id_key" ON "WorkshopJob"("businessId", "id");
CREATE UNIQUE INDEX "WorkshopShortcut_businessId_id_key" ON "WorkshopShortcut"("businessId", "id");

CREATE TABLE "WorkshopMaintenanceCycle" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "lastJobId" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "lastPerformedDate" TEXT NOT NULL,
  "lastMileage" INTEGER NOT NULL,
  "returnMonths" INTEGER,
  "returnKilometers" INTEGER,
  "nextDueDate" TEXT,
  "nextDueMileage" INTEGER,
  "customerInstructions" TEXT NOT NULL DEFAULT '',
  "manuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopMaintenanceCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkshopMaintenanceCycle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkshopMaintenanceCycle_businessId_vehicleId_fkey" FOREIGN KEY ("businessId", "vehicleId") REFERENCES "WorkshopVehicle"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkshopMaintenanceCycle_businessId_serviceId_fkey" FOREIGN KEY ("businessId", "serviceId") REFERENCES "WorkshopShortcut"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkshopMaintenanceCycle_businessId_lastJobId_fkey" FOREIGN KEY ("businessId", "lastJobId") REFERENCES "WorkshopJob"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkshopMaintenanceCycle_businessId_vehicleId_serviceId_key" ON "WorkshopMaintenanceCycle"("businessId", "vehicleId", "serviceId");
CREATE INDEX "WorkshopMaintenanceCycle_businessId_nextDueDate_idx" ON "WorkshopMaintenanceCycle"("businessId", "nextDueDate");
CREATE INDEX "WorkshopMaintenanceCycle_businessId_vehicleId_idx" ON "WorkshopMaintenanceCycle"("businessId", "vehicleId");