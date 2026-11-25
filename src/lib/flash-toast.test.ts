import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlashToast, takeFlashToast } from './flash-toast';

function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k) => m.get(k) ?? null,
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('flash-toast', () => {
    it('round-trips once: the second read is empty', () => {
        vi.stubGlobal('sessionStorage', memoryStorage());
        setFlashToast('Espacio archivado', { label: 'Ver', href: '/spaces' });
        expect(takeFlashToast()).toEqual({ message: 'Espacio archivado', action: { label: 'Ver', href: '/spaces' } });
        expect(takeFlashToast()).toBeNull();
    });

    it('drops malformed data and external action links', () => {
        const s = memoryStorage();
        vi.stubGlobal('sessionStorage', s);
        s.setItem('eq-flash-toast', '{not json');
        expect(takeFlashToast()).toBeNull();
        s.setItem('eq-flash-toast', JSON.stringify({ message: 'Hola', action: { label: 'X', href: 'https://evil.example' } }));
        expect(takeFlashToast()).toEqual({ message: 'Hola' });
    });

    it('works (no toast, no throw) when sessionStorage throws', () => {
        const boom = () => { throw new Error('SecurityError'); };
        vi.stubGlobal('sessionStorage', { getItem: boom, setItem: boom, removeItem: boom });
        expect(() => setFlashToast('Hola')).not.toThrow();
        expect(takeFlashToast()).toBeNull();
    });

    it('works when sessionStorage itself is not accessible', () => {
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('denied'); } });
        try {
            expect(() => setFlashToast('Hola')).not.toThrow();
            expect(takeFlashToast()).toBeNull();
        } finally {
            Reflect.deleteProperty(globalThis, 'sessionStorage');
        }
    });
});
