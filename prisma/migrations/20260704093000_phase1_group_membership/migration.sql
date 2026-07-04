-- Phase 1: Group + Membership (EXPAND + backfill). Additive; existing tables untouched.
-- groupId references Couple.id for now (rename to Group is a later contract phase).

CREATE TABLE `Membership` (
  `id`        VARCHAR(191) NOT NULL,
  `groupId`   VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `role`      ENUM('OWNER','ADMIN','MEMBER')  NOT NULL DEFAULT 'MEMBER',
  `status`    ENUM('ACTIVE','LEFT','REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `joinedAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leftAt`    DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Membership_groupId_userId_key` (`groupId`, `userId`),
  INDEX `Membership_groupId_idx` (`groupId`),
  INDEX `Membership_userId_idx` (`userId`),
  INDEX `Membership_groupId_status_idx` (`groupId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- utf8mb4_unicode_ci must match Couple.id / User.id so the FKs below are compatible.

ALTER TABLE `Membership`
  ADD CONSTRAINT `Membership_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Membership_userId_fkey`
    FOREIGN KEY (`userId`)  REFERENCES `User`(`id`)   ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one ACTIVE membership per coupled user (deterministic surrogate id),
-- joinedAt = the user's createdAt so ordering reproduces couple.members order.
INSERT INTO `Membership` (`id`, `groupId`, `userId`, `role`, `status`, `joinedAt`, `createdAt`, `updatedAt`)
SELECT
  SHA2(CONCAT(u.`coupleId`, ':', u.`id`), 224),
  u.`coupleId`,
  u.`id`,
  'MEMBER',
  'ACTIVE',
  u.`createdAt`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `User` u
WHERE u.`coupleId` IS NOT NULL;

-- Promote the earliest member of each couple to OWNER (tie-break by id for determinism).
UPDATE `Membership` m
JOIN (
  SELECT x.`coupleId` AS gid, x.`id` AS uid
  FROM `User` x
  WHERE x.`coupleId` IS NOT NULL
    AND x.`id` = (
      SELECT y.`id` FROM `User` y
      WHERE y.`coupleId` = x.`coupleId`
      ORDER BY y.`createdAt` ASC, y.`id` ASC
      LIMIT 1
    )
) owner ON owner.gid = m.`groupId` AND owner.uid = m.`userId`
SET m.`role` = 'OWNER';
