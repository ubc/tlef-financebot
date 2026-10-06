import { comparePeopleImports } from '../../server/src/services/people-import-diff';
import type { ImportedCoursePerson } from '../../server/src/types/people-import';
const person = (puid: string, role: ImportedCoursePerson['role'] = 'student', name = puid): ImportedCoursePerson => ({ puid, name, role });
test('first import marks unique people added, never individual duplicate role rows', () => {
  const result = comparePeopleImports([], [person('A'), person('A', 'ta'), person('B')]);
  expect(result.added.map(p => p.puid)).toEqual(['A', 'B']); expect(result.added[0].roles).toEqual(['student', 'ta']);
  expect(result.unchanged).toBe(0); expect(result.removed).toEqual([]);
});
test('late joiners are identified by exact Login ID with readable names', () => {
  const result = comparePeopleImports([person('OLD')], [person('OLD'), person('LATE', 'student', 'Late Student')]);
  expect(result.added).toEqual([{ puid: 'LATE', name: 'Late Student', roles: ['student'] }]); expect(result.unchanged).toBe(1);
});
test('row reordering, name corrections and duplicate rows cannot inflate additions', () => {
  const result = comparePeopleImports([person('A'), person('B')], [person('B', 'student', 'Changed Name'), person('A'), person('A')]);
  expect(result).toMatchObject({ added: [], removed: [], roleChanged: [], unchanged: 2 });
});
test('role changes are separated from genuinely new identities', () => {
  const result = comparePeopleImports([person('A'), person('A', 'ta')], [person('A', 'instructor')]);
  expect(result.added).toEqual([]); expect(result.removed).toEqual([]); expect(result.roleChanged).toEqual([{ puid: 'A', name: 'A', previousRoles: ['student', 'ta'], roles: ['instructor'] }]);
});
test('missing rows are explicit and PUID casing is never normalized', () => {
  const result = comparePeopleImports([person('ABC'), person('REMOVED')], [person('abc')]);
  expect(result.added.map(p => p.puid)).toEqual(['abc']); expect(result.removed.map(p => p.puid)).toEqual(['ABC', 'REMOVED']);
});
