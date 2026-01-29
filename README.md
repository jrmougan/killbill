# Kill Bill 💸
**Split Expenses & Settle Debts** - A modern collaborative finance tracker for couples and groups.
Built with Next.js 15, Prisma, TailwindCSS, and Secure JWT Authentication.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- MySQL Database (Local or Docker)

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/jrmougan/killbill.git
    cd killbill
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure Environment:
    Copy `.env.example` to `.env` and fill in your secrets.
    ```bash
    cp .env.example .env
    ```
    *   `DATABASE_URL`: Connection string for Prisma.
    *   `JWT_SECRET`: Secure random string for session signing.

4.  Initialize Database:
    ```bash
    npx prisma migrate dev
    ```

5.  Run Development Server:
    ```bash
    npm run dev
    ```
    Visit `http://localhost:3000`.

---

## 🐳 Deployment (Docker / Portainer)

This project is configured to run nicely with Portainer and a Shared Database architecture.

### 1. Networking
Create an external Bridge network in Docker (or via Portainer) named `app_network`. This allows Kill Bill to communicate with your shared services (MySQL, Traefik, etc.).

```bash
docker network create app_network
```

### 2. Database
Ensure you have a MySQL container connected to `app_network`.
-   **Container Name**: `mysql-shared` (or update `DATABASE_HOST` env var).
-   **Database**: `killbill`
-   **User**: `killbill`

### 3. Deploy
Deploy the stack using `docker-compose.yml`.

```yaml
version: '3.8'
services:
  app:
    image: ghcr.io/jrmougan/killbill:latest
    environment:
      - DATABASE_HOST=mysql-shared
      - JWT_SECRET=your_production_secret_here
    networks:
      - app_network
```

### 4. Initialize Database (First Run)
Once the app is running in Portainer:
1.  Open the container console (`>_` Exec Console).
2.  Run migrations to create tables:
    ```bash
    npx prisma migrate deploy
    ```
3.  Seed the admin user:
    ```bash
    npx prisma db seed
    ```

---

## 🔒 Security
-   **Authentication**: Custom JWT-based session system (`/lib/auth.ts`, `/lib/jwt.ts`).
-   **Middleware**: Edge-compatible middleware (`middleware.ts`) protects sensitive routes.
-   **HttpOnly Cookies**: Sessions are stored in secure, HTTP-only cookies.

## 🛠️ Tech Stack
-   **Framework**: Next.js 15 (App Router)
-   **Database**: MySQL + Prisma ORM
-   **Styling**: TailwindCSS + Shadcn/UI (Glassmorphism design)
-   **Auth**: jose (JWT) + bcryptjs
