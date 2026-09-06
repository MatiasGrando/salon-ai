-- Persistencia financiera de Caja. Los CHECK, índices parciales y triggers
-- son deliberadamente SQL manual porque Prisma no representa estas invariantes.
BEGIN;

CREATE TYPE "AppointmentPricingMode" AS ENUM ('FIXED', 'ESTIMATED');
CREATE TYPE "CashEntryType" AS ENUM ('PAYMENT', 'LEGACY_PAYMENT', 'EXPENSE', 'WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT', 'REFUND', 'REVERSAL');
CREATE TYPE "CashDirection" AS ENUM ('INFLOW', 'OUTFLOW');
CREATE TYPE "CashPaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'UNSPECIFIED');
CREATE TYPE "CashEntryOrigin" AS ENUM ('AGENDA', 'CASH_REGISTER', 'WEB_DEPOSIT', 'BOT_DEPOSIT', 'MIGRATION');

ALTER TABLE "Appointment" ADD COLUMN "businessId" TEXT;

UPDATE "Appointment" AS appointment
SET "businessId" = professional."businessId"
FROM "Professional" AS professional
WHERE professional."id" = appointment."professionalId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Appointment" WHERE "businessId" IS NULL) THEN
    RAISE EXCEPTION 'cash migration cannot resolve Appointment.businessId';
  END IF;
END
$$;

ALTER TABLE "Appointment" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Appointment_businessId_id_key" ON "Appointment"("businessId", "id");
CREATE INDEX "Appointment_businessId_startAt_idx" ON "Appointment"("businessId", "startAt");

CREATE UNIQUE INDEX "User_businessId_id_key" ON "User"("businessId", "id");

CREATE TABLE "AppointmentAccount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "pricingMode" "AppointmentPricingMode" NOT NULL,
  "agreedAmount" INTEGER,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentAccount_amounts_check" CHECK (
    "discountAmount" >= 0
    AND ("agreedAmount" IS NULL OR "agreedAmount" >= 0)
    AND ("pricingMode" <> 'FIXED'::"AppointmentPricingMode" OR "agreedAmount" IS NOT NULL)
    AND ("agreedAmount" IS NULL OR "discountAmount" <= "agreedAmount")
  )
);

CREATE UNIQUE INDEX "AppointmentAccount_businessId_id_key" ON "AppointmentAccount"("businessId", "id");
CREATE INDEX "AppointmentAccount_businessId_createdAt_idx" ON "AppointmentAccount"("businessId", "createdAt");
ALTER TABLE "AppointmentAccount"
  ADD CONSTRAINT "AppointmentAccount_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AppointmentAccountLink" (
  "businessId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentAccountLink_pkey" PRIMARY KEY ("businessId", "appointmentId")
);

CREATE UNIQUE INDEX "AppointmentAccountLink_appointmentId_key" ON "AppointmentAccountLink"("appointmentId");
CREATE INDEX "AppointmentAccountLink_businessId_accountId_idx" ON "AppointmentAccountLink"("businessId", "accountId");
ALTER TABLE "AppointmentAccountLink"
  ADD CONSTRAINT "AppointmentAccountLink_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentAccountLink"
  ADD CONSTRAINT "AppointmentAccountLink_businessId_accountId_fkey"
  FOREIGN KEY ("businessId", "accountId") REFERENCES "AppointmentAccount"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentAccountLink"
  ADD CONSTRAINT "AppointmentAccountLink_businessId_appointmentId_fkey"
  FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CashRegisterDay" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  "closedAt" TIMESTAMP(3),
  "openingCash" INTEGER NOT NULL,
  "expectedClosingCash" INTEGER,
  "countedClosingCash" INTEGER,
  "closingDifference" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashRegisterDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashRegisterDay_control_check" CHECK (
    "openingCash" >= 0
    AND (
      ("closedAt" IS NULL AND "expectedClosingCash" IS NULL AND "countedClosingCash" IS NULL AND "closingDifference" IS NULL)
      OR
      ("closedAt" IS NOT NULL AND "expectedClosingCash" IS NOT NULL AND "countedClosingCash" IS NOT NULL AND "closingDifference" IS NOT NULL
        AND "closedAt" >= "openedAt" AND "expectedClosingCash" >= 0 AND "countedClosingCash" >= 0
        AND "closingDifference" = "countedClosingCash" - "expectedClosingCash")
    )
  )
);

