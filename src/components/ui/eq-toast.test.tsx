import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EqToast, useEqToast } from './eq';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function Harness({ onUndo }: { onUndo: () => void }) {
    const [toast, show, action] = useEqToast();
    return (
        <>
            <button type="button" onClick={() => show('Producto eliminado', { label: 'Deshacer', onAction: onUndo })}>abrir</button>
            <button type="button" onClick={() => show('Guardado')}>simple</button>
            {toast && <EqToast action={action}>{toast}</EqToast>}
        </>
    );
}

describe('EqToast', () => {
    it('mounts the live region empty and fills it afterwards (so it is announced)', () => {
        vi.useFakeTimers();
        render(<Harness onUndo={() => {}} />);
        fireEvent.click(screen.getByText('simple'));
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    });

    it('renders the action button and calls onAction (and dismisses)', async () => {
        const onUndo = vi.fn();
        render(<Harness onUndo={onUndo} />);
        fireEvent.click(screen.getByText('abrir'));
        expect(await screen.findByText('Producto eliminado')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Producto eliminado');
        fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Producto eliminado')).not.toBeInTheDocument();
    });

    it('renders a link action', async () => {
        render(<EqToast action={{ label: 'Ver qué falta', href: '/spaces/s1/close' }}>Estáis cerrando cuentas</EqToast>);
        expect(await screen.findByRole('link', { name: 'Ver qué falta' })).toHaveAttribute('href', '/spaces/s1/close');
    });

    it('keeps a toast with action ~5 s; a plain one uses the default', () => {
        vi.useFakeTimers();
        render(<Harness onUndo={() => {}} />);
        fireEvent.click(screen.getByText('simple'));
        act(() => { vi.advanceTimersByTime(2100); });
        expect(screen.queryByText('Guardado')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('abrir'));
        act(() => { vi.advanceTimersByTime(4000); });
        expect(screen.getByText('Producto eliminado')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1100); });
        expect(screen.queryByText('Producto eliminado')).not.toBeInTheDocument();
    });
});
