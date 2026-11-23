import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nonLocalDatabaseReason, SHARED_REPLICA, sharedReplicaReason, testDatabaseRefusal, worktreeDatabaseEnv } from './test-db-guard.mjs';

describe('nonLocalDatabaseReason', () => {
    it.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]'])('allows host %s', (host) => {
        expect(nonLocalDatabaseReason({ DATABASE_HOST: host })).toBeNull();
    });

    it('allows a local host with a local URL', () => {
        expect(nonLocalDatabaseReason({
            DATABASE_HOST: '127.0.0.1',
            DATABASE_URL: 'mysql://killbill:secret@127.0.0.1:13306/killbill',
        })).toBeNull();
    });

    it.each([undefined, '', 'mysql', 'killbill-mysql-8', '10.0.0.5', '127.0.0.1.example.com', 'localhost.example.com'])(
        'refuses host %s', (host) => {
            expect(nonLocalDatabaseReason({ DATABASE_HOST: host })).toEqual(expect.any(String));
        });

    it('refuses a remote DATABASE_URL behind a local DATABASE_HOST, without leaking credentials', () => {
        const reason = nonLocalDatabaseReason({
            DATABASE_HOST: '127.0.0.1',
            DATABASE_URL: 'mysql://killbill:secret@mysql.example.com:3306/killbill',
        });
        expect(reason).toContain('mysql.example.com');
        expect(reason).not.toContain('secret');
    });

    it('refuses an unparseable DATABASE_URL without echoing it', () => {
        const reason = nonLocalDatabaseReason({ DATABASE_HOST: '127.0.0.1', DATABASE_URL: 'not a url secret' });
        expect(reason).toBe('DATABASE_URL cannot be parsed');
    });
});

describe('sharedReplicaReason', () => {
    it('allows a worktree database', () => {
        expect(sharedReplicaReason({
            DATABASE_PORT: '38053', DATABASE_USER: 'killbill',
            DATABASE_URL: 'mysql://killbill:secret@127.0.0.1:38053/killbill',
        })).toBeNull();
    });

    it.each([
        { DATABASE_PORT: '23308' },
        { DATABASE_USER: 'killbill_replica' },
        { DATABASE_URL: 'mysql://killbill:secret@127.0.0.1:23308/killbill' },
        { DATABASE_URL: 'mysql://killbill_replica:secret@127.0.0.1:3306/killbill' },
    ])('refuses %o', (env) => {
        const reason = sharedReplicaReason(env);
        expect(reason).toEqual(expect.any(String));
        expect(reason).not.toContain('secret');
    });

    it('is part of the test database refusal', () => {
        expect(testDatabaseRefusal({ DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '23308' })).toContain('shared replica');
    });

    it('matches the constants of scripts/replica/db-replica.sh', () => {
        const script = readFileSync('scripts/replica/db-replica.sh', 'utf8');
        expect(script).toContain(`REPLICA_PORT=${SHARED_REPLICA.port}`);
        expect(script).toContain(`REPLICA_USER=${SHARED_REPLICA.user}`);
        expect(script).toContain('REPLICA_NAME=prod-replica-$APP');
        expect(SHARED_REPLICA.hostname).toBe('prod-replica-killbill');
    });

    it('runs the same MySQL image as the worktree database', () => {
        const script = readFileSync('scripts/replica/db-replica.sh', 'utf8');
        const image = /^REPLICA_IMAGE=(\S+)$/m.exec(script)?.[1];
        const compose = readFileSync('compose.dev.yaml', 'utf8');
        const dbImage = /^ {2}db:\n {4}image: (\S+)$/m.exec(compose)?.[1];
        expect(image).toBeTruthy();
        expect(image).toBe(dbImage);
    });
});

describe('worktreeDatabaseEnv', () => {
    it('is empty without WORKTREE_DATABASE_PORT (CI sets DATABASE_* directly)', () => {
        expect(worktreeDatabaseEnv({ DATABASE_PORT: '3306' })).toEqual({});
    });

    it('points every DATABASE_* variable at the worktree MySQL', () => {
        const env = worktreeDatabaseEnv({
            DATABASE_PORT: '23308', DATABASE_USER: 'killbill_replica',
            WORKTREE_DATABASE_PORT: '38053', WORKTREE_DATABASE_USER: 'killbill',
            WORKTREE_DATABASE_PASSWORD: 'p@ss', WORKTREE_DATABASE_NAME: 'killbill',
        });
        expect(env).toEqual({
            DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '38053', DATABASE_USER: 'killbill',
            DATABASE_PASSWORD: 'p@ss', DATABASE_NAME: 'killbill',
            DATABASE_URL: 'mysql://killbill:p%40ss@127.0.0.1:38053/killbill',
        });
        expect(testDatabaseRefusal(env)).toBeNull();
    });

    it('fails on a partial worktree configuration', () => {
        expect(() => worktreeDatabaseEnv({ WORKTREE_DATABASE_PORT: '38053' })).toThrow(/mise run setup/);
    });
});

describe('prisma.config.ts', () => {
    it('inlines the same replica port (it cannot import this module in the image)', () => {
        expect(readFileSync('prisma.config.ts', 'utf8')).toContain(`SHARED_REPLICA_PORT = ${SHARED_REPLICA.port}`);
    });
});
