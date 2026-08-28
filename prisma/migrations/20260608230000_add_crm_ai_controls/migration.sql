ALTER TABLE "Business" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Conversation" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Conversation" ADD COLUMN "humanHandoffAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "humanHandoffResolvedAt" TIMESTAMP(3);

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
