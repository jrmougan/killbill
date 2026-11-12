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

describe('AiSettingsForm: selector de modelo', () => {
    const MODELS_URL = '/api/admin/ai-settings/models';
    const withKey = { keySource: 'database', keyHint: 'abcd' } as const;
    const geminiModels = {
        provider: 'gemini',
        models: [
            { id: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
            { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        ],
    };
    const options = () => geminiCard().getAllByRole('option').map((option) => option.textContent);
    const option = (name: RegExp) => geminiCard().getByRole('option', { name });

    it('does not call the provider until the field is used, then lists its models', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(modelInput()).toHaveAttribute('role', 'combobox');
        expect(modelInput()).toHaveAttribute('aria-expanded', 'false');

        fireEvent.focus(modelInput());
        expect(geminiCard().getByText('Cargando modelos…')).toBeInTheDocument();

        await waitFor(() => expect(geminiCard().getByRole('listbox', { name: 'Modelos con visión' })).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`${MODELS_URL}?provider=gemini`);
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(modelInput()).toHaveAttribute('aria-expanded', 'true');
        expect(options()).toEqual([
            'Usar el predeterminadogemini-flash-latest',
            'Gemini Flash Latest (actual)gemini-flash-latest',
            'Gemini 3.1 Progemini-3.1-pro',
            'Gemini 2.5 Flashgemini-2.5-flash',
        ]);
    });

    it('"Ver modelos" loads and toggles the list', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);

        fireEvent.click(geminiCard().getByRole('button', { name: 'Ver modelos' }));
        await waitFor(() => expect(geminiCard().getByRole('listbox')).toBeInTheDocument());

        fireEvent.click(geminiCard().getByRole('button', { name: 'Ocultar modelos' }));
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();

        fireEvent.click(geminiCard().getByRole('button', { name: 'Ver modelos' }));
        expect(geminiCard().getByRole('listbox')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('picking a model fills the field, and saving sends its id', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());

        fireEvent.click(await geminiCard().findByRole('option', { name: /Gemini 3\.1 Pro/ }));
        expect(modelInput().value).toBe('gemini-3.1-pro');
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();

        respondWith(view({ ...withKey, model: 'gemini-3.1-pro', modelSource: 'database' }));
        fireEvent.click(saveButton());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(lastBody()).toEqual({ provider: 'gemini', model: 'gemini-3.1-pro' });
    });

    it('lists the model in use even when the provider does not offer it', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view({ ...withKey, model: 'gemini-retired', modelSource: 'database' })} />);
        expect(modelInput().value).toBe('gemini-retired');

        fireEvent.focus(modelInput());

        await geminiCard().findByRole('listbox');
        expect(await geminiCard().findByRole('option', { name: 'gemini-retired (actual)' })).toHaveAttribute('aria-selected', 'true');
        // A stored id that is not listed is a selection, not a search: nothing is hidden.
        expect(options()).toHaveLength(5);
    });

    it('filters by id or name while typing, and says when nothing matches', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('listbox');

        fireEvent.change(modelInput(), { target: { value: 'PRO' } });
        expect(options()).toEqual(['Gemini 3.1 Progemini-3.1-pro']);

        fireEvent.change(modelInput(), { target: { value: '2.5-fl' } });
        expect(options()).toEqual(['Gemini 2.5 Flashgemini-2.5-flash']);

        fireEvent.change(modelInput(), { target: { value: 'custom-model' } });
        expect(geminiCard().queryAllByRole('option')).toHaveLength(0);
        expect(geminiCard().getByText(/Ningún modelo coincide/)).toBeInTheDocument();
        expect(saveButton()).toBeEnabled();
    });

    it('paints at most 50 rows of a long list and narrows it by typing', async () => {
        const models = Array.from({ length: 120 }, (_, i) => ({ id: `vendor/model-${i}`, label: `Model ${i}` }));
        respondWith({ provider: 'openrouter', models });
        render(<AiSettingsForm settings={view()} />);
        const router = card('OpenRouter');

        // OpenRouter lists without a key.
        fireEvent.focus(router.getByLabelText('Modelo'));
        await router.findByRole('listbox');
        expect(fetchMock.mock.calls[0][0]).toBe(`${MODELS_URL}?provider=openrouter`);
        // 50 models + the default row + the model in use (not listed).
        expect(router.getAllByRole('option')).toHaveLength(52);
        expect(router.getByText('Mostrando 50 de 120. Escribe para filtrar.')).toBeInTheDocument();

        fireEvent.change(router.getByLabelText('Modelo'), { target: { value: 'model-119' } });
        expect(router.getAllByRole('option').map((o) => o.textContent)).toEqual(['Model 119vendor/model-119']);
    });

    it('"Usar el predeterminado" empties the field', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view({ ...withKey, model: 'gemini-3.1-pro', modelSource: 'database' })} />);
        fireEvent.focus(modelInput());

        fireEvent.click(await geminiCard().findByRole('option', { name: /Usar el predeterminado/ }));
        expect(modelInput().value).toBe('');

        respondWith(view(withKey));
        fireEvent.click(saveButton());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(lastBody()).toEqual({ provider: 'gemini', model: null });
    });

    it('arrow keys and Enter pick a model without submitting the form', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('listbox');

        fireEvent.keyDown(modelInput(), { key: 'ArrowDown' });
        fireEvent.keyDown(modelInput(), { key: 'ArrowDown' });
        fireEvent.keyDown(modelInput(), { key: 'ArrowDown' });
        expect(modelInput()).toHaveAttribute('aria-activedescendant', option(/Gemini 3\.1 Pro/).id);
        fireEvent.keyDown(modelInput(), { key: 'Enter' });

        expect(modelInput().value).toBe('gemini-3.1-pro');
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(modelInput(), { key: 'ArrowDown' });
        expect(geminiCard().getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(modelInput(), { key: 'Escape' });
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('without a Gemini key it asks for one, does not call the API and still accepts a typed model', async () => {
        respondWith(view({ model: 'gemini-typed', modelSource: 'database' }));
        render(<AiSettingsForm settings={view()} />);
        expect(geminiCard().getByText(/Guarda una clave de API para ver los modelos disponibles/)).toBeInTheDocument();
        expect(geminiCard().queryByRole('button', { name: 'Ver modelos' })).not.toBeInTheDocument();

        fireEvent.focus(modelInput());
        expect(fetchMock).not.toHaveBeenCalled();

        fireEvent.change(modelInput(), { target: { value: 'gemini-typed' } });
        fireEvent.click(saveButton());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(lastBody()).toEqual({ provider: 'gemini', model: 'gemini-typed' });
    });

    it('shows why the list failed, keeps manual entry and retries', async () => {
        respondWith({ error: 'El proveedor ha rechazado la clave de API: no es válida o no tiene permiso', code: 'AI_KEY_REJECTED' }, 422);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());

        expect(await geminiCard().findByText(/El proveedor ha rechazado la clave de API.*Puedes escribir el modelo a mano\./)).toBeInTheDocument();
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();
        // The listing failure is not the save error.
        expect(geminiCard().queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.change(modelInput(), { target: { value: 'gemini-by-hand' } });
        expect(saveButton()).toBeEnabled();

        respondWith(geminiModels);
        fireEvent.change(modelInput(), { target: { value: '' } });
        fireEvent.click(geminiCard().getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(geminiCard().getByRole('listbox')).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(geminiCard().queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    });

    it('a network failure does not double the full stop', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed'));
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        expect(await geminiCard().findByText('Sin conexión. Inténtalo de nuevo. Puedes escribir el modelo a mano.')).toBeInTheDocument();
    });

    it('asks for the list again after the key of that provider is saved', async () => {
        respondWith({ error: 'El proveedor ha rechazado la clave de API: no es válida o no tiene permiso' }, 422);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('button', { name: 'Reintentar' });

        respondWith(view({ keySource: 'database', keyHint: '5678' }));
        respondWith(geminiModels);
        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(saveButton());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
        expect(fetchMock.mock.calls[2][0]).toBe(`${MODELS_URL}?provider=gemini`);
        await waitFor(() => expect(options()).toHaveLength(4));
        expect(geminiCard().queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    });

    it('asks again when the list was requested while the key was being saved', async () => {
        let answerPatch!: (res: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answerPatch = resolve)));
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(saveButton());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // The list is asked for against the previous key while the PATCH is in flight.
        respondWith({ models: [{ id: 'gemini-old-key', label: 'Old key model' }] });
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('option', { name: /Old key model/ });

        respondWith(geminiModels);
        answerPatch(new Response(JSON.stringify(view({ keySource: 'database', keyHint: '5678' }))));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls[2][0]).toBe(`${MODELS_URL}?provider=gemini`);
        await waitFor(() => expect(geminiCard().queryByRole('option', { name: /Old key model/ })).not.toBeInTheDocument());
        expect(options()).toHaveLength(4);
    });

    it('saving a key does not ask for a list that was never requested', async () => {
        respondWith(view({ keySource: 'database', keyHint: '5678' }));
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(saveButton());
        expect(await screen.findByText('Configuración guardada')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('drops a list requested while the only Gemini key was being removed', async () => {
        let answerPatch!: (res: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answerPatch = resolve)));
        render(<AiSettingsForm settings={view({ keySource: 'database', keyHint: '1234' })} />);
        fireEvent.click(geminiCard().getByRole('button', { name: 'Quitar clave' }));
        fireEvent.click(within(screen.getByTestId('ai-key-remove-sheet')).getByRole('button', { name: 'Quitar clave' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        respondWith(geminiModels);
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('listbox');

        answerPatch(new Response(JSON.stringify(view())));
        expect(await geminiCard().findByText(/Guarda una clave de API para ver los modelos disponibles/)).toBeInTheDocument();
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();

        // A key saved later starts from an empty list, not from the stale one.
        respondWith(view({ keySource: 'database', keyHint: '5678' }));
        fireEvent.change(keyInput(), { target: { value: 'key-12345678' } });
        fireEvent.click(saveButton());
        expect(await screen.findByText('Configuración guardada')).toBeInTheDocument();
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('drops the list when the only Gemini key is removed', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        await geminiCard().findByRole('listbox');

        respondWith(view());
        fireEvent.click(geminiCard().getByRole('button', { name: 'Quitar clave' }));
        fireEvent.click(within(screen.getByTestId('ai-key-remove-sheet')).getByRole('button', { name: 'Quitar clave' }));

        expect(await geminiCard().findByText(/Guarda una clave de API para ver los modelos disponibles/)).toBeInTheDocument();
        expect(geminiCard().queryByRole('listbox')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('saving only the model does not ask for the list again', async () => {
        respondWith(geminiModels);
        render(<AiSettingsForm settings={view(withKey)} />);
        fireEvent.focus(modelInput());
        fireEvent.click(await geminiCard().findByRole('option', { name: /Gemini 2\.5 Flash/ }));

        respondWith(view({ ...withKey, model: 'gemini-2.5-flash', modelSource: 'database' }));
        fireEvent.click(saveButton());
        expect(await screen.findByText('Configuración guardada')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
