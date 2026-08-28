CREATE TABLE "ProfessionalService" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfessionalService_professionalId_serviceId_key" ON "ProfessionalService"("professionalId", "serviceId");
CREATE INDEX "ProfessionalService_serviceId_idx" ON "ProfessionalService"("serviceId");

ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessionalService" ADD CONSTRAINT "ProfessionalService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId")
SELECT
  concat('ps_', substr(md5(random()::text || clock_timestamp()::text || p.id || s.id), 1, 24)),
  p.id,
  s.id
FROM "Professional" p
JOIN "Service" s ON s."businessId" = p."businessId"
ON CONFLICT ("professionalId", "serviceId") DO NOTHING;
