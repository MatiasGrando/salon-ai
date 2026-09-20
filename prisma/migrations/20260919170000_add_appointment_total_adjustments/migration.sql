ALTER TABLE "AppointmentAccount"
  ADD COLUMN "originalAmount" INTEGER,
  ADD COLUMN "minimumAmount" INTEGER NOT NULL DEFAULT 0;

WITH account_minimum AS (
  SELECT link."accountId",
    sum(coalesce(item_totals."baseTotal", primary_service."price"))::integer AS "minimumAmount"
  FROM "AppointmentAccountLink" AS link
  JOIN "Appointment" AS appointment
    ON appointment."businessId" = link."businessId" AND appointment."id" = link."appointmentId"
  JOIN "Service" AS primary_service
    ON primary_service."businessId" = appointment."businessId" AND primary_service."id" = appointment."serviceId"
  LEFT JOIN LATERAL (
    SELECT sum(service."price")::integer AS "baseTotal"
    FROM "AppointmentServiceItem" AS item
    JOIN "Service" AS service ON service."id" = item."serviceId" AND service."businessId" = appointment."businessId"
    WHERE item."appointmentId" = appointment."id"
  ) AS item_totals ON true
  GROUP BY link."accountId"
)
UPDATE "AppointmentAccount" AS account
SET "originalAmount" = account."agreedAmount",
    "minimumAmount" = CASE
      WHEN account."pricingMode" = 'ESTIMATED'::"AppointmentPricingMode"
        THEN coalesce(account_minimum."minimumAmount", account."agreedAmount", 0)
      ELSE 0
    END
FROM account_minimum
WHERE account_minimum."accountId" = account."id";

UPDATE "AppointmentAccount"
SET "originalAmount" = "agreedAmount",
    "minimumAmount" = CASE
      WHEN "pricingMode" = 'ESTIMATED'::"AppointmentPricingMode" THEN coalesce("agreedAmount", 0)
      ELSE 0
    END
WHERE "originalAmount" IS NULL;

ALTER TABLE "AppointmentAccount"
  ADD CONSTRAINT "AppointmentAccount_original_minimum_check"
  CHECK (
    ("originalAmount" IS NULL OR "originalAmount" >= 0)
    AND "minimumAmount" >= 0
  );

CREATE TABLE "AppointmentTotalAdjustment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "previousAmount" INTEGER,
  "newAmount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "AppointmentTotalAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentTotalAdjustment_amounts_check" CHECK (("previousAmount" IS NULL OR "previousAmount" >= 0) AND "newAmount" >= 0),
  CONSTRAINT "AppointmentTotalAdjustment_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "AppointmentTotalAdjustment_businessId_accountId_createdAt_id_idx"
  ON "AppointmentTotalAdjustment"("businessId", "accountId", "createdAt", "id");
CREATE INDEX "AppointmentTotalAdjustment_businessId_actorUserId_createdAt_idx"
  ON "AppointmentTotalAdjustment"("businessId", "actorUserId", "createdAt");

ALTER TABLE "AppointmentTotalAdjustment"
  ADD CONSTRAINT "AppointmentTotalAdjustment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentTotalAdjustment"
  ADD CONSTRAINT "AppointmentTotalAdjustment_businessId_accountId_fkey"
  FOREIGN KEY ("businessId", "accountId") REFERENCES "AppointmentAccount"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentTotalAdjustment"
  ADD CONSTRAINT "AppointmentTotalAdjustment_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER "AppointmentAccount_fixed_price_trigger" ON "AppointmentAccount";
DROP FUNCTION "cash_account_protect_fixed_price"();

CREATE FUNCTION "cash_account_require_total_adjustment_audit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  adjustment_id TEXT;
BEGIN
  IF NEW."pricingMode" IS DISTINCT FROM OLD."pricingMode" THEN
    RAISE EXCEPTION 'appointment account pricing mode is immutable';
  END IF;
  IF NEW."pricingMode" = 'ESTIMATED'::"AppointmentPricingMode"
     AND NEW."agreedAmount" < OLD."minimumAmount" THEN
    RAISE EXCEPTION 'estimated appointment total is below service minimum';
  END IF;
  IF NEW."agreedAmount" IS DISTINCT FROM OLD."agreedAmount" THEN
    SELECT adjustment."id" INTO adjustment_id
    FROM "AppointmentTotalAdjustment" AS adjustment
    WHERE adjustment."businessId" = OLD."businessId"
      AND adjustment."accountId" = OLD."id"
      AND adjustment."previousAmount" IS NOT DISTINCT FROM OLD."agreedAmount"
      AND adjustment."newAmount" = NEW."agreedAmount"
      AND adjustment."appliedAt" IS NULL
    ORDER BY adjustment."createdAt" DESC, adjustment."id" DESC
    LIMIT 1
    FOR UPDATE;
    IF adjustment_id IS NULL THEN
      RAISE EXCEPTION 'appointment total adjustment audit is required';
    END IF;
    UPDATE "AppointmentTotalAdjustment"
    SET "appliedAt" = clock_timestamp()
    WHERE "id" = adjustment_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "AppointmentAccount_total_adjustment_audit_trigger"
BEFORE UPDATE OF "pricingMode", "agreedAmount" ON "AppointmentAccount"
FOR EACH ROW EXECUTE FUNCTION "cash_account_require_total_adjustment_audit"();
