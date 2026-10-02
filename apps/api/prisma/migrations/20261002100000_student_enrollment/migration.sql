-- What the school records when a student enrols.
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "Religion" AS ENUM ('MUSLIM', 'CHRISTIAN', 'OTHER');

ALTER TABLE "Student"
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "nationalId" TEXT,
  ADD COLUMN "passportNo" TEXT,
  ADD COLUMN "religion" "Religion",
  ADD COLUMN "placeOfBirth" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "previousSchool" TEXT,
  ADD COLUMN "enrolledOn" DATE,
  ADD COLUMN "bloodType" TEXT,
  ADD COLUMN "allergies" TEXT,
  ADD COLUMN "emergencyName" TEXT,
  ADD COLUMN "emergencyRelation" TEXT,
  ADD COLUMN "emergencyPhone" TEXT;

CREATE UNIQUE INDEX "Student_schoolId_nationalId_key" ON "Student"("schoolId", "nationalId");

-- Photos and scans of the student's papers.
CREATE TABLE "StudentFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentFile_schoolId_studentId_idx" ON "StudentFile"("schoolId", "studentId");
ALTER TABLE "StudentFile" ADD CONSTRAINT "StudentFile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentFile" ADD CONSTRAINT "StudentFile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
