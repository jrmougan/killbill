import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BudgetClient } from './client';

const { refresh, fetchMock } = vi.hoisted(() => ({ refresh: vi.fn(), fetchMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/components/category/use-category-list', () => ({
    useCategoryList: () => ({ categories: [{ key: 'food', label: 'Comida', iconName: 'Utensils', hex: '#C9A227' }] }),
}));

const entry = { budget: { id: 'budget', category: 'food', amount: 100.08, month: '2026-10' }, spent: 0, percentage: 0 };
const savedEntry = { ...entry, budget: { ...entry.budget, amount: 12510 } };

beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function enterAmount(value: string): void {
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Importe del presupuesto' }), { target: { value } });
}
function save(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));
}

describe('budget save recovery', () => {
    it('preserves an edit on API rejection and refreshes only after a successful retry', async () => {
        render(<BudgetClient budgetData={[entry]} monthLabel="Octubre" />);
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        enterAmount('125.10');
        fetchMock.mockResolvedValueOnce(Response.json({ error: 'Invalid category' }, { status: 400 }));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el presupuesto');
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid category');
        expect(screen.getByRole('spinbutton')).toHaveValue(125.1);
        expect(screen.getByText(/Límite:/)).toHaveTextContent('100,08');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();

        fetchMock.mockResolvedValueOnce(Response.json({ budget: savedEntry.budget }, { status: 201 }))
            .mockResolvedValueOnce(Response.json({ budgets: [savedEntry] }));
        save();
        await waitFor(() => expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument());
        expect(screen.getByText(/Límite:/)).toHaveTextContent('125,10');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ category: 'food', amount: 125.1, scope: 'shared' });
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('keeps the add form after a network failure without an unhandled rejection', async () => {
        render(<BudgetClient budgetData={[]} monthLabel="Octubre" />);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        enterAmount('125.10');
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('Comprueba tu conexión');
        expect(screen.getByRole('spinbutton')).toHaveValue(125.1);
        expect(screen.getByRole('button', { name: 'Guardar presupuesto' })).toBeEnabled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('rejects zero and non-finite amounts without sending a request', () => {
        render(<BudgetClient budgetData={[]} monthLabel="Octubre" />);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        for (const value of ['0', '-1', '0.001', '1e309']) {
            enterAmount(value);
            save();
            expect(screen.getByRole('alert')).toHaveTextContent('Introduce un importe válido');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows read errors and restores the scope only after a successful retry', async () => {
        render(<BudgetClient budgetData={[entry]} monthLabel="Octubre" />);
        fetchMock.mockResolvedValueOnce(new Response('Service unavailable', { status: 500 }));
        fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los presupuestos');
        expect(screen.queryByText('Sin presupuestos aún')).not.toBeInTheDocument();
        expect(screen.queryByText(/Límite:/)).not.toBeInTheDocument();
        fetchMock.mockResolvedValueOnce(Response.json({ budgets: [] }));
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));
        expect(await screen.findByText('Sin presupuestos aún')).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
