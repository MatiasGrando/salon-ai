-- PostgreSQL enum value commits before dependent constraints/indexes.
ALTER TYPE "BotChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
