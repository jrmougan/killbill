import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CriticalActionSheet } from './critical-action-sheet';

afterEach(cleanup);

type Props = Partial<React.ComponentProps<typeof CriticalActionSheet>>;

function renderSheet(props: Props = {}) {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
        <CriticalActionSheet
            title="¿Archivar Casa?"
            confirmLabel="Archivar para siempre"
            onConfirm={onConfirm}
            onClose={onClose}
            {...props}
        />,
    );
    // `<dialog>` without `open` is hidden for role queries: look it up directly.
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    return { onConfirm, onClose, dialog };
}

describe('CriticalActionSheet', () => {
    it('renders facts and consequences', () => {
        renderSheet({
            facts: [{ label: 'Quién', value: 'Lucía' }, { label: 'Cuánto', value: '79,30 €', emphasis: true }],
            consequences: ['Quedará en solo lectura.', 'Nadie podrá añadir gastos.'],
        });
        expect(screen.getByText('Quién')).toBeInTheDocument();
        expect(screen.getByText('Lucía')).toBeInTheDocument();
        expect(screen.getByText('79,30 €')).toBeInTheDocument();
        expect(screen.getByText('Quedará en solo lectura.')).toBeInTheDocument();
        expect(screen.getByText('Nadie podrá añadir gastos.')).toBeInTheDocument();
        expect(screen.queryByText('No se puede deshacer.')).not.toBeInTheDocument();
    });

    it('danger: alertdialog, modal, initial focus on Cancelar', () => {
        const { dialog } = renderSheet({ tone: 'danger' });
        expect(dialog).toHaveAttribute('role', 'alertdialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(document.activeElement).toBe(screen.getByTestId('confirm-sheet-cancel'));
    });

    it('primary: plain dialog', () => {
        const { dialog } = renderSheet();
        expect(dialog.getAttribute('role') ?? 'dialog').toBe('dialog');
        expect(document.activeElement).not.toBe(screen.getByTestId('confirm-sheet-cancel'));
    });

    it('reversible=false adds "No se puede deshacer."', () => {
        renderSheet({ reversible: false });
        expect(screen.getByText('No se puede deshacer.')).toBeInTheDocument();
    });

    it('confirmDisabled shows the reason and blocks the CTA', () => {
        const { onConfirm } = renderSheet({ confirmDisabled: true, disabledReason: 'Aún hay deudas sin saldar.' });
        const cta = screen.getByTestId('confirm-sheet-confirm');
        expect(cta).toBeDisabled();
        expect(screen.getByText('Aún hay deudas sin saldar.')).toBeInTheDocument();
        expect(cta).toHaveAttribute('aria-describedby', screen.getByTestId('confirm-sheet-reason').id);
        fireEvent.click(cta);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Escape (dialog cancel) closes, but not while busy', () => {
        const first = renderSheet();
        fireEvent(first.dialog, new Event('cancel', { cancelable: true }));
        expect(first.onClose).toHaveBeenCalledTimes(1);
        cleanup();

        const busy = renderSheet({ busy: true });
        fireEvent(busy.dialog, new Event('cancel', { cancelable: true }));
        fireEvent.click(busy.dialog); // backdrop
        fireEvent.click(screen.getByTestId('confirm-sheet-cancel'));
        expect(busy.onClose).not.toHaveBeenCalled();
    });

    it('busy sets aria-busy and disables the CTA', () => {
        renderSheet({ busy: true, testId: 'archive-sheet' });
        expect(screen.getByTestId('archive-sheet')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByTestId('confirm-sheet-confirm')).toBeDisabled();
    });

    it('renders the server error with its link, even when the CTA is disabled', () => {
        renderSheet({
            confirmDisabled: true,
            error: 'Aún hay deudas sin saldar en este espacio.',
            errorHref: '/settle?space=s1',
        });
        expect(screen.getByTestId('confirm-sheet-error')).toHaveTextContent('Aún hay deudas sin saldar en este espacio.');
        expect(screen.getByRole('link', { name: /Saldar deudas/ })).toHaveAttribute('href', '/settle?space=s1');
    });

    it('confirms and renders a secondary action', () => {
        const onSecondary = vi.fn();
        const { onConfirm } = renderSheet({ secondary: { label: 'Salir sin saldar', onClick: onSecondary, tone: 'danger' } });
        fireEvent.click(screen.getByTestId('confirm-sheet-confirm'));
        fireEvent.click(screen.getByRole('button', { name: 'Salir sin saldar' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onSecondary).toHaveBeenCalledTimes(1);
    });
});
