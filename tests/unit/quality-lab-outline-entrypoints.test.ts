it('keeps outline preflight entrypoints free of configuration, database and provider initialization', () => {
  jest.isolateModules(() => {
    for (const dependency of [
      '../../server/src/config/env', '../../server/src/components/mongodb',
      '../../server/src/components/genai/llm', '../../server/src/services/structure-generation.service',
    ]) jest.doMock(dependency, () => { throw new Error(`Live dependency imported during offline setup: ${dependency}`); });
    expect(() => require('../../scripts/quality-lab/run-outline-experiment')).not.toThrow();
    expect(() => require('../../scripts/quality-lab/run-outline-warm-cache')).not.toThrow();
  });
});
