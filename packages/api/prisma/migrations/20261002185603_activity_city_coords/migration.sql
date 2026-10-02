-- Verified city coordinates for exact weather lookups
ALTER TABLE "Activity" ADD COLUMN "cityLat" DOUBLE PRECISION;
ALTER TABLE "Activity" ADD COLUMN "cityLon" DOUBLE PRECISION;