CREATE UNIQUE INDEX "CashRegisterDay_businessId_id_key" ON "CashRegisterDay"("businessId", "id");
CREATE INDEX "CashRegisterDay_businessId_openedAt_id_idx" ON "CashRegisterDay"("businessId", "openedAt", "id");
CREATE UNIQUE INDEX "CashRegisterDay_one_open_per_business" ON "CashRegisterDay"("businessId") WHERE "closedAt" IS NULL;
ALTER TABLE "CashRegisterDay"
  ADD CONSTRAINT "CashRegisterDay_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CashSession" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "registerDayId" TEXT NOT NULL,
  "responsibleUserId" TEXT NOT NULL,
  "responsibleName" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  "closedAt" TIMESTAMP(3),
  "expectedCash" INTEGER,
  "countedCash" INTEGER,
  "cashDifference" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashSession_responsible_name_check" CHECK (btrim("responsibleName") <> ''),
  CONSTRAINT "CashSession_control_check" CHECK (
    ("closedAt" IS NULL AND "expectedCash" IS NULL AND "countedCash" IS NULL AND "cashDifference" IS NULL)
    OR
    ("closedAt" IS NOT NULL AND "expectedCash" IS NOT NULL AND "countedCash" IS NOT NULL AND "cashDifference" IS NOT NULL
      AND "closedAt" >= "openedAt" AND "expectedCash" >= 0 AND "countedCash" >= 0
      AND "cashDifference" = "countedCash" - "expectedCash")
  )
);

