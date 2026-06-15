import { describe, it, expect } from 'vitest';
import { escapeCsvField } from './csv';

describe('escapeCsvField', () => {
    it('returns empty string for null/undefined', () => {
        expect(escapeCsvField(null)).toBe('');
        expect(escapeCsvField(undefined)).toBe('');
    });

    it('leaves plain values untouched', () => {
        expect(escapeCsvField('Mercadona')).toBe('Mercadona');
        expect(escapeCsvField('12.50')).toBe('12.50');
    });

    it('quotes and doubles quotes for comma/quote/newline', () => {
        expect(escapeCsvField('a,b')).toBe('"a,b"');
        expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
        expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('neutralizes CSV/formula injection by prefixing a quote', () => {
        // Classic injection payloads must not start with the formula char anymore.
        expect(escapeCsvField('=1+1')).toBe("'=1+1");
        expect(escapeCsvField('+CMD')).toBe("'+CMD");
        expect(escapeCsvField('-2+3')).toBe("'-2+3");
        expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    });

    it('both neutralizes the leader and quotes when the payload also has a comma', () => {
        // =HYPERLINK("http://evil","x") -> prefixed AND wrapped/escaped
        const out = escapeCsvField('=HYPERLINK("http://evil","x")');
        expect(out.startsWith('"\'=')).toBe(true);
        expect(out).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    });
});
