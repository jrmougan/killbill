-- Espacios Fase 0 (expand): acceso de invitados + autoría de gastos + tags
-- personales. Todo aditivo con DEFAULT / NULL; el código actual lo ignora.
-- Nota MySQL 8: añadir 'GUEST' AL FINAL del enum MembershipRole es un cambio
-- metadata-only (no reordena valores existentes).

-- AlterTable: autoría del gasto (nullable + SetNull). Backfill inmediato abajo.
ALTER TABLE `Expense` ADD COLUMN `createdById` VARCHAR(191) NULL;

-- Backfill: autoría = quien lo creó ≈ COALESCE(ownerId, paidById). ownerId es
-- NOT NULL, así que todas las filas quedan con autor; COALESCE por robustez.
UPDATE `Expense` SET `createdById` = COALESCE(`ownerId`, `paidById`) WHERE `createdById` IS NULL;

-- AlterTable: Membership gana el enlace de recuperación del invitado y el rol
-- GUEST (añadido AL FINAL del enum).
ALTER TABLE `Membership` ADD COLUMN `guestTokenHash` VARCHAR(191) NULL,
    MODIFY `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'GUEST') NOT NULL DEFAULT 'MEMBER';

-- AlterTable: Tag pasa a XOR grupo/personal (patrón Budget): coupleId nullable +
-- ownerId nuevo.
ALTER TABLE `Tag` ADD COLUMN `ownerId` VARCHAR(191) NULL,
    MODIFY `coupleId` VARCHAR(191) NULL;

-- AlterTable: identidad de invitado sombra.
ALTER TABLE `User` ADD COLUMN `isGuest` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `upgradedAt` DATETIME(3) NULL;

-- CreateTable: invitaciones por enlace.
CREATE TABLE `GroupInvite` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `tokenPrefix` VARCHAR(191) NOT NULL,
    `kind` ENUM('MEMBER', 'GUEST') NOT NULL,
    `maxUses` INTEGER NOT NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GroupInvite_tokenHash_key`(`tokenHash`),
    INDEX `GroupInvite_groupId_idx`(`groupId`),
    INDEX `GroupInvite_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Expense_createdById_idx` ON `Expense`(`createdById`);

-- CreateIndex
CREATE UNIQUE INDEX `Membership_guestTokenHash_key` ON `Membership`(`guestTokenHash`);

-- CreateIndex
CREATE INDEX `Tag_ownerId_idx` ON `Tag`(`ownerId`);

-- AddForeignKey
ALTER TABLE `GroupInvite` ADD CONSTRAINT `GroupInvite_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupInvite` ADD CONSTRAINT `GroupInvite_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
