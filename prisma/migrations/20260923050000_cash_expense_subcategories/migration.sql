CREATE TABLE "CashExpenseSubcategory" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashExpenseSubcategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CashExpenseSubcategory_businessId_categoryId_normalizedName_key" ON "CashExpenseSubcategory"("businessId", "categoryId", "normalizedName");
CREATE UNIQUE INDEX "CashExpenseSubcategory_businessId_categoryId_id_key" ON "CashExpenseSubcategory"("businessId", "categoryId", "id");
CREATE INDEX "CashExpenseSubcategory_businessId_categoryId_isActive_position_name_idx" ON "CashExpenseSubcategory"("businessId", "categoryId", "isActive", "position", "name");
ALTER TABLE "CashExpenseSubcategory" ADD CONSTRAINT "CashExpenseSubcategory_businessId_categoryId_fkey"
  FOREIGN KEY ("businessId", "categoryId") REFERENCES "CashExpenseCategory"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashEntry" ADD COLUMN "expenseSubcategoryId" TEXT;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_expenseSubcategory_requires_category" CHECK ("expenseSubcategoryId" IS NULL OR "expenseCategoryId" IS NOT NULL);
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_businessId_expenseCategoryId_expenseSubcategoryId_fkey"
  FOREIGN KEY ("businessId", "expenseCategoryId", "expenseSubcategoryId") REFERENCES "CashExpenseSubcategory"("businessId", "categoryId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CashEntry_businessId_expenseCategoryId_expenseSubcategoryId_idx" ON "CashEntry"("businessId", "expenseCategoryId", "expenseSubcategoryId");
