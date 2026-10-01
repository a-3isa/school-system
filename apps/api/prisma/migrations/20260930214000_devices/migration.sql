-- CreateEnum
CREATE TYPE "GatewayKind" AS ENUM ('GATE', 'ROOM', 'BUS', 'CANTEEN');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('NOT_IN_CLASS', 'LEFT_LESSON', 'LEFT_EARLY', 'STRAP_NOT_SEEN', 'LOW_BATTERY', 'GATEWAY_OFFLINE');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "detection" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Gateway" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "claimCode" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "schoolId" TEXT,
    "name" TEXT,
    "kind" "GatewayKind",
    "roomId" TEXT,
    "firmware" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strap" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "studentId" TEXT,
    "battery" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sighting" (
    "id" BIGSERIAL NOT NULL,
    "schoolId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "strapId" TEXT NOT NULL,
    "rssi" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatePresence" (
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "lastGateAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "GatePresence_pkey" PRIMARY KEY ("studentId","date")
);

-- CreateTable
CREATE TABLE "AttendanceException" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "date" DATE NOT NULL,
    "studentId" TEXT,
    "gatewayId" TEXT,
    "classId" TEXT,
    "periodId" TEXT,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "note" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluatedPeriod" (
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periodId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluatedPeriod_pkey" PRIMARY KEY ("schoolId","date","periodId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_serial_key" ON "Gateway"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_claimCode_key" ON "Gateway"("claimCode");

-- CreateIndex
CREATE INDEX "Gateway_schoolId_idx" ON "Gateway"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Strap_studentId_key" ON "Strap"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Strap_schoolId_mac_key" ON "Strap"("schoolId", "mac");

-- CreateIndex
CREATE INDEX "Sighting_schoolId_seenAt_idx" ON "Sighting"("schoolId", "seenAt");

-- CreateIndex
CREATE INDEX "Sighting_strapId_seenAt_idx" ON "Sighting"("strapId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceException_dedupeKey_key" ON "AttendanceException"("dedupeKey");

-- CreateIndex
CREATE INDEX "AttendanceException_schoolId_date_status_idx" ON "AttendanceException"("schoolId", "date", "status");

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strap" ADD CONSTRAINT "Strap_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strap" ADD CONSTRAINT "Strap_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sighting" ADD CONSTRAINT "Sighting_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sighting" ADD CONSTRAINT "Sighting_strapId_fkey" FOREIGN KEY ("strapId") REFERENCES "Strap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatePresence" ADD CONSTRAINT "GatePresence_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
