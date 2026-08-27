import { INDEX_SPECS } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));

describe('Phase 6 index specs', () => {
  const specs = INDEX_SPECS.filter((s) => s.collection === 'lmsRosterEntries');
  it('has both unique lmsRosterEntries indexes', () => {
    expect(specs).toHaveLength(2);
    expect(specs.every((s) => s.options?.unique)).toBe(true);
    expect(specs.map((s) => Object.keys(s.keys).at(-1))).toEqual(['externalUserId', 'puid']);
  });
  it('pins the materials origin partial index name', () => {
    const origin = INDEX_SPECS.find((s) => s.options?.name === 'materials_origin_unique');
    expect(origin?.options?.partialFilterExpression).toEqual({ 'origin.provider': { $type: 'string' } });
  });
});
