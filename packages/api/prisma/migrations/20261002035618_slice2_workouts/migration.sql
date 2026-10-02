-- CreateEnum
CREATE TYPE "WorkoutKind" AS ENUM ('INTERVAL', 'TEMPO', 'PROGRESSION', 'LONG_RUN', 'RECOVERY', 'RACE', 'CROSS_TRAINING', 'STRENGTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WorkoutStepKind" AS ENUM ('WARMUP', 'COOLDOWN', 'INTERVAL', 'RECOVERY', 'STEADY', 'REST');

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "WorkoutKind" NOT NULL DEFAULT 'CUSTOM',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutStep" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "WorkoutStepKind" NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "durationS" INTEGER,
    "targetPaceS" DOUBLE PRECISION,
    "targetHrBpm" INTEGER,
    "targetRpe" INTEGER,
    "repetitions" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,

    CONSTRAINT "WorkoutStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroup" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutAssignment" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "groupId" TEXT,
    "scheduledDate" DATE NOT NULL,
    "notes" TEXT,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workout_teamId_isTemplate_idx" ON "Workout"("teamId", "isTemplate");

-- CreateIndex
CREATE INDEX "WorkoutStep_workoutId_order_idx" ON "WorkoutStep"("workoutId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroup_teamId_name_key" ON "TeamGroup"("teamId", "name");

-- CreateIndex
CREATE INDEX "TeamGroupMember_userId_idx" ON "TeamGroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroupMember_groupId_userId_key" ON "TeamGroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "WorkoutAssignment_teamId_scheduledDate_idx" ON "WorkoutAssignment"("teamId", "scheduledDate");

-- CreateIndex
CREATE INDEX "WorkoutAssignment_assignedToUserId_scheduledDate_idx" ON "WorkoutAssignment"("assignedToUserId", "scheduledDate");

-- CreateIndex
CREATE INDEX "WorkoutAssignment_groupId_scheduledDate_idx" ON "WorkoutAssignment"("groupId", "scheduledDate");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutStep" ADD CONSTRAINT "WorkoutStep_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroup" ADD CONSTRAINT "TeamGroup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroup" ADD CONSTRAINT "TeamGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMember" ADD CONSTRAINT "TeamGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroupMember" ADD CONSTRAINT "TeamGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAssignment" ADD CONSTRAINT "WorkoutAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
