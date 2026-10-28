jest.mock('../../server/src/config/env', () => ({ env: { samlEnvironment: 'STAGING', nodeEnv: 'staging', samlDebugAttributes: true } }));
import { env } from '../../server/src/config/env';
import { logSamlAttributes } from '../../server/src/components/auth/saml-logging';

it.each([
  ['STAGING', 'staging', true, false], ['PRODUCTION', 'production', true, false],
  ['LOCAL', 'production', true, false], ['LOCAL', 'staging', true, false],
  ['LOCAL', 'development', false, false], ['LOCAL', 'development', true, true],
])('limits attribute values in %s/%s with debug=%s', (samlEnvironment, nodeEnv, debug, allowed) => {
  Object.assign(env, { samlEnvironment, nodeEnv, samlDebugAttributes: debug });
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const attributes = { mail: 'synthetic-person@example.test', cn: 'Synthetic Private Person', ubcEduCwlPuid: 'SYNTHETIC-PRIVATE-PUID', cwlLoginName: 'synthetic-private-login' };
    logSamlAttributes({ ...attributes, attributes }, attributes);
    const output = JSON.stringify([log.mock.calls, warn.mock.calls]);
    expect(output).toContain('assertion attribute names');
    expect(output.includes('synthetic-person@example.test')).toBe(allowed);
    expect(output.includes('SYNTHETIC-PRIVATE-PUID')).toBe(allowed);
    expect(output.includes('Synthetic Private Person')).toBe(allowed);
  } finally { log.mockRestore(); warn.mockRestore(); }
});
