-- CreateEnum
CREATE TYPE "InjuryStatus" AS ENUM ('ACTIVE', 'RECOVERED');

-- CreateTable
CREATE TABLE "Injury" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" "InjuryStatus" NOT NULL DEFAULT 'ACTIVE',
    "expectedReturn" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Injury_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Injury_teamId_status_idx" ON "Injury"("teamId", "status");

-- CreateIndex
CREATE INDEX "Injury_athleteId_status_idx" ON "Injury"("athleteId", "status");

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
