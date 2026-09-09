-- Preserve existing services and let operators remove a service from future booking catalogs.
ALTER TABLE "Service" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
