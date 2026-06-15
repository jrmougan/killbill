---
name: Prisma ORM Guidelines
description: Best practices for managing the database schema and queries using Prisma v7 in Kill Bill.
---
# Prisma ORM in Kill Bill

- **Prisma v7**: Uses the new `prisma-client` generator (ESM) with a custom output. The client is generated into `src/generated/prisma` (not `node_modules`) — import from there, and never edit those files by hand.
- **MariaDB driver adapter**: The runtime connects through `@prisma/adapter-mariadb`. Instantiate the client via the shared singleton in `src/lib/db.ts` rather than `new PrismaClient()` directly.
- **Models**: `Couple`, `User`, `InviteCode`, `Expense`, `Split`, `Settlement`, `Tag`, `ExpenseTag`, `Budget`.
- **Amounts in Cents**: Financial amounts (e.g., `amount` in `Expense`, `Split`, `Settlement`, `Budget`) are stored and processed in **cents** (integers) to prevent rounding errors. Do not convert them to floats inside the database logic.
- **Run Migrations**: When changing `prisma/schema.prisma`, run `npx prisma migrate dev` locally; production runs `prisma migrate deploy`.
- **Generate Client**: Run `npx prisma generate` after schema changes to refresh the generated client and TypeScript types.
- **Type Safety**: Always rely on Prisma's generated types (e.g., `Expense`, `User`) rather than making custom interfaces for DB models.
