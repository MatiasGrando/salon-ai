CREATE TABLE "TreasuryAccount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TreasuryAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TreasuryAccount_businessId_id_key" ON "TreasuryAccount"("businessId", "id");
CREATE UNIQUE INDEX "TreasuryAccount_businessId_method_key" ON "TreasuryAccount"("businessId", "method");

CREATE TABLE "TreasuryMovement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "direction" "CashDirection" NOT NULL,
  "amount" INTEGER NOT NULL,
  "description" TEXT,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "cashEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "TreasuryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TreasuryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TreasuryMovement_businessId_accountId_fkey" FOREIGN KEY ("businessId", "accountId") REFERENCES "TreasuryAccount"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TreasuryMovement_businessId_cashEntryId_fkey" FOREIGN KEY ("businessId", "cashEntryId") REFERENCES "CashEntry"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TreasuryMovement_businessId_id_key" ON "TreasuryMovement"("businessId", "id");
CREATE UNIQUE INDEX "TreasuryMovement_cashEntryId_key" ON "TreasuryMovement"("cashEntryId");
CREATE UNIQUE INDEX "TreasuryMovement_businessId_cashEntryId_key" ON "TreasuryMovement"("businessId", "cashEntryId");
CREATE INDEX "TreasuryMovement_businessId_createdAt_id_idx" ON "TreasuryMovement"("businessId", "createdAt", "id");
CREATE INDEX "TreasuryMovement_businessId_accountId_createdAt_id_idx" ON "TreasuryMovement"("businessId", "accountId", "createdAt", "id");
