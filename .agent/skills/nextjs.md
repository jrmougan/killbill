---
name: Next.js 16 App Router
description: Conventions for Next.js 16 App Router development in the Kill Bill project.
---
# Next.js 16 Guidelines

- **Server Components by Default**: Components in the `app` directory are React 19 Server Components. Only use `"use client"` when you need browser APIs, interactivity (e.g., hooks like `useState`, `useEffect`), or event listeners.
- **Async request APIs**: `cookies()`, `headers()`, `params`, and `searchParams` are async — always `await` them in pages, layouts, and route handlers.
- **Route Handlers**: API routes are defined in `route.ts` files inside `app/api/...`. Ex: `export async function GET(request: Request)`.
- **Data Mutation**: Use Server Actions for form submissions and simple data mutations where possible, or Route Handlers if they serve external clients/complex logic.
- **Caching**: Understand Next.js caching behavior. Use `revalidatePath` or `revalidateTag` to purge cache after data changes (e.g., after adding an expense).
