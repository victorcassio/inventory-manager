-- Add paymentId to FinancialTransaction for Payment <-> FinancialTransaction link
ALTER TABLE "financial_transactions" ADD COLUMN "payment_id" TEXT;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
