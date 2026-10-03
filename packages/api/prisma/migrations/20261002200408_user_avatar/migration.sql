-- User profile pictures (stored as bytes so they survive deploys)
ALTER TABLE "User" ADD COLUMN "avatarImage" BYTEA;
ALTER TABLE "User" ADD COLUMN "avatarMime" TEXT;
