import { connection } from "next/server";

/**
 * The current request's timestamp, for Server Components.
 *
 * Reading the clock in render is impure (React's `purity` rule): it must come
 * from the request, not from the component body. `connection()` makes the page
 * explicitly per-request, so Next.js never prerenders it with a date frozen at
 * build time; then the clock is read once and passed down as data.
 */
export async function requestTime(): Promise<Date> {
    await connection();
    return new Date();
}
