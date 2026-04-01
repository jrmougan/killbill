import { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';

  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseURL);
      if (res.ok || res.status < 500) {
        console.log(`Server is up at ${baseURL}`);
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `Server at ${baseURL} did not respond within 10 seconds. Last error: ${lastError}`
  );
}

export default globalSetup;
