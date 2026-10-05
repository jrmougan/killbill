-- Shopping-list quantities may be fractional (weighed goods: 1,5 kg). Widening
-- INT -> DOUBLE keeps every existing value; no data rewrite.
ALTER TABLE `ShoppingListItem` MODIFY `quantity` DOUBLE NULL;
