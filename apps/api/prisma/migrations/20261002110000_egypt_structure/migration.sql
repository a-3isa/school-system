-- How Egyptian schools are organised: stages, class details, the school year.
ALTER TYPE "Role" ADD VALUE 'SOCIAL_WORKER';

CREATE TYPE "Stage" AS ENUM ('KG', 'PRIMARY', 'PREPARATORY', 'SECONDARY', 'OTHER');
CREATE TYPE "SchoolSystem" AS ENUM ('NATIONAL_ARABIC', 'NATIONAL_LANGUAGES', 'BRITISH', 'AMERICAN', 'IB', 'FRENCH', 'GERMAN', 'AZHAR', 'OTHER');
CREATE TYPE "ClassGender" AS ENUM ('MIXED', 'BOYS', 'GIRLS');
CREATE TYPE "SecondaryStream" AS ENUM ('SCIENCE', 'MATHEMATICS', 'LITERARY');

ALTER TABLE "Grade" ADD COLUMN "nameAr" TEXT, ADD COLUMN "stage" "Stage" NOT NULL DEFAULT 'OTHER';

ALTER TABLE "Class"
  ADD COLUMN "section" TEXT,
  ADD COLUMN "system" "SchoolSystem",
  ADD COLUMN "gender" "ClassGender" NOT NULL DEFAULT 'MIXED',
  ADD COLUMN "stream" "SecondaryStream",
  ADD COLUMN "capacity" INTEGER;

CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "term2StartsOn" DATE,
    "breakFrom" DATE,
    "breakTo" DATE,
    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcademicYear_schoolId_name_key" ON "AcademicYear"("schoolId", "name");
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Holiday_schoolId_fromDate_idx" ON "Holiday"("schoolId", "fromDate");
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
