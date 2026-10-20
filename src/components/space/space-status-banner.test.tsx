import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SpaceStatusBanner } from './space-status-banner';

afterEach(cleanup);

type Props = Partial<Parameters<typeof SpaceStatusBanner>[0]>;

function renderSettling(props: Props = {}) {
    return render(
        <SpaceStatusBanner
            spaceId="s1"
            type="GROUP"
            status="SETTLING"
            settleHref="/settle?space=s1"
            openDebts={2}
            {...props}
        />,
    );
}

function links() {
    return screen.queryAllByRole('link');
}

describe('SpaceStatusBanner · SETTLING', () => {
    it('shows the progress and how the space is blocked', () => {
        renderSettling();
        expect(screen.getByTestId('space-status-progress').textContent).toBe('Cerrando cuentas · faltan 2 deudas');
        expect(screen.getByText('No se pueden añadir ni editar gastos; sí saldar deudas.')).toBeTruthy();
    });

    it('uses the singular for one debt', () => {
        renderSettling({ openDebts: 1 });
        expect(screen.getByTestId('space-status-progress').textContent).toBe('Cerrando cuentas · falta 1 deuda');
    });

    it('offers only "Saldar deudas" when the viewer has something open', () => {
        renderSettling({ myBalanceOpen: true, canManage: true });
        expect(links()).toHaveLength(1);
        expect(screen.getByRole('link', { name: 'Saldar deudas →' }).getAttribute('href')).toBe('/settle?space=s1');
    });

    it('points a registered member who is settled to what is missing', () => {
        renderSettling();
        expect(links()).toHaveLength(1);
        expect(screen.getByRole('link', { name: 'Ver qué falta →' }).getAttribute('href')).toBe('/spaces/s1/close');
    });

    it('never links a guest to the close flow', () => {
        renderSettling({ isGuest: true });
        expect(links()).toHaveLength(0);
        cleanup();
        renderSettling({ isGuest: true, openDebts: 0, canManage: true });
        expect(links()).toHaveLength(0);
        cleanup();
        renderSettling({ isGuest: true, myBalanceOpen: true });
        expect(links().map((a) => a.getAttribute('href'))).toEqual(['/settle?space=s1']);
    });

    it('offers archiving to OWNER/ADMIN once everything is settled', () => {
        renderSettling({ openDebts: 0, canManage: true });
        expect(screen.getByTestId('space-status-progress').textContent).toBe('Cerrando cuentas · estáis al día');
        expect(screen.getByRole('link', { name: 'Todo saldado · Archivar →' }).getAttribute('href')).toBe('/spaces/s1/close');
    });

    it('shows no CTA to a member when everything is settled', () => {
        renderSettling({ openDebts: 0 });
        expect(links()).toHaveLength(0);
    });
});
