CREATE TYPE "ConversationStep" AS ENUM (
  'START',
  'ASK_SERVICE',
  'ASK_PROFESSIONAL',
  'ASK_DATE',
  'ASK_TIME',
  'CONFIRM',
  'COMPLETED'
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "currentStep" "ConversationStep" NOT NULL DEFAULT 'START',
  "selectedServiceId" TEXT,
  "selectedProfessionalId" TEXT,
  "selectedDate" TEXT,
  "selectedTime" TEXT,
  "lastMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_phone_key" ON "Conversation"("phone");
