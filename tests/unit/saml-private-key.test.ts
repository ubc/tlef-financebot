import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Passport } from 'passport';
import { Strategy } from 'passport-ubcshib';
import request from 'supertest';
import { normalizePrivateKey, withPrivateKeyPath } from '../../server/src/components/auth/private-key';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const annotated = `Bag Attributes\n    friendlyName: synthetic-only\n${pem}`;
const publicDer = (key: string) => createPublicKey(key).export({ type: 'spki', format: 'der' });
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-key-test-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

it.each([pem, annotated, pem.replace(/\n/g, '\r\n')])('preserves the existing cryptographic identity when normalizing PEM', input => {
  const normalized = normalizePrivateKey(input);
  expect(normalized).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  expect(publicDer(normalized)).toEqual(publicDer(pem));
  expect(normalized).not.toContain('Bag Attributes');
});

it.each(['not-a-key-private-marker', pem + pem, pem.replace(/\n/g, '\\n'),
  pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  pair.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'synthetic' }).toString(),
])('refuses invalid, ambiguous, public or encrypted input without exposing it', input => {
  expect(() => normalizePrivateKey(input)).toThrow('SAML SP private key could not be parsed.');
  try { normalizePrivateKey(input); } catch (error) { expect((error as Error).message).not.toContain(input); }
});

it('uses an exclusive restricted file only during synchronous construction and preserves the original', () => {
  const original = path.join(directory, 'original.pem'); fs.writeFileSync(original, annotated);
  let temporary = '';
  withPrivateKeyPath(original, filename => {
    temporary = filename!;
    expect(fs.statSync(filename!).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filename!)).mode & 0o777).toBe(0o700);
    expect(publicDer(fs.readFileSync(filename!, 'utf8'))).toEqual(publicDer(pem));
  });
  expect(fs.existsSync(path.dirname(temporary))).toBe(false);
  expect(fs.readFileSync(original, 'utf8')).toBe(annotated);
  expect(() => withPrivateKeyPath(original, filename => { temporary = filename!; throw new Error('constructor failure'); })).toThrow('constructor failure');
  expect(fs.existsSync(path.dirname(temporary))).toBe(false);
});

it('keeps LOCAL no-key behavior and gives safe missing-file guidance', () => {
  expect(withPrivateKeyPath(undefined, filename => filename)).toBeUndefined();
  expect(() => withPrivateKeyPath(path.join(directory, 'missing'), () => undefined)).toThrow('could not be read');
});

it('preserves library validation for unsupported input without logging key contents', () => {
  const filename = path.join(directory, 'unsupported.pem');
  fs.writeFileSync(filename, 'private-marker-unsupported');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(withPrivateKeyPath(filename, received => received)).toBe(filename);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-marker');
  } finally { warn.mockRestore(); }
});

it('generates a real signed login redirect using the new wrapper after its temporary key file is removed', async () => {
  const filename = path.join(directory, 'original.pem'); fs.writeFileSync(filename, annotated);
  const strategy = withPrivateKeyPath(filename, privateKeyPath => new Strategy({
    issuer: 'https://synthetic-sp.invalid', callbackUrl: 'https://synthetic-sp.invalid/callback',
    entryPoint: 'https://synthetic-idp.invalid/sso', cert: 'synthetic-idp-cert', privateKeyPath,
    validateInResponseTo: false, enableSLO: false,
  }, (_profile, done) => done(null, false)));
  const passport = new Passport(); passport.use(strategy);
  const app = express(); app.use(passport.initialize()); app.get('/login', passport.authenticate('ubcshib'));
  const response = await request(app).get('/login');
  expect(response.status).toBe(302);
  const target = new URL(response.headers.location);
  expect(target.origin).toBe('https://synthetic-idp.invalid');
  const signedQuery = target.search.slice(1).split('&Signature=')[0];
  expect(verify('RSA-SHA256', Buffer.from(signedQuery), pair.publicKey, Buffer.from(target.searchParams.get('Signature')!, 'base64'))).toBe(true);
  expect(fs.readFileSync(filename, 'utf8')).toBe(annotated);
});
