-- CreateTable
CREATE TABLE "GradeSubject" (
    "gradeId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lessonsPerWeek" INTEGER,

    CONSTRAINT "GradeSubject_pkey" PRIMARY KEY ("gradeId","subjectId")
);

-- CreateTable
CREATE TABLE "ClassSubject" (
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,

    CONSTRAINT "ClassSubject_pkey" PRIMARY KEY ("classId","subjectId")
);

-- CreateIndex
CREATE INDEX "GradeSubject_subjectId_idx" ON "GradeSubject"("subjectId");

-- CreateIndex
CREATE INDEX "ClassSubject_teacherId_idx" ON "ClassSubject"("teacherId");

-- CreateIndex
CREATE INDEX "ClassSubject_subjectId_idx" ON "ClassSubject"("subjectId");

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Clean-up of what was there before. Until now a subject belonged to nobody until a lesson was
-- placed, and a teacher was chosen lesson by lesson. Now a year group has its subjects, each class
-- has each subject with ONE teacher, and the lessons follow. Everything below only adds rows or
-- makes lessons agree with their subject's teacher; it never deletes anything.
-- ---------------------------------------------------------------------------------------------

-- 1. A year group's subjects: every subject one of its classes already has lessons or marks in.
INSERT INTO "GradeSubject" ("gradeId", "subjectId")
SELECT DISTINCT c."gradeId", x."subjectId"
FROM (
  SELECT "classId", "subjectId" FROM "TimetableEntry"
  UNION
  SELECT "classId", "subjectId" FROM "Assessment"
) x
JOIN "Class" c ON c."id" = x."classId"
ON CONFLICT DO NOTHING;

-- 2. Each class gets each of its year group's subjects, taught by whoever has most of that subject's
--    lessons in the class (the first by id when two are level); nobody when no lesson has a teacher.
INSERT INTO "ClassSubject" ("classId", "subjectId", "teacherId")
SELECT c."id", gs."subjectId",
  (
    SELECT t."teacherId"
    FROM "TimetableEntry" t
    WHERE t."classId" = c."id" AND t."subjectId" = gs."subjectId" AND t."teacherId" IS NOT NULL
    GROUP BY t."teacherId"
    ORDER BY count(*) DESC, t."teacherId"
    LIMIT 1
  )
FROM "Class" c
JOIN "GradeSubject" gs ON gs."gradeId" = c."gradeId"
ON CONFLICT DO NOTHING;

-- 3. Make every lesson agree with its subject's teacher. A lesson is left as it was only when that
--    teacher is already teaching another class at that very time (they can't be in two places).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT te."id", cs."teacherId"
    FROM "TimetableEntry" te
    JOIN "ClassSubject" cs ON cs."classId" = te."classId" AND cs."subjectId" = te."subjectId"
    WHERE te."teacherId" IS DISTINCT FROM cs."teacherId"
  LOOP
    BEGIN
      UPDATE "TimetableEntry" SET "teacherId" = r."teacherId" WHERE "id" = r."id";
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;
