import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LeaveSpace } from './leave-space';

const { fetchMock, pushMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: pushMock }) }));

beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const base = { spaceId: 's1', userId: 'u1', spaceName: 'Casa', settleHref: '/settle?space=s1' };

describe('LeaveSpace', () => {
    it('with a debt the first sheet shows it and "Saldar deuda" goes to settle, without calling the API', () => {
        render(<LeaveSpace {...base} balanceCents={-3333} creditors={['Álvaro']} />);
        fireEvent.click(screen.getByTestId('leave-space'));
        const sheet = screen.getByTestId('leave-sheet');
        expect(sheet).toHaveTextContent('Tienes una deuda de 33,33');
        expect(sheet).toHaveTextContent('dejará de aparecer a tu nombre y Álvaro no podrá saldarla');
        fireEvent.click(screen.getByRole('button', { name: 'Saldar deuda', hidden: true }));
        expect(pushMock).toHaveBeenCalledWith('/settle?space=s1');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('"Salir sin saldar" does not call the API until the checkbox is ticked', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
        render(<LeaveSpace {...base} balanceCents={-3333} creditors={['Álvaro']} />);
        fireEvent.click(screen.getByTestId('leave-space'));
        fireEvent.click(screen.getByRole('button', { name: 'Salir sin saldar', hidden: true }));
        const confirm = screen.getByTestId('confirm-sheet-confirm');
        expect(confirm).toHaveTextContent('Salir sin saldar');
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(fetchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('leave-ack'));
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/spaces/s1/members/u1?force=1', { method: 'DELETE' }));
        await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    });

    it('last owner: offers to pick another owner instead of leaving', () => {
        render(<LeaveSpace {...base} lastOwner />);
        fireEvent.click(screen.getByTestId('leave-space'));
        expect(screen.getByTestId('leave-sheet')).toHaveTextContent('Eres la única persona propietaria de Casa');
        expect(screen.getByTestId('confirm-sheet-confirm')).toHaveTextContent('Elegir persona propietaria');
    });

    it('a stale 409 HAS_BALANCE switches to the debt sheet', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'HAS_BALANCE', balanceCents: -500, error: 'x' }), { status: 409 }));
        render(<LeaveSpace {...base} />);
        fireEvent.click(screen.getByTestId('leave-space'));
        fireEvent.click(screen.getByTestId('confirm-sheet-confirm'));
        await waitFor(() => expect(screen.getByTestId('leave-sheet')).toHaveTextContent('Tienes una deuda de 5,00'));
        expect(fetchMock).toHaveBeenCalledWith('/api/spaces/s1/members/u1', { method: 'DELETE' });
    });
});
