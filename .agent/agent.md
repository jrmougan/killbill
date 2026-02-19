# Kill Bill Agent Configuration

## Project Overview
"Kill Bill" is a modern collaborative finance tracker for couples and groups, built to split expenses and settle debts.

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Database**: MySQL with Prisma ORM (`@prisma/adapter-mariadb`)
- **Styling**: TailwindCSS v4 + Shadcn/UI (Glassmorphism design, Framer Motion)
- **Auth**: Custom JWT-based session system (`jose` + `bcryptjs`) using HttpOnly cookies
- **Testing**: Vitest + React Testing Library
- **Deployment**: Dockerized, designed to run with Portainer and a Shared Database

## Core Architecture
- The database schema uses a `Couple` model linking multiple `User`s.
- `Expense`s are linked to a payer (`User`) and a `Couple`. Costs are divided through the `Split` model.
- `Settlement`s represent clearing debts between users.
- Amounts are typically handled in **cents** to avoid floating-point errors.
- The OCR route (`src/app/api/ocr/route.ts`) handles parsing receipts.

## Key Guidelines
- Ensure all new API routes follow Next.js 15 App Router conventions (`src/app/api/.../route.ts`).
- Preserve the glassmorphism aesthetic and use Tailwind v4 utility classes.
- Make sure database reads/writes are type-safe via Prisma.
