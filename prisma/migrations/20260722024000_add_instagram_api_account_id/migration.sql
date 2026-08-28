ALTER TABLE "BusinessInstagramConfig"
ADD COLUMN "apiAccountId" TEXT;

CREATE UNIQUE INDEX "BusinessInstagramConfig_apiAccountId_key"
ON "BusinessInstagramConfig"("apiAccountId");
