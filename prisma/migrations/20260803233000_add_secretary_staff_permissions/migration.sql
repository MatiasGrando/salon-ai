ALTER TABLE "User"
ADD COLUMN "staffProfile" TEXT NOT NULL DEFAULT 'PROFESSIONAL',
ADD COLUMN "permissionPreset" TEXT NOT NULL DEFAULT 'PROFESSIONAL_DEFAULT',
ADD COLUMN "agendaScope" TEXT NOT NULL DEFAULT 'OWN',
ADD COLUMN "canForceAppointments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewCustomers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canCreateCustomers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canEditCustomers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageCustomerNotes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageCustomerMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewConversations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canReplyConversations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageDeposits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewOperationalReports" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewFinancialAmounts" BOOLEAN NOT NULL DEFAULT false;

-- Existing staff may already have a custom combination of agenda permissions.
-- Mark them as custom so a later edit never replaces that combination silently.
UPDATE "User" SET "permissionPreset" = 'CUSTOM' WHERE "role" = 'STAFF';

CREATE TABLE "StaffAuditLog" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffAuditLog_businessId_createdAt_idx" ON "StaffAuditLog"("businessId", "createdAt");
CREATE INDEX "StaffAuditLog_userId_createdAt_idx" ON "StaffAuditLog"("userId", "createdAt");
