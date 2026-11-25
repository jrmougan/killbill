-- CreateTable
CREATE TABLE `AiProviderConfig` (
    `provider` ENUM('GEMINI', 'OPENROUTER') NOT NULL,
    `encryptedApiKey` TEXT NULL,
    `model` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
