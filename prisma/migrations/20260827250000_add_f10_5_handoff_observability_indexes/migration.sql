-- F10.5 keeps the 60-second SELECT-only observability sweep bounded as the
-- append-only handoff ledger grows. PostgreSQL migrations are not wrapped by
-- Prisma by default; CONCURRENTLY therefore avoids blocking runtime writers.
CREATE INDEX CONCURRENTLY "BotHandoffAudit_createdAt_action_idx"
  ON "BotHandoffAudit"("createdAt", "action");

CREATE INDEX CONCURRENTLY "BotHandoff_status_queuedAt_idx"
  ON "BotHandoff"("status", "queuedAt");

CREATE INDEX CONCURRENTLY "BotHandoff_status_takenAt_idx"
  ON "BotHandoff"("status", "takenAt");

CREATE INDEX CONCURRENTLY "BotOperation_status_type_idx"
  ON "BotOperation"("status", "type");
