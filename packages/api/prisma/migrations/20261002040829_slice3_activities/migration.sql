-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('RUN', 'WALK', 'CROSS_TRAINING', 'STRENGTH', 'REST_DAY', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('MANUAL', 'GARMIN', 'STRAVA', 'APPLE_HEALTH', 'GOOGLE_HEALTH', 'FILE_IMPORT');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "assignmentId" TEXT,
    "kind" "ActivityKind" NOT NULL DEFAULT 'RUN',
    "title" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "durationS" INTEGER,
    "avgPaceS" DOUBLE PRECISION,
    "avgHrBpm" INTEGER,
    "maxHrBpm" INTEGER,
    "effortRpe" INTEGER,
    "calories" INTEGER,
    "notes" TEXT,
    "source" "ActivitySource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'TEAM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_userId_startedAt_idx" ON "Activity"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Activity_teamId_startedAt_idx" ON "Activity"("teamId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_source_externalId_key" ON "Activity"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "WorkoutAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
