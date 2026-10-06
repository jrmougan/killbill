import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BudgetView, validateBudgetInput } from './budget-view';
import type { BudgetEntry, MonthCategory } from './types';

const { fetchMock, refreshMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

const categories: MonthCategory[] = [
    { key: 'food', label: 'Comida', emoji: '🍽️', iconName: 'Utensils', hex: '#D9713C' },
    { key: 'home', label: 'Casa', emoji: '🏠', iconName: 'Home', hex: '#2F7D5B' },
    { key: 'leisure', label: 'Ocio', emoji: '🎉', iconName: 'PartyPopper', hex: '#A85C8A' },
];
const entry: BudgetEntry = { id: 'budget', category: 'food', amount: 10008, spent: 2502 };

beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderView(budgets: BudgetEntry[] = [entry], extra: { readOnly?: boolean; spent?: Record<string, number> } = {}) {
    return render(
        <BudgetView
            scope="shared"
            groupId="g1"
            readOnly={extra.readOnly}
            daysLeft={27}
            categories={categories}
            initialBudgets={budgets}
            spentByCategory={extra.spent}
        />,
    );
}
const input = () => screen.getByRole('textbox', { name: 'Importe del presupuesto' });
const enterAmount = (value: string) => fireEvent.change(input(), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));

describe('validateBudgetInput', () => {
    it('accepts es-ES amounts and rejects garbage, zero and the over-max', () => {
        expect(validateBudgetInput('12,5')).toEqual({ cents: 1250 });
        expect(validateBudgetInput('1.234,56')).toEqual({ cents: 123456 });
        expect(validateBudgetInput('1000000')).toEqual({ cents: 100_000_000 });
        for (const bad of ['', '0', '-1', '0,001', 'abc', '1e309']) {
            expect(validateBudgetInput(bad)).toHaveProperty('error');
        }
        expect(validateBudgetInput('1000000,01')).toEqual({ error: 'El presupuesto máximo es de 1.000.000 €' });
        expect(validateBudgetInput('99999999')).toEqual({ error: 'El presupuesto máximo es de 1.000.000 €' });
    });
});

describe('Mes · presupuestos', () => {
    it('summarises remaining budget, rows with percentage and unbudgeted chips', () => {
        renderView();
        expect(screen.getByText('Te quedan para 27 días')).toBeVisible();
        expect(screen.getByTestId('budget-remaining')).toHaveTextContent('75,06 €');
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();
        expect(screen.getByTestId('budget-percent')).toHaveTextContent('25%');
        expect(screen.getByRole('button', { name: 'Añadir presupuesto de Casa' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Añadir presupuesto de Comida' })).not.toBeInTheDocument();
    });

    it('warns at 80 % and flags an overspent category hidden by the aggregate', () => {
        renderView([
            { id: 'a', category: 'food', amount: 10000, spent: 8500 },
            { id: 'b', category: 'leisure', amount: 6000, spent: 10000 },
            { id: 'c', category: 'home', amount: 50000, spent: 0 },
        ]);
        const pcts = screen.getAllByTestId('budget-percent').map((el) => el.textContent);
        expect(pcts).toEqual(['85% · cerca del límite', '0%', '167% · pasado']);
        expect(screen.getByText('Te quedan para 27 días')).toBeVisible();
        expect(screen.getByTestId('budget-over-note')).toHaveTextContent('Te has pasado en Ocio');
    });

    it('flags an overspent month in red', () => {
        renderView([{ ...entry, spent: 12000 }]);
        expect(screen.getByText('Te has pasado')).toBeVisible();
        expect(screen.getByTestId('budget-remaining')).toHaveTextContent('19,92 €');
        expect(screen.queryByTestId('budget-over-note')).not.toBeInTheDocument();
    });

    it('shows the empty copy when there are no budgets', () => {
        renderView([]);
        expect(screen.getByText(/Aún no tienes presupuestos aquí/)).toBeVisible();
    });

    it('is read-only for a SETTLING/ARCHIVED space: no add, edit or delete', () => {
        renderView([entry], { readOnly: true });
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();
        expect(screen.queryByRole('button', { name: /Editar presupuesto/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Añadir presupuesto/ })).not.toBeInTheDocument();
    });

    it('preserves an edit on API rejection and only closes after a successful retry', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        expect(input()).toHaveValue('100,08');
        enterAmount('125,10');
        fetchMock.mockResolvedValueOnce(Response.json({ error: 'Invalid category' }, { status: 400 }));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el presupuesto: Invalid category.');
        expect(input()).toHaveValue('125,10');
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();

        fetchMock.mockResolvedValueOnce(Response.json({ budget: { id: 'budget' } }, { status: 201 }));
        save();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByText('25,02 / 125,10 €')).toBeVisible();
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ category: 'food', amount: 125.1, scope: 'shared', groupId: 'g1' });
        expect(refreshMock).toHaveBeenCalled();
    });

    it('adds a new budget with the month spend the server already measured', async () => {
        renderView([], { spent: { home: 4200 } });
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Casa' }));
        enterAmount('1.000');
        fetchMock.mockResolvedValueOnce(Response.json({ budget: { id: 'new' } }, { status: 201 }));
        save();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByText('42 / 1000 €')).toBeVisible();
    });

    it('explains a 409 SPACE_NOT_WRITABLE instead of suggesting a retry', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        fetchMock.mockResolvedValueOnce(
            Response.json({ error: 'x', code: 'SPACE_NOT_WRITABLE' }, { status: 409 }),
        );
        save();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('solo lectura');
        expect(alert).not.toHaveTextContent('Vuelve a intentarlo');
    });

    it('keeps the add sheet after a network failure', async () => {
        renderView([]);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        enterAmount('125.10');
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('Comprueba tu conexión');
        expect(input()).toHaveValue('125.10');
        expect(screen.getByRole('button', { name: 'Guardar presupuesto' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Eliminar presupuesto' })).not.toBeInTheDocument();
    });

    it('rejects invalid and over-max amounts without sending a request', () => {
        renderView([]);
        fireEvent.click(screen.getByRole('button', { name: 'Añadir presupuesto de Comida' }));
        for (const value of ['', '0', '-1', '0.001', '1e309', 'abc']) {
            enterAmount(value);
            save();
            expect(screen.getByRole('alert')).toHaveTextContent('Introduce un importe válido');
        }
        enterAmount('99999999');
        save();
        expect(screen.getByRole('alert')).toHaveTextContent('1.000.000 €');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('asks for confirmation before deleting, keeping it on failure', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Editar presupuesto de Comida' }));
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto' }));
        expect(fetchMock).not.toHaveBeenCalled();
        // Cancel keeps it.
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(screen.getByRole('button', { name: 'Guardar presupuesto' })).toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: 'Eliminar presupuesto' }));
        fetchMock.mockResolvedValueOnce(Response.json({ error: 'Budget not found' }, { status: 404 }));
        fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo eliminar el presupuesto: Budget not found');
        expect(screen.getByText('25,02 / 100,08 €')).toBeVisible();

        fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(fetchMock.mock.calls[1][0]).toBe('/api/budget?id=budget&scope=shared&groupId=g1');
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
        expect(screen.getByText(/Aún no tienes presupuestos aquí/)).toBeVisible();
    });
});
