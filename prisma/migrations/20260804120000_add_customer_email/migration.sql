ALTER TABLE "Customer"
ADD COLUMN "email" TEXT;

CREATE INDEX "Customer_email_idx" ON "Customer"("email");
