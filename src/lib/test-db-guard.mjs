// Plain .mjs because e2e/ocr/test-server.mjs imports it outside any TypeScript build.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** @param {string} host */
function isLoopback(host) {
    return LOOPBACK_HOSTS.has(host.toLowerCase().replace(/^\[|\]$/g, ''));
}

/**
 * Why the test harness must not touch this database, or null when it may.
 * `/api/test/reset` deletes every user and space, so a missing or unreadable host
 * counts as non-local. Cannot detect a tunnel: a forwarded port still looks local.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function nonLocalDatabaseReason(env) {
    const host = env.DATABASE_HOST;
    if (!host) return 'DATABASE_HOST is not set';
    if (!isLoopback(host)) return `DATABASE_HOST "${host}" is not local`;

    // The app connects through DATABASE_HOST, Prisma's CLI through DATABASE_URL.
    if (env.DATABASE_URL) {
        let urlHost;
        try {
            urlHost = new URL(env.DATABASE_URL).hostname;
        } catch {
            return 'DATABASE_URL cannot be parsed';
        }
        if (!isLoopback(urlHost)) return `DATABASE_URL host "${urlHost}" is not local`;
    }
    return null;
}
