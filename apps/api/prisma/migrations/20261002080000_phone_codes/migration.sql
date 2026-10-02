-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('SIGNUP', 'PHONE', 'RESET');

-- DropTable
DROP TABLE "EmailCode";

-- DropEnum
DROP TYPE "EmailCodePurpose";

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCode_target_purpose_createdAt_idx" ON "VerificationCode"("target", "purpose", "createdAt");

