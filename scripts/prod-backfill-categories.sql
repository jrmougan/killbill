-- Production category seed + categoryId backfill (raw SQL).
--
-- Why raw SQL instead of scripts/seed-categories-and-backfill.ts: that script
-- filters on the `category` ENUM column, which the *final* Prisma client no longer
-- models (phase5 drops it), so it throws "Unknown argument category" at runtime.
-- This file does the same work driver-side and MUST run:
--   * AFTER  20260708130000_phase2b_category_table  (Category table + categoryId cols exist)
--   * BEFORE 20260708260000_phase4_budget_unique_swap (makes Budget.categoryId NOT NULL)
--   * BEFORE 20260709100000_phase5_contract_drops    (drops the `category` ENUM read below)
--
-- Idempotent: the seed only inserts a system category when its (groupId=NULL, key)
-- row is absent (MySQL treats NULLs as distinct in the unique index, so a plain
-- ON DUPLICATE KEY would not dedupe system rows); the backfill only touches rows
-- whose categoryId is still NULL. Uses `SELECT ... FROM DUAL WHERE NOT EXISTS`
-- (no derived table) so repeated literal values like 'shopping' don't collide.

-- 1) Seed the 8 system categories (groupId NULL, isSystem 1). UUID()-based ids are
--    fine — FKs only need a stable unique id; the app resolves categories by key.
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'shopping','Compras','shopping','🛍️','ShoppingBag','text-pink-400','bg-pink-400/20','#f472b6',0,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='shopping');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'food','Comida','food','🍕','Coffee','text-orange-400','bg-orange-400/20','#fb923c',1,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='food');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'rent','Alquiler','rent','🏠','Home','text-blue-400','bg-blue-400/20','#60a5fa',2,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='rent');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'utilities','Recibos','utilities','💡','Lightbulb','text-yellow-400','bg-yellow-400/20','#facc15',3,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='utilities');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'transport','Transporte','transport','🚗','TramFront','text-green-400','bg-green-400/20','#4ade80',4,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='transport');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'entertainment','Ocio','entertainment','🎬','Clapperboard','text-purple-400','bg-purple-400/20','#c084fc',5,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='entertainment');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'health','Salud','health','💊','Heart','text-red-400','bg-red-400/20','#f87171',6,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='health');
INSERT INTO `Category` (`id`,`key`,`label`,`labelEn`,`emoji`,`icon`,`color`,`bgColor`,`hex`,`sortOrder`,`isSystem`,`groupId`,`createdAt`,`updatedAt`)
SELECT UUID(),'other','Otro','other','📦','Receipt','text-gray-400','bg-gray-400/20','#9ca3af',7,1,NULL,NOW(3),NOW(3)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `Category` WHERE `groupId` IS NULL AND `key`='other');

-- 2) Backfill categoryId from the legacy `category` ENUM (still present pre-phase5).
UPDATE `Expense` e
  JOIN `Category` c ON c.`groupId` IS NULL AND c.`key` = e.`category`
  SET e.`categoryId` = c.`id`
  WHERE e.`categoryId` IS NULL;

UPDATE `Budget` b
  JOIN `Category` c ON c.`groupId` IS NULL AND c.`key` = b.`category`
  SET b.`categoryId` = c.`id`
  WHERE b.`categoryId` IS NULL;
