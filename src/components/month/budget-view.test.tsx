import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BudgetView } from './budget-view';
import type { BudgetEntry, MonthCategory } from './types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const categories: MonthCategory[] = [
    { key: 'food', label: 'Comida', emoji: '🍽️', iconName: 'Utensils', hex: '#D9713C' },
    { key: 'home', label: 'Casa', emoji: '🏠', iconName: 'Home', hex: '#2F7D5B' },
];
const entry: BudgetEntry = { id: 'budget', category: 'food', amount: 10008, spent: 2502 };
const apiEntry = (amount: number, spent = 2502) => ({ budget: { id: 'budget', category: 'food', amount }, spent, percentage: 0 });

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderView(budgets: BudgetEntry[] = [entry]) {
    return render(<BudgetView scope="shared" daysLeft={27} categories={categories} initialBudgets={budgets} />);
}
const input = () => screen.getByRole('spinbutton', { name: 'Importe del presupuesto' });
const enterAmount = (value: string) => fireEvent.change(input(), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));

describe('Mes · presupuestos', () => {
    it('summarises remaining budget, rows and unbudgeted chips', () => {
        renderView();
        expect(screen.getByText('Te quedan para 27 días')).toBeVisible();
        expect(screen.getByTestId('budget-remaining')).toHaveTextContent('75,06 €');
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Añadir presupuesto de Casa' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Añadir presupuesto de Comida' })).not.toBeInTheDocument();
    });

    it('flags an overspent month in red', () => {
        renderView([{ ...entry, spent: 12000 }]);
        expect(screen.getByText('Te has pasado')).toBeVisible();
        expect(screen.getByTestId('budget-remaining')).toHaveTextContent('19,92 €');
    });

    it('shows the empty copy when there are no budgets', () => {
        renderView([]);
        expect(screen.getByText(/Aún no tienes presupuestos aquí/)).toBeVisible();
    });

    it('preserves an edit on API rejection and only closes after a successful retry', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        expect(input()).toHaveValue(100.08);
        enterAmount('125.10');
        fetchMock.mockResolvedValueOnce(Response.json({ error: 'Invalid category' }, { status: 400 }));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el presupuesto: Invalid category');
        expect(input()).toHaveValue(125.1);
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();

        fetchMock.mockResolvedValueOnce(Response.json({ budget: {} }, { status: 201 }))
            .mockResolvedValueOnce(Response.json({ budgets: [apiEntry(12510)] }));
        save();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByText('25,02 / 125,10 €')).toBeVisible();
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ category: 'food', amount: 125.1, scope: 'shared' });
        expect(fetchMock.mock.calls[2][0]).toBe('/api/budget?scope=shared');
    });

    it('keeps the add sheet after a network failure', async () => {
        renderView([]);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        enterAmount('125.10');
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('Comprueba tu conexión');
        expect(input()).toHaveValue(125.1);
        expect(screen.getByRole('button', { name: 'Guardar presupuesto' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Eliminar presupuesto' })).not.toBeInTheDocument();
    });

    it('rejects zero and non-finite amounts without sending a request', () => {
        renderView([]);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        for (const value of ['', '0', '-1', '0.001', '1e309']) {
            enterAmount(value);
            save();
            expect(screen.getByRole('alert')).toHaveTextContent('Introduce un importe válido');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes a budget, keeping it on failure', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        fetchMock.mockResolvedValueOnce(Response.json({ error: 'Budget not found' }, { status: 404 }));
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo eliminar el presupuesto: Budget not found');
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();

        fetchMock.mockResolvedValueOnce(Response.json({ ok: true }))
            .mockResolvedValueOnce(Response.json({ budgets: [] }));
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(fetchMock.mock.calls[1][0]).toBe('/api/budget?id=budget&scope=shared');
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
        expect(screen.getByText(/Aún no tienes presupuestos aquí/)).toBeVisible();
    });
});
