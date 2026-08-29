-- F11.1 phase 1. PostgreSQL requires this enum value to commit before a later
-- migration can use it safely in a partial-index predicate.

ALTER TYPE "BotDispatchKind" ADD VALUE 'LEGACY_PROCESS';
