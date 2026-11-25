-- AlterTable
ALTER TABLE "Professional" ADD COLUMN     "availabilityMode" TEXT NOT NULL DEFAULT 'HABITUAL';

-- CreateTable
CREATE TABLE "AvailabilityWeek" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "draftHours" JSONB NOT NULL,
    "publishedHours" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBooking" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT,
    "time" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "useBenefits" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringOccurrence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "conflict" TEXT,
    "appointmentId" TEXT,

    CONSTRAINT "RecurringOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitPlan" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serviceIds" TEXT[],
    "totalUses" INTEGER,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL DEFAULT 31,
    "cancellationHours" INTEGER NOT NULL DEFAULT 24,
    "consumeLateCancellation" BOOLEAN NOT NULL DEFAULT false,
    "consumeNoShow" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BenefitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBenefit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serviceIds" TEXT[],
    "totalUses" INTEGER,
    "discountPercent" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "cancellationHours" INTEGER NOT NULL,
    "consumeLateCancellation" BOOLEAN NOT NULL,
    "consumeNoShow" BOOLEAN NOT NULL,
    "cashEntryId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitUse" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "originalPrice" INTEGER NOT NULL,
    "coveredAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilityWeek_businessId_weekStart_idx" ON "AvailabilityWeek"("businessId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityWeek_professionalId_weekStart_key" ON "AvailabilityWeek"("professionalId", "weekStart");

-- CreateIndex
CREATE INDEX "RecurringBooking_businessId_professionalId_status_idx" ON "RecurringBooking"("businessId", "professionalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringBooking_businessId_id_key" ON "RecurringBooking"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_appointmentId_key" ON "RecurringOccurrence"("appointmentId");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_businessId_status_idx" ON "RecurringOccurrence"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_ruleId_date_key" ON "RecurringOccurrence"("ruleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_businessId_appointmentId_key" ON "RecurringOccurrence"("businessId", "appointmentId");

-- CreateIndex
CREATE INDEX "BenefitPlan_businessId_isActive_idx" ON "BenefitPlan"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitPlan_businessId_id_key" ON "BenefitPlan"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBenefit_cashEntryId_key" ON "CustomerBenefit"("cashEntryId");

-- CreateIndex
CREATE INDEX "CustomerBenefit_businessId_customerId_endsOn_idx" ON "CustomerBenefit"("businessId", "customerId", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBenefit_businessId_id_key" ON "CustomerBenefit"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBenefit_businessId_requestKey_key" ON "CustomerBenefit"("businessId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBenefit_businessId_cashEntryId_key" ON "CustomerBenefit"("businessId", "cashEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitUse_appointmentId_key" ON "BenefitUse"("appointmentId");

-- CreateIndex
CREATE INDEX "BenefitUse_benefitId_state_idx" ON "BenefitUse"("benefitId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitUse_businessId_appointmentId_key" ON "BenefitUse"("businessId", "appointmentId");

-- AddForeignKey
ALTER TABLE "AvailabilityWeek" ADD CONSTRAINT "AvailabilityWeek_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityWeek" ADD CONSTRAINT "AvailabilityWeek_businessId_professionalId_fkey" FOREIGN KEY ("businessId", "professionalId") REFERENCES "Professional"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_businessId_professionalId_fkey" FOREIGN KEY ("businessId", "professionalId") REFERENCES "Professional"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_businessId_serviceId_fkey" FOREIGN KEY ("businessId", "serviceId") REFERENCES "Service"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_businessId_ruleId_fkey" FOREIGN KEY ("businessId", "ruleId") REFERENCES "RecurringBooking"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_businessId_appointmentId_fkey" FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitPlan" ADD CONSTRAINT "BenefitPlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_businessId_planId_fkey" FOREIGN KEY ("businessId", "planId") REFERENCES "BenefitPlan"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_businessId_cashEntryId_fkey" FOREIGN KEY ("businessId", "cashEntryId") REFERENCES "CashEntry"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitUse" ADD CONSTRAINT "BenefitUse_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitUse" ADD CONSTRAINT "BenefitUse_businessId_benefitId_fkey" FOREIGN KEY ("businessId", "benefitId") REFERENCES "CustomerBenefit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitUse" ADD CONSTRAINT "BenefitUse_businessId_appointmentId_fkey" FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Professional" ADD CONSTRAINT "Professional_availabilityMode_check" CHECK ("availabilityMode" IN ('HABITUAL','MANUAL'));
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_terms_check" CHECK (frequency IN ('WEEKLY','FORTNIGHTLY','MONTHLY') AND status IN ('ACTIVE','PAUSED','ENDED') AND ("endsOn" IS NULL OR "endsOn">="startsOn"));
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_status_check" CHECK (status IN ('BOOKED','CONFLICT','SKIPPED') AND (status<>'BOOKED' OR "appointmentId" IS NOT NULL));
ALTER TABLE "BenefitPlan" ADD CONSTRAINT "BenefitPlan_terms_check" CHECK (kind IN ('PACK','MEMBERSHIP') AND price>0 AND "validityDays">0 AND "cancellationHours">=0 AND "discountPercent" BETWEEN 0 AND 100 AND ("totalUses" IS NULL OR "totalUses">0) AND (kind<>'PACK' OR "totalUses" IS NOT NULL));
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_terms_check" CHECK (kind IN ('PACK','MEMBERSHIP') AND "startsOn"<="endsOn" AND "discountPercent" BETWEEN 0 AND 100 AND ("totalUses" IS NULL OR "totalUses">0));
ALTER TABLE "BenefitUse" ADD CONSTRAINT "BenefitUse_terms_check" CHECK (state IN ('RESERVED','CONSUMED','RELEASED') AND "coveredAmount">=0 AND "originalPrice">="coveredAmount");

-- A paid purchase is an immutable snapshot. All channels share these guards.
CREATE FUNCTION "guardBenefitReservation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g "CustomerBenefit"%ROWTYPE; a "Appointment"%ROWTYPE; day text; zone text; used integer;
BEGIN
  SELECT * INTO g FROM "CustomerBenefit" WHERE id=NEW."benefitId" AND "businessId"=NEW."businessId" FOR UPDATE;
  SELECT * INTO a FROM "Appointment" WHERE id=NEW."appointmentId" AND "businessId"=NEW."businessId" FOR UPDATE;
  IF g.id IS NULL OR a.id IS NULL OR g."customerId"<>a."customerId" OR a.status NOT IN ('PENDING','CONFIRMED') OR NEW.state<>'RESERVED' THEN RAISE EXCEPTION 'BENEFIT_CUSTOMER_OR_STATUS_CONFLICT'; END IF;
  SELECT coalesce(timezone,'America/Argentina/Buenos_Aires') INTO zone FROM "Business" WHERE id=NEW."businessId";
  day := to_char(a."startAt" AT TIME ZONE 'UTC' AT TIME ZONE zone,'YYYY-MM-DD');
  IF day<g."startsOn" OR day>g."endsOn" THEN RAISE EXCEPTION 'BENEFIT_OUTSIDE_PAID_PERIOD'; END IF;
  IF NOT a."serviceId"=ANY(g."serviceIds") OR EXISTS(SELECT 1 FROM "AppointmentServiceItem" i WHERE i."appointmentId"=a.id AND NOT i."serviceId"=ANY(g."serviceIds")) THEN RAISE EXCEPTION 'BENEFIT_SERVICE_NOT_INCLUDED'; END IF;
  IF g."totalUses" IS NOT NULL AND (SELECT count(*) FROM "AppointmentServiceItem" WHERE "appointmentId"=a.id)>1 THEN RAISE EXCEPTION 'BENEFIT_ONE_SERVICE_PER_USE'; END IF;
  IF EXISTS(SELECT 1 FROM "CashEntry" WHERE "reversesEntryId"=g."cashEntryId") THEN RAISE EXCEPTION 'BENEFIT_PURCHASE_REVERSED'; END IF;
  SELECT count(*) INTO used FROM "BenefitUse" WHERE "benefitId"=g.id AND state IN ('RESERVED','CONSUMED');
  IF g."totalUses" IS NOT NULL AND used>=g."totalUses" THEN RAISE EXCEPTION 'BENEFIT_NO_USES'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BenefitUse_reservation_guard" BEFORE INSERT ON "BenefitUse" FOR EACH ROW EXECUTE FUNCTION "guardBenefitReservation"();

CREATE FUNCTION "syncAppointmentBenefit"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "BenefitUse"%ROWTYPE; g "CustomerBenefit"%ROWTYPE; day text; zone text; next_state text; used integer;
BEGIN
  SELECT * INTO u FROM "BenefitUse" WHERE "appointmentId"=NEW.id;
  IF u.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM "CustomerBenefit" WHERE id=u."benefitId" FOR UPDATE;
  IF NEW."businessId"<>OLD."businessId" OR NEW."customerId"<>OLD."customerId" OR NEW."serviceId"<>OLD."serviceId" OR NEW."totalDurationMinutes"<>OLD."totalDurationMinutes" THEN RAISE EXCEPTION 'BENEFIT_APPOINTMENT_TERMS_LOCKED'; END IF;
  next_state := CASE WHEN NEW.status='COMPLETED' THEN 'CONSUMED' WHEN NEW.status='NO_SHOW' THEN CASE WHEN g."consumeNoShow" THEN 'CONSUMED' ELSE 'RELEASED' END WHEN NEW.status='CANCELLED' THEN CASE WHEN u.state='CONSUMED' OR (g."consumeLateCancellation" AND clock_timestamp()>(OLD."startAt" AT TIME ZONE 'UTC') - make_interval(hours=>g."cancellationHours")) THEN 'CONSUMED' ELSE 'RELEASED' END ELSE 'RESERVED' END;
  IF NEW.status IN ('PENDING','CONFIRMED') THEN
    SELECT coalesce(timezone,'America/Argentina/Buenos_Aires') INTO zone FROM "Business" WHERE id=NEW."businessId";
    day := to_char(NEW."startAt" AT TIME ZONE 'UTC' AT TIME ZONE zone,'YYYY-MM-DD');
    IF day<g."startsOn" OR day>g."endsOn" THEN RAISE EXCEPTION 'BENEFIT_OUTSIDE_PAID_PERIOD'; END IF;
    IF u.state='CONSUMED' THEN RAISE EXCEPTION 'BENEFIT_ALREADY_CONSUMED'; END IF;
    IF EXISTS(SELECT 1 FROM "CashEntry" WHERE "reversesEntryId"=g."cashEntryId") THEN RAISE EXCEPTION 'BENEFIT_PURCHASE_REVERSED'; END IF;
    SELECT count(*) INTO used FROM "BenefitUse" WHERE "benefitId"=g.id AND id<>u.id AND state IN ('RESERVED','CONSUMED');
    IF g."totalUses" IS NOT NULL AND used>=g."totalUses" THEN RAISE EXCEPTION 'BENEFIT_NO_USES'; END IF;
  END IF;
  UPDATE "BenefitUse" SET state=next_state WHERE id=u.id;
  RETURN NEW;
END $$;
CREATE TRIGGER "Appointment_benefit_lifecycle" BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION "syncAppointmentBenefit"();

CREATE FUNCTION "guardBenefitServiceItems"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  target := CASE WHEN TG_OP='DELETE' THEN OLD."appointmentId" ELSE NEW."appointmentId" END;
  IF EXISTS(SELECT 1 FROM "BenefitUse" WHERE "appointmentId"=target) THEN RAISE EXCEPTION 'BENEFIT_SERVICE_ITEMS_LOCKED'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AppointmentServiceItem_benefit_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AppointmentServiceItem" FOR EACH ROW EXECUTE FUNCTION "guardBenefitServiceItems"();

CREATE FUNCTION "guardUsedBenefitRefund"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL AND EXISTS(SELECT 1 FROM "CustomerBenefit" g JOIN "BenefitUse" u ON u."benefitId"=g.id WHERE g."cashEntryId"=NEW."reversesEntryId" AND u.state IN ('RESERVED','CONSUMED')) THEN RAISE EXCEPTION 'BENEFIT_HAS_RESERVED_OR_CONSUMED_USES'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CashEntry_used_benefit_refund_guard" BEFORE INSERT ON "CashEntry" FOR EACH ROW EXECUTE FUNCTION "guardUsedBenefitRefund"();
