import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type APIRequestContext, type Page } from '@playwright/test';
import { resetDb, seedScenario, type SeedResult } from '../../e2e/fixtures/db.fixture';

/**
 * Screenshots of the real app for the Ralph UX loop (scripts/ralph/README.md).
 * Each screen writes, under scripts/ralph/shots/:
 *   <id>.png       — the first viewport (what the user sees without scrolling)
 *   <id>.full.png  — the whole scrollable page
 *   <id>.aria.yml  — accessibility tree (names, roles, headings)
 *   <id>.json      — url, console errors, overflow and small-touch-target report
 * The `design` field names the matching mockup in scripts/ralph/design/ (if any).
 *
 * Run:  mise run ux:capture                         (every screen)
 *       SCREENS=inicio,listas mise run ux:capture   (only those ids)
 */

type Screen = {
  id: string;
  scenario: 'ux-showcase' | 'couple-no-expenses' | 'solo-user' | 'space-settling' | 'space-archived';
  path: (d: SeedResult) => string;
  design?: string;
  /** Lands on /welcome instead of skipping it like the e2e loginAs helper. */
  keepWelcome?: boolean;
  /** Log in as the seed's second user (default: userA). */
  asUserB?: boolean;
  /** Interaction run before the screenshots (e.g. type an amount, open a sheet). */
  act?: (page: Page) => Promise<void>;
  /** Space pinned as active (`active_group` cookie); default: the seed's `coupleId`. */
  activeGroup?: (d: SeedResult) => string;
};

const SCREENS: Screen[] = [
  { id: 'inicio', scenario: 'ux-showcase', path: () => '/dashboard', design: '2a-inicio' },
  { id: 'anadir-gasto', scenario: 'ux-showcase', path: () => '/expenses/new', design: '2a-anadir-gasto' },
  {
    id: 'anadir-gasto-relleno', scenario: 'ux-showcase', path: () => '/expenses/new', design: '2a-anadir-gasto',
    act: async (page) => {
      for (const k of ['2', '4', 'comma', '5', '0']) await page.click(`[data-testid="numpad-${k}"]`);
      await page.fill('[data-testid="expense-description"]', 'Farmacia');
    },
  },
  {
    id: 'anadir-gasto-opciones', scenario: 'ux-showcase', path: () => '/expenses/new',
    act: async (page) => {
      await page.click('[data-testid="numpad-2"]');
      await page.click('[data-testid="expense-more"]');
      await page.waitForTimeout(600); // let the sheet finish sliding in
    },
  },
  { id: 'quedar-en-paz', scenario: 'ux-showcase', path: (d) => `/settle?space=${d.coupleId}`, design: '2a-quedar-en-paz-ticket' },
  { id: 'quedar-en-paz-deudor', scenario: 'ux-showcase', path: (d) => `/settle?space=${d.coupleId}`, design: '2a-quedar-en-paz-ticket', asUserB: true },
  { id: 'quedar-en-paz-pendiente', scenario: 'ux-showcase', path: (d) => `/settle?space=${d.groupId}` },
  { id: 'pago-detalle', scenario: 'ux-showcase', path: (d) => `/settle/${d.settlementId}` },
  { id: 'gastos', scenario: 'ux-showcase', path: () => '/expenses/list', design: '3a-gastos' },
  { id: 'gasto-detalle', scenario: 'ux-showcase', path: (d) => `/expense/${d.expenseId}` },
  { id: 'mes-presupuestos', scenario: 'ux-showcase', path: () => '/month', design: '3a-mes-presupuestos' },
  {
    id: 'mes-presupuestos-anadir', scenario: 'ux-showcase', path: () => '/month',
    act: async (page) => {
      await page.getByRole('button', { name: 'Añadir presupuesto de Alquiler', exact: true }).click();
      await page.waitForTimeout(600); // let the sheet finish sliding in
    },
  },
  { id: 'mes-analisis', scenario: 'ux-showcase', path: () => '/month?view=analysis', design: '3a-mes-analisis' },
  { id: 'listas', scenario: 'ux-showcase', path: (d) => `/lists/${d.listId}`, design: '3a-listas-de-la-compra' },
  { id: 'espacios', scenario: 'ux-showcase', path: () => '/spaces', design: '3a-espacios' },
  { id: 'espacio-detalle', scenario: 'ux-showcase', path: (d) => `/spaces/${d.coupleId}` },
  // Lisboa active: Casa (a full couple) can't invite, so this shows the "Invitar a…" card.
  { id: 'espacios-invitar', scenario: 'ux-showcase', path: () => '/spaces', activeGroup: (d) => d.groupId as string },
  {
    id: 'espacios-unirme', scenario: 'ux-showcase', path: () => '/spaces',
    act: async (page) => {
      await page.getByRole('button', { name: 'Unirme con enlace' }).click();
      await page.waitForTimeout(600); // let the form/sheet finish opening
    },
  },
  { id: 'espacio-detalle-grupo', scenario: 'ux-showcase', path: (d) => `/spaces/${d.groupId}` },
  { id: 'ajustes', scenario: 'ux-showcase', path: () => '/settings', design: '3a-ajustes' },
  { id: 'historial-pagos', scenario: 'ux-showcase', path: () => '/settle/history' },
  { id: 'bienvenida', scenario: 'solo-user', path: () => '/welcome', design: '3a-bienvenida', keepWelcome: true },
  { id: 'inicio-vacio', scenario: 'couple-no-expenses', path: () => '/dashboard' },
  { id: 'gastos-vacio', scenario: 'couple-no-expenses', path: () => '/expenses/list' },
  { id: 'inicio-liquidando', scenario: 'space-settling', path: () => '/dashboard' },
  { id: 'inicio-archivado', scenario: 'space-archived', path: () => '/dashboard' },
  { id: 'login', scenario: 'ux-showcase', path: () => '/login' },
];

