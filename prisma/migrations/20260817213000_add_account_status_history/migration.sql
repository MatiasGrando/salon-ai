CREATE TABLE "BusinessAccountStatusChange" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "fromStatus" "BusinessAccountStatus" NOT NULL,
  "toStatus" "BusinessAccountStatus" NOT NULL,
  "reason" TEXT,
  "changedById" TEXT NOT NULL,
  "changedByName" TEXT NOT NULL,
  "changedByRole" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessAccountStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessAccountStatusChange_businessId_createdAt_idx"
  ON "BusinessAccountStatusChange"("businessId", "createdAt");

ALTER TABLE "BusinessAccountStatusChange"
  ADD CONSTRAINT "BusinessAccountStatusChange_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
