import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Parsed values of a .env file. */
export function readEnvFile(path) {
  return parseEnv(readFileSync(path, 'utf8'));
}

/**
 * Sets KEY=value lines in a .env file, keeping every other line and comment, and
 * appends the keys it does not have. Atomic (rename) and 0600: .env holds secrets.
 * Values must not need quoting (ports, hex secrets, URLs without spaces).
 * @param {string} path
 * @param {Record<string, string | number>} values
 */
export function updateEnvFile(path, values) {
  let text = readFileSync(path, 'utf8');
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw);
    if (/[\s"'#\\]/.test(value)) throw new Error(`Value for ${key} would need quoting`);
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, () => `${key}=${value}`)
      : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
