-- CreateTable
CREATE TABLE "google_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_userId_key" ON "google_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_googleId_key" ON "google_accounts"("googleId");

-- CreateIndex
CREATE INDEX "google_accounts_userId_idx" ON "google_accounts"("userId");

-- CreateIndex
CREATE INDEX "google_accounts_googleId_idx" ON "google_accounts"("googleId");

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
