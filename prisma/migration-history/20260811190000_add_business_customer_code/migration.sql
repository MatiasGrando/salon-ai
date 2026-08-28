ALTER TABLE "Business"
ADD COLUMN "customerCode" TEXT;

DO $$
DECLARE
  business_row RECORD;
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate TEXT;
BEGIN
  FOR business_row IN SELECT "id" FROM "Business" WHERE "customerCode" IS NULL LOOP
    LOOP
      candidate := 'WX-'
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1)
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "Business" WHERE "customerCode" = candidate
      );
    END LOOP;

    UPDATE "Business"
    SET "customerCode" = candidate
    WHERE "id" = business_row."id";
  END LOOP;
END $$;

ALTER TABLE "Business"
ALTER COLUMN "customerCode" SET NOT NULL;

CREATE UNIQUE INDEX "Business_customerCode_key"
ON "Business"("customerCode");
