import type { ObjectId } from 'mongodb';
import type { CourseRole } from './domain';

export interface ImportedCoursePerson {
  puid: string;
  name: string;
  role: CourseRole;
}

/** One revisioned, replaceable grant source per course; never placeholder Users. */
export interface CoursePeopleImport {
  lastChanges?: PeopleImportChanges;
  _id: ObjectId;
  courseId: ObjectId;
  revision: number;
  members: ImportedCoursePerson[];
  importedAt: Date;
  importedByPuid: string;
  fileName: string;
}

export interface PeopleImportPreview {
  expectedRevision?: number;
  changes?: PeopleImportChanges;
  columns: string[];
  identityColumn: string;
  roleColumn: string | null;
  members: ImportedCoursePerson[];
  rejects: Array<{ line: number; value: string; reason: string }>;
  totalRows: number;
  ignoredRows: number;
  warnings: string[];
}

export interface PeopleImportChanges {
  comparison: 'previous-csv-import';
  added: Array<{ puid: string; name: string; roles: ImportedCoursePerson['role'][] }>;
  removed: Array<{ puid: string; name: string; roles: ImportedCoursePerson['role'][] }>;
  roleChanged: Array<{ puid: string; name: string; roles: ImportedCoursePerson['role'][]; previousRoles: ImportedCoursePerson['role'][] }>;
  unchanged: number;
}
