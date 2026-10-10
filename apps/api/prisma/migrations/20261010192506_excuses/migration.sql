-- CreateEnum
CREATE TYPE "AbsenceAnswer" AS ENUM ('KNOWS', 'DOESNT_KNOW');

-- CreateEnum
CREATE TYPE "ExcuseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExcuseReason" AS ENUM ('SICK', 'APPOINTMENT', 'FAMILY', 'OTHER');

-- AlterEnum
ALTER TYPE "ExceptionType" ADD VALUE 'ABSENT_UNKNOWN';

-- AlterTable
ALTER TABLE "AbsenceNotice" ADD COLUMN     "alertedAt" TIMESTAMP(3),
ADD COLUMN     "answer" "AbsenceAnswer",
ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "answeredById" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "excuseId" TEXT;

-- CreateTable
CREATE TABLE "Excuse" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" "ExcuseReason" NOT NULL,
    "note" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "fileData" BYTEA,
    "status" "ExcuseStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Excuse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Excuse_schoolId_status_idx" ON "Excuse"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Excuse_studentId_fromDate_idx" ON "Excuse"("studentId", "fromDate");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_excuseId_fkey" FOREIGN KEY ("excuseId") REFERENCES "Excuse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excuse" ADD CONSTRAINT "Excuse_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excuse" ADD CONSTRAINT "Excuse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excuse" ADD CONSTRAINT "Excuse_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
