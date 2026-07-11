-- Retira el puente lista→gasto (§2/§4 plan-listas-v2): el gasto lo contabiliza el
-- OCR del ticket, la lista solo planifica. Migración CONTRACT (no edita la
-- 20260711120000 ya aplicada). Además añade `aisle` (categoría por pasillo del
-- súper, nullable + auto-asignada), ortogonal a las categorías de gasto.

-- DropForeignKey (idempotencia del puente: enlace item→Expense)
ALTER TABLE `ShoppingListItem` DROP FOREIGN KEY `ShoppingListItem_linkedExpenseId_fkey`;

-- DropIndex
DROP INDEX `ShoppingListItem_linkedExpenseId_idx` ON `ShoppingListItem`;

-- AlterTable: fuera el enlace al gasto y el precio (autoreferente sin el puente);
-- dentro el pasillo del súper.
ALTER TABLE `ShoppingListItem` DROP COLUMN `linkedExpenseId`,
    DROP COLUMN `priceCents`,
    ADD COLUMN `aisle` VARCHAR(191) NULL;
