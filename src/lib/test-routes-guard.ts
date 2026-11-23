import { prisma } from '@/lib/db';
import { SHARED_REPLICA, testDatabaseRefusal } from '@/lib/test-db-guard.mjs';

/**
 * Why `/api/test/reset` and `/api/test/seed` must refuse to run, or null. Besides the
 * environment checks, asks the server itself: the shared replica's container has a
 * fixed hostname, so a remapped port or another user still cannot reach it.
 */
export async function testRoutesRefusal(): Promise<string | null> {
    const fromEnv = testDatabaseRefusal(process.env);
    if (fromEnv) return fromEnv;
    const rows = await prisma.$queryRaw<{ host: string }[]>`SELECT @@hostname AS host`;
    if (rows[0]?.host === SHARED_REPLICA.hostname) return 'the MySQL server is the shared replica';
    return null;
}
