// Pure-logic tests for the Question Bank (I7) / Question Detail (I6) helpers
// (Task 15, Task E). No DOM needed for any of these — importing api.ts,
// bank.ts, and question-detail.ts also pulls in dom.ts/render.ts (DOM-
// touching), but merely importing doesn't execute document access, so this is
// safe under jest's node test environment. See
// client/src/api.ts (bankFiltersToQuery), client/src/views/instructor/bank.ts
// (statusToBadgeVariant), client/src/views/instructor/question-detail.ts
// (isFieldEdited).
import { bankFiltersToQuery, type BankFilters } from '../../client/src/api';
import { statusToBadgeVariant } from '../../client/src/views/instructor/bank';
import { isFieldEdited } from '../../client/src/views/instructor/question-detail';

describe('bankFiltersToQuery', () => {
  it('returns an empty string for no filters', () => {
    expect(bankFiltersToQuery({})).toBe('');
  });

  it('encodes a single filter as a leading-? querystring', () => {
    expect(bankFiltersToQuery({ state: 'approved' })).toBe('?state=approved');
  });

  it('encodes multiple filters, one param per key', () => {
    const filters: BankFilters = { state: 'draft', type: 'mcq', difficulty: 'hard' };
    const qs = bankFiltersToQuery(filters);
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('state')).toBe('draft');
    expect(params.get('type')).toBe('mcq');
    expect(params.get('difficulty')).toBe('hard');
  });

  it('omits loId/themeId/label when not provided', () => {
    const qs = bankFiltersToQuery({ state: 'archived' });
    expect(qs).toBe('?state=archived');
  });

  it('includes loId, themeId, and label when provided', () => {
    const qs = bankFiltersToQuery({ loId: 'lo1', themeId: 'theme1', label: 'source-changed' });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('loId')).toBe('lo1');
    expect(params.get('themeId')).toBe('theme1');
    expect(params.get('label')).toBe('source-changed');
  });
});

describe('statusToBadgeVariant', () => {
  it('maps every PublicationState to its badge variant', () => {
    expect(statusToBadgeVariant('draft')).toBe('draft');
    expect(statusToBadgeVariant('pending-review')).toBe('pending');
    expect(statusToBadgeVariant('reviewed')).toBe('reviewed');
    expect(statusToBadgeVariant('approved')).toBe('approved');
    expect(statusToBadgeVariant('paused')).toBe('paused');
    expect(statusToBadgeVariant('archived')).toBe('archived');
  });
});

describe('isFieldEdited', () => {
  it('returns false for identical strings', () => {
    expect(isFieldEdited('same stem', 'same stem')).toBe(false);
  });

  it('returns true for differing strings', () => {
    expect(isFieldEdited('new stem', 'old stem')).toBe(true);
  });

  it('returns false for identical arrays regardless of the two references', () => {
    expect(isFieldEdited(['a', 'b'], ['a', 'b'])).toBe(false);
  });

  it('returns true for arrays that differ', () => {
    expect(isFieldEdited(['a', 'b'], ['a', 'c'])).toBe(true);
  });

  it('treats undefined vs undefined as unedited', () => {
    expect(isFieldEdited(undefined, undefined)).toBe(false);
  });
});
