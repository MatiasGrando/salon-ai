ALTER TABLE "BenefitPlan" ADD COLUMN "serviceRules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CustomerBenefit" ADD COLUMN "serviceRules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "BenefitUse" ADD COLUMN "allocations" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "commissionBase" INTEGER;
ALTER TABLE "BenefitPlan" ADD CONSTRAINT "BenefitPlan_rules_array" CHECK (jsonb_typeof("serviceRules")='array');
ALTER TABLE "CustomerBenefit" ADD CONSTRAINT "CustomerBenefit_rules_array" CHECK (jsonb_typeof("serviceRules")='array');
ALTER TABLE "BenefitUse" ADD CONSTRAINT "BenefitUse_allocations_array" CHECK (jsonb_typeof(allocations)='array' AND ("commissionBase" IS NULL OR "commissionBase">=0));

-- The grant row is locked by both reservation and reactivation. Quotas count
-- individual services, including services combined in the same appointment.
CREATE FUNCTION "assertMembershipAllocation"(grant_id text, appointment_id text, allocation jsonb, excluded_use text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE g "CustomerBenefit"%ROWTYPE; line jsonb; rule jsonb; taken integer; actual integer;
BEGIN
  SELECT * INTO STRICT g FROM "CustomerBenefit" WHERE id=grant_id FOR UPDATE;
  IF jsonb_array_length(allocation)=0 OR (SELECT count(DISTINCT x->>'serviceId') FROM jsonb_array_elements(allocation) x)<>jsonb_array_length(allocation) THEN RAISE EXCEPTION 'MEMBERSHIP_INVALID_ALLOCATION'; END IF;
  FOR line IN SELECT * FROM jsonb_array_elements(allocation) LOOP
    SELECT x INTO rule FROM jsonb_array_elements(g."serviceRules") x WHERE x->>'serviceId'=line->>'serviceId';
    IF rule IS NULL OR (line->>'unitPrice')::integer IS DISTINCT FROM (rule->>'unitPrice')::integer THEN RAISE EXCEPTION 'MEMBERSHIP_INVALID_SERVICE_PRICE'; END IF;
    SELECT i.price INTO actual FROM "AppointmentServiceItem" i WHERE i."appointmentId"=appointment_id AND i."serviceId"=line->>'serviceId';
    IF NOT FOUND THEN
      SELECT coalesce(a."quotedPrice", s.price) INTO actual FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId"
        WHERE a.id=appointment_id AND a."serviceId"=line->>'serviceId' AND NOT EXISTS(SELECT 1 FROM "AppointmentServiceItem" WHERE "appointmentId"=appointment_id);
    END IF;
    IF actual IS NULL OR actual IS DISTINCT FROM (line->>'originalPrice')::integer THEN RAISE EXCEPTION 'MEMBERSHIP_INVALID_SERVICE_AMOUNT'; END IF;
    SELECT count(*) INTO taken FROM "BenefitUse" u CROSS JOIN LATERAL jsonb_array_elements(u.allocations) x
      WHERE u."benefitId"=g.id AND u.state IN ('RESERVED','CONSUMED') AND (excluded_use IS NULL OR u.id<>excluded_use) AND x->>'serviceId'=line->>'serviceId';
    IF taken >= (rule->>'uses')::integer THEN RAISE EXCEPTION 'MEMBERSHIP_SERVICE_EXHAUSTED'; END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION "guardBenefitReservation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g "CustomerBenefit"%ROWTYPE; a "Appointment"%ROWTYPE; day text; zone text; used integer;
BEGIN
  SELECT * INTO g FROM "CustomerBenefit" WHERE id=NEW."benefitId" AND "businessId"=NEW."businessId" FOR UPDATE;
  SELECT * INTO a FROM "Appointment" WHERE id=NEW."appointmentId" AND "businessId"=NEW."businessId" FOR UPDATE;
  IF g.id IS NULL OR a.id IS NULL OR g."customerId"<>a."customerId" OR a.status NOT IN ('PENDING','CONFIRMED') OR NEW.state<>'RESERVED' THEN RAISE EXCEPTION 'BENEFIT_CUSTOMER_OR_STATUS_CONFLICT'; END IF;
  SELECT coalesce(timezone,'America/Argentina/Buenos_Aires') INTO zone FROM "Business" WHERE id=NEW."businessId";
  day := to_char(a."startAt" AT TIME ZONE 'UTC' AT TIME ZONE zone,'YYYY-MM-DD');
  IF day<g."startsOn" OR day>g."endsOn" THEN RAISE EXCEPTION 'BENEFIT_OUTSIDE_PAID_PERIOD'; END IF;
  IF EXISTS(SELECT 1 FROM "CashEntry" WHERE "reversesEntryId"=g."cashEntryId") THEN RAISE EXCEPTION 'BENEFIT_PURCHASE_REVERSED'; END IF;
  IF jsonb_array_length(g."serviceRules")>0 THEN
    PERFORM "assertMembershipAllocation"(g.id,a.id,NEW.allocations);
    IF NEW."coveredAmount" IS DISTINCT FROM (SELECT sum((x->>'originalPrice')::integer) FROM jsonb_array_elements(NEW.allocations) x)
      OR NEW."commissionBase" IS DISTINCT FROM (SELECT sum((x->>'unitPrice')::integer) FROM jsonb_array_elements(NEW.allocations) x) THEN RAISE EXCEPTION 'MEMBERSHIP_TOTAL_MISMATCH'; END IF;
  ELSE
    IF NOT a."serviceId"=ANY(g."serviceIds") OR EXISTS(SELECT 1 FROM "AppointmentServiceItem" i WHERE i."appointmentId"=a.id AND NOT i."serviceId"=ANY(g."serviceIds")) THEN RAISE EXCEPTION 'BENEFIT_SERVICE_NOT_INCLUDED'; END IF;
    IF g."totalUses" IS NOT NULL AND (SELECT count(*) FROM "AppointmentServiceItem" WHERE "appointmentId"=a.id)>1 THEN RAISE EXCEPTION 'BENEFIT_ONE_SERVICE_PER_USE'; END IF;
    SELECT count(*) INTO used FROM "BenefitUse" WHERE "benefitId"=g.id AND state IN ('RESERVED','CONSUMED');
    IF g."totalUses" IS NOT NULL AND used>=g."totalUses" THEN RAISE EXCEPTION 'BENEFIT_NO_USES'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "syncAppointmentBenefit"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "BenefitUse"%ROWTYPE; g "CustomerBenefit"%ROWTYPE; day text; zone text; next_state text; used integer;
BEGIN
  SELECT * INTO u FROM "BenefitUse" WHERE "appointmentId"=NEW.id;
  IF u.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM "CustomerBenefit" WHERE id=u."benefitId" FOR UPDATE;
  IF NEW."businessId"<>OLD."businessId" OR NEW."customerId"<>OLD."customerId" OR NEW."serviceId"<>OLD."serviceId" OR NEW."totalDurationMinutes" IS DISTINCT FROM OLD."totalDurationMinutes" THEN RAISE EXCEPTION 'BENEFIT_APPOINTMENT_TERMS_LOCKED'; END IF;
  next_state := CASE WHEN NEW.status='COMPLETED' THEN 'CONSUMED' WHEN NEW.status='NO_SHOW' THEN CASE WHEN g."consumeNoShow" THEN 'CONSUMED' ELSE 'RELEASED' END WHEN NEW.status='CANCELLED' THEN CASE WHEN u.state='CONSUMED' OR (g."consumeLateCancellation" AND clock_timestamp()>(OLD."startAt" AT TIME ZONE 'UTC') - make_interval(hours=>g."cancellationHours")) THEN 'CONSUMED' ELSE 'RELEASED' END ELSE 'RESERVED' END;
  IF NEW.status IN ('PENDING','CONFIRMED') THEN
    SELECT coalesce(timezone,'America/Argentina/Buenos_Aires') INTO zone FROM "Business" WHERE id=NEW."businessId";
    day := to_char(NEW."startAt" AT TIME ZONE 'UTC' AT TIME ZONE zone,'YYYY-MM-DD');
    IF day<g."startsOn" OR day>g."endsOn" THEN RAISE EXCEPTION 'BENEFIT_OUTSIDE_PAID_PERIOD'; END IF;
    IF u.state='CONSUMED' THEN RAISE EXCEPTION 'BENEFIT_ALREADY_CONSUMED'; END IF;
    IF EXISTS(SELECT 1 FROM "CashEntry" WHERE "reversesEntryId"=g."cashEntryId") THEN RAISE EXCEPTION 'BENEFIT_PURCHASE_REVERSED'; END IF;
    IF jsonb_array_length(g."serviceRules")>0 THEN
      PERFORM "assertMembershipAllocation"(g.id,NEW.id,u.allocations,u.id);
    ELSE
      SELECT count(*) INTO used FROM "BenefitUse" WHERE "benefitId"=g.id AND id<>u.id AND state IN ('RESERVED','CONSUMED');
      IF g."totalUses" IS NOT NULL AND used>=g."totalUses" THEN RAISE EXCEPTION 'BENEFIT_NO_USES'; END IF;
    END IF;
  END IF;
  UPDATE "BenefitUse" SET state=next_state WHERE id=u.id;
  RETURN NEW;
END $$;

-- Paid prices and quantities survive later catalog edits.
CREATE FUNCTION "guardPurchasedMembershipTerms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'MEMBERSHIP_PURCHASE_TERMS_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CustomerBenefit_terms_immutable" BEFORE UPDATE ON "CustomerBenefit" FOR EACH ROW EXECUTE FUNCTION "guardPurchasedMembershipTerms"();

CREATE FUNCTION "guardMembershipAccountCoverage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE covered integer;
BEGIN
  SELECT coalesce(sum(u."coveredAmount"),0) INTO covered FROM "AppointmentAccountLink" l
    JOIN "BenefitUse" u ON u."businessId"=l."businessId" AND u."appointmentId"=l."appointmentId"
    WHERE l."businessId"=NEW."businessId" AND l."accountId"=NEW.id;
  IF covered>0 AND (NEW."discountAmount"<covered OR NEW."agreedAmount"<covered) THEN RAISE EXCEPTION 'MEMBERSHIP_COVERAGE_LOCKED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AppointmentAccount_membership_coverage" BEFORE UPDATE ON "AppointmentAccount" FOR EACH ROW EXECUTE FUNCTION "guardMembershipAccountCoverage"();

CREATE FUNCTION "guardMembershipUseTerms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'MEMBERSHIP_USE_TERMS_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BenefitUse_terms_immutable" BEFORE UPDATE ON "BenefitUse" FOR EACH ROW EXECUTE FUNCTION "guardMembershipUseTerms"();

CREATE OR REPLACE FUNCTION "guardUsedBenefitRefund"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_id text;
BEGIN
  IF NEW."reversesEntryId" IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO grant_id FROM "CustomerBenefit" WHERE "cashEntryId"=NEW."reversesEntryId" FOR UPDATE;
  IF grant_id IS NOT NULL AND EXISTS(SELECT 1 FROM "BenefitUse" WHERE "benefitId"=grant_id AND state IN ('RESERVED','CONSUMED')) THEN RAISE EXCEPTION 'BENEFIT_HAS_RESERVED_OR_CONSUMED_USES'; END IF;
  RETURN NEW;
END $$;
