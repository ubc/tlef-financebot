import { peopleImportChangesView } from './people-import-changes.js';
import { clearPeopleImport, commitPeopleImport, getPeopleImport, previewPeopleImport,
  type ImportedCoursePerson, type PeopleImportPreview, type PeopleImportSummary } from '../../api.js';
import { el, mount } from '../../dom.js';
import { uploadZone } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';

function counts(members: ImportedCoursePerson[]): string {
  return `${members.filter(m => m.role === 'student').length} Students · ${members.filter(m => m.role === 'instructor').length} Instructors · ${members.filter(m => m.role === 'ta').length} TAs`;
}

export function peopleImportPanel(courseId: string): HTMLElement {
  const status = el('div', { 'aria-live': 'polite' });
  const previewSlot = el('div', { class: 'people-import-preview', 'aria-live': 'polite' });
  const savedSlot = el('div', {});
  let saved: PeopleImportSummary | null = null;
  let selected: File | null = null;
  let preview: PeopleImportPreview | null = null;
  let requestId = 0;
  let writing = false;
  let showLatestChanges = false;
  function setWriting(value: boolean): void { writing = value; section.dispatchEvent(new CustomEvent('people-import-busy', { bubbles: true, detail: value })); }

  const fileZone = uploadZone('Drop a Canvas people CSV here or browse', files => { if (files[0]) void readFile(files[0]); });
  const fileInput = fileZone.querySelector('input')!;
  fileInput.accept = '.csv,text/csv'; fileInput.multiple = false;
  fileInput.setAttribute('aria-label', 'Canvas people CSV');
  const section = el('section', { class: 'stack', 'aria-labelledby': 'people-import-title' },
    el('h3', { id: 'people-import-title', text: 'Import people from Canvas' }),
    el('p', { class: 'admin-fine', text: 'In Canvas, open Grades → Export → Export Entire Gradebook, then upload the CSV here. SIS Login ID identifies the CWL account. Gradebook files contain students only; grades are ignored.' }),
    el('p', { class: 'admin-fine', text: 'For professors and TAs, use the template below with their exact Login ID from Canvas People and a Role of Teacher, TA or Student. A gradebook export cannot infer teaching roles.' }),
    el('a', { class: 'btn btn--ghost btn--sm', href: '/templates/canvas-people.csv', download: 'canvas-people.csv', text: 'Download people CSV template' }),
    el('p', { class: 'admin-fine', text: 'Imported people receive course access when they log in with CWL, including their first login. Students need a published course within its term dates. Re-import to reflect membership changes. This replaces only the previous people import; other course access remains.' }),
    savedSlot, fileZone, previewSlot, status);

  function showSaved(): void {
    if (!saved) return;
    savedSlot.replaceChildren(el('p', { text: saved.members.length ? `Current import: ${counts(saved.members)}. Updated ${new Date(saved.importedAt!).toLocaleString()}.` : 'No people imported yet.' }));
    if (saved.lastChanges) savedSlot.append(el('details', { open: showLatestChanges }, el('summary', { text: `Latest import: ${saved.lastChanges.added.length} newly added people` }), peopleImportChangesView(saved.lastChanges)));
    fileZone.hidden = !saved.canManage;
    if (!saved.canManage) savedSlot.append(el('p', { text: 'Only the course owner or an administrator can import or remove people.' }));
    if (saved.members.length) {
      savedSlot.append(peopleList(saved.members));
      if (saved.canManage) savedSlot.append(el('button', { class: 'btn btn--ghost', type: 'button', text: 'Remove imported access', onclick: async () => {
        if (writing || !saved) return;
        setWriting(true);
        try {
          if (!await confirmDialog({ title: 'Remove imported course access?', message: 'People will lose roles granted by this CSV import on their next request. Access granted through other methods remains.', confirmLabel: 'Remove imported access' })) return;
          saved = await clearPeopleImport(courseId, saved.revision);
          selected = null; preview = null; requestId++;
          previewSlot.replaceChildren(); showLatestChanges = true; showSaved(); status.replaceChildren(el('p', { text: 'Imported access removed.' }));
        } catch (error) { status.replaceChildren(errorState((error as Error).message, () => void loadSaved())); }
        finally { setWriting(false); }
      } }));
    }
  }

  function peopleList(members: ImportedCoursePerson[]): HTMLElement {
    return el('details', {}, el('summary', { text: `View people (${members.length})` }), el('ul', {},
      ...members.slice(0, 100).map(m => el('li', { text: `${m.name || m.puid} · ${m.puid} · ${m.role === 'instructor' ? 'Instructor' : m.role === 'ta' ? 'TA' : 'Student'}` }))),
      members.length > 100 && el('p', { text: 'Showing the first 100 people.' }));
  }

  async function loadSaved(): Promise<void> {
    status.replaceChildren(loadingState('Loading imported people…'));
    fileZone.hidden = true;
    selected = null; preview = null; requestId++; previewSlot.replaceChildren();
    try { saved = await getPeopleImport(courseId); showSaved(); status.replaceChildren(); }
    catch (error) { saved = null; status.replaceChildren(errorState((error as Error).message, () => void loadSaved())); }
  }

  async function readFile(file: File): Promise<void> {
    if (writing || !saved?.canManage) return;
    const current = ++requestId;
    selected = null; preview = null;
    previewSlot.replaceChildren(loadingState(`Reading ${file.name}…`)); status.replaceChildren();
    try {
      const result = await previewPeopleImport(courseId, file);
      if (current !== requestId || !section.isConnected) return;
      selected = file; preview = result; renderPreview();
    } catch (error) {
      if (current === requestId) previewSlot.replaceChildren(errorState((error as Error).message));
    }
  }

  function renderPreview(): void {
    if (!preview || !saved) return;
    const teaching = preview.members.some(m => m.role !== 'student');
    const confirmTeaching = el('input', { type: 'checkbox', id: 'people-import-teaching' });
    const confirmText = el('label', { for: confirmTeaching.id, text: 'I confirm these Instructors and TAs should receive access to the whole FinanceBot course.' });
    const submit = el('button', { class: 'btn btn--instr-primary', type: 'button', text: 'Import people', disabled: !preview.members.length || teaching, onclick: async () => {
      if (writing || !saved || !selected || !preview?.members.length || (teaching && !confirmTeaching.checked)) return;
      setWriting(true); const file = selected; const current = requestId;
      try {
        if (!await confirmDialog({ title: 'Import course people?', message: `Confirm these are current active members of this FinanceBot course. ${counts(preview.members)} will receive course roles when they log in with CWL. This replaces the previous CSV people import.`, confirmLabel: 'Import people' })) return;
        saved = await commitPeopleImport(courseId, file, preview.expectedRevision ?? saved.revision, confirmTeaching.checked);
        if (current !== requestId || !section.isConnected) return;
        selected = null; preview = null; previewSlot.replaceChildren(); showLatestChanges = true; showSaved();
        window.dispatchEvent(new CustomEvent('course-people-changed', { detail: courseId }));
        status.replaceChildren(el('p', { text: `Imported ${counts(saved.members)}. ${saved.lastChanges?.added.length ?? 0} newly added people; see the names above. FinanceBot profiles are created on first CWL login.` }));
      } catch (error) { status.replaceChildren(errorState((error as Error).message, () => void loadSaved())); }
      finally { setWriting(false); }
    } });
    confirmTeaching.addEventListener('change', () => { submit.disabled = !preview?.members.length || (teaching && !confirmTeaching.checked); });
    mount(previewSlot, preview.changes && peopleImportChangesView(preview.changes), el('p', { text: `${counts(preview.members)} · ${preview.rejects.length} rejected rows · ${preview.ignoredRows} metadata/empty rows ignored.` }),
      el('p', { class: 'admin-fine', text: `Identity: ${preview.identityColumn}. Roles: ${preview.roleColumn ?? 'Student (file has no role column)'}.` }), peopleList(preview.members),
      ...preview.warnings.map(warning => el('p', { class: 'admin-fine', text: warning })),
      preview.rejects.length > 0 && el('details', {}, el('summary', { text: `Review rejected rows (${preview.rejects.length})` }),
        el('ul', {}, ...preview.rejects.slice(0, 100).map(r => el('li', { text: `Row ${r.line}: ${r.value || '(blank)'} — ${r.reason}` })))),
      teaching && el('div', {}, confirmTeaching, confirmText),
      preview.members.length === 0 && el('p', { text: 'No usable people. Your previous import will be kept.' }), submit);
  }
  void loadSaved();
  return section;
}
