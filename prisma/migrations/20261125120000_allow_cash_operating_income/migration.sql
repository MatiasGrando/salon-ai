BEGIN;

-- Cash operations already write INCOME. Admit that type in the ledger shape check.
ALTER TABLE "CashEntry"
  DROP CONSTRAINT "CashEntry_shape_check",
  ADD CONSTRAINT "CashEntry_shape_check" CHECK (
    CASE "type"
      WHEN 'PAYMENT'::"CashEntryType" THEN
        "direction" = 'INFLOW'::"CashDirection" AND "accountId" IS NOT NULL
        AND "effectiveAt" IS NOT NULL
        AND "paymentMethod" IN ('CASH'::"CashPaymentMethod", 'TRANSFER'::"CashPaymentMethod", 'CARD'::"CashPaymentMethod")
        AND "reversesEntryId" IS NULL
        AND (
          (
            "origin" IN ('AGENDA'::"CashEntryOrigin", 'CASH_REGISTER'::"CashEntryOrigin")
            AND "bookingDepositId" IS NULL AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL
          )
          OR
          (
            "origin" IN ('WEB_DEPOSIT'::"CashEntryOrigin", 'BOT_DEPOSIT'::"CashEntryOrigin")
            AND "bookingDepositId" IS NOT NULL AND "paymentMethod" = 'TRANSFER'::"CashPaymentMethod"
            AND (("registerDayId" IS NULL AND "cashSessionId" IS NULL) OR ("registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL))
          )
        )
      WHEN 'LEGACY_PAYMENT'::"CashEntryType" THEN
        "direction" = 'INFLOW'::"CashDirection" AND "accountId" IS NOT NULL
        AND "effectiveAt" IS NULL
        AND "paymentMethod" = 'UNSPECIFIED'::"CashPaymentMethod"
        AND "origin" = 'MIGRATION'::"CashEntryOrigin"
        AND "registerDayId" IS NULL AND "cashSessionId" IS NULL AND "bookingDepositId" IS NULL AND "reversesEntryId" IS NULL
      WHEN 'EXPENSE'::"CashEntryType" THEN
        "direction" = 'OUTFLOW'::"CashDirection" AND "paymentMethod" IN ('CASH'::"CashPaymentMethod", 'TRANSFER'::"CashPaymentMethod", 'CARD'::"CashPaymentMethod")
        AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL AND btrim(coalesce("description", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'WITHDRAWAL'::"CashEntryType" THEN
        "direction" = 'OUTFLOW'::"CashDirection" AND "paymentMethod" = 'CASH'::"CashPaymentMethod"
        AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL AND btrim(coalesce("counterparty", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'INCOME'::"CashEntryType" THEN
        "direction" = 'INFLOW'::"CashDirection"
        AND "origin" = 'CASH_REGISTER'::"CashEntryOrigin"
        AND "paymentMethod" IN ('CASH'::"CashPaymentMethod", 'TRANSFER'::"CashPaymentMethod", 'CARD'::"CashPaymentMethod")
        AND "accountId" IS NULL AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL
        AND btrim(coalesce("description", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'CASH_IN'::"CashEntryType" THEN
        "direction" = 'INFLOW'::"CashDirection" AND "paymentMethod" = 'CASH'::"CashPaymentMethod"
        AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL AND btrim(coalesce("description", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'ADJUSTMENT'::"CashEntryType" THEN
        "paymentMethod" = 'CASH'::"CashPaymentMethod" AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL
        AND btrim(coalesce("observation", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'REFUND'::"CashEntryType" THEN
        "direction" = 'OUTFLOW'::"CashDirection" AND "paymentMethod" IN ('CASH'::"CashPaymentMethod", 'TRANSFER'::"CashPaymentMethod", 'CARD'::"CashPaymentMethod")
        AND "registerDayId" IS NOT NULL AND "cashSessionId" IS NOT NULL AND btrim(coalesce("description", '')) <> '' AND "reversesEntryId" IS NULL
      WHEN 'REVERSAL'::"CashEntryType" THEN "reversesEntryId" IS NOT NULL
      ELSE false
    END
    AND (
      ("type" = 'LEGACY_PAYMENT'::"CashEntryType" AND "effectiveAt" IS NULL)
      OR ("type" <> 'LEGACY_PAYMENT'::"CashEntryType" AND "effectiveAt" IS NOT NULL)
    )
    AND ("bookingDepositId" IS NULL OR "type" = 'PAYMENT'::"CashEntryType")
  );

COMMIT;
