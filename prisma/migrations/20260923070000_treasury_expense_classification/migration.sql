ALTER TABLE "TreasuryMovement" ADD COLUMN "counterparty" TEXT;
ALTER TABLE "TreasuryMovement" ADD COLUMN "expenseCategoryId" TEXT;
ALTER TABLE "TreasuryMovement" ADD COLUMN "expenseSubcategoryId" TEXT;
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_expense_subcategory_requires_category"
  CHECK ("expenseSubcategoryId" IS NULL OR "expenseCategoryId" IS NOT NULL);
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_expenseCategory_fkey"
  FOREIGN KEY ("businessId", "expenseCategoryId") REFERENCES "CashExpenseCategory"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_expenseSubcategory_fkey"
  FOREIGN KEY ("businessId", "expenseCategoryId", "expenseSubcategoryId") REFERENCES "CashExpenseSubcategory"("businessId", "categoryId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TreasuryMovement_businessId_kind_expenseCategoryId_expenseSubcategoryId_createdAt_idx"
  ON "TreasuryMovement"("businessId", "kind", "expenseCategoryId", "expenseSubcategoryId", "createdAt");
