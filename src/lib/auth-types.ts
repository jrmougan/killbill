// Shared shape returned by the auth Server Actions (login/register) and
// consumed by their client forms via useActionState. Kept in a plain module
// (not a "use server" file, whose runtime exports must all be async functions).
// `email` echoes the typed address back so a failed login doesn't wipe it
// (React resets the uncontrolled form after the action).
export type AuthState = { error?: string; email?: string };
