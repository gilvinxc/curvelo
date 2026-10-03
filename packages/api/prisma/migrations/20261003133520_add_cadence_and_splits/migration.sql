-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "avgCadenceSpm" INTEGER;

-- CreateTable
CREATE TABLE "ActivitySplit" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "durationS" INTEGER,

    CONSTRAINT "ActivitySplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivitySplit_activityId_position_idx" ON "ActivitySplit"("activityId", "position");

-- AddForeignKey
ALTER TABLE "ActivitySplit" ADD CONSTRAINT "ActivitySplit_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
