BEGIN;

ALTER TABLE "CashEntry"
  DROP CONSTRAINT IF EXISTS "CashEntry_expense_category_only_for_classified_operation_check";

INSERT INTO "CashExpenseCategory" (
  "id", "businessId", "name", "normalizedName", "position", "isDefault", "isActive", "createdAt", "updatedAt"
)
SELECT 'cash-income-contribution-' || md5(entry."businessId"), entry."businessId",
  'Aporte de efectivo', 'aporte de efectivo', 10, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CashEntry" entry
WHERE entry."type" = 'CASH_IN'
GROUP BY entry."businessId"
ON CONFLICT ("businessId", "normalizedName") DO NOTHING;

ALTER TABLE "CashEntry" DISABLE TRIGGER "CashEntry_append_only_trigger";
UPDATE "CashEntry" entry
SET "type" = 'INCOME',
    "expenseCategoryId" = category."id"
FROM "CashExpenseCategory" category
WHERE entry."businessId" = category."businessId"
  AND entry."type" = 'CASH_IN'
  AND category."normalizedName" = 'aporte de efectivo';
ALTER TABLE "CashEntry" ENABLE TRIGGER "CashEntry_append_only_trigger";

ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_expense_category_only_for_classified_operation_check"
  CHECK (
    ("type" IN ('EXPENSE', 'INCOME') AND "expenseCategoryId" IS NOT NULL)
    OR
    ("type" NOT IN ('EXPENSE', 'INCOME') AND "expenseCategoryId" IS NULL)
  );

COMMIT;
