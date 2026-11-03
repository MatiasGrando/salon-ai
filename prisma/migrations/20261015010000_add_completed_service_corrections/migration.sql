CREATE TABLE "AppointmentServiceCorrection" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "previousServiceId" TEXT NOT NULL,
  "newServiceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "previousServicePrice" INTEGER,
  "newServicePrice" INTEGER,
  "previousAmount" INTEGER NOT NULL,
  "newAmount" INTEGER NOT NULL,
  "refundAmount" INTEGER NOT NULL DEFAULT 0,
  "refundCashEntryId" TEXT,
  "previousCompensation" JSONB,
  "newCompensation" JSONB NOT NULL,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "AppointmentServiceCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentServiceCorrection_amounts_check" CHECK (
    "previousAmount" >= 0 AND "newAmount" >= 0 AND "refundAmount" >= 0
  ),
  CONSTRAINT "AppointmentServiceCorrection_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "AppointmentServiceCorrection_businessId_id_key"
  ON "AppointmentServiceCorrection"("businessId", "id");
CREATE UNIQUE INDEX "AppointmentServiceCorrection_businessId_requestId_key"
  ON "AppointmentServiceCorrection"("businessId", "requestId");
CREATE UNIQUE INDEX "AppointmentServiceCorrection_refundCashEntryId_key"
  ON "AppointmentServiceCorrection"("refundCashEntryId");
CREATE UNIQUE INDEX "AppointmentServiceCorrection_businessId_refundCashEntryId_key"
  ON "AppointmentServiceCorrection"("businessId", "refundCashEntryId");
CREATE INDEX "AppointmentServiceCorrection_businessId_appointmentId_createdAt_id_idx"
  ON "AppointmentServiceCorrection"("businessId", "appointmentId", "createdAt", "id");
CREATE INDEX "AppointmentServiceCorrection_businessId_actorUserId_createdAt_idx"
  ON "AppointmentServiceCorrection"("businessId", "actorUserId", "createdAt");

ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_businessId_appointmentId_fkey"
  FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_previousServiceId_fkey"
  FOREIGN KEY ("businessId", "previousServiceId") REFERENCES "Service"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_newServiceId_fkey"
  FOREIGN KEY ("businessId", "newServiceId") REFERENCES "Service"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_businessId_refundCashEntryId_fkey"
  FOREIGN KEY ("businessId", "refundCashEntryId") REFERENCES "CashEntry"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentServiceCorrection"
  ADD CONSTRAINT "AppointmentServiceCorrection_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_appointment_service_correction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AppointmentServiceCorrection is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AppointmentServiceCorrection_append_only"
  BEFORE UPDATE OR DELETE ON "AppointmentServiceCorrection"
  FOR EACH ROW EXECUTE FUNCTION reject_appointment_service_correction_mutation();
