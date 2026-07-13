CREATE TABLE "WeexAccount" (
  "id" TEXT NOT NULL,
  "googleSub" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "name" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "phone" TEXT,
  "phoneVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WeexAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeexAccountSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WeexAccountSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeexCustomerLink" (
  "id" TEXT NOT NULL,
  "weexAccountId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WeexCustomerLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeexAccount_googleSub_key" ON "WeexAccount"("googleSub");
CREATE INDEX "WeexAccount_email_idx" ON "WeexAccount"("email");
CREATE INDEX "WeexAccount_phone_idx" ON "WeexAccount"("phone");
CREATE UNIQUE INDEX "WeexAccountSession_tokenHash_key" ON "WeexAccountSession"("tokenHash");
CREATE INDEX "WeexAccountSession_accountId_idx" ON "WeexAccountSession"("accountId");
CREATE INDEX "WeexAccountSession_expiresAt_idx" ON "WeexAccountSession"("expiresAt");
CREATE UNIQUE INDEX "WeexCustomerLink_weexAccountId_customerId_businessId_key" ON "WeexCustomerLink"("weexAccountId", "customerId", "businessId");
CREATE INDEX "WeexCustomerLink_weexAccountId_businessId_idx" ON "WeexCustomerLink"("weexAccountId", "businessId");
CREATE INDEX "WeexCustomerLink_customerId_idx" ON "WeexCustomerLink"("customerId");
CREATE INDEX "WeexCustomerLink_businessId_idx" ON "WeexCustomerLink"("businessId");
CREATE INDEX "WeexCustomerLink_phone_idx" ON "WeexCustomerLink"("phone");

ALTER TABLE "WeexAccountSession"
  ADD CONSTRAINT "WeexAccountSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "WeexAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeexCustomerLink"
  ADD CONSTRAINT "WeexCustomerLink_weexAccountId_fkey"
  FOREIGN KEY ("weexAccountId") REFERENCES "WeexAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeexCustomerLink"
  ADD CONSTRAINT "WeexCustomerLink_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeexCustomerLink"
  ADD CONSTRAINT "WeexCustomerLink_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
