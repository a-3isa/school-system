-- CreateEnum
CREATE TYPE "BehaviourKind" AS ENUM ('PRAISE', 'CONCERN', 'INCIDENT');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS');

-- CreateTable
CREATE TABLE "BehaviourNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "BehaviourKind" NOT NULL,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "points" INTEGER,
    "visibleToParents" BOOLEAN NOT NULL DEFAULT true,
    "severity" "IncidentSeverity",
    "actionTaken" TEXT,
    "place" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "BehaviourNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BehaviourNoteRead" (
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehaviourNoteRead_pkey" PRIMARY KEY ("noteId","userId")
);

-- CreateIndex
CREATE INDEX "BehaviourNote_schoolId_occurredAt_idx" ON "BehaviourNote"("schoolId", "occurredAt");

-- CreateIndex
CREATE INDEX "BehaviourNote_studentId_occurredAt_idx" ON "BehaviourNote"("studentId", "occurredAt");

-- AddForeignKey
ALTER TABLE "BehaviourNote" ADD CONSTRAINT "BehaviourNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviourNote" ADD CONSTRAINT "BehaviourNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviourNote" ADD CONSTRAINT "BehaviourNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviourNoteRead" ADD CONSTRAINT "BehaviourNoteRead_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "BehaviourNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviourNoteRead" ADD CONSTRAINT "BehaviourNoteRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
