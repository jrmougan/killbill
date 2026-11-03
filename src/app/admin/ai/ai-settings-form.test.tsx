import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AiProviderView, AiSettingsView } from '@/lib/ai-settings-schemas';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AiSettingsForm } = await import('./ai-settings-form');

const gemini = (over: Partial<AiProviderView> = {}): AiProviderView => ({
    provider: 'gemini',
    keySource: 'none',
    keyHint: null,
    keyUndecryptable: false,
    model: 'gemini-flash-latest',
    modelSource: 'default',
    defaultModel: 'gemini-flash-latest',
    fallbackModel: 'gemini-flash-latest',
    ...over,
});

const openrouter = (over: Partial<AiProviderView> = {}): AiProviderView => ({
    provider: 'openrouter',
    keySource: 'none',
    keyHint: null,
    keyUndecryptable: false,
    model: 'xiaomi/mimo-v2.6-flash',
    modelSource: 'default',
    defaultModel: 'xiaomi/mimo-v2.6-flash',
    fallbackModel: 'xiaomi/mimo-v2.6-flash',
    ...over,
});

const view = (g: Partial<AiProviderView> = {}, o: Partial<AiProviderView> = {}): AiSettingsView => ({
    providers: [gemini(g), openrouter(o)],
});

const fetchMock = vi.fn();
const respondWith = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
const card = (name: string) => within(screen.getByRole('region', { name }));
const geminiCard = () => card('Google Gemini');
const keyInput = () => geminiCard().getByLabelText('Clave de API') as HTMLInputElement;
const modelInput = () => geminiCard().getByLabelText('Modelo') as HTMLInputElement;
const saveButton = () => geminiCard().getByRole('button', { name: 'Guardar' });

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
});

