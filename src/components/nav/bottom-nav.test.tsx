import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BottomNav, isTabRoute } from './bottom-nav';

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn(() => '/dashboard') }));
vi.mock('next/navigation', () => ({
    usePathname: pathnameMock,
    useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

describe('isTabRoute', () => {
    it('shows the registered nav on its tabs (and sub-routes) only', () => {
        for (const p of ['/dashboard', '/expenses/list', '/month', '/lists', '/lists/abc']) {
            expect(isTabRoute(p, false)).toBe(true);
        }
        for (const p of ['/expenses/new', '/expenses/abc', '/settle', '/settings', '/guest/upgrade', '/dashboardx']) {
            expect(isTabRoute(p, false)).toBe(false);
        }
    });

    it('shows the guest nav on its own tabs, including the "Cuenta" tab /guest/upgrade', () => {
        for (const p of ['/dashboard', '/expenses/list', '/guest/upgrade']) {
            expect(isTabRoute(p, true)).toBe(true);
        }
        for (const p of ['/expenses/new', '/settle', '/month', '/lists']) {
            expect(isTabRoute(p, true)).toBe(false);
        }
    });
});

describe('BottomNav', () => {
    it('renders the guest nav on /guest/upgrade with "Crear cuenta" active', () => {
        pathnameMock.mockReturnValue('/guest/upgrade');
        render(<BottomNav isGuest />);
        expect(screen.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
    });

    it('renders nothing on /guest/upgrade for a registered session', () => {
        pathnameMock.mockReturnValue('/guest/upgrade');
        const { container } = render(<BottomNav />);
        expect(container).toBeEmptyDOMElement();
    });
});
