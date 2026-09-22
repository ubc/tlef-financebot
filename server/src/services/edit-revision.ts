/** Legacy documents start at revision zero; every authoring write advances it. */
export function editRevisionFilter(expectedRevision?: number): Record<string, unknown> {
  if (expectedRevision === undefined) return {};
  return expectedRevision === 0
    ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
    : { revision: expectedRevision };
}

export function editConflict(resource: string): Error & { status: number } {
  return Object.assign(new Error(`${resource} changed since you opened it. Your changes were not saved. Keep your draft and reload the latest version before trying again.`), { status: 409 });
}

export function assertEditRevision(resource: string, current: { revision?: number }, expectedRevision?: number): void {
  if (expectedRevision !== undefined && (current.revision ?? 0) !== expectedRevision) throw editConflict(resource);
}
