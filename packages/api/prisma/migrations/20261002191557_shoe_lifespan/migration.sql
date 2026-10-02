-- Per-shoe replacement lifespan (default 500 km)
ALTER TABLE "Shoe" ADD COLUMN "lifespanM" INTEGER NOT NULL DEFAULT 500000;
