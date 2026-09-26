ALTER TYPE "CashEntryType" ADD VALUE IF NOT EXISTS 'INCOME';

ALTER TABLE "CashEntry"
  DROP CONSTRAINT IF EXISTS "CashEntry_expense_category_only_for_expense_check";

ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_expense_category_only_for_classified_operation_check"
  CHECK (
    ("type" IN ('EXPENSE', 'INCOME') AND "expenseCategoryId" IS NOT NULL)
    OR
    ("type" NOT IN ('EXPENSE', 'INCOME') AND "expenseCategoryId" IS NULL)
  );
