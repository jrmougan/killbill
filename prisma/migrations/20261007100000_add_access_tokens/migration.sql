-- Opaque, revocable MCP access tokens (`kb_…`). Only the sha256 of the token is
-- stored (`tokenHash`, unique) plus a short non-secret `tokenPrefix` to identify
-- it in the UI; the plaintext is shown once. `expiresAt` NULL = never expires.
-- Additive: the legacy 90-day `kind:'mcp'` JWTs simply stop being accepted as a
-- Bearer on /api/mcp (no data to migrate).

-- CreateTable
CREATE TABLE `AccessToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `tokenPrefix` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AccessToken_tokenHash_key`(`tokenHash`),
    INDEX `AccessToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccessToken` ADD CONSTRAINT `AccessToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
