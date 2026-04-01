# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server on http://localhost:3000

# Build & Production
npm run build        # Build production bundle (standalone output)
npm start            # Run production server

# Linting
npm run lint         # ESLint with Next.js + TypeScript rules

# Testing
npm test             # Run all Vitest tests
npx vitest run src/lib/finance.test.ts   # Run a single test file

# Database
npx prisma migrate dev    # Run migrations + regenerate client
npx prisma db seed        # Seed admin user
npx prisma studio         # Open Prisma Studio GUI

# Docker
docker compose up -d      # Start full stack (app + MySQL)
```

## Environment Variables

Copy `.env.example` to `.env`. Required variables:
- `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- `JWT_SECRET` — used for signing session tokens
- `GEMINI_API_KEY` — required for OCR receipt parsing

## Architecture

Kill Bill is a couples/group expense-splitting app. Full-stack Next.js with App Router, Prisma + MariaDB, and JWT auth.

### Key directories

- `src/app/` — Pages and API routes (App Router)
- `src/components/` — React components grouped by feature (`dashboard/`, `expense/`, `expenses/`, `ui/`)
- `src/lib/` — Core logic: `finance.ts` (balance/settlement math), `splits.ts` (split distributions), `ocr_parser.ts` (Gemini Vision OCR), `auth.ts` (session/cookie management), `jwt.ts` (sign/verify), `db.ts` (Prisma singleton)
- `src/middleware.ts` — Edge middleware protecting `/dashboard`, `/admin`, and `/api/admin` routes
- `prisma/` — Schema, migrations, seed script, and fix scripts
- `src/generated/prisma/` — Generated Prisma client (do not edit manually)

### Data model

All monetary amounts are stored in **cents** (integers). Convert to euros only for display using `src/lib/currency.ts`.

Six Prisma models: `Couple` → `User[]`, `Expense[]`, `Settlement[]`. An `Expense` has `Split[]` records (one per user). `InviteCode` controls registration.

### Auth flow

Login → bcryptjs password check → JWT signed with `jose` → stored as HttpOnly cookie. Middleware verifies JWT on every protected request. Session is refreshed on each API call in `src/lib/auth.ts`.

### Expense & balance flow

1. User creates expense: payer + total amount + splits (equal or custom)
2. `finance.ts` calculates each user's net balance: `amount paid − fair share of splits ± settlements`
3. Settlement records zero out debts between specific users

### OCR flow

Receipt image uploaded → stored via `/api/upload` → path sent to `/api/ocr` → `ocr_parser.ts` calls Gemini Vision API → returns structured JSON (items + amounts) for user confirmation before saving.

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds a Docker image on push to `main` → pushes to GHCR → SSH into VPS → pulls image → runs `prisma migrate deploy` → restarts container via Docker Compose + Traefik.

## Testing

Tests live alongside the code in `src/lib/` (`.test.ts` files). Tests use Vitest with jsdom. The `finance.ts` and `splits.ts` files are the most critical to keep tested — they contain the core financial math.
