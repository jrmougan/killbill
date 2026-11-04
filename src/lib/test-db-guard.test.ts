import { describe, expect, it } from 'vitest';
import { nonLocalDatabaseReason } from './test-db-guard.mjs';

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
