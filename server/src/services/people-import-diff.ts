import type { ImportedCoursePerson, PeopleImportChanges } from '../types/people-import';

/** Compare exact PUID identities, not names, row order or student numbers. */
export function comparePeopleImports(previous: ImportedCoursePerson[], next: ImportedCoursePerson[]): PeopleImportChanges {
  function identities(members: ImportedCoursePerson[]) {
    const people = new Map<string, { puid: string; name: string; roles: ImportedCoursePerson['role'][] }>();
    for (const member of members) {
      const person = people.get(member.puid) ?? { puid: member.puid, name: member.name, roles: [] };
      if (!person.roles.includes(member.role)) person.roles.push(member.role);
      if (member.name) person.name = member.name;
      person.roles.sort(); people.set(member.puid, person);
    }
    return people;
  }
  const before = identities(previous); const after = identities(next);
  const added = [...after.values()].filter(p => !before.has(p.puid));
  const removed = [...before.values()].filter(p => !after.has(p.puid));
  const roleChanged = [...after.values()].flatMap(p => {
    const old = before.get(p.puid);
    return old && old.roles.join(',') !== p.roles.join(',') ? [{ ...p, previousRoles: old.roles }] : [];
  });
  const unchanged = [...after.keys()].filter(puid => before.has(puid)).length - roleChanged.length;
  return { comparison: 'previous-csv-import', added, removed, roleChanged, unchanged };
}
