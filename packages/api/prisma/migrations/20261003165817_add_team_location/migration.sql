-- Add optional city/state to Team for the public team directory
ALTER TABLE "Team" ADD COLUMN "city" TEXT;
ALTER TABLE "Team" ADD COLUMN "state" TEXT;
