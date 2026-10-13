import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccessTokensSettings, activeTokensLabel, mcpClientConfig, type AccessTokenItem } from './access-tokens';

const fetchMock = vi.fn();

const tok = (over: Partial<AccessTokenItem> = {}): AccessTokenItem => ({
    id: 't1',
    name: 'Portátil',
    prefix: 'kb_AbCdEfGh',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastUsedAt: null,
    expiresAt: '2026-12-30T10:00:00.000Z',
    status: 'active',
    ...over,
});

const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

/** Routes the mocked fetch by method + URL; `list` is what GET returns (mutable). */
function api(opts: { list?: AccessTokenItem[]; post?: (init?: RequestInit) => Promise<Response>; del?: () => Promise<Response> } = {}) {
    const state = { list: opts.list ?? [] };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/me/tokens' && method === 'GET') return json(200, { tokens: state.list });
        if (url === '/api/me/tokens' && method === 'POST') return opts.post ? opts.post(init) : json(500, {});
        if (url.startsWith('/api/me/tokens/') && method === 'DELETE') return opts.del ? opts.del() : json(500, {});
        throw new Error(`unexpected ${method} ${url}`);
    });
    return state;
}

const renderRow = () => render(<AccessTokensSettings rowClassName="row" />);
const openList = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Tokens de acceso/ }));
    return screen.findByRole('dialog', { name: 'Tokens de acceso' });
};

// jsdom has no <dialog> modal API; the Sheet opens/closes through it.
beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute('open');
    };
});
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('helpers', () => {
    it('summarises only active tokens', () => {
        expect(activeTokensLabel(null)).toBe('Conecta un agente o cliente MCP');
        expect(activeTokensLabel([tok({ status: 'revoked' })])).toBe('Conecta un agente o cliente MCP');
        expect(activeTokensLabel([tok()])).toBe('1 activo');
        expect(activeTokensLabel([tok(), tok({ id: 't2' }), tok({ id: 't3', status: 'expired' })])).toBe('2 activos');
    });

    it('builds a generic mcpServers config', () => {
        expect(JSON.parse(mcpClientConfig('https://x.test/api/mcp', 'kb_secret'))).toEqual({
            mcpServers: { killbill: { url: 'https://x.test/api/mcp', headers: { Authorization: 'Bearer kb_secret' } } },
        });
    });
});

