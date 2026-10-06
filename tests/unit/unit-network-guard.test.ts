import http from 'node:http';
import https from 'node:https';
import { assertUnitLoopbackRequest, installUnitNetworkGuard } from './setup/network-guard';

describe('unit test external network guard', () => {
  it('blocks external fetch before a network request can begin', async () => {
    await expect(fetch('https://synthetic-model.invalid/v1?private=do-not-print')).rejects.toThrow('External network is blocked in unit tests (synthetic-model.invalid)');
    await expect(fetch(new Request('https://another-synthetic.invalid/'))).rejects.toThrow('External network is blocked in unit tests');
  });
  it('blocks Node request/get and checks host overrides', () => {
    expect(() => http.request('http://synthetic-model.invalid/')).toThrow('External network is blocked in unit tests');
    expect(() => https.request({ hostname: 'synthetic-model.invalid', path: '/secret' })).toThrow('External network is blocked in unit tests');
    expect(() => http.get('http://synthetic-model.invalid/')).toThrow('External network is blocked in unit tests');
    expect(() => https.get('https://synthetic-model.invalid/')).toThrow('External network is blocked in unit tests');
    expect(() => http.request('http://127.0.0.1/', { hostname: 'synthetic-model.invalid' })).toThrow('External network is blocked in unit tests');
  });
  it('allows loopback HTTP used by supertest without allowing similar names', async () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(() => assertUnitLoopbackRequest(`http://${host}/`)).not.toThrow();
    expect(() => assertUnitLoopbackRequest('http://localhost.synthetic.invalid/')).toThrow('External network is blocked in unit tests');
    const server = http.createServer((_request, response) => response.end('local fixture'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback fixture did not bind a port');
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(await response.text()).toBe('local fixture');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('is idempotent and reports no private URL data', () => {
    const request = http.request;
    installUnitNetworkGuard();
    expect(http.request).toBe(request);
    try { assertUnitLoopbackRequest('https://synthetic.invalid/private?apiKey=secret'); }
    catch (error) {
      expect(String(error)).not.toMatch(/private|apiKey|secret/);
    }
  });
  it('prevents native fetch from following a loopback redirect outside the guard', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { Location: 'https://synthetic-model.invalid/v1' }); response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback fixture did not bind a port');
      await expect(fetch(`http://127.0.0.1:${address.port}/`, { redirect: 'follow' })).rejects.toThrow();
      expect((await fetch(`http://127.0.0.1:${address.port}/`, { redirect: 'manual' })).status).toBe(302);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
