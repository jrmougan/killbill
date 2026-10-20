import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CategoryListItem } from '@/lib/category-context';
import { DeleteCategoryModal } from './delete-category-modal';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const cat = (id: string, key: string, label: string, isSystem = true) =>
    ({ id, key, label, emoji: '🏷️', hex: '#8b5cf6', isSystem }) as unknown as CategoryListItem;
const mascotas = cat('c-pets', 'mascotas', 'Mascotas', false);
const categories = [cat('c-shop', 'shopping', 'Compras'), cat('c-other', 'other', 'Otros'), mascotas];
const context = { kind: 'shared', groupId: 'g1' } as const;

describe('DeleteCategoryModal', () => {
    it('names the category and the target, prefilled to "Otros"', () => {
        render(<DeleteCategoryModal context={context} category={mascotas} categories={categories} onCancel={vi.fn()} />);
        expect(screen.getByRole('alertdialog', { hidden: true, name: '¿Eliminar la categoría «Mascotas»?' })).toBeTruthy();
        expect(screen.getByTestId('category-delete-sheet')).toHaveTextContent(
            'Los gastos, gastos recurrentes y presupuestos de «Mascotas» pasarán a la categoría que elijas.',
        );
        expect(screen.getByTestId('confirm-sheet-confirm')).toHaveTextContent('Eliminar y mover a «Otros»');
    });

    it('a 409 BUDGET_CONFLICT offers another target and "Ir a Presupuestos"', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ error: 'x', code: 'BUDGET_CONFLICT' }), { status: 409 }),
        );
        const onDeleted = vi.fn();
        render(<DeleteCategoryModal context={context} category={mascotas} categories={categories} onDeleted={onDeleted} onCancel={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Mover a'), { target: { value: 'c-shop' } });
        const confirm = screen.getByTestId('confirm-sheet-confirm');
        expect(confirm).toHaveTextContent('Eliminar y mover a «Compras»');
        fireEvent.click(confirm);
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/spaces/g1/categories?id=c-pets&reassignTo=c-shop', { method: 'DELETE' }),
        );
        const conflict = await screen.findByTestId('category-budget-conflict');
        expect(conflict).toHaveTextContent('«Compras» ya tiene presupuesto en un mes en que «Mascotas» también lo tiene');
        expect(screen.getByRole('link', { name: /Ir a Presupuestos/, hidden: true })).toHaveAttribute('href', '/month?view=budget');
        expect(confirm).toBeDisabled();
        expect(onDeleted).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Elegir otro destino', hidden: true }));
        expect(screen.queryByTestId('category-budget-conflict')).toBeNull();
        expect(document.activeElement).toBe(screen.getByLabelText('Mover a'));
        expect(confirm).toBeEnabled();
    });
});