describe('Ajustes · tokens de acceso', () => {
    it('shows the active count on the row and lists tokens with their state', async () => {
        api({
            list: [
                tok(),
                tok({ id: 't2', name: 'Viejo', status: 'revoked' }),
                tok({ id: 't3', name: 'Eterno', expiresAt: null, lastUsedAt: '2026-10-05T10:00:00.000Z' }),
            ],
        });
        renderRow();
        await waitFor(() => expect(screen.getByTestId('access-tokens-summary')).toHaveTextContent('2 activos'));

        const dialog = await openList();
        const rows = await within(dialog).findAllByTestId('access-token-row');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('kb_AbCdEfGh…');
        expect(rows[0]).toHaveTextContent('Sin usar');
        expect(rows[0]).toHaveTextContent(/Caduca el/);
        expect(rows[1]).toHaveTextContent('Revocado');
        expect(within(rows[1]).queryByRole('button', { name: /Revocar/ })).toBeNull();
        expect(rows[2]).toHaveTextContent('Sin caducidad');
        expect(rows[2]).toHaveTextContent(/Último uso el/);
        expect(screen.queryByText(/Hermes/)).toBeNull();
    });

    it('creates a token, shows it once in a non-dismissible sheet with a generic config', async () => {
        let body: unknown;
        const state = api({
            post: (init) => {
                body = JSON.parse(String(init?.body));
                state.list = [tok({ id: 'new', name: 'Claude', expiresAt: null })];
                return json(201, { token: 'kb_plaintextsecret', ...tok({ id: 'new', name: 'Claude', expiresAt: null }) });
            },
        });
        renderRow();
        await waitFor(() => expect(screen.getByTestId('access-tokens-summary')).toHaveTextContent('Conecta un agente o cliente MCP'));
        const list = await openList();
        fireEvent.click(within(list).getByRole('button', { name: 'Nuevo token' }));

        const create = await screen.findByRole('dialog', { name: 'Nuevo token' });
        const generate = within(create).getByRole('button', { name: 'Generar token' });
        expect(generate).toBeDisabled();
        expect(within(create).getByRole('radio', { name: '90 días' })).toBeChecked();
        fireEvent.change(within(create).getByPlaceholderText('p. ej. Claude Desktop, portátil'), { target: { value: '  Claude  ' } });
        fireEvent.click(within(create).getByRole('radio', { name: 'Sin caducidad' }));
        expect(within(create).getByTestId('token-no-expiry-warning')).toHaveTextContent('No caducará nunca');

        fireEvent.click(generate);

        const created = await screen.findByRole('dialog', { name: 'Guarda tu token ahora' });
        expect(body).toEqual({ name: 'Claude', expiresInDays: null });
        expect(within(created).getByTestId('access-token-value')).toHaveTextContent('kb_plaintextsecret');
        expect(created).toHaveTextContent('No caduca.');
        expect(created).toHaveTextContent(`${window.location.origin}/api/mcp`);
        expect(created).toHaveTextContent('Authorization: Bearer kb_plaintextsecret');
        expect(within(created).getByTestId('access-token-config')).toHaveTextContent('"mcpServers"');
        expect(created).not.toHaveTextContent(/hermes/i);
        // Not dismissible: no X, Escape ignored.
        expect(within(created).queryByRole('button', { name: 'Cerrar' })).toBeNull();
        fireEvent(created, new Event('cancel', { cancelable: true }));
        expect(screen.getByRole('dialog', { name: 'Guarda tu token ahora' })).toBeInTheDocument();

        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        fireEvent.click(within(created).getByRole('button', { name: 'Copiar token' }));
        await within(created).findByRole('button', { name: 'Token copiado' });
        expect(writeText).toHaveBeenCalledWith('kb_plaintextsecret');

        fireEvent.click(within(created).getByRole('button', { name: 'He guardado el token' }));
        await screen.findByRole('dialog', { name: 'Tokens de acceso' });
        expect(screen.queryByText('kb_plaintextsecret')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('access-tokens-summary')).toHaveTextContent('1 activo'));
    });

    it('shows the API error on create (409 TOKEN_LIMIT)', async () => {
        api({
            post: () =>
                json(409, {
                    error: 'Has alcanzado el máximo de 20 tokens activos. Revoca alguno antes de crear otro.',
                    code: 'TOKEN_LIMIT',
                }),
        });
        renderRow();
        const list = await openList();
        fireEvent.click(within(list).getByRole('button', { name: 'Nuevo token' }));
        const create = await screen.findByRole('dialog', { name: 'Nuevo token' });
        fireEvent.change(within(create).getByPlaceholderText('p. ej. Claude Desktop, portátil'), { target: { value: 'X' } });
        fireEvent.click(within(create).getByRole('button', { name: 'Generar token' }));
        expect(await within(create).findByRole('alert')).toHaveTextContent('máximo de 20 tokens activos');
        expect(screen.queryByRole('dialog', { name: 'Guarda tu token ahora' })).toBeNull();
    });

    it('revokes a token after confirmation', async () => {
        const state = api({ list: [tok()], del: () => json(200, { success: true }) });
        renderRow();
        await waitFor(() => expect(screen.getByTestId('access-tokens-summary')).toHaveTextContent('1 activo'));
        const list = await openList();
        fireEvent.click(await within(list).findByRole('button', { name: 'Revocar Portátil' }));

        const confirm = await screen.findByRole('dialog', { name: '¿Revocar «Portátil»?' });
        state.list = [tok({ status: 'revoked' })];
        fireEvent.click(within(confirm).getByRole('button', { name: 'Revocar' }));

        await screen.findByRole('dialog', { name: 'Tokens de acceso' });
        expect(fetchMock).toHaveBeenCalledWith('/api/me/tokens/t1', { method: 'DELETE' });
        await waitFor(() => expect(screen.getByTestId('access-tokens-summary')).toHaveTextContent('Conecta un agente o cliente MCP'));
        expect(await screen.findByText('Revocado')).toBeInTheDocument();
    });

    it('shows a 404 on revoke and keeps the confirmation open', async () => {
        api({ list: [tok()], del: () => json(404, { error: 'Token no encontrado' }) });
        renderRow();
        const list = await openList();
        fireEvent.click(await within(list).findByRole('button', { name: 'Revocar Portátil' }));
        const confirm = await screen.findByRole('dialog', { name: '¿Revocar «Portátil»?' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Revocar' }));
        expect(await within(confirm).findByRole('alert')).toHaveTextContent('Token no encontrado');
    });
});
