UPDATE "User"
SET
  "role" = 'ACCOUNT_ADMIN',
  "canCreateBusinesses" = true
WHERE "role" = 'BUSINESS_ADMIN'
  AND "canCreateBusinesses" = true;

UPDATE "User"
SET "canCreateBusinesses" = true
WHERE "role" = 'ACCOUNT_ADMIN'
  AND "canCreateBusinesses" = false;
