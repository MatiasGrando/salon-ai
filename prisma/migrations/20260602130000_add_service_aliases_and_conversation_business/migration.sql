ALTER TABLE "Service" ADD COLUMN "category" TEXT;

CREATE TABLE "ServiceAlias" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,

  CONSTRAINT "ServiceAlias_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ServiceAlias"
  ADD CONSTRAINT "ServiceAlias_serviceId_fkey"
  FOREIGN KEY ("serviceId")
  REFERENCES "Service"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD COLUMN "businessId" TEXT;
