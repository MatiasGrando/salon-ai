CREATE TABLE "CommunicationExecution" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "initiatedByUserId" TEXT,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "excludedCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunicationExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationRecipient" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "phoneSnapshot" TEXT NOT NULL,
  "customerNameSnapshot" TEXT NOT NULL,
  "messageSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceDeliveryId" TEXT,
  "providerMessageId" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "bookedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "skipReason" TEXT,
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunicationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationEvent" (
  "id" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunicationExecution_businessId_sourceType_sourceId_createdAt_idx" ON "CommunicationExecution"("businessId", "sourceType", "sourceId", "createdAt");
CREATE INDEX "CommunicationExecution_businessId_status_createdAt_idx" ON "CommunicationExecution"("businessId", "status", "createdAt");
CREATE UNIQUE INDEX "CommunicationRecipient_executionId_customerId_key" ON "CommunicationRecipient"("executionId", "customerId");
CREATE INDEX "CommunicationRecipient_businessId_customerId_sentAt_idx" ON "CommunicationRecipient"("businessId", "customerId", "sentAt");
CREATE INDEX "CommunicationRecipient_businessId_status_scheduledAt_idx" ON "CommunicationRecipient"("businessId", "status", "scheduledAt");
CREATE UNIQUE INDEX "CommunicationRecipient_sourceDeliveryId_key" ON "CommunicationRecipient"("sourceDeliveryId");
CREATE INDEX "CommunicationEvent_recipientId_createdAt_idx" ON "CommunicationEvent"("recipientId", "createdAt");

ALTER TABLE "CommunicationExecution" ADD CONSTRAINT "CommunicationExecution_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "CommunicationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationEvent" ADD CONSTRAINT "CommunicationEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CommunicationRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
