import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminInvite } from './admin-data';

const createInviteAction = vi.fn();
const deleteInviteAction = vi.fn();
vi.mock('./actions', () => ({
    createInviteAction: () => createInviteAction(),
    deleteInviteAction: (id: string) => deleteInviteAction(id),
}));

const { AdminInvites } = await import('./admin-invites');

afterEach(() => {
    cleanup();
    createInviteAction.mockReset();
    deleteInviteAction.mockReset();
    vi.unstubAllGlobals();
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

/** Replace `navigator.clipboard` (absent in jsdom) for one test. */
const stubClipboard = (writeText: (text: string) => Promise<void>) =>
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

const INVITES = [
    invite('AAAA1111', 5),
    invite('BBBB2222', -2),
    invite('CCCC3333', -10, { id: 'u1', name: 'Pablo', email: 'pablo@example.com' }),
];

describe('AdminInvites', () => {
    it('links to the AI keys and models screen', () => {
        render(<AdminInvites invites={[]} />);
        expect(screen.getByRole('link', { name: /IA de los tickets/ })).toHaveAttribute('href', '/admin/ai');
    });

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

    it('an invite used or voided meanwhile closes the sheet instead of offering a retry', async () => {
        deleteInviteAction.mockResolvedValue({ ok: false, error: 'Esta invitación ya se había usado o anulado', gone: true });
        render(<AdminInvites invites={INVITES} />);

        fireEvent.click(screen.getByRole('button', { name: 'Anular invitación AAAA1111' }));
        fireEvent.click(within(screen.getByTestId('invite-void-sheet')).getByRole('button', { name: 'Anular invitación' }));

        expect(await screen.findByText('Esta invitación ya se había usado o anulado')).toBeInTheDocument();
        expect(screen.queryByTestId('invite-void-sheet')).not.toBeInTheDocument();
        expect(screen.queryByText('Invitación anulada')).not.toBeInTheDocument();
    });

    it('a failed void keeps the sheet open with a retry message', async () => {
        deleteInviteAction.mockResolvedValue({ ok: false, error: 'No se pudo eliminar la invitación' });
        render(<AdminInvites invites={INVITES} />);

        fireEvent.click(screen.getByRole('button', { name: 'Anular invitación AAAA1111' }));
        const sheet = screen.getByTestId('invite-void-sheet');
        fireEvent.click(within(sheet).getByRole('button', { name: 'Anular invitación' }));

        expect(await within(sheet).findByText('No se pudo anular la invitación. Inténtalo de nuevo.')).toBeInTheDocument();
    });

    it('Nueva invitación confirms with a toast', async () => {
        createInviteAction.mockResolvedValue({ ok: true });
        render(<AdminInvites invites={[]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Nueva invitación' }));
        expect(await screen.findByText('Invitación creada')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('a failed creation shows an error, whether the action refuses or throws', async () => {
        createInviteAction.mockResolvedValueOnce({ ok: false, error: 'Acceso denegado' });
        render(<AdminInvites invites={[]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Nueva invitación' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear la invitación');

        createInviteAction.mockRejectedValueOnce(new Error('network'));
        fireEvent.click(await screen.findByRole('button', { name: 'Nueva invitación' }));
        await waitFor(() => expect(createInviteAction).toHaveBeenCalledTimes(2));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear la invitación');
    });

    it('Copiar enlace copies the registration link', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard(writeText);
        render(<AdminInvites invites={INVITES} />);

        fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace de registro AAAA1111' }));
        expect(await screen.findByText('Enlace de registro copiado')).toBeInTheDocument();
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/register?code=AAAA1111`);
        expect(screen.getByRole('button', { name: 'Copiar enlace de registro AAAA1111' })).toHaveTextContent('Copiado');
    });

    it('when the clipboard fails the row shows the link to copy by hand', async () => {
        stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
        render(<AdminInvites invites={INVITES} />);

        fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace de registro AAAA1111' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo copiar el enlace');
        const field = screen.getByLabelText('Copia el enlace a mano');
        expect(field).toHaveValue(`${window.location.origin}/register?code=AAAA1111`);
        expect(field).toHaveAttribute('readonly');
    });

    it('a copy that works after a failed one clears the error and the manual link', async () => {
        const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
        stubClipboard(writeText);
        render(<AdminInvites invites={INVITES} />);

        const copy = screen.getByRole('button', { name: 'Copiar enlace de registro AAAA1111' });
        fireEvent.click(copy);
        expect(await screen.findByRole('alert')).toBeInTheDocument();

        fireEvent.click(copy);
        expect(await screen.findByText('Enlace de registro copiado')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Copia el enlace a mano')).not.toBeInTheDocument();
    });
});
