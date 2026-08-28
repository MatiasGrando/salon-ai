CREATE TYPE "ServiceCombinationPolicy" AS ENUM ('ALLOWED', 'REVIEW_REQUIRED', 'BLOCKED');

ALTER TABLE "Appointment" ADD COLUMN "totalDurationMinutes" INTEGER;

UPDATE "Appointment" AS appointment
SET "totalDurationMinutes" = service."duration"
FROM "Service" AS service
WHERE service."id" = appointment."serviceId";

ALTER TABLE "Appointment" ALTER COLUMN "totalDurationMinutes" SET NOT NULL;

CREATE TABLE "AppointmentServiceItem" (
  "appointmentId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "price" INTEGER,
  CONSTRAINT "AppointmentServiceItem_pkey" PRIMARY KEY ("appointmentId", "serviceId")
);

INSERT INTO "AppointmentServiceItem" (
  "appointmentId", "serviceId", "sortOrder", "durationMinutes", "price"
)
SELECT appointment."id", appointment."serviceId", 0, service."duration", service."price"
FROM "Appointment" AS appointment
JOIN "Service" AS service ON service."id" = appointment."serviceId";

CREATE TABLE "ServiceAddon" (
  "sourceServiceId" TEXT NOT NULL,
  "addonServiceId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ServiceAddon_pkey" PRIMARY KEY ("sourceServiceId", "addonServiceId")
);

CREATE TABLE "ServiceCombinationRule" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "serviceAId" TEXT NOT NULL,
  "serviceBId" TEXT NOT NULL,
  "policy" "ServiceCombinationPolicy" NOT NULL,
  "note" TEXT,
  CONSTRAINT "ServiceCombinationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentServiceItem_serviceId_idx" ON "AppointmentServiceItem"("serviceId");
CREATE INDEX "ServiceAddon_addonServiceId_idx" ON "ServiceAddon"("addonServiceId");
CREATE UNIQUE INDEX "ServiceCombinationRule_businessId_serviceAId_serviceBId_key"
  ON "ServiceCombinationRule"("businessId", "serviceAId", "serviceBId");
CREATE INDEX "ServiceCombinationRule_serviceAId_idx" ON "ServiceCombinationRule"("serviceAId");
CREATE INDEX "ServiceCombinationRule_serviceBId_idx" ON "ServiceCombinationRule"("serviceBId");

ALTER TABLE "AppointmentServiceItem"
  ADD CONSTRAINT "AppointmentServiceItem_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceItem"
  ADD CONSTRAINT "AppointmentServiceItem_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAddon"
  ADD CONSTRAINT "ServiceAddon_sourceServiceId_fkey"
  FOREIGN KEY ("sourceServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAddon"
  ADD CONSTRAINT "ServiceAddon_addonServiceId_fkey"
  FOREIGN KEY ("addonServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceCombinationRule"
  ADD CONSTRAINT "ServiceCombinationRule_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceCombinationRule"
  ADD CONSTRAINT "ServiceCombinationRule_serviceAId_fkey"
  FOREIGN KEY ("serviceAId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceCombinationRule"
  ADD CONSTRAINT "ServiceCombinationRule_serviceBId_fkey"
  FOREIGN KEY ("serviceBId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
