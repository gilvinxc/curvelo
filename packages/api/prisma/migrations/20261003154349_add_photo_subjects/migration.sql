-- AlterEnum
ALTER TYPE "PostKind" ADD VALUE 'PHOTO';

-- CreateTable
CREATE TABLE "PhotoSubject" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,

    CONSTRAINT "PhotoSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoSubject_athleteId_idx" ON "PhotoSubject"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoSubject_photoId_athleteId_key" ON "PhotoSubject"("photoId", "athleteId");

-- AddForeignKey
ALTER TABLE "PhotoSubject" ADD CONSTRAINT "PhotoSubject_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSubject" ADD CONSTRAINT "PhotoSubject_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
