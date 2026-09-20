CREATE TABLE "CashExpenseCategory" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashExpenseCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashExpenseCategory_businessId_normalizedName_key"
  ON "CashExpenseCategory"("businessId", "normalizedName");
CREATE UNIQUE INDEX "CashExpenseCategory_businessId_id_key"
  ON "CashExpenseCategory"("businessId", "id");
CREATE UNIQUE INDEX "CashExpenseCategory_one_default_per_business"
  ON "CashExpenseCategory"("businessId") WHERE "isDefault" = true;
CREATE INDEX "CashExpenseCategory_businessId_isActive_position_name_idx"
  ON "CashExpenseCategory"("businessId", "isActive", "position", "name");

ALTER TABLE "CashExpenseCategory"
  ADD CONSTRAINT "CashExpenseCategory_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CashExpenseCategory" (
  "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
)
SELECT 'cash-expense-other-' || md5(business."id"), business."id", 'Otros', 'otros', 0, true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" business
ON CONFLICT ("businessId", "normalizedName") DO UPDATE
SET "name" = 'Otros', "isDefault" = true, "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "CashEntry" ADD COLUMN "expenseCategoryId" TEXT;

-- El ledger es append-only en runtime. La excepción acotada permite clasificar
-- el histórico una sola vez durante esta migración y vuelve a cerrar el ledger.
ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger";
UPDATE "CashEntry" entry
SET "expenseCategoryId" = category."id"
FROM "CashExpenseCategory" category
WHERE entry."businessId" = category."businessId"
  AND entry."type" = 'EXPENSE'
  AND category."isDefault" = true;
ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger";

ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_expenseCategoryId_fkey"
  FOREIGN KEY ("businessId", "expenseCategoryId")
  REFERENCES "CashExpenseCategory"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CashEntry_businessId_expenseCategoryId_effectiveAt_id_idx"
  ON "CashEntry"("businessId", "expenseCategoryId", "effectiveAt", "id");

ALTER TABLE "CashExpenseCategory"
  ADD CONSTRAINT "CashExpenseCategory_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);

ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_expense_category_only_for_expense_check"
  CHECK (("type" = 'EXPENSE' AND "expenseCategoryId" IS NOT NULL) OR ("type" <> 'EXPENSE' AND "expenseCategoryId" IS NULL));
