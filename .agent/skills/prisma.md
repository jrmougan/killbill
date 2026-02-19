---
name: Prisma ORM Guidelines
description: Best practices for managing the database schema and queries using Prisma in Kill Bill.
---
# Prisma ORM in Kill Bill

- **Amounts in Cents**: Financial amounts (e.g., `amount` in `Expense`, `Split`, `Settlement`) should be stored and processed in **cents** (integers) to prevent rounding errors. Do not convert them to floats inside the database logic.
- **Run Migrations**: When changing `prisma/schema.prisma`, run `npx prisma migrate dev` locally.
- **Generate Client**: Run `npx prisma generate` after schema changes to update TypeScript types.
- **Type Safety**: Always rely on Prisma's generated types (e.g., `Expense`, `User`) rather than making custom interfaces for DB models.
