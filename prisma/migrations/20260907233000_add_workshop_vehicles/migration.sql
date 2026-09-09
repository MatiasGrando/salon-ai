CREATE TYPE "WorkshopVehicleUsage" AS ENUM ('PARTICULAR', 'FREQUENT', 'PROFESSIONAL');

CREATE TABLE "WorkshopBrand" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopBrand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopVehicle" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "plate" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "engine" TEXT NOT NULL,
  "currentMileage" INTEGER,
  "usage" "WorkshopVehicleUsage" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkshopBrand_businessId_normalizedName_key" ON "WorkshopBrand"("businessId", "normalizedName");
CREATE UNIQUE INDEX "WorkshopBrand_businessId_id_key" ON "WorkshopBrand"("businessId", "id");
CREATE INDEX "WorkshopBrand_businessId_name_idx" ON "WorkshopBrand"("businessId", "name");
CREATE UNIQUE INDEX "WorkshopVehicle_businessId_plate_key" ON "WorkshopVehicle"("businessId", "plate");
CREATE UNIQUE INDEX "WorkshopVehicle_businessId_id_key" ON "WorkshopVehicle"("businessId", "id");
CREATE INDEX "WorkshopVehicle_businessId_updatedAt_idx" ON "WorkshopVehicle"("businessId", "updatedAt");
CREATE INDEX "WorkshopVehicle_customerId_idx" ON "WorkshopVehicle"("customerId");
ALTER TABLE "WorkshopBrand" ADD CONSTRAINT "WorkshopBrand_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopVehicle" ADD CONSTRAINT "WorkshopVehicle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopVehicle" ADD CONSTRAINT "WorkshopVehicle_businessId_brandId_fkey" FOREIGN KEY ("businessId", "brandId") REFERENCES "WorkshopBrand"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkshopVehicle" ADD CONSTRAINT "WorkshopVehicle_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
