-- AlterTable
ALTER TABLE "CreditProfile" ADD COLUMN     "bankGuaranteeAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "bankGuaranteeAmount" DECIMAL(12,2),
ADD COLUMN     "bankGuaranteeDocUrl" TEXT,
ADD COLUMN     "bankGuaranteeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankGuaranteeIssuerName" TEXT,
ADD COLUMN     "bankGuaranteeStatus" "CreditStatus" NOT NULL DEFAULT 'NOT_APPLIED',
ADD COLUMN     "bankGuaranteeValidTill" TIMESTAMP(3);
