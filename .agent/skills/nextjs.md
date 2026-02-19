---
name: Next.js 15 App Router
description: Conventions for Next.js 15 App Router development in the Kill Bill project.
---
# Next.js 15 Guidelines

- **Server Components by Default**: Components in the `app` directory are React Server Components. Only use `"use client"` when you need browser APIs, interactivity (e.g., hooks like `useState`, `useEffect`), or event listeners.
- **Route Handlers**: API routes are defined in `route.ts` files inside `app/api/...`. Ex: `export async function GET(request: Request)`.
- **Data Mutation**: Use Server Actions for form submissions and simple data mutations where possible, or Route Handlers if they serve external clients/complex logic.
- **Caching**: Understand Next.js caching behavior. Use `revalidatePath` or `revalidateTag` to purge cache after data changes (e.g., after adding an expense).
