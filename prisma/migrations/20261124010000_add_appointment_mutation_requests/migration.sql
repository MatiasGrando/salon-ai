BEGIN;

-- One server receipt per submitted intent, atomically committed with creation/payment.
CREATE TABLE "AppointmentMutationRequest" (
  "businessId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "AppointmentMutationRequest_pkey" PRIMARY KEY ("businessId", "requestId"),
  CONSTRAINT "AppointmentMutationRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AppointmentMutationRequest_appointment_fkey" FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AppointmentMutationRequest_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AppointmentMutationRequest_operation_check" CHECK ("operation" IN ('CREATE', 'PAYMENT')),
  CONSTRAINT "AppointmentMutationRequest_requestId_check" CHECK (length("requestId") BETWEEN 1 AND 128 AND "requestId" = btrim("requestId") AND "requestId" !~ '[[:cntrl:]]'),
  CONSTRAINT "AppointmentMutationRequest_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AppointmentMutationRequest_result_check" CHECK (jsonb_typeof("result") = 'object')
);
CREATE INDEX "AppointmentMutationRequest_businessId_appointmentId_createdAt_idx"
  ON "AppointmentMutationRequest" ("businessId", "appointmentId", "createdAt");

-- Financial results belong to the server. No client-facing policies or grants.
ALTER TABLE "AppointmentMutationRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AppointmentMutationRequest" FROM PUBLIC;

COMMIT;
