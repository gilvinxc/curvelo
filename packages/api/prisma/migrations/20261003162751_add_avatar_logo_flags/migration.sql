-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "hasLogo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasAvatar" BOOLEAN NOT NULL DEFAULT false;

-- Backfill flags from existing image bytes.
UPDATE "User" SET "hasAvatar" = ("avatarImage" IS NOT NULL);
UPDATE "Team" SET "hasLogo" = ("logoImage" IS NOT NULL);