const OUT = 'scripts/ralph/shots';
mkdirSync(OUT, { recursive: true });

let api: APIRequestContext;
const seeds = new Map<string, Promise<SeedResult>>();
const seed = (scenario: string) => {
  if (!seeds.has(scenario)) seeds.set(scenario, seedScenario(api, scenario));
  return seeds.get(scenario)!;
};

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });
  await resetDb(api);
});

test.afterAll(async () => {
  await api.dispose();
});

async function login(page: Page, user: { email: string; password: string }, keepWelcome: boolean) {
  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', user.email);
  await page.fill('[data-testid="login-password"]', user.password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL(/\/(dashboard|welcome)(\?|$)/);
  if (!keepWelcome && new URL(page.url()).pathname === '/welcome') await page.goto('/dashboard');
}

const only = process.env.SCREENS?.split(',').map((s) => s.trim()).filter(Boolean);

for (const screen of SCREENS.filter((s) => !only?.length || only.includes(s.id))) {
  test(screen.id, async ({ page, context }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    const data = await seed(screen.scenario);
    const user = screen.asUserB ? data.userB : data.userA ?? data.user;
    if (screen.id !== 'login') {
      await login(page, user!, !!screen.keepWelcome);
      // Pin the space the screen is about (the active_group cookie otherwise picks the primary one).
      const activeGroup = screen.activeGroup?.(data) ?? data.coupleId;
      if (typeof activeGroup === 'string') {
        await context.addCookies([{ name: 'active_group', value: activeGroup, url: page.url() }]);
      }
    }
    await page.goto(screen.path(data));
    await page.waitForLoadState('networkidle');
    // The Next dev-tools badge sits on top of the tab bar; it is not part of the UI.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    if (screen.act) await screen.act(page);
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: `${OUT}/${screen.id}.png` });
    await page.screenshot({ path: `${OUT}/${screen.id}.full.png`, fullPage: true });
    writeFileSync(`${OUT}/${screen.id}.aria.yml`, await page.locator('body').ariaSnapshot());

    const layout = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const smallTargets = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"], [role="tab"]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => ({
          tag: el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        }));
      // Content of a horizontal scroller (the space cards carousel) is meant to overflow.
      const inScroller = (el: HTMLElement) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      const overflowing = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > vw + 1 && !inScroller(el))
        .slice(0, 10)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}`);
      return { scrollWidth: document.documentElement.scrollWidth, viewportWidth: vw, overflowing, smallTargets };
    });

    writeFileSync(`${OUT}/${screen.id}.json`, JSON.stringify({
      id: screen.id, url: page.url(), design: screen.design ? `scripts/ralph/design/${screen.design}.png` : null,
      consoleErrors, ...layout,
    }, null, 2));
  });
}
