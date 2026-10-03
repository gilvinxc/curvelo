-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('MEDAL', 'TROPHY', 'RIBBON', 'PLAQUE', 'OTHER');

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "AwardType" NOT NULL,
    "place" INTEGER,
    "eventName" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Award_athleteId_idx" ON "Award"("athleteId");

-- CreateIndex
CREATE INDEX "Award_teamId_idx" ON "Award"("teamId");

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
