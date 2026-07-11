/**
 * Runtime feature flags (read from env, default off).
 *
 * `EPHEMERAL_SPACES_ENABLED` gates the whole GUEST / ephemeral-space flow
 * (Fase 3): guest invite minting, guest claim, guest sessions and the guest
 * upgrade path. Keeping it env-driven means the code can ship dark and be
 * toggled per-environment without a redeploy of new code — and turning it off
 * never breaks sessions that were already upgraded to real accounts.
 */
export function ephemeralSpacesEnabled(): boolean {
    return process.env.EPHEMERAL_SPACES_ENABLED === "true";
}
