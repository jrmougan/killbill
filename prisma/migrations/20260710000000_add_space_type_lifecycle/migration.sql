-- Espacios Fase 0 (expand): tipo + ciclo de vida sobre Couple. Todo aditivo con
-- DEFAULT; el código actual ignora las columnas nuevas. El backfill de `type`
-- (GROUP donde ACTIVE members > 2) NO va aquí: script manual verificable.

-- AlterTable
ALTER TABLE `Couple` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'SETTLING', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `type` ENUM('INDIVIDUAL', 'COUPLE', 'GROUP', 'EPHEMERAL') NOT NULL DEFAULT 'COUPLE';

-- CreateIndex
CREATE INDEX `Couple_status_expiresAt_idx` ON `Couple`(`status`, `expiresAt`);

-- AddForeignKey
ALTER TABLE `Couple` ADD CONSTRAINT `Couple_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
