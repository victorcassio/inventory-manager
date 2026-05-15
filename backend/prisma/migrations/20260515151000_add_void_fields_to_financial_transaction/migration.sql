-- Add void tracking fields to FinancialTransaction
ALTER TABLE "financial_transactions" ADD COLUMN "voided_at" TIMESTAMP(3);
ALTER TABLE "financial_transactions" ADD COLUMN "voided_by_id" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN "void_reason" TEXT;
