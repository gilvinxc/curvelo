-- Tracker OAuth connections (COROS)
CREATE TABLE "TrackerConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "expiresAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackerConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrackerConnection_userId_provider_key" ON "TrackerConnection"("userId", "provider");
CREATE INDEX "TrackerConnection_provider_idx" ON "TrackerConnection"("provider");
ALTER TABLE "TrackerConnection" ADD CONSTRAINT "TrackerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrackerOAuthState" (
  "state" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "codeVerifier" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackerOAuthState_pkey" PRIMARY KEY ("state")
);
CREATE INDEX "TrackerOAuthState_expiresAt_idx" ON "TrackerOAuthState"("expiresAt");

CREATE TABLE "TrackerOAuthClient" (
  "provider" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackerOAuthClient_pkey" PRIMARY KEY ("provider")
);

-- COROS activity source
ALTER TYPE "ActivitySource" ADD VALUE 'COROS';
