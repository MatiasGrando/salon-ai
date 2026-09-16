-- Reward intent is explicit. Existing forms default to no promised benefit.
CREATE TYPE "LeadFormRewardMode" AS ENUM ('NONE', 'BENEFIT');

ALTER TABLE "LeadCaptureForm"
ADD COLUMN "rewardMode" "LeadFormRewardMode" NOT NULL DEFAULT 'NONE';

-- Before this delta every accepted submission required a reward claim. Preserve
-- that historical meaning, while new rows default to the explicit safe mode.
ALTER TABLE "FormSubmission"
ADD COLUMN "rewardMode" "LeadFormRewardMode";

UPDATE "FormSubmission" SET "rewardMode" = 'BENEFIT';

ALTER TABLE "FormSubmission"
ALTER COLUMN "rewardMode" SET DEFAULT 'NONE',
ALTER COLUMN "rewardMode" SET NOT NULL;

-- Fail the migration rather than preserve an ambiguous BENEFIT configuration.
-- Operators must audit/disable duplicates before applying this index.
CREATE UNIQUE INDEX "FormReward_one_enabled_per_form_key"
ON "FormReward"("businessId", "formId")
WHERE "enabled" = true;
