// Plain .mjs because e2e/ocr/test-server.mjs, scripts/ and prisma.config.ts import it
// outside any Next.js build.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * The shared anonymized production replica (docs/prod-replica.md). One per machine,
 * shared by every worktree: tests, e2e, seeds and the branch's Prisma CLI must never
 * write to it. Keep in sync with scripts/replica/db-replica.sh (a unit test checks).
 */
export const SHARED_REPLICA = Object.freeze({
    port: 23308,
    user: 'killbill_replica',
    hostname: 'prod-replica-killbill',
});

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

/**
 * Why this environment points at the shared replica, or null when it does not.
 * Checks the port and the user of DATABASE_PORT/DATABASE_USER and DATABASE_URL.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function sharedReplicaReason(env) {
    if (Number(env.DATABASE_PORT) === SHARED_REPLICA.port) {
        return `DATABASE_PORT ${SHARED_REPLICA.port} is the shared replica`;
    }
    if (env.DATABASE_USER === SHARED_REPLICA.user) return `DATABASE_USER is the shared replica's user`;
    if (env.DATABASE_URL) {
        let url;
        try {
            url = new URL(env.DATABASE_URL);
        } catch {
            return 'DATABASE_URL cannot be parsed';
        }
        if (Number(url.port) === SHARED_REPLICA.port) return `DATABASE_URL port ${SHARED_REPLICA.port} is the shared replica`;
        if (decodeURIComponent(url.username) === SHARED_REPLICA.user) return `DATABASE_URL user is the shared replica's user`;
    }
    return null;
}

/**
 * Why tests, e2e and their reset/seed routes must refuse this database, or null.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function testDatabaseRefusal(env) {
    return nonLocalDatabaseReason(env) ?? sharedReplicaReason(env);
}

/**
 * DATABASE_* overrides that point at this worktree's own MySQL (compose.dev.yaml),
 * from the WORKTREE_DATABASE_* values `mise run setup` writes to .env. Empty when
 * they are absent (CI sets DATABASE_* directly). Tests use this, never the replica.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function worktreeDatabaseEnv(env) {
    const port = env.WORKTREE_DATABASE_PORT;
    const user = env.WORKTREE_DATABASE_USER;
    const password = env.WORKTREE_DATABASE_PASSWORD;
    const name = env.WORKTREE_DATABASE_NAME;
    if (!port) return {};
    if (!user || !password || !name) {
        throw new Error('WORKTREE_DATABASE_PORT is set but WORKTREE_DATABASE_USER/PASSWORD/NAME are not: run mise run setup.');
    }
    return {
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: port,
        DATABASE_USER: user,
        DATABASE_PASSWORD: password,
        DATABASE_NAME: name,
        DATABASE_URL: `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`,
    };
}
