-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('DISTANCE', 'SESSIONS', 'STREAK');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('WEEK', 'MONTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "logoImage" BYTEA,
ADD COLUMN     "logoMime" TEXT;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "kind" "GoalKind" NOT NULL,
    "period" "GoalPeriod" NOT NULL,
    "title" TEXT,
    "targetMeters" INTEGER,
    "targetCount" INTEGER,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "shareOnComplete" BOOLEAN NOT NULL DEFAULT false,
    "feedTeamId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE INDEX "Goal_teamId_status_idx" ON "Goal"("teamId", "status");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
