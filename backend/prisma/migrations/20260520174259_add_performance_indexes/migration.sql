-- AlterTable
ALTER TABLE "financial_transactions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "item_categories" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "financial_transactions_is_voided_date_idx" ON "financial_transactions"("is_voided", "date");

-- CreateIndex
CREATE INDEX "financial_transactions_user_id_date_idx" ON "financial_transactions"("user_id", "date");

-- CreateIndex
CREATE INDEX "items_category_id_idx" ON "items"("category_id");

-- CreateIndex
CREATE INDEX "items_is_active_idx" ON "items"("is_active");

-- CreateIndex
CREATE INDEX "payments_rental_id_idx" ON "payments"("rental_id");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "rental_items_rental_id_idx" ON "rental_items"("rental_id");

-- CreateIndex
CREATE INDEX "rental_items_item_id_idx" ON "rental_items"("item_id");

-- CreateIndex
CREATE INDEX "rentals_status_expected_return_idx" ON "rentals"("status", "expected_return");

-- CreateIndex
CREATE INDEX "rentals_customer_id_idx" ON "rentals"("customer_id");
