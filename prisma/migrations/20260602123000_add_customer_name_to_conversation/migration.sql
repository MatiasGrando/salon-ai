ALTER TYPE "ConversationStep" ADD VALUE 'ASK_CUSTOMER_NAME';

ALTER TABLE "Conversation" ADD COLUMN "selectedCustomerName" TEXT;
