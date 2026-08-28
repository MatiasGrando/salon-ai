ALTER TABLE "Customer" ADD COLUMN "normalizedPhone" TEXT;

CREATE UNIQUE INDEX "Customer_normalizedPhone_key" ON "Customer"("normalizedPhone");
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");