describe('AiSettingsForm', () => {
    it('shows the status of each key source with only the hint', () => {
        render(
            <AiSettingsForm
                settings={view(
                    { keySource: 'database', keyHint: 'abcd', model: 'gemini-pro', modelSource: 'database' },
                    { keySource: 'environment', keyHint: 'wxyz', model: 'vendor/env-model', modelSource: 'environment', fallbackModel: 'vendor/env-model' },
                )}
            />,
        );
        expect(geminiCard().getByText(/Clave guardada aquí/)).toHaveTextContent('••••abcd');
        expect(geminiCard().getByText(/En uso/)).toHaveTextContent('gemini-pro (guardado aquí)');
        const router = card('OpenRouter');
        expect(router.getByText(/Clave de variable de entorno/)).toHaveTextContent('••••wxyz');
        expect(router.getByText(/En uso/)).toHaveTextContent('vendor/env-model (de variable de entorno)');
        expect(router.getByLabelText('Modelo')).toHaveAttribute('placeholder', 'vendor/env-model');
    });

    it('shows an unconfigured provider, with the default model as placeholder', () => {
        render(<AiSettingsForm settings={view()} />);
        expect(geminiCard().getByText('Sin configurar')).toBeInTheDocument();
        expect(geminiCard().queryByText(/••••/)).not.toBeInTheDocument();
        expect(modelInput().value).toBe('');
        expect(modelInput()).toHaveAttribute('placeholder', 'gemini-flash-latest');
        expect(geminiCard().queryByRole('button', { name: 'Restablecer modelo' })).not.toBeInTheDocument();
    });

    it('shows the env model as placeholder while a stored model hides it', () => {
        render(
            <AiSettingsForm
                settings={view({}, { model: 'vendor/db-model', modelSource: 'database', fallbackModel: 'vendor/env-model' })}
            />,
        );
        const input = card('OpenRouter').getByLabelText('Modelo') as HTMLInputElement;
        expect(input.value).toBe('vendor/db-model');
        expect(input).toHaveAttribute('placeholder', 'vendor/env-model');
    });

    it('never prefills the key input, and asks the browser not to autofill it', () => {
        render(<AiSettingsForm settings={view({ keySource: 'database', keyHint: 'abcd' })} />);
        expect(keyInput().value).toBe('');
        expect(keyInput()).toHaveAttribute('type', 'password');
        expect(keyInput()).toHaveAttribute('autocomplete', 'new-password');
    });

    it('clears the key input after saving and shows the new hint', async () => {
        respondWith(view({ keySource: 'database', keyHint: '5678' }));
        render(<AiSettingsForm settings={view()} />);

        fireEvent.change(keyInput(), { target: { value: '  key-12345678  ' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(keyInput().value).toBe(''));
        expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ai-settings');
        expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
        expect(lastBody()).toEqual({ provider: 'gemini', apiKey: 'key-12345678' });
        expect(geminiCard().getByText(/Clave guardada aquí/)).toHaveTextContent('••••5678');
        expect(await screen.findByText('Configuración guardada')).toBeInTheDocument();
    });

    it('sends only the field that changed', async () => {
        respondWith(view({ model: 'gemini-pro', modelSource: 'database' }));
        render(<AiSettingsForm settings={view()} />);

        fireEvent.change(modelInput(), { target: { value: 'gemini-pro' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(lastBody()).toEqual({ provider: 'gemini', model: 'gemini-pro' });
        await waitFor(() => expect(modelInput().value).toBe('gemini-pro'));
    });

    it('sends both fields when both changed, on the card that was edited', async () => {
        respondWith(view({}, { keySource: 'database', keyHint: '5678', model: 'a/b', modelSource: 'database' }));
        render(<AiSettingsForm settings={view()} />);
        const router = card('OpenRouter');

        fireEvent.change(router.getByLabelText('Clave de API'), { target: { value: 'key-12345678' } });
        fireEvent.change(router.getByLabelText('Modelo'), { target: { value: 'a/b' } });
        fireEvent.click(router.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(lastBody()).toEqual({ provider: 'openrouter', apiKey: 'key-12345678', model: 'a/b' });
    });

    it('cannot save while nothing differs from what is stored', () => {
        render(<AiSettingsForm settings={view({ model: 'gemini-pro', modelSource: 'database' })} />);
        expect(saveButton()).toBeDisabled();

        fireEvent.change(modelInput(), { target: { value: 'other' } });
        expect(saveButton()).toBeEnabled();
        fireEvent.change(modelInput(), { target: { value: 'gemini-pro' } });
        expect(saveButton()).toBeDisabled();

        fireEvent.change(keyInput(), { target: { value: '   ' } });
        expect(saveButton()).toBeDisabled();
    });

    it('an emptied model input sends model:null', async () => {
        respondWith(view());
        render(<AiSettingsForm settings={view({ model: 'gemini-pro', modelSource: 'database' })} />);
        expect(modelInput().value).toBe('gemini-pro');

        fireEvent.change(modelInput(), { target: { value: '' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(lastBody()).toEqual({ provider: 'gemini', model: null });
        await waitFor(() => expect(geminiCard().getByText(/En uso/)).toHaveTextContent('gemini-flash-latest (predeterminado)'));
    });

    it('"Restablecer modelo" sends model:null and keeps an unsaved key draft', async () => {
        respondWith(view());
        render(<AiSettingsForm settings={view({ model: 'gemini-pro', modelSource: 'database' })} />);

        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(geminiCard().getByRole('button', { name: 'Restablecer modelo' }));

        await waitFor(() => expect(modelInput().value).toBe(''));
        expect(lastBody()).toEqual({ provider: 'gemini', model: null });
        expect(keyInput().value).toBe('key-12345678');
    });

    it('"Quitar clave" appears only for a stored key', () => {
        render(<AiSettingsForm settings={view({ keySource: 'database', keyHint: 'abcd' }, { keySource: 'environment', keyHint: 'wxyz' })} />);
        expect(geminiCard().getByRole('button', { name: 'Quitar clave' })).toBeInTheDocument();
        expect(card('OpenRouter').queryByRole('button', { name: 'Quitar clave' })).not.toBeInTheDocument();
    });

    it('"Quitar clave" sends apiKey:null only after confirming', async () => {
        respondWith(view());
        render(<AiSettingsForm settings={view({ keySource: 'database', keyHint: 'abcd' })} />);

        fireEvent.click(geminiCard().getByRole('button', { name: 'Quitar clave' }));
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(within(screen.getByTestId('ai-key-remove-sheet')).getByRole('button', { name: 'Quitar clave' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(lastBody()).toEqual({ provider: 'gemini', apiKey: null });
        await waitFor(() => expect(screen.queryByTestId('ai-key-remove-sheet')).not.toBeInTheDocument());
        expect(geminiCard().getByText('Sin configurar')).toBeInTheDocument();
    });

    it('shows a failed removal inside the sheet, which stays open', async () => {
        respondWith({ error: 'Error al guardar la configuración de IA' }, 500);
        render(<AiSettingsForm settings={view({ keySource: 'database', keyHint: 'abcd' })} />);

        fireEvent.click(geminiCard().getByRole('button', { name: 'Quitar clave' }));
        fireEvent.click(within(screen.getByTestId('ai-key-remove-sheet')).getByRole('button', { name: 'Quitar clave' }));

        expect(await screen.findByTestId('confirm-sheet-error')).toHaveTextContent('Error al guardar la configuración de IA');
        expect(screen.getByTestId('ai-key-remove-sheet')).toBeInTheDocument();
    });

    it('warns about an undecryptable key and lets it be removed', () => {
        render(<AiSettingsForm settings={view({ keySource: 'environment', keyHint: 'wxyz', keyUndecryptable: true })} />);
        expect(geminiCard().getByText(/no se puede descifrar/)).toBeInTheDocument();
        expect(geminiCard().getByRole('button', { name: 'Quitar clave' })).toBeInTheDocument();
        expect(card('OpenRouter').queryByText(/no se puede descifrar/)).not.toBeInTheDocument();
    });

    it('shows an API error on the card and keeps what was typed', async () => {
        respondWith({ error: 'La clave de API debe tener entre 8 y 512 caracteres, sin espacios' }, 400);
        render(<AiSettingsForm settings={view()} />);

        fireEvent.change(keyInput(), { target: { value: 'short' } });
        fireEvent.click(saveButton());

        expect(await geminiCard().findByRole('alert')).toHaveTextContent('La clave de API debe tener entre 8 y 512 caracteres');
        expect(keyInput().value).toBe('short');
        expect(geminiCard().getByText('Sin configurar')).toBeInTheDocument();
        expect(card('OpenRouter').queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a network failure', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed'));
        render(<AiSettingsForm settings={view()} />);

        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(saveButton());

        expect(await geminiCard().findByRole('alert')).toHaveTextContent('Sin conexión');
        expect(keyInput().value).toBe('key-12345678');
    });
});
