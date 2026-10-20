import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminInvite } from './admin-data';

const deleteInviteAction = vi.fn();
vi.mock('./actions', () => ({
    createInviteAction: vi.fn(),
    deleteInviteAction: (id: string) => deleteInviteAction(id),
}));

const { AdminInvites } = await import('./admin-invites');

afterEach(() => {
    cleanup();
    deleteInviteAction.mockReset();
});

const DAY = 24 * 60 * 60 * 1000;
const invite = (code: string, expiresInDays: number, usedBy: AdminInvite['usedBy'] = null): AdminInvite => ({
    id: code,
    code,
    createdAt: new Date().toISOString(),
    usedAt: usedBy ? new Date().toISOString() : null,
    expiresAt: new Date(Date.now() + expiresInDays * DAY).toISOString(),
    usedBy,
});

const INVITES = [
    invite('AAAA1111', 5),
    invite('BBBB2222', -2),
    invite('CCCC3333', -10, { id: 'u1', name: 'Pablo', email: 'pablo@example.com' }),
];

describe('AdminInvites', () => {
    it('an expired invite does not count as Disponible and cannot be copied', () => {
        render(<AdminInvites invites={INVITES} />);
        expect(screen.getByTestId('admin-available-count')).toHaveTextContent('1');

        const available = screen.getByRole('region', { name: 'Disponibles' });
        expect(within(available).getByText('AAAA1111')).toBeInTheDocument();
        expect(within(available).queryByText('BBBB2222')).not.toBeInTheDocument();
        expect(within(available).getByRole('button', { name: /^Copiar enlace/ })).toHaveTextContent('Copiar enlace');

        const expired = screen.getByRole('region', { name: 'Caducadas' });
        expect(within(expired).getByText('BBBB2222')).toBeInTheDocument();
        expect(within(expired).queryByRole('button', { name: /^Copiar enlace/ })).not.toBeInTheDocument();
        expect(within(expired).getByRole('button', { name: 'Anular invitación BBBB2222' })).toBeInTheDocument();
    });

    it('Anular opens a danger sheet and voids the invite only on confirm', async () => {
        deleteInviteAction.mockResolvedValue({ ok: true });
        render(<AdminInvites invites={INVITES} />);

        fireEvent.click(screen.getByRole('button', { name: 'Anular invitación AAAA1111' }));
        expect(deleteInviteAction).not.toHaveBeenCalled();
        const sheet = screen.getByTestId('invite-void-sheet');
        expect(screen.getByText('¿Anular la invitación AAAA1111?')).toBeInTheDocument();
        expect(within(sheet).getByText(/El enlace de registro que hayas enviado dejará de funcionar/)).toBeInTheDocument();

        fireEvent.click(within(sheet).getByRole('button', { name: 'Anular invitación' }));
        await waitFor(() => expect(deleteInviteAction).toHaveBeenCalledWith('AAAA1111'));
        expect(await screen.findByText('Invitación anulada')).toBeInTheDocument();
    });
});
