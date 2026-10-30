import { createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Validate the existing key and remove PEM envelope annotations, not key material. */
export function normalizePrivateKey(contents: string): string {
  try {
    // Do not silently select one key from an ambiguous bundle.
    if ((contents.match(/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/g) ?? []).length > 1) throw new Error();
    return createPrivateKey(contents).export({ format: 'pem', type: 'pkcs8' }).toString();
  } catch {
    throw new Error('SAML SP private key could not be parsed. Provide one readable, unencrypted private key in SAML_PRIVATE_KEY_PATH. Key contents are not logged.');
  }
}

/** The wrapper accepts a filename only and reads it synchronously in its constructor. */
export function withPrivateKeyPath<T>(configuredPath: string | undefined, construct: (keyPath?: string) => T): T {
  if (!configuredPath) return construct(undefined);
  let contents: string;
  try { contents = fs.readFileSync(path.resolve(configuredPath), 'utf8'); }
  catch { throw new Error('SAML SP private key could not be read. Check SAML_PRIVATE_KEY_PATH and service file permissions.'); }
  let pem: string;
  try { pem = normalizePrivateKey(contents); }
  catch {
    // Preserve the library's existing validation for unsupported input (including
    // its base64 formats). A format repair must not newly take the app offline.
    console.warn('[server] SAML: SP key normalization unavailable; retaining library validation. Check the configured key format.');
    return construct(configuredPath);
  }
  // Directory 0700 and exclusive file 0600; never rewrite the configured key.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'financebot-saml-'));
  try {
    const filename = path.join(directory, 'key.pem');
    fs.writeFileSync(filename, pem, { mode: 0o600, flag: 'wx' });
    return construct(filename);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
