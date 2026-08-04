CREATE TYPE "ServiceCatalogDisplayMode" AS ENUM ('ALL_SERVICES', 'CATEGORIES_FIRST');

ALTER TABLE "BusinessFeatureSettings"
ADD COLUMN "serviceCatalogDisplayMode" "ServiceCatalogDisplayMode" NOT NULL DEFAULT 'ALL_SERVICES';
