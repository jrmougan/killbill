import { describe, it, expect } from 'vitest';
import { parseOCRText } from './ocr_parser';

describe('ocr_parser', () => {
    it('should parse a simple receipt with total', () => {
        const text = `
            MERCADONA
            CALLE FALSA 123
            TOTAL EUR 15.50
            GRACIAS POR SU VISITA
        `;
        const result = parseOCRText(text);
        expect(result.amount).toBe('15.50');
        expect(result.description).toBe('MERCADONA');
    });

    it('should detect items and calculate total from items if no total found', () => {
        const text = `
            SUPERMERCADO
            PAN BLANCO 1.20
            LECHE ENTERA 0.90
            MANZANAS 2.50
        `;
        const result = parseOCRText(text);
        expect(result.items.length).toBe(3);
        expect(result.amount).toBe('4.60');
        expect(result.items[0].description).toBe('PAN BLANCO');
        expect(result.items[0].total).toBe(1.20);
    });

    it('should parse quantities correctly', () => {
        const text = `
            SHOP
            2 x 1.50 COCA COLA 3.00
        `;
        const result = parseOCRText(text);
        expect(result.items[0].quantity).toBe(2);
        expect(result.items[0].price).toBe(1.50);
        expect(result.items[0].total).toBe(3.00);
    });

    it('should ignore garbage lines', () => {
        const text = `
            TICKET
            CIF: 12345678A
            FECHA: 2026-01-28
            PRODUCTO A 10.00
            TOTAL 10.00
        `;
        const result = parseOCRText(text);
        expect(result.items.length).toBe(1);
        expect(result.items[0].description).toBe('PRODUCTO A');
    });
});
