-- Personal training plans: dated lists of plain-text workouts, owner + team coaches visible
CREATE TABLE "PersonalPlan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "applied" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalPlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PersonalPlanDay" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalPlanDay_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonalPlan_userId_idx" ON "PersonalPlan"("userId");
CREATE INDEX "PersonalPlanDay_planId_date_idx" ON "PersonalPlanDay"("planId", "date");
ALTER TABLE "PersonalPlan" ADD CONSTRAINT "PersonalPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalPlanDay" ADD CONSTRAINT "PersonalPlanDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PersonalPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
