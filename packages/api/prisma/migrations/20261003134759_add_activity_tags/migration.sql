-- CreateTable
CREATE TABLE "ActivityTag" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "taggedUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityTag_taggedUserId_status_idx" ON "ActivityTag"("taggedUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityTag_activityId_taggedUserId_key" ON "ActivityTag"("activityId", "taggedUserId");

-- AddForeignKey
ALTER TABLE "ActivityTag" ADD CONSTRAINT "ActivityTag_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTag" ADD CONSTRAINT "ActivityTag_taggedUserId_fkey" FOREIGN KEY ("taggedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
