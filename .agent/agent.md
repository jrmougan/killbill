# Kill Bill Agent Configuration

## Project Overview
"Kill Bill" is a modern collaborative finance tracker for couples and groups, built to split expenses and settle debts.

## Tech Stack
- **Framework**: Next.js 16 (App Router) + React 19
- **Database**: MySQL/MariaDB with Prisma ORM v7 (`@prisma/adapter-mariadb`)
- **Styling**: TailwindCSS v4 + Shadcn/UI (Glassmorphism design, Framer Motion), charts via `recharts`
- **Auth**: Custom JWT-based session system (`jose` + `bcryptjs`) using HttpOnly cookies
- **Testing**: Vitest + React Testing Library (unit), Playwright (e2e)
- **Deployment**: Dockerized image on GHCR, deployed via Coolify webhook behind Traefik

## Core Architecture
- The database schema uses a `Couple` model linking multiple `User`s.
- `Expense`s are linked to a payer (`User`) and a `Couple`. Costs are divided through the `Split` model.
- `Settlement`s represent clearing debts between users.
- `InviteCode` gates registration. `Tag`/`ExpenseTag` categorize expenses, and `Budget` tracks spending limits.
- Amounts are always handled in **cents** (integers) to avoid floating-point errors; convert to euros only for display (`src/lib/currency.ts`).
- The OCR route (`src/app/api/ocr/route.ts`) parses receipts via Gemini Vision (`src/lib/ocr_parser.ts`, requires `GEMINI_API_KEY`).

## Key Guidelines
- Ensure all new API routes follow Next.js 16 App Router conventions (`src/app/api/.../route.ts`).
- Preserve the glassmorphism aesthetic and use Tailwind v4 utility classes.
- Make sure database reads/writes are type-safe via Prisma (generated client lives in `src/generated/prisma`).
