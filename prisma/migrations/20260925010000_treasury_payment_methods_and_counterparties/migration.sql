CREATE TABLE "BusinessPaymentMethod" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "kind" "CashPaymentMethod" NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessPaymentMethod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessPaymentMethod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessPaymentMethod_businessId_id_key" ON "BusinessPaymentMethod"("businessId", "id");
CREATE UNIQUE INDEX "BusinessPaymentMethod_businessId_normalizedName_key" ON "BusinessPaymentMethod"("businessId", "normalizedName");
CREATE UNIQUE INDEX "BusinessPaymentMethod_default_kind_key" ON "BusinessPaymentMethod"("businessId", "kind") WHERE "isDefault" = true;
CREATE INDEX "BusinessPaymentMethod_businessId_isActive_position_name_idx" ON "BusinessPaymentMethod"("businessId", "isActive", "position", "name");

CREATE TABLE "TreasuryCounterparty" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreasuryCounterparty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TreasuryCounterparty_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TreasuryCounterparty_businessId_id_key" ON "TreasuryCounterparty"("businessId", "id");
CREATE UNIQUE INDEX "TreasuryCounterparty_businessId_normalizedName_key" ON "TreasuryCounterparty"("businessId", "normalizedName");
CREATE INDEX "TreasuryCounterparty_businessId_isActive_name_idx" ON "TreasuryCounterparty"("businessId", "isActive", "name");

ALTER TABLE "TreasuryAccount" ADD COLUMN "paymentMethodId" TEXT;
ALTER TABLE "TreasuryMovement" ADD COLUMN "counterpartyId" TEXT;
ALTER TABLE "CashEntry" ADD COLUMN "businessPaymentMethodId" TEXT;

INSERT INTO "BusinessPaymentMethod" ("id", "businessId", "name", "normalizedName", "kind", "position", "isDefault")
SELECT 'pm_cash_' || b."id", b."id", 'Efectivo', 'efectivo', 'CASH'::"CashPaymentMethod", 10, true FROM "Business" b
UNION ALL
SELECT 'pm_transfer_' || b."id", b."id", 'Mercado Pago', 'mercado pago', 'TRANSFER'::"CashPaymentMethod", 20, true FROM "Business" b
UNION ALL
SELECT 'pm_card_' || b."id", b."id", 'Tarjeta', 'tarjeta', 'CARD'::"CashPaymentMethod", 30, true FROM "Business" b;

UPDATE "TreasuryAccount" account
SET "paymentMethodId" = method."id"
FROM "BusinessPaymentMethod" method
WHERE account."businessId" = method."businessId" AND account."method" = 'CASH' AND method."kind" = 'CASH' AND method."isDefault" = true;

INSERT INTO "TreasuryAccount" ("id", "businessId", "method", "paymentMethodId", "createdAt")
SELECT 'ta_' || md5(method."id"), method."businessId", method."id", method."id", CURRENT_TIMESTAMP
FROM "BusinessPaymentMethod" method
WHERE method."kind" IN ('TRANSFER'::"CashPaymentMethod", 'CARD'::"CashPaymentMethod")
  AND NOT EXISTS (SELECT 1 FROM "TreasuryAccount" account WHERE account."businessId" = method."businessId" AND account."paymentMethodId" = method."id");

UPDATE "CashEntry" entry
SET "businessPaymentMethodId" = method."id"
FROM "BusinessPaymentMethod" method
WHERE entry."businessId" = method."businessId" AND entry."paymentMethod" = method."kind" AND method."isDefault" = true;

CREATE UNIQUE INDEX "TreasuryAccount_businessId_paymentMethodId_key" ON "TreasuryAccount"("businessId", "paymentMethodId");
CREATE INDEX "TreasuryMovement_businessId_counterpartyId_createdAt_idx" ON "TreasuryMovement"("businessId", "counterpartyId", "createdAt");
CREATE INDEX "CashEntry_businessId_businessPaymentMethodId_effectiveAt_id_idx" ON "CashEntry"("businessId", "businessPaymentMethodId", "effectiveAt", "id");
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_businessId_paymentMethodId_fkey" FOREIGN KEY ("businessId", "paymentMethodId") REFERENCES "BusinessPaymentMethod"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_businessId_counterpartyId_fkey" FOREIGN KEY ("businessId", "counterpartyId") REFERENCES "TreasuryCounterparty"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_businessId_businessPaymentMethodId_fkey" FOREIGN KEY ("businessId", "businessPaymentMethodId") REFERENCES "BusinessPaymentMethod"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION assign_default_business_payment_method() RETURNS trigger AS $$
DECLARE
  configured_kind "CashPaymentMethod";
BEGIN
  IF NEW."businessPaymentMethodId" IS NULL THEN
    SELECT method."id" INTO NEW."businessPaymentMethodId"
    FROM "BusinessPaymentMethod" method
    WHERE method."businessId" = NEW."businessId" AND method."kind" = NEW."paymentMethod" AND method."isDefault" = true
    LIMIT 1;
  ELSE
    SELECT method."kind" INTO configured_kind
    FROM "BusinessPaymentMethod" method
    WHERE method."businessId" = NEW."businessId" AND method."id" = NEW."businessPaymentMethodId";
    IF configured_kind IS NULL OR configured_kind <> NEW."paymentMethod" THEN
      RAISE EXCEPTION 'business payment method mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CashEntry_assign_business_payment_method"
BEFORE INSERT OR UPDATE OF "paymentMethod", "businessPaymentMethodId" ON "CashEntry"
FOR EACH ROW EXECUTE FUNCTION assign_default_business_payment_method();
