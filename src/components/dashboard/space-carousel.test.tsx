import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SpaceCarousel, type SpaceCardData } from './space-carousel';

vi.mock('@/components/space/use-activate-space', () => ({
    useActivateSpace: () => ({ activate: vi.fn(), pending: false }),
}));

beforeAll(() => {
    // jsdom has no layout, so it does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const NBSP_EUR = ' €';

function card(over: Partial<SpaceCardData> = {}): SpaceCardData {
    return {
        key: 'a',
        emoji: '💑',
        name: 'Casa',
        sub: 'con Axel',
        label: 'Axel te debe',
        amount: `5,35${NBSP_EUR}`,
        tone: 'positive',
        signed: `+5,35${NBSP_EUR}`,
        settleHref: '/settle?space=a',
        settleSub: `Cobras 5,35${NBSP_EUR}`,
        ...over,
    };
}

const OWED = card();
const OWING = card({
    label: 'Le debes a Axel',
    tone: 'negative',
    signed: `-5,35${NBSP_EUR}`,
    settleSub: `Pagas 5,35${NBSP_EUR}`,
});
const AT_PEACE = card({
    label: 'Estáis al día',
    amount: `0,00${NBSP_EUR}`,
    tone: 'neutral',
    signed: `0,00${NBSP_EUR}`,
    settleHref: null,
    settleSub: null,
});
const PERSONAL = card({
    label: 'Personal este mes',
    amount: `12,00${NBSP_EUR}`,
    tone: 'neutral',
    signed: null,
    settleHref: null,
    settleSub: null,
});

function renderActive(c: SpaceCardData) {
    render(<SpaceCarousel cards={[c]} activeKey={c.key} spacesHref={null} />);
    return screen.getByTestId('space-card-active');
}

/** The visible amount: the aria-hidden figure, or the plain one when unsigned. */
function bigAmount(root: HTMLElement) {
    return root.querySelector('.font-bold')?.textContent;
}

function directionIcon(root: HTMLElement) {
    return root.querySelector('span[aria-hidden="true"].rounded-full svg')?.getAttribute('class') ?? null;
}

describe('SpaceCarousel · active card direction', () => {
    it('owed to me: green, plus sign, arrow coming in', () => {
        const root = renderActive(OWED);
        expect(root.getAttribute('data-tone')).toBe('positive');
        expect(root.className).toContain('bg-primary');
        expect(root.className).not.toContain('bg-[var(--negative)]');
        expect(bigAmount(root)).toBe(`+5,35${NBSP_EUR}`);
        expect(directionIcon(root)).toContain('lucide-arrow-down-left');
    });

    it('I owe: terracotta, U+2212 sign, arrow going out', () => {
        const root = renderActive(OWING);
        expect(root.getAttribute('data-tone')).toBe('negative');
        expect(root.className).toContain('bg-[var(--negative)]');
        expect(root.className).not.toContain('bg-primary');
        expect(bigAmount(root)).toBe(`−5,35${NBSP_EUR}`);
        expect(directionIcon(root)).toContain('lucide-arrow-up-right');
    });

    it('stays terracotta while a payment is pending or was rejected', () => {
        const root = renderActive({
            ...OWING,
            pendingNote: 'Pago pendiente',
            rejectedNote: { text: 'Axel no recibió tu pago', href: '/settle/1' },
        });
        expect(root.getAttribute('data-tone')).toBe('negative');
        expect(root.className).toContain('bg-[var(--negative)]');
    });

    it('at zero: green, no sign, a check and no settle link', () => {
        const root = renderActive(AT_PEACE);
        expect(root.getAttribute('data-tone')).toBe('neutral');
        expect(root.className).toContain('bg-primary');
        expect(bigAmount(root)).toBe(`0,00${NBSP_EUR}`);
        expect(directionIcon(root)).toContain('lucide-check');
        expect(screen.queryByRole('link', { name: 'Saldar deuda' })).toBeNull();
    });

    it('personal: green, without disc or sign', () => {
        const root = renderActive(PERSONAL);
        expect(root.getAttribute('data-tone')).toBe('neutral');
        expect(root.className).toContain('bg-primary');
        expect(bigAmount(root)).toBe(`12,00${NBSP_EUR}`);
        expect(directionIcon(root)).toBeNull();
        expect(screen.queryByTestId('balance-amount')).toBeNull();
    });

    it('keeps the ASCII signed amount and the settle description for assistive tech', () => {
        renderActive(OWING);
        expect(screen.getByTestId('balance-amount').textContent).toBe(`-5,35${NBSP_EUR}`);
        const link = screen.getByRole('link', { name: 'Saldar deuda' });
        const sub = document.getElementById(link.getAttribute('aria-describedby') ?? '');
        expect(sub?.textContent).toBe(`Pagas 5,35${NBSP_EUR}`);
    });

    it('does not dim or truncate the direction phrase nor "con X"', () => {
        const root = renderActive(card({ label: 'Maximiliano te debe' }));
        const label = screen.getByText('Maximiliano te debe');
        const sub = screen.getByText('con Axel');
        expect(label.className).not.toMatch(/opacity-|truncate/);
        expect(sub.className).not.toMatch(/opacity-/);
        expect(root.querySelector('[class*="opacity-"]')).toBeNull();
    });

    it('counts the sign when stepping the big amount down', () => {
        // 12 characters unsigned would stay at 34 px; the sign makes it 13.
        const root = renderActive({ ...OWING, amount: `123.456,78${NBSP_EUR}` });
        expect(root.querySelector('.font-bold')?.className).toContain('text-[30px]');
    });
});

describe('SpaceCarousel · inactive cards', () => {
    function renderInactive(c: SpaceCardData) {
        render(<SpaceCarousel cards={[card({ key: 'other' }), c]} activeKey="other" spacesHref={null} />);
        return screen.getByRole('button', { name: new RegExp(c.label) });
    }

    it('shows the sign and keeps the aria-label', () => {
        const button = renderInactive({ ...OWING, key: 'b' });
        expect(button.querySelector('.font-bold')?.textContent).toBe(`−5,35${NBSP_EUR}`);
        expect(button.getAttribute('aria-label')).toBe(
            `Cambiar a Casa. con Axel. Le debes a Axel: -5,35${NBSP_EUR}`,
        );
    });

    it('gets no direction icon', () => {
        const button = renderInactive({ ...OWED, key: 'b' });
        expect(button.querySelector('.rounded-full')).toBeNull();
        expect(button.querySelector('.font-bold')?.textContent).toBe(`+5,35${NBSP_EUR}`);
    });
});
