ALTER TYPE "CashEntryOrigin" ADD VALUE IF NOT EXISTS 'PRODUCT_SALE';
CREATE TYPE "ProductSaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "ProductCategory" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductCategory_businessId_normalizedName_key" ON "ProductCategory"("businessId", "normalizedName");
CREATE UNIQUE INDEX "ProductCategory_businessId_id_key" ON "ProductCategory"("businessId", "id");
CREATE INDEX "ProductCategory_businessId_isActive_sortOrder_name_idx" ON "ProductCategory"("businessId", "isActive", "sortOrder", "name");
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "sku" TEXT,
  "description" TEXT,
  "salePrice" INTEGER NOT NULL,
  "cost" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_sale_price_check" CHECK ("salePrice" >= 0),
  CONSTRAINT "Product_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0)
);
CREATE UNIQUE INDEX "Product_businessId_normalizedName_key" ON "Product"("businessId", "normalizedName");
CREATE UNIQUE INDEX "Product_businessId_id_key" ON "Product"("businessId", "id");
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");
CREATE INDEX "Product_businessId_isActive_sortOrder_name_idx" ON "Product"("businessId", "isActive", "sortOrder", "name");
CREATE INDEX "Product_businessId_categoryId_isActive_idx" ON "Product"("businessId", "categoryId", "isActive");
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_categoryId_fkey" FOREIGN KEY ("businessId", "categoryId") REFERENCES "ProductCategory"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductSale" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "customerId" TEXT,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "status" "ProductSaleStatus" NOT NULL DEFAULT 'DRAFT',
  "serviceSubtotal" INTEGER NOT NULL DEFAULT 0,
  "productSubtotal" INTEGER NOT NULL DEFAULT 0,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "paymentMethod" "CashPaymentMethod" NOT NULL DEFAULT 'UNSPECIFIED',
  "observation" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSale_amounts_check" CHECK ("serviceSubtotal" >= 0 AND "productSubtotal" >= 0 AND "discountAmount" >= 0 AND "total" >= 0)
);
CREATE UNIQUE INDEX "ProductSale_businessId_id_key" ON "ProductSale"("businessId", "id");
CREATE UNIQUE INDEX "ProductSale_businessId_idempotencyKey_key" ON "ProductSale"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "ProductSale_businessId_appointmentId_key" ON "ProductSale"("businessId", "appointmentId");
CREATE INDEX "ProductSale_businessId_status_createdAt_idx" ON "ProductSale"("businessId", "status", "createdAt");
CREATE INDEX "ProductSale_businessId_customerId_createdAt_idx" ON "ProductSale"("businessId", "customerId", "createdAt");
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_businessId_appointmentId_fkey" FOREIGN KEY ("businessId", "appointmentId") REFERENCES "Appointment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductSaleLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "skuSnapshot" TEXT,
  "unitPrice" INTEGER NOT NULL,
  "unitCost" INTEGER,
  "quantity" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductSaleLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSaleLine_values_check" CHECK ("unitPrice" >= 0 AND ("unitCost" IS NULL OR "unitCost" >= 0) AND "quantity" > 0 AND "lineTotal" = "unitPrice" * "quantity")
);
CREATE UNIQUE INDEX "ProductSaleLine_saleId_productId_key" ON "ProductSaleLine"("saleId", "productId");
CREATE UNIQUE INDEX "ProductSaleLine_businessId_id_key" ON "ProductSaleLine"("businessId", "id");
CREATE INDEX "ProductSaleLine_businessId_saleId_idx" ON "ProductSaleLine"("businessId", "saleId");
CREATE INDEX "ProductSaleLine_businessId_productId_idx" ON "ProductSaleLine"("businessId", "productId");
ALTER TABLE "ProductSaleLine" ADD CONSTRAINT "ProductSaleLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSaleLine" ADD CONSTRAINT "ProductSaleLine_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "ProductSale"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSaleLine" ADD CONSTRAINT "ProductSaleLine_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductSaleAudit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousSubtotal" INTEGER NOT NULL,
  "newSubtotal" INTEGER NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ProductSaleAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductSaleAudit_businessId_id_key" ON "ProductSaleAudit"("businessId", "id");
CREATE INDEX "ProductSaleAudit_businessId_saleId_createdAt_idx" ON "ProductSaleAudit"("businessId", "saleId", "createdAt");
ALTER TABLE "ProductSaleAudit" ADD CONSTRAINT "ProductSaleAudit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSaleAudit" ADD CONSTRAINT "ProductSaleAudit_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "ProductSale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSaleAudit" ADD CONSTRAINT "ProductSaleAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashEntry" ADD COLUMN "productSaleId" TEXT;
CREATE UNIQUE INDEX "CashEntry_productSaleId_key" ON "CashEntry"("productSaleId");
CREATE UNIQUE INDEX "CashEntry_businessId_productSaleId_key" ON "CashEntry"("businessId", "productSaleId");
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_businessId_productSaleId_fkey" FOREIGN KEY ("businessId", "productSaleId") REFERENCES "ProductSale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "canViewProducts" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canManageProducts" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canSellProducts" BOOLEAN NOT NULL DEFAULT false;
