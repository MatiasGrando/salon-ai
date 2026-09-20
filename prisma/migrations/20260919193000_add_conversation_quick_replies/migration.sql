CREATE TABLE "ConversationQuickReply" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationQuickReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationQuickReply_businessId_shortcut_key"
ON "ConversationQuickReply"("businessId", "shortcut");

CREATE INDEX "ConversationQuickReply_businessId_isActive_position_idx"
ON "ConversationQuickReply"("businessId", "isActive", "position");

ALTER TABLE "ConversationQuickReply"
ADD CONSTRAINT "ConversationQuickReply_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
