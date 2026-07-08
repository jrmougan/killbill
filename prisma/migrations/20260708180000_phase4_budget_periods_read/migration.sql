-- Phase 4 (read-switch: budget-periods-read)
-- The Budget GET now selects rows by the half-open [periodStart, periodEnd) range
-- (periodStart < windowEnd AND periodEnd > windowStart) instead of `month` equality.
-- This index supports the periodStart range scan. No FK / no new table, so no
-- charset change is required on this DDL.
--
-- NOTE (schema drift): schema.prisma is intentionally NOT edited in this phase, so
-- this index is not yet reflected there. Before the next `prisma migrate dev`, the
-- operator should add `@@index([periodStart])` to the Budget model so Prisma does
-- not flag drift / try to drop it. Reversible: `DROP INDEX ... ON \`Budget\``.

CREATE INDEX `Budget_periodStart_idx` ON `Budget`(`periodStart`);
