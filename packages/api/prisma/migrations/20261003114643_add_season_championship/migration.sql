-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "championshipDate" TIMESTAMP(3),
ADD COLUMN     "championshipName" TEXT,
ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
