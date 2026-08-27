CREATE TYPE "BookingVisitStatus" AS ENUM (
  'DRAFT',
  'HELD',
  'PENDING_PAYMENT_REVIEW',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED'
);

CREATE UNIQUE INDEX "Professional_businessId_id_key"
  ON "Professional"("businessId", "id");

CREATE UNIQUE INDEX "Customer_businessId_id_key"
  ON "Customer"("businessId", "id");

CREATE TABLE "BookingVisit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" "BookingVisitStatus" NOT NULL DEFAULT 'CONFIRMED',
  "scheduledStartAt" TIMESTAMP(3) NOT NULL,
  "totalDurationMinutes" INTEGER NOT NULL,
  "totalPrice" INTEGER,
  "holdExpiresAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "origin" "AppointmentOrigin" NOT NULL DEFAULT 'BOT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingVisit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Appointment"
  ADD COLUMN "visitId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "BookingVisit_businessId_id_key"
  ON "BookingVisit"("businessId", "id");
CREATE INDEX "BookingVisit_customerId_status_scheduledStartAt_idx"
  ON "BookingVisit"("customerId", "status", "scheduledStartAt");
CREATE INDEX "BookingVisit_professionalId_status_scheduledStartAt_idx"
  ON "BookingVisit"("professionalId", "status", "scheduledStartAt");
CREATE INDEX "BookingVisit_status_holdExpiresAt_idx"
  ON "BookingVisit"("status", "holdExpiresAt");
CREATE INDEX "BookingVisit_sessionId_createdAt_idx"
  ON "BookingVisit"("sessionId", "createdAt");
CREATE UNIQUE INDEX "Appointment_visitId_key"
  ON "Appointment"("visitId");

ALTER TABLE "BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_customerId_fkey"
  FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_professionalId_fkey"
  FOREIGN KEY ("businessId", "professionalId") REFERENCES "Professional"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_sessionId_fkey"
  FOREIGN KEY ("businessId", "sessionId") REFERENCES "BotSession"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "BookingVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