CREATE UNIQUE INDEX "CashSession_businessId_id_key" ON "CashSession"("businessId", "id");
CREATE UNIQUE INDEX "CashSession_businessId_registerDayId_id_key" ON "CashSession"("businessId", "registerDayId", "id");
CREATE INDEX "CashSession_businessId_registerDayId_openedAt_id_idx" ON "CashSession"("businessId", "registerDayId", "openedAt", "id");
CREATE INDEX "CashSession_businessId_responsibleUserId_idx" ON "CashSession"("businessId", "responsibleUserId");
CREATE UNIQUE INDEX "CashSession_one_open_per_business" ON "CashSession"("businessId") WHERE "closedAt" IS NULL;
ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_businessId_registerDayId_fkey"
  FOREIGN KEY ("businessId", "registerDayId") REFERENCES "CashRegisterDay"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashSession"
  ADD CONSTRAINT "CashSession_businessId_responsibleUserId_fkey"
  FOREIGN KEY ("businessId", "responsibleUserId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CashEntry" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "accountId" TEXT,
  "registerDayId" TEXT,
  "cashSessionId" TEXT,
  "type" "CashEntryType" NOT NULL,
  "direction" "CashDirection" NOT NULL,
  "amount" INTEGER NOT NULL,
  "paymentMethod" "CashPaymentMethod" NOT NULL,
  "origin" "CashEntryOrigin" NOT NULL,
  "description" TEXT,
  "counterparty" TEXT,
  "observation" TEXT,
  "bookingDepositId" TEXT,
  "reversesEntryId" TEXT,
  "effectiveAt" TIMESTAMP(3) DEFAULT clock_timestamp(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashEntry_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "CashEntry_session_day_check" CHECK ("cashSessionId" IS NULL OR "registerDayId" IS NOT NULL),
  CONSTRAINT "CashEntry_shape_check" CHECK (
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
  )
);

CREATE UNIQUE INDEX "CashEntry_businessId_id_key" ON "CashEntry"("businessId", "id");
CREATE UNIQUE INDEX "CashEntry_bookingDepositId_key" ON "CashEntry"("bookingDepositId");
CREATE UNIQUE INDEX "CashEntry_reversesEntryId_key" ON "CashEntry"("reversesEntryId");
CREATE UNIQUE INDEX "CashEntry_businessId_bookingDepositId_key" ON "CashEntry"("businessId", "bookingDepositId");
CREATE UNIQUE INDEX "CashEntry_businessId_reversesEntryId_key" ON "CashEntry"("businessId", "reversesEntryId");
CREATE INDEX "CashEntry_businessId_effectiveAt_id_idx" ON "CashEntry"("businessId", "effectiveAt", "id");
CREATE INDEX "CashEntry_registerDayId_effectiveAt_id_idx" ON "CashEntry"("registerDayId", "effectiveAt", "id");
CREATE INDEX "CashEntry_businessId_accountId_effectiveAt_id_idx" ON "CashEntry"("businessId", "accountId", "effectiveAt", "id");
CREATE INDEX "CashEntry_businessId_type_paymentMethod_effectiveAt_id_idx" ON "CashEntry"("businessId", "type", "paymentMethod", "effectiveAt", "id");

ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_accountId_fkey"
  FOREIGN KEY ("businessId", "accountId") REFERENCES "AppointmentAccount"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_registerDayId_fkey"
  FOREIGN KEY ("businessId", "registerDayId") REFERENCES "CashRegisterDay"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_registerDayId_cashSessionId_fkey"
  FOREIGN KEY ("businessId", "registerDayId", "cashSessionId") REFERENCES "CashSession"("businessId", "registerDayId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_bookingDepositId_fkey"
  FOREIGN KEY ("businessId", "bookingDepositId") REFERENCES "BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashEntry"
  ADD CONSTRAINT "CashEntry_businessId_reversesEntryId_fkey"
  FOREIGN KEY ("businessId", "reversesEntryId") REFERENCES "CashEntry"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "cash_account_protect_fixed_price"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."pricingMode" = 'FIXED'::"AppointmentPricingMode"
     AND (NEW."pricingMode" IS DISTINCT FROM OLD."pricingMode" OR NEW."agreedAmount" IS DISTINCT FROM OLD."agreedAmount") THEN
    RAISE EXCEPTION 'fixed appointment account price is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "AppointmentAccount_fixed_price_trigger"
BEFORE UPDATE OF "pricingMode", "agreedAmount" ON "AppointmentAccount"
FOR EACH ROW EXECUTE FUNCTION "cash_account_protect_fixed_price"();

CREATE FUNCTION "cash_entry_validate_reversal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original "CashEntry"%ROWTYPE;
BEGIN
  IF NEW."type" <> 'REVERSAL'::"CashEntryType" THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original
  FROM "CashEntry"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."reversesEntryId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reversal source not found in tenant';
  END IF;
  IF original."type" = 'REVERSAL'::"CashEntryType"
     OR NEW."direction" = original."direction"
     OR NEW."amount" <> original."amount"
     OR NEW."paymentMethod" <> original."paymentMethod"
     OR NEW."accountId" IS DISTINCT FROM original."accountId" THEN
    RAISE EXCEPTION 'reversal must be an exact opposite entry';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "CashEntry_reversal_consistency_trigger"
BEFORE INSERT ON "CashEntry"
FOR EACH ROW EXECUTE FUNCTION "cash_entry_validate_reversal"();

CREATE FUNCTION "cash_entry_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CashEntry is append-only';
END
$$;

CREATE TRIGGER "CashEntry_append_only_trigger"
BEFORE UPDATE OR DELETE ON "CashEntry"
FOR EACH ROW EXECUTE FUNCTION "cash_entry_reject_mutation"();

COMMIT;
