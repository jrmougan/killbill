import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

/** YYYY-MM-DD of day `day` in the month `offset` months from today (Madrid). */
function madridDate(offset: number, day: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value) - 1 + offset;
  const d = new Date(Date.UTC(y, m, day));
  return d.toISOString().slice(0, 10);
}

async function postExpense(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/expenses', { data: body });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe('Mes — Análisis y Presupuestos', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('a future-dated expense never leaks into this month; KPIs and balance evolution are back', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt'); // 100 € today, 50/50, paid by A
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await postExpense(page, { description: 'Futuro QA', amount: 40, category: 'food', date: madridDate(1, 15) });
    await postExpense(page, { description: 'Pasado QA', amount: 20, category: 'food', date: madridDate(-1, 10) });

    await page.goto('/month?view=analysis');
    const panel = page.getByRole('tabpanel', { name: 'Análisis' });
    await expect(page.getByTestId('month-total')).toHaveText(/100,00\s*€/);
    await expect(page.getByTestId('month-my-share')).toHaveText(/50,00\s*€/);
    await expect(page.getByTestId('month-delta')).toHaveText(/\+400% vs/);
    // Breakdown adds up to the total: only "Otro", no future "Comida".
    await expect(panel.getByText('100%', { exact: true })).toBeVisible();
    await expect(panel.getByText('Comida', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Futuro QA')).toHaveCount(0);
    // KPI tiles.
    await expect(page.getByTestId('kpi-count')).toHaveText('1');
    await expect(page.getByTestId('kpi-avg')).toHaveText(/60,00\s*€/);
    await expect(page.getByTestId('kpi-top')).toHaveText('Otro');
    // Balance at this month's end: 50 (today) + 10 (last month), not the future 20.
    await expect(page.getByTestId('balance-now')).toHaveText(/Te deben\s*60,00\s*€/);
  });

  test('SETTLING space: Mes shows the status and budgets are read-only', async ({ page, request }) => {
    const seed = await seedScenario(request, 'space-settling');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/month');
    await expect(page.getByTestId('month-status-banner')).toContainText('Espacio en liquidación');
    await expect(page.getByRole('button', { name: /Añadir presupuesto/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Editar presupuesto/ })).toHaveCount(0);
  });

  test('budget rows show the percentage and warn from 80 %, and the summary names an overspent category', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt'); // 100 € "Otro" this month
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await postExpense(page, { description: 'Cena QA', amount: 85, category: 'food' });
    for (const [category, amount] of [['other', 60], ['food', 100], ['rent', 500]] as const) {
      const res = await page.request.post('/api/budget', { data: { category, amount, scope: 'shared' } });
      expect(res.status()).toBe(201);
    }
    await page.goto('/month');
    const percents = page.getByTestId('budget-percent');
    await expect(percents.filter({ hasText: '85% · cerca del límite' })).toHaveCount(1);
    await expect(percents.filter({ hasText: '167% · pasado' })).toHaveCount(1);
    await expect(page.getByText(/^Te quedan para \d+ días?$/)).toBeVisible();
    await expect(page.getByTestId('budget-over-note')).toHaveText(/Te has pasado en Otro/);
  });
});
