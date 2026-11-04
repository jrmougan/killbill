import { spawn } from 'node:child_process';
import { createProviderStub } from './provider-stub.mjs';
import { nonLocalDatabaseReason } from '../../src/lib/test-db-guard.mjs';

const mode = process.argv[2];
if (!['dev', 'standalone'].includes(mode)) throw new Error('Expected dev or standalone');
if (process.env.TEST_ROUTES_ENABLED !== 'true') throw new Error('E2E server requires TEST_ROUTES_ENABLED=true');
// Next.js would load .env by itself: read it here so the check sees the same values.
try { process.loadEnvFile(); } catch { /* no .env: CI passes real variables */ }
const nonLocal = nonLocalDatabaseReason(process.env);
if (nonLocal) throw new Error(`E2E wipes its database, refusing to start: ${nonLocal}`);
const provider = createProviderStub();
await new Promise((resolve, reject) => {
  provider.once('error', reject);
  provider.listen(0, '127.0.0.1', resolve);
});
const providerURL = `http://127.0.0.1:${provider.address().port}`;
const child = spawn(process.execPath, mode === 'standalone'
  ? ['.next/standalone/server.js']
  : ['node_modules/next/dist/bin/next', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OCR_TEST_PROVIDER_URL: providerURL,
    GEMINI_API_KEY: 'ocr-e2e-fake',
    OPENROUTER_API_KEY: 'ocr-e2e-fake',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal); provider.close(); });
}
child.once('error', error => {
  console.error(error.message);
  provider.close();
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  provider.close();
  process.exitCode = signal ? 1 : (code ?? 1);
});
