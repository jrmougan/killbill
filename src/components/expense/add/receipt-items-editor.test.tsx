import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReceiptItemsEditor, withUid, type EditableReceiptItem } from './receipt-items-editor';

afterEach(cleanup);

const line = (description: string, total: number) => withUid({ description, quantity: 1, price: total, total, assignedTo: null });

// Mirrors the form: the lines are the source of the total.
function Harness({ initial }: { initial: EditableReceiptItem[] }) {
    const [items, setItems] = useState(initial);
    const total = items.reduce((acc, it) => acc + it.total, 0);
    return (
        <>
            <output data-testid="total">{total.toFixed(2)}</output>
            <ReceiptItemsEditor items={items} onChange={setItems} userId="me" partner={{ id: 'lu', name: 'Lucía' }} assignable />
        </>
    );
}

const descriptions = () => screen.queryAllByLabelText(/^Descripción del producto/).map((el) => (el as HTMLInputElement).value);

describe('ReceiptItemsEditor', () => {
    it('deleting a line says what the total drops to and Deshacer restores the line and the total', () => {
        render(<Harness initial={[line('Pan', 1.2), line('Leche', 3.5), line('Huevos', 2.3)]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar producto 2' }));
        expect(descriptions()).toEqual(['Pan', 'Huevos']);
        expect(screen.getByTestId('total')).toHaveTextContent('3.50');
        expect(screen.getByTestId('receipt-line-removed')).toHaveTextContent(/Línea «Leche» eliminada · el total baja a 3,50\s€/);

        fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
        expect(descriptions()).toEqual(['Pan', 'Leche', 'Huevos']);
        expect(screen.getByTestId('total')).toHaveTextContent('7.00');
        expect(screen.queryByTestId('receipt-line-removed')).toBeNull();
    });

    it('deleting the last line keeps the amount and can be undone too', () => {
        render(<Harness initial={[line('Pan', 1.2)]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar producto 1' }));
        expect(screen.getByTestId('receipt-line-removed')).toHaveTextContent(/Sin desglose: el importe se queda en 1,20\s€/);
        fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
        expect(descriptions()).toEqual(['Pan']);
    });
});
