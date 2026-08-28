CREATE TYPE "ConversationOpportunityStatus" AS ENUM ('OPEN', 'CONVERTED', 'CLOSED');

ALTER TABLE "Conversation"
ADD COLUMN "opportunityStatus" "ConversationOpportunityStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN "opportunityOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "opportunityConvertedAt" TIMESTAMP(3),
ADD COLUMN "opportunityClosedAt" TIMESTAMP(3),
ADD COLUMN "opportunityCloseReason" TEXT,
ADD COLUMN "opportunityCloseNote" TEXT,
ADD COLUMN "opportunityAppointmentId" TEXT;

CREATE TABLE "ConversationOpportunityEvent" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "appointmentId" TEXT,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationOpportunityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_opportunityAppointmentId_key"
ON "Conversation"("opportunityAppointmentId");

CREATE INDEX "Conversation_businessId_opportunityStatus_updatedAt_idx"
ON "Conversation"("businessId", "opportunityStatus", "updatedAt");

CREATE INDEX "ConversationOpportunityEvent_conversationId_createdAt_idx"
ON "ConversationOpportunityEvent"("conversationId", "createdAt");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_opportunityAppointmentId_fkey"
FOREIGN KEY ("opportunityAppointmentId") REFERENCES "Appointment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConversationOpportunityEvent"
ADD CONSTRAINT "ConversationOpportunityEvent_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Conversation" conversation
SET
  "opportunityStatus" = 'CONVERTED',
  "opportunityAppointmentId" = matched."appointmentId",
  "opportunityConvertedAt" = matched."appointmentCreatedAt"
FROM (
  SELECT DISTINCT ON (candidate.id)
    candidate.id AS "conversationId",
    appointment.id AS "appointmentId",
    appointment."createdAt" AS "appointmentCreatedAt"
  FROM "Conversation" candidate
  JOIN "Customer" customer
    ON regexp_replace(customer.phone, '[^0-9]', '', 'g') = regexp_replace(candidate.phone, '[^0-9]', '', 'g')
  JOIN "Appointment" appointment ON appointment."customerId" = customer.id
  JOIN "Professional" professional ON professional.id = appointment."professionalId"
  WHERE professional."businessId" = candidate."businessId"
    AND appointment.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
    AND appointment."createdAt" >= candidate."createdAt"
    AND candidate.id = (
      SELECT MIN(same_phone.id)
      FROM "Conversation" same_phone
      WHERE same_phone."businessId" = candidate."businessId"
        AND regexp_replace(same_phone.phone, '[^0-9]', '', 'g') = regexp_replace(candidate.phone, '[^0-9]', '', 'g')
    )
  ORDER BY
    candidate.id,
    (appointment."startAt" >= CURRENT_TIMESTAMP) DESC,
    appointment."createdAt" DESC
) matched
WHERE conversation.id = matched."conversationId";
