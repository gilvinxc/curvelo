-- AlterTable
ALTER TABLE "RaceResult" ADD COLUMN     "splits" JSONB,
ADD COLUMN     "finishPlace" INTEGER,
ADD COLUMN     "ageGroupPlace" INTEGER,
ADD COLUMN     "fieldSize" INTEGER;
