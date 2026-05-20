-- ─── Enums: drop old values, add new ────────────────────────────────────────

-- InventoryMovementType: replace all values
ALTER TYPE "InventoryMovementType" RENAME TO "InventoryMovementType_old";
CREATE TYPE "InventoryMovementType" AS ENUM ('initial_stock', 'rental_out', 'rental_return', 'rental_reversal', 'manual_adjustment', 'maintenance_in', 'maintenance_out', 'deactivation');
ALTER TABLE "inventory_movements" ALTER COLUMN "type" TYPE "InventoryMovementType" USING "type"::text::"InventoryMovementType";
DROP TYPE "InventoryMovementType_old";

-- RentalStatus: remove overdue and cancelled, add canceled
ALTER TYPE "RentalStatus" RENAME TO "RentalStatus_old";
CREATE TYPE "RentalStatus" AS ENUM ('active', 'returned', 'canceled');
-- Drop default before altering type (PostgreSQL cannot cast the old typed default automatically)
ALTER TABLE "rentals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "rentals" ALTER COLUMN "status" TYPE "RentalStatus" USING "status"::text::"RentalStatus";
ALTER TABLE "rentals" ALTER COLUMN "status" SET DEFAULT 'active'::"RentalStatus";
DROP TYPE "RentalStatus_old";

-- New enums
CREATE TYPE "FinancialTransactionOrigin" AS ENUM ('manual', 'payment', 'adjustment');
CREATE TYPE "DocumentStatus" AS ENUM ('generated', 'voided');

-- ─── ItemCategory: add isActive and updatedAt ─────────────────────────────

ALTER TABLE "item_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "item_categories" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── Rental: add paidAmount ───────────────────────────────────────────────

ALTER TABLE "rentals" ADD COLUMN "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- ─── Payment: add referenceCode ───────────────────────────────────────────

ALTER TABLE "payments" ADD COLUMN "reference_code" VARCHAR(100);

-- ─── FinancialTransaction: add origin, isVoided, updatedAt ───────────────

ALTER TABLE "financial_transactions" ADD COLUMN "origin" "FinancialTransactionOrigin" NOT NULL DEFAULT 'manual';
ALTER TABLE "financial_transactions" ADD COLUMN "is_voided" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "financial_transactions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── Document: full rewrite (make rentalId optional, add new columns) ────

-- Drop existing document FK constraints
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_rental_id_fkey";

-- Make rental_id nullable
ALTER TABLE "documents" ALTER COLUMN "rental_id" DROP NOT NULL;

-- Add new columns
ALTER TABLE "documents" ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'generated';
ALTER TABLE "documents" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "documents" ADD COLUMN "payment_id" TEXT;
ALTER TABLE "documents" ADD COLUMN "return_id" TEXT;

-- Re-add rental FK (nullable)
ALTER TABLE "documents" ADD CONSTRAINT "documents_rental_id_fkey"
  FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add new FKs
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_return_id_fkey"
  FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ContractCounter: new table ───────────────────────────────────────────

CREATE TABLE "contract_counters" (
  "year"     INTEGER NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "contract_counters_pkey" PRIMARY KEY ("year")
);
