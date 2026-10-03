-- CreateTable
CREATE TABLE "ActivityRoute" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRoute_activityId_key" ON "ActivityRoute"("activityId");

-- AddForeignKey
ALTER TABLE "ActivityRoute" ADD CONSTRAINT "ActivityRoute_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
